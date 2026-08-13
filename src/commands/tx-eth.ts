import { Binary, type TxEvent } from "polkadot-api";
import type { ChainConfig } from "../config/types.ts";
import { primaryRpc } from "../config/types.ts";
import { type EthereumIdentity, resolveEthereumPrivateKey, toSs58 } from "../core/accounts.ts";
import { type ClientHandle, createChainClient } from "../core/client.ts";
import {
  decodeRevertData,
  encodeDeploymentData,
  encodeFunctionCall,
  ethereumAddressFromPrivateKey,
  limbsToU256,
  looksLikeConstructorSignature,
  looksLikeFunctionSignature,
  predictCreateAddress,
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
  buildBareTx,
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
  dest: string | null; // EIP-55 H160, or null for a contract deployment (CREATE)
  data: string; // 0x calldata, or init code when `dest` is null
  signature?: string; // human ABI signature, when used
}

const DEPLOY_USAGE =
  "Usage: dot <chain>.tx.Revive.instantiate_with_code <0xcode|@file> ['constructor(types)' args...] [--value <wei>] --from <ethereum-account>";

// Deploy bytecode is far too long to paste, so the code argument also accepts
// `@<path>` — a file of hex, with or without the 0x prefix and trailing
// whitespace, which is exactly what `solc --bin` and foundry's `*.bin` emit.
async function readBytecodeArg(raw: string): Promise<string> {
  if (!raw.startsWith("@")) {
    if (!/^0x([0-9a-fA-F]{2})*$/.test(raw)) {
      throw new CliError(
        `"${raw}" is neither 0x-hex bytecode nor an @file reference.\n${DEPLOY_USAGE}`,
      );
    }
    return raw;
  }
  const path = raw.slice(1);
  let contents: string;
  try {
    contents = await Bun.file(path).text();
  } catch {
    throw new CliError(`Cannot read bytecode file "${path}".`);
  }
  const hex = contents.trim().replace(/\s+/g, "");
  const body = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (!/^([0-9a-fA-F]{2})*$/.test(body) || body.length === 0) {
    throw new CliError(
      `File "${path}" does not contain contract bytecode (expected an even number of hex characters).`,
    );
  }
  return `0x${body}`;
}

