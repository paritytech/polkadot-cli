import { Binary, type TxEvent } from "polkadot-api";
import type { ChainConfig } from "../config/types.ts";
import { primaryRpc } from "../config/types.ts";
import { resolveEthereumPrivateKey, toSs58 } from "../core/accounts.ts";
import { type ClientHandle, createChainClient } from "../core/client.ts";
import {
  decodeRevertData,
  encodeFunctionCall,
  ethereumAddressFromPrivateKey,
  limbsToU256,
  looksLikeFunctionSignature,
  signEthereumTransaction,
  u256ToLimbs,
} from "../core/ethereum.ts";
import { papiLink, pjsAppsLink } from "../core/explorers.ts";
import { h160FromHex, h160ToFallbackAccountId, isH160Hex, toEip55 } from "../core/h160.ts";
import { findPallet, findRuntimeApi, getOrFetchMetadata } from "../core/metadata.ts";
import {
  BOLD,
  CYAN,
  DIM,
  formatJson,
  GREEN,
  isJsonOutput,
  printJsonLine,
  RED,
  RESET,
} from "../core/output.ts";
import { CliError } from "../utils/errors.ts";
import {
  buildGeneralTx,
  formatDispatchError,
  formatEventValue,
  parseCallArgs,
  parseNonceOption,
  parseTypedArg,
  parseWaitLevel,
  watchTransaction,
  watchTransactionJson,
} from "./tx.ts";

export interface EthereumTxOptions {
  rpc?: string;
  value?: string;
  dryRun?: boolean;
  encode?: boolean;
  toYaml?: boolean;
  toJson?: boolean;
  ext?: string;
  asset?: string;
  tip?: string;
  mortality?: string;
  wait?: string;
  nonce?: string;
  at?: string;
  output?: string;
  json?: boolean;
}

interface ParsedEthereumCall {
  dest: string; // EIP-55 H160
  data: string; // 0x calldata
  signature?: string; // human ABI signature, when used
}

// Parse the positional args of an ethereum-signed contract call:
//   <dest> [<0xcalldata> | <signature> [args...]]
async function parseEthereumCallArgs(args: string[]): Promise<ParsedEthereumCall> {
  const usage =
    "Usage: dot <chain>.tx.Revive.call <dest-h160> [<0xcalldata> | '<sig(types)>' [args...]] [--value <wei>] --from <ethereum-account>";

  const [destArg, ...rest] = args;
  if (!destArg) {
    throw new CliError(`Contract address is required.\n${usage}`);
  }
  if (!isH160Hex(destArg)) {
    throw new CliError(
      `"${destArg}" is not a valid contract address (0x + 40 hex chars).\n${usage}`,
    );
  }
  const dest = toEip55(h160FromHex(destArg));

  if (rest.length === 0) {
    return { dest, data: "0x" };
  }

  const [first, ...fnArgs] = rest;
  if (/^0x([0-9a-fA-F]{2})*$/.test(first!)) {
    if (fnArgs.length > 0) {
      throw new CliError(`Raw calldata takes no further arguments.\n${usage}`);
    }
    return { dest, data: first! };
  }

  if (looksLikeFunctionSignature(first!)) {
    return { dest, data: await encodeFunctionCall(first!, fnArgs), signature: first! };
  }

  throw new CliError(
    `"${first}" is neither 0x-hex calldata nor a function signature like 'transfer(address,uint256)'.\n${usage}`,
  );
}

function parseValueOption(raw: string | undefined): bigint {
  if (raw === undefined) return 0n;
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    throw new CliError(
      `Invalid --value "${raw}". Expected an integer amount in wei (18 decimals).`,
    );
  }
  if (value < 0n) {
    throw new CliError(`--value must be non-negative, got ${raw}.`);
  }
  return value;
}

// The GenericTransaction struct ReviveApi.eth_transact expects, as the JSON
// shape the CLI's own typed-arg parser understands (it is then converted into
// papi values via `parseTypedArg`, the same path `dot <chain>.apis…` uses).
// U256 fields are 4 little-endian u64 limbs.
function buildGenericTransaction(params: {
  from: string;
  to: string;
  data: string;
  value: bigint;
  nonce: bigint;
}) {
  const limbs = (v: bigint) => u256ToLimbs(v).map(String);
  return {
    access_list: null,
    authorization_list: [],
    blob_versioned_hashes: [],
    blobs: [],
    chain_id: null,
    from: params.from,
    gas: null,
    gas_price: null,
    input: { input: null, data: params.data },
    max_fee_per_blob_gas: null,
    max_fee_per_gas: null,
    max_priority_fee_per_gas: null,
    nonce: limbs(params.nonce),
    to: params.to,
    type: null,
    value: limbs(params.value),
  };
}