// Parse the positional args of an ethereum-signed contract deployment:
//   <0xcode|@file> ['constructor(types)' args...]
async function parseEthereumDeployArgs(args: string[]): Promise<ParsedEthereumCall> {
  const [codeArg, ...rest] = args;
  if (!codeArg) {
    throw new CliError(`Contract bytecode is required.\n${DEPLOY_USAGE}`);
  }
  const bytecode = await readBytecodeArg(codeArg);

  const [first, ...ctorArgs] = rest;
  if (first !== undefined && !looksLikeConstructorSignature(first)) {
    throw new CliError(
      `"${first}" is not a constructor signature like 'constructor(string,uint256)'.\n${DEPLOY_USAGE}`,
    );
  }
  return {
    dest: null,
    data: await encodeDeploymentData(bytecode, first, ctorArgs),
    signature: first,
  };
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
  to: string | null;
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

function byteLength(hex: string): number {
  return Math.max(0, (hex.length - 2) / 2);
}

// Deploy init code runs to kilobytes of hex and would bury the rest of the
// report. Only deployments abbreviate — a call's calldata prints verbatim, as
// it always has, and `--json` always carries the full value either way.
const HEX_ABBREVIATE_ABOVE = 128;

function abbreviateHex(hex: string): string {
  if (hex.length <= HEX_ABBREVIATE_ABOVE) return hex;
  return `${hex.slice(0, 66)}…${hex.slice(-8)} (${byteLength(hex)} bytes)`;
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

// The authoritative deployed address: pallet-revive reports it as
// `Revive.Instantiated { deployer, contract }`.
function deployedContractFromEvents(
  events: readonly { type?: string; value?: { type?: string; value?: unknown } }[] | undefined,
): string | undefined {
  const instantiated = events?.find((e) => e.type === "Revive" && e.value?.type === "Instantiated");
  const contract = (instantiated?.value?.value as { contract?: unknown } | undefined)?.contract;
  if (contract === undefined) return undefined;
  const hex = toHexData(contract);
  return isH160Hex(hex) ? toEip55(h160FromHex(hex)) : undefined;
}

// Which contract address a deployment may report, if any. A dispatch error
// created no contract, so neither the event nor the predicted address may be
// shown — emitting one would hand a script an address that does not exist.
// Before inclusion there is no event yet, but the signed nonce already fixes
// the address, so it is offered as `predicted`.
function deployReport(
  result: { type: string; ok?: boolean; events?: readonly unknown[] },
  predictedContract: string | undefined,
): { address: string; predicted: boolean } | undefined {
  if (result.type === "broadcasted") {
    return predictedContract ? { address: predictedContract, predicted: true } : undefined;
  }
  if (!result.ok) return undefined;
  const address =
    deployedContractFromEvents(result.events as Parameters<typeof deployedContractFromEvents>[0]) ??
    predictedContract;
  return address ? { address, predicted: false } : undefined;
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
  // Supplied by the caller, which already resolved it to decide on this path.
  // Optional so the pre-connect guards stay callable without a keystore.
  identity?: EthereumIdentity,
): Promise<void> {
  if (/^0x[0-9a-fA-F]+$/.test(target)) {
    throw new CliError(
      `Raw call hex is a substrate call and cannot be signed by ethereum account "${accountName}". Use dot <chain>.tx.Revive.call <dest> <data> --from ${accountName}.`,
    );
  }
  // Two eth-transactable targets: a call (`to` = contract) and a deployment
  // (`to` = null, data = init code). Everything else is a substrate extrinsic a
  // secp256k1 key cannot sign.
  const normalizedTarget = target.toLowerCase();
  const isDeploy =
    normalizedTarget === "revive.instantiate_with_code" ||
    normalizedTarget === "revive.eth_instantiate_with_code";
  if (normalizedTarget !== "revive.call" && !isDeploy) {
    throw new CliError(
      `Ethereum account "${accountName}" holds a secp256k1 key and cannot sign substrate extrinsics.\n` +
        `It can call a contract:   dot <chain>.tx.Revive.call <dest> [data] --from ${accountName}\n` +
        `or deploy one:            dot <chain>.tx.Revive.instantiate_with_code <0xcode|@file> --from ${accountName}\n` +
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

  const call = isDeploy ? await parseEthereumDeployArgs(args) : await parseEthereumCallArgs(args);
  const value = parseValueOption(opts.value);
  const nonceOverride = parseNonceOption(opts.nonce);
  const waitLevel = parseWaitLevel(opts.wait);

  const privateKey = identity?.privateKey ?? (await resolveEthereumPrivateKey(accountName));
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

    // A CREATE address is a pure function of sender and nonce, so it is known
    // before submission. On the real submit the `Revive.Instantiated` event is
    // authoritative and replaces this.
    const predictedContract = isDeploy ? await predictCreateAddress(fromH160, nonce) : undefined;

    if (opts.dryRun) {
      if (isJsonOutput(opts)) {
        console.log(
          formatJson({
            chain: chainName,
            from: { name: accountName, address: fromH160, ss58: fallbackSs58 },
            to: call.dest,
            deploy: isDeploy || undefined,
            contract: predictedContract,
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
      if (isDeploy) {
        console.log(
          `  ${BOLD}Deploy:${RESET} ${byteLength(call.data)} bytes of init code ${DIM}(CREATE)${RESET}`,
        );
        console.log(
          `  ${BOLD}Contract:${RESET} ${predictedContract} ${DIM}(predicted from nonce ${nonce})${RESET}`,
        );
      } else {
        console.log(`  ${BOLD}To:${RESET}     ${call.dest}`);
      }
      if (call.signature) console.log(`  ${BOLD}Method:${RESET} ${CYAN}${call.signature}${RESET}`);
      console.log(`  ${BOLD}Data:${RESET}   ${isDeploy ? abbreviateHex(call.data) : call.data}`);
      if (value > 0n) console.log(`  ${BOLD}Value:${RESET}  ${value} wei`);
      console.log(`  ${BOLD}Nonce:${RESET}  ${nonce}`);
      console.log(`  ${BOLD}Gas:${RESET}    ${gas} @ ${gasPrice} wei`);
      if (storageDeposit > 0n) console.log(`  ${BOLD}Storage deposit:${RESET} ${storageDeposit}`);
      console.log(`  ${BOLD}Max fee:${RESET} ${maxFeeWei} wei`);
      if (returnData !== "0x") {
        // For a deployment the runtime returns the contract's runtime code —
        // its size is the useful signal, not kilobytes of hex.
        console.log(
          isDeploy
            ? `  ${BOLD}Code:${RESET}   ${byteLength(returnData)} bytes deployed`
            : `  ${BOLD}Return:${RESET} ${returnData}`,
        );
      }
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
    const bareTx = buildBareTx(callDataBytes);

    const observable = clientHandle.client.submitAndWatch(
      bareTx,
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
        deploy: isDeploy || undefined,
        contract: isDeploy ? deployReport(result, predictedContract)?.address : undefined,
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
    if (isDeploy) {
      console.log(
        `  ${BOLD}Deploy:${RESET} ${byteLength(call.data)} bytes of init code ${DIM}(CREATE)${RESET}`,
      );
      const deployed = deployReport(result, predictedContract);
      if (deployed) {
        const note = deployed.predicted ? ` ${DIM}(predicted — not yet in a block)${RESET}` : "";
        console.log(
          `  ${BOLD}Contract:${RESET} ${deployed.predicted ? deployed.address : `${GREEN}${deployed.address}${RESET}`}${note}`,
        );
      }
    } else {
      console.log(`  ${BOLD}To:${RESET}     ${call.dest}`);
    }
    if (call.signature) console.log(`  ${BOLD}Method:${RESET} ${CYAN}${call.signature}${RESET}`);
    console.log(`  ${BOLD}Data:${RESET}   ${isDeploy ? abbreviateHex(call.data) : call.data}`);
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
  abbreviateHex,
  buildGenericTransaction,
  deployedContractFromEvents,
  deployReport,
  formatEthTransactError,
  parseEthereumCallArgs,
  parseEthereumDeployArgs,
  parseValueOption,
  toHexData,
};