// Runtime-API results carry byte payloads either as papi Binary or as plain
// Uint8Array depending on the codec — normalize to 0x-hex.
function toHexData(value: unknown): string {
  if (value && typeof (value as { asHex?: unknown }).asHex === "function") {
    return (value as { asHex: () => string }).asHex();
  }
  if (value instanceof Uint8Array) {
    return Binary.toHex(value);
  }
  return "0x";
}

// Render the Err side of ReviveApi.eth_transact — `Data(Vec<u8>)` carries the
// contract's revert data, `Message(string)` a runtime-side message.
async function formatEthTransactError(err: { type: string; value: unknown }): Promise<string> {
  if (err.type === "Data") {
    const hex = toHexData(err.value);
    const decoded = await decodeRevertData(hex);
    return decoded ? `Contract ${decoded}` : `Contract reverted with data: ${hex}`;
  }
  if (err.type === "Message") {
    return String(err.value);
  }
  return JSON.stringify(err);
}

// Submit (or dry-run) a contract call as an Ethereum transaction signed by a
// secp256k1 account: price it via the ReviveApi.eth_transact dry-run, sign an
// EIP-1559 envelope, and submit it wrapped in the unsigned `Revive.eth_transact`
// extrinsic. No eth-rpc sidecar involved — same ws connection as everything else.
export async function handleEthereumTx(
  target: string,
  args: string[],
  accountName: string,
  chainName: string,
  chainConfig: ChainConfig,
  opts: EthereumTxOptions,
): Promise<void> {
  if (/^0x[0-9a-fA-F]+$/.test(target)) {
    throw new CliError(
      `Raw call hex is a substrate call and cannot be signed by ethereum account "${accountName}". Use dot <chain>.tx.Revive.call <dest> <data> --from ${accountName}.`,
    );
  }
  if (target.toLowerCase() !== "revive.call") {
    throw new CliError(
      `Ethereum account "${accountName}" holds a secp256k1 key and cannot sign substrate extrinsics.\n` +
        `It can only submit contract calls via: dot <chain>.tx.Revive.call <dest> [data] --from ${accountName}\n` +
        `(got: ${target})`,
    );
  }
  for (const [flag, set] of [
    ["--tip", opts.tip],
    ["--mortality", opts.mortality],
    ["--asset", opts.asset],
    ["--ext", opts.ext],
  ] as const) {
    if (set !== undefined) {
      throw new CliError(`${flag} does not apply to ethereum transactions (Revive.eth_transact).`);
    }
  }

  const call = await parseEthereumCallArgs(args);
  const value = parseValueOption(opts.value);
  const nonceOverride = parseNonceOption(opts.nonce);
  const waitLevel = parseWaitLevel(opts.wait);

  const privateKey = await resolveEthereumPrivateKey(accountName);
  const fromH160 = toEip55(await ethereumAddressFromPrivateKey(privateKey));
  const fallbackSs58 = toSs58(h160ToFallbackAccountId(h160FromHex(fromH160)));

  let clientHandle: ClientHandle | undefined;
  try {
    clientHandle = await createChainClient(chainName, chainConfig, opts.rpc);
    const meta = await getOrFetchMetadata(chainName, clientHandle);

    if (!findPallet(meta, "Revive") || !findRuntimeApi(meta, "ReviveApi")) {
      throw new CliError(
        `Chain "${chainName}" does not expose pallet-revive, so ethereum account "${accountName}" cannot transact on it.`,
      );
    }

    const unsafeApi = clientHandle.client.getUnsafeApi() as any;

    const [chainId, gasPriceLimbs, chainNonce] = await Promise.all([
      unsafeApi.constants.Revive.ChainId() as Promise<bigint>,
      unsafeApi.apis.ReviveApi.gas_price(),
      unsafeApi.apis.AccountNonceApi.account_nonce(fallbackSs58) as Promise<number>,
    ]);
    const gasPrice = limbsToU256(gasPriceLimbs);
    const nonce = nonceOverride !== undefined ? BigInt(nonceOverride) : BigInt(chainNonce);

    // Dry-run: prices the tx (eth_gas) and surfaces reverts before signing.
    // The GenericTransaction JSON goes through the CLI's typed-arg parser to
    // produce papi-compatible values (hand-built structs fail papi's
    // runtime-entry compatibility check).
    const ethTransactMethod = findRuntimeApi(meta, "ReviveApi")!.methods.find(
      (m) => m.name === "eth_transact",
    );
    if (!ethTransactMethod || ethTransactMethod.inputs.length !== 1) {
      throw new CliError(
        `Chain "${chainName}" does not expose ReviveApi.eth_transact(tx) — cannot price the transaction.`,
      );
    }
    const genericTx = await parseTypedArg(
      meta,
      meta.lookup(ethTransactMethod.inputs[0]!.type),
      JSON.stringify(
        buildGenericTransaction({
          from: fromH160,
          to: call.dest,
          data: call.data,
          value,
          nonce,
        }),
      ),
    );
    const dryRun = await unsafeApi.apis.ReviveApi.eth_transact(genericTx);

    if (!dryRun.success) {
      const message = await formatEthTransactError(dryRun.value);
      if (isJsonOutput(opts)) {
        printJsonLine({ event: "dryRunFailed", error: message });
      }
      throw new CliError(`Dry-run failed: ${message}`);
    }

    const gas = limbsToU256(dryRun.value.eth_gas);
    const storageDeposit = dryRun.value.storage_deposit as bigint;
    const returnData = toHexData(dryRun.value.data);
    const maxFeeWei = gas * gasPrice;

    if (opts.dryRun) {
      if (isJsonOutput(opts)) {
        console.log(
          formatJson({
            chain: chainName,
            from: { name: accountName, address: fromH160, ss58: fallbackSs58 },
            to: call.dest,
            signature: call.signature,
            data: call.data,
            value: String(value),
            nonce: String(nonce),
            chainId: String(chainId),
            gas: String(gas),
            gasPrice: String(gasPrice),
            maxFeeWei: String(maxFeeWei),
            storageDeposit: String(storageDeposit),
            returnData,
          }),
        );
        return;
      }
      console.log(`  ${BOLD}Chain:${RESET}  ${chainName} ${DIM}(eth chain id ${chainId})${RESET}`);
      console.log(`  ${BOLD}From:${RESET}   ${accountName} (${fromH160})`);
      console.log(`  ${BOLD}To:${RESET}     ${call.dest}`);
      if (call.signature) console.log(`  ${BOLD}Method:${RESET} ${CYAN}${call.signature}${RESET}`);
      console.log(`  ${BOLD}Data:${RESET}   ${call.data}`);
      if (value > 0n) console.log(`  ${BOLD}Value:${RESET}  ${value} wei`);
      console.log(`  ${BOLD}Nonce:${RESET}  ${nonce}`);
      console.log(`  ${BOLD}Gas:${RESET}    ${gas} @ ${gasPrice} wei`);
      if (storageDeposit > 0n) console.log(`  ${BOLD}Storage deposit:${RESET} ${storageDeposit}`);
      console.log(`  ${BOLD}Max fee:${RESET} ${maxFeeWei} wei`);
      if (returnData !== "0x") console.log(`  ${BOLD}Return:${RESET} ${returnData}`);
      return;
    }

    const payload = await signEthereumTransaction(privateKey, {
      chainId: Number(chainId),
      nonce,
      to: call.dest,
      value,
      data: call.data,
      gas,
      maxFeePerGas: gasPrice,
    });

    const callData = await parseCallArgs(meta, "Revive", "eth_transact", [payload]);
    const tx = unsafeApi.tx.Revive.eth_transact(callData);
    const callDataBytes = await tx.getEncodedData();
    const generalTx = buildGeneralTx(meta, callDataBytes, {});

    const observable = clientHandle.client.submitAndWatch(
      generalTx,
      opts.at,
    ) as import("rxjs").Observable<TxEvent>;

    const rpcUrl = primaryRpc(opts.rpc ?? chainConfig.rpc);

    if (isJsonOutput(opts)) {
      const result = await watchTransactionJson(observable, waitLevel, { unsigned: true });
      if (result.type === "broadcasted") {
        printJsonLine({ event: "broadcasted", txHash: result.txHash });
        return;
      }
      const blockHash = result.block.hash;
      const explorer: Record<string, string> = {};
      if (rpcUrl) {
        explorer.polkadotjs = pjsAppsLink(rpcUrl, blockHash);
        explorer.papi = papiLink(rpcUrl, blockHash);
      }
      printJsonLine({
        event: result.type === "finalized" ? "finalized" : "bestBlock",
        ethereum: true,
        from: { name: accountName, address: fromH160 },
        to: call.dest,
        blockNumber: result.block.number,
        blockHash,
        txHash: result.txHash,
        ok: result.ok,
        events: result.events?.map((e: any) => ({
          pallet: e.type,
          name: e.value?.type,
          fields: e.value?.value,
        })),
        dispatchError: result.ok ? null : formatDispatchError(result.dispatchError),
        explorer,
      });
      if (!result.ok) {
        throw new CliError(
          `Transaction dispatch error: ${formatDispatchError(result.dispatchError)}`,
        );
      }
      return;
    }

    const result = await watchTransaction(observable, waitLevel, { unsigned: true });

    console.log();
    console.log(`  ${BOLD}Chain:${RESET}  ${chainName} ${DIM}(eth chain id ${chainId})${RESET}`);
    console.log(`  ${BOLD}From:${RESET}   ${accountName} (${fromH160})`);
    console.log(`  ${BOLD}To:${RESET}     ${call.dest}`);
    if (call.signature) console.log(`  ${BOLD}Method:${RESET} ${CYAN}${call.signature}${RESET}`);
    console.log(`  ${BOLD}Data:${RESET}   ${call.data}`);
    if (value > 0n) console.log(`  ${BOLD}Value:${RESET}  ${value} wei`);
    console.log(`  ${BOLD}Nonce:${RESET}  ${nonce}`);
    console.log(`  ${BOLD}Gas:${RESET}    ${gas} @ ${gasPrice} wei`);
    console.log(`  ${BOLD}Tx:${RESET}     ${result.txHash}`);

    if (result.type === "broadcasted") {
      console.log(`  ${BOLD}Status:${RESET} ${GREEN}broadcasted${RESET}`);
      console.log(`  ${DIM}Note: tx was broadcast but not yet included in a block${RESET}`);
      console.log();
      return;
    }

    let dispatchErrorMsg: string | undefined;
    if (result.ok) {
      const hint =
        result.type === "txBestBlocksState" ? ` ${DIM}(best block, not yet finalized)${RESET}` : "";
      console.log(`  ${BOLD}Status:${RESET} ${GREEN}ok${RESET}${hint}`);
    } else {
      dispatchErrorMsg = formatDispatchError(result.dispatchError);
      console.log(`  ${BOLD}Status:${RESET} ${RED}dispatch error${RESET}`);
      console.log(`  ${BOLD}Error:${RESET}  ${dispatchErrorMsg}`);
    }

    if (result.events && result.events.length > 0) {
      console.log(`  ${BOLD}Events:${RESET}`);
      for (const event of result.events) {
        const name = `${CYAN}${event.type}${RESET}.${CYAN}${event.value?.type ?? ""}${RESET}`;
        const payload_ = event.value?.value;
        if (payload_ && typeof payload_ === "object") {
          const fields = Object.entries(payload_)
            .map(([k, v]) => `${k}: ${formatEventValue(v)}`)
            .join(", ");
          console.log(`    ${name} { ${fields} }`);
        } else {
          console.log(`    ${name}`);
        }
      }
    }

    if (rpcUrl) {
      const blockHash = result.block.hash;
      console.log(`  ${BOLD}Block:${RESET}  #${result.block.number} (${blockHash})`);
      console.log(`  ${BOLD}Explorer:${RESET}`);
      console.log(`    ${DIM}PolkadotJS${RESET}  ${pjsAppsLink(rpcUrl, blockHash)}`);
      console.log(`    ${DIM}PAPI${RESET}        ${papiLink(rpcUrl, blockHash)}`);
    }
    console.log();

    if (!result.ok) {
      throw new CliError(`Transaction dispatch error: ${dispatchErrorMsg}`);
    }
  } finally {
    clientHandle?.destroy();
  }
}

export {
  buildGenericTransaction,
  formatEthTransactError,
  parseEthereumCallArgs,
  parseValueOption,
  toHexData,
};
