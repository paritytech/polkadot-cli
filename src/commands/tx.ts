import { compact as scaleCompact } from "@polkadot-api/substrate-bindings";
import type { Decoded } from "@polkadot-api/view-builder";
import { getViewBuilder } from "@polkadot-api/view-builder";
import type { TxBestBlocksState, TxBroadcasted, TxEvent, TxFinalized } from "polkadot-api";
import { Binary } from "polkadot-api";
import { stringify as stringifyYaml } from "yaml";
import { loadConfig, resolveChain } from "../config/store.ts";
import { connectedEndpoint, primaryRpc } from "../config/types.ts";
import { resolveAccountSigner, toSs58 } from "../core/accounts.ts";
import { type ClientHandle, createChainClient } from "../core/client.ts";
import { papiLink, pjsAppsLink } from "../core/explorers.ts";
import type { Lookup, MetadataBundle } from "../core/metadata.ts";
import {
  describeCallArgs,
  describeType,
  findPallet,
  getOrFetchMetadata,
  getPalletNames,
  getSignedExtensions,
  listPallets,
  PAPI_BUILTIN_EXTENSIONS,
  withBlockAvailabilityHint,
  withStalenessSuggestion,
} from "../core/metadata.ts";
import {
  BOLD,
  CYAN,
  DIM,
  firstSentence,
  formatJson,
  formatPretty,
  GREEN,
  isJsonOutput,
  printHeading,
  printHeadingWithEndpoint,
  printItem,
  printJsonLine,
  RED,
  RESET,
  Spinner,
  YELLOW,
} from "../core/output.ts";
import { prettyCallArgs } from "../core/pretty-type.ts";
import { resolveAccountAddress } from "../core/resolve-address.ts";
import { binaryToDisplay } from "../utils/binary-display.ts";
import { CliError, formatRuntimeError } from "../utils/errors.ts";
import { suggestMessage } from "../utils/fuzzy-match.ts";
import { parseValue } from "../utils/parse-value.ts";
import { loadMeta, resolvePallet, showItemHelp } from "./focused-inspect.ts";

export type WaitLevel = "broadcast" | "best-block" | "finalized";

export function parseWaitLevel(raw?: string): WaitLevel {
  switch (raw) {
    case "broadcast":
      return "broadcast";
    case "best-block":
    case "best":
      return "best-block";
    case "finalized":
    case undefined:
      return "finalized";
    default:
      throw new CliError(
        `Invalid --wait value "${raw}". Valid: broadcast, best-block, best, finalized`,
      );
  }
}

export function parseNonceOption(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new CliError(`Invalid --nonce value "${raw}". Must be a non-negative integer.`);
  }
  return n;
}

export function parseTipOption(raw: string | undefined): bigint | undefined {
  if (raw === undefined) return undefined;
  try {
    const t = BigInt(raw);
    if (t < 0n) {
      throw new CliError(`Invalid --tip value "${raw}". Must be a non-negative integer.`);
    }
    return t;
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`Invalid --tip value "${raw}". Must be a non-negative integer.`);
  }
}

export type MortalityOption = { mortal: false } | { mortal: true; period: number };

export function parseMortalityOption(raw: string | undefined): MortalityOption | undefined {
  if (raw === undefined) return undefined;
  if (raw === "immortal") return { mortal: false };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 4) {
    throw new CliError(
      `Invalid --mortality value "${raw}". Use "immortal" or a period number (minimum 4).`,
    );
  }
  return { mortal: true, period: n };
}

export function parseAssetOption(raw: string | undefined): Record<string, any> | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("must be a JSON object");
    }
    return parsed;
  } catch (err: any) {
    throw new CliError(
      `Invalid --asset value: ${err.message}\n` +
        'Expected an XCM location, e.g. \'{"parents":0,"interior":{"type":"X2","value":[{"type":"PalletInstance","value":50},{"type":"GeneralIndex","value":"3"}]}}\'',
    );
  }
}

export function parseAtOption(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === "finalized") return undefined; // v2 defaults to finalized when omitted
  if (raw === "best") {
    throw new CliError(
      '"best" is no longer supported for --at in papi v2. Omit --at for finalized, or pass a specific block hash.',
    );
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  throw new CliError(
    `Invalid --at value "${raw}". Use a 0x-prefixed 32-byte block hash, or omit for finalized.`,
  );
}

// Storage reads / runtime API calls go through papi's `PullOptions`, which
// accepts "best" — unlike tx submission. Keep the two parsers separate so
// each call site is explicit about which semantics apply.
export function parseAtForRead(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === "best" || raw === "finalized") return raw;
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  throw new CliError(
    `Invalid --at value "${raw}". Use "best", "finalized", or a 0x-prefixed 32-byte block hash.`,
  );
}

export async function handleTx(
  target: string | undefined,
  args: string[],
  opts: {
    chain?: string;
    rpc?: string;
    from?: string;
    unsigned?: boolean;
    dryRun?: boolean;
    encode?: boolean;
    toYaml?: boolean;
    toJson?: boolean;
    output?: string;
    json?: boolean;
    ext?: string;
    asset?: string;
    wait?: string;
    nonce?: string;
    tip?: string;
    mortality?: string;
    at?: string;
    /** Pre-parsed args from a file (skip CLI string parsing, still normalize) */
    parsedArgs?: unknown;
  },
) {
  if (!target) {
    const config = await loadConfig();
    const { name: chainName, chain: chainConfig } = resolveChain(config, opts.chain);
    const endpoint = connectedEndpoint(chainConfig.rpc, opts.rpc);
    const meta = await loadMeta(chainName, chainConfig, opts.rpc);
    const pallets = listPallets(meta);
    const withCalls = pallets.filter((p) => p.calls.length > 0);

    if (isJsonOutput(opts)) {
      console.log(
        formatJson({
          chain: chainName,
          rpc: endpoint,
          pallets: withCalls.map((p) => ({ name: p.name, calls: p.calls.length })),
        }),
      );
      return;
    }

    printHeadingWithEndpoint(`Pallets with calls on ${chainName} (${withCalls.length})`, endpoint);
    for (const p of withCalls) {
      printItem(p.name, `${p.calls.length} calls`);
    }
    console.log();
    return;
  }

  // Check if this is a raw hex call
  const isRawCall = /^0x[0-9a-fA-F]+$/.test(target);

  // Check if target is pallet-only (no dot, not hex)
  if (!isRawCall && target.indexOf(".") === -1) {
    const config = await loadConfig();
    const { name: chainName, chain: chainConfig } = resolveChain(config, opts.chain);
    const meta = await loadMeta(chainName, chainConfig, opts.rpc);
    const pallet = resolvePallet(meta, target);

    if (pallet.calls.length === 0) {
      if (isJsonOutput(opts)) {
        console.log(formatJson({ chain: chainName, pallet: pallet.name, calls: [] }));
      } else {
        console.log(`No calls in ${pallet.name}.`);
      }
      return;
    }

    if (isJsonOutput(opts)) {
      console.log(
        formatJson({
          chain: chainName,
          pallet: pallet.name,
          calls: pallet.calls.map((c) => ({
            name: c.name,
            args: describeCallArgs(meta, pallet.name, c.name),
            docs: firstSentence(c.docs),
          })),
        }),
      );
      return;
    }

    printHeading(`${pallet.name} Calls`);
    for (const c of pallet.calls) {
      const callArgs = prettyCallArgs(meta, pallet.name, c.name, {
        indent: 2,
        prefix: c.name.length,
      });
      console.log(`  ${CYAN}${c.name}${RESET}${callArgs}`);
      const summary = firstSentence(c.docs);
      if (summary) {
        console.log(`      ${DIM}${summary}${RESET}`);
      }
    }
    console.log();
    return;
  }

  if (!opts.from && !opts.unsigned && !opts.encode && !opts.toYaml && !opts.toJson) {
    if (isRawCall) {
      throw new Error(
        "--from is required (or use --unsigned for bare tx, --encode for hex without signing)",
      );
    }
    await showItemHelp("tx", target, opts);
    return;
  }

  if (opts.encode && opts.dryRun) {
    throw new Error("--encode and --dry-run are mutually exclusive");
  }

  if (opts.encode && isRawCall) {
    throw new Error("--encode cannot be used with raw call hex (already encoded)");
  }

  if ((opts.toYaml || opts.toJson) && opts.encode) {
    throw new Error("--to-yaml/--to-json and --encode are mutually exclusive");
  }
  if ((opts.toYaml || opts.toJson) && opts.dryRun) {
    throw new Error("--to-yaml/--to-json and --dry-run are mutually exclusive");
  }
  if (opts.toYaml && opts.toJson) {
    throw new Error("--to-yaml and --to-json are mutually exclusive");
  }

  if (opts.unsigned && opts.from) {
    throw new Error("--unsigned and --from are mutually exclusive");
  }
  if (opts.unsigned && opts.nonce) {
    throw new Error("--unsigned does not support --nonce");
  }
  if (opts.unsigned && opts.tip) {
    throw new Error("--unsigned does not support --tip");
  }
  if (opts.unsigned && opts.mortality) {
    throw new Error("--unsigned does not support --mortality");
  }

  const config = await loadConfig();
  const effectiveChain: string | undefined = opts.chain;
  let pallet: string | undefined;
  let callName: string | undefined;

  if (!isRawCall) {
    // Parse Pallet.Call from the target
    const dotIdx = target.indexOf(".");
    pallet = target.slice(0, dotIdx);
    callName = target.slice(dotIdx + 1);
  }

  const { name: chainName, chain: chainConfig } = resolveChain(config, effectiveChain);

  const decodeOnly = opts.encode || opts.toYaml || opts.toJson;
  const signer = decodeOnly || opts.unsigned ? undefined : await resolveAccountSigner(opts.from!);

  let clientHandle: ClientHandle | undefined;

  if (!decodeOnly || opts.unsigned) {
    clientHandle = await createChainClient(chainName, chainConfig, opts.rpc);
  }

  try {
    let meta: MetadataBundle;
    if (clientHandle) {
      meta = await getOrFetchMetadata(chainName, clientHandle);
    } else {
      try {
        meta = await getOrFetchMetadata(chainName);
      } catch {
        clientHandle = await createChainClient(chainName, chainConfig, opts.rpc);
        meta = await getOrFetchMetadata(chainName, clientHandle);
      }
    }

    // Build transaction options (custom extensions + nonce/tip/mortality/at)
    let unsafeApi: any;
    let txOptions: Record<string, any> | undefined;

    const nonce = parseNonceOption(opts.nonce);
    const tip = parseTipOption(opts.tip);
    const asset = parseAssetOption(opts.asset);
    const mortality = parseMortalityOption(opts.mortality);
    const at = parseAtOption(opts.at);

    if (!decodeOnly || opts.unsigned) {
      const userExtOverrides = parseExtOption(opts.ext);

      // When --asset is specified, handle ChargeAssetTxPayment as a custom extension
      // instead of letting PAPI handle it. PAPI's built-in path runs
      // `isAssetCompat(asset)` (packages/client/src/tx/tx.ts) against a typedef
      // derived from metadata; for XCM Location JSON on the unsafe API this
      // check rejects with "Incompatible runtime asset" even with fresh metadata.
      // Bypassing it lets us SCALE-encode the asset directly via the metadata
      // builder.
      const skipBuiltins =
        asset !== undefined
          ? new Set([...PAPI_BUILTIN_EXTENSIONS].filter((e) => e !== "ChargeAssetTxPayment"))
          : PAPI_BUILTIN_EXTENSIONS;
      if (asset !== undefined) {
        userExtOverrides.ChargeAssetTxPayment ??= {
          value: { tip: tip ?? 0n, asset_id: asset },
        };
      }

      const customSignedExtensions = buildCustomSignedExtensions(
        meta,
        userExtOverrides,
        skipBuiltins,
      );

      const built: Record<string, any> = {};
      if (Object.keys(customSignedExtensions).length > 0)
        built.customSignedExtensions = customSignedExtensions;
      if (nonce !== undefined) built.nonce = nonce;
      if (tip !== undefined) built.tip = tip;
      if (mortality !== undefined) built.mortality = mortality;
      if (at !== undefined) built.at = at;

      txOptions = Object.keys(built).length > 0 ? built : undefined;
      unsafeApi = clientHandle?.client.getUnsafeApi();
    }

    let tx: any;
    let callHex: string;

    if (isRawCall) {
      if (args.length > 0) {
        throw new Error(
          "Extra arguments are not allowed when submitting a raw call hex.\n" +
            "Usage: dot tx 0x<call_hex> --from <account> --chain <chain>",
        );
      }
      callHex = target;

      if (opts.toYaml || opts.toJson) {
        const fileObj = decodeCallToFileFormat(meta, callHex, chainName);
        outputFileFormat(fileObj, !!opts.toYaml);
        return;
      }

      const callBinary = Binary.fromHex(target as `0x${string}`);
      tx = await (unsafeApi as any).txFromCallData(callBinary);
    } else {
      // Validate pallet
      const palletNames = getPalletNames(meta);
      const palletInfo = findPallet(meta, pallet!);
      if (!palletInfo) {
        throw new Error(suggestMessage("pallet", pallet!, palletNames));
      }

      // Validate call
      const callInfo = palletInfo.calls.find(
        (c) => c.name.toLowerCase() === callName!.toLowerCase(),
      );
      if (!callInfo) {
        const callNames = palletInfo.calls.map((c) => c.name);
        throw new Error(suggestMessage(`call in ${palletInfo.name}`, callName!, callNames));
      }

      // Parse args: convert file args to strings for the existing pipeline, or use CLI strings
      const effectiveArgs =
        opts.parsedArgs !== undefined ? fileArgsToStrings(opts.parsedArgs) : args;
      const callData = await parseCallArgs(meta, palletInfo.name, callInfo.name, effectiveArgs);

      if ((opts.encode && !opts.unsigned) || opts.toYaml || opts.toJson) {
        const { codec, location } = meta.builder.buildCall(palletInfo.name, callInfo.name);
        const encodedArgs = codec.enc(callData);
        const fullCall = new Uint8Array([location[0], location[1], ...encodedArgs]);
        const hex = Binary.toHex(fullCall);
        if (opts.encode) {
          if (isJsonOutput(opts)) {
            console.log(formatJson({ callHex: hex }));
          } else {
            console.log(hex);
          }
          return;
        }
        const fileObj = decodeCallToFileFormat(meta, hex, chainName);
        outputFileFormat(fileObj, !!opts.toYaml);
        return;
      }

      tx = (unsafeApi as any).tx[palletInfo.name][callInfo.name](callData);

      const encodedCall = await tx.getEncodedData();
      callHex = Binary.toHex(encodedCall);
    }

    // Decode for display (works for both paths)
    const decodedStr = decodeCall(meta, callHex);
    const decodedObj = decodeCallObject(meta, callHex);

    // --- Unsigned dry-run ---
    if (opts.dryRun && opts.unsigned) {
      if (isJsonOutput(opts)) {
        console.log(
          formatJson({
            chain: chainName,
            unsigned: true,
            callHex,
            decoded: decodedStr,
            estimatedFees: null,
          }),
        );
        return;
      }
      console.log(`  ${BOLD}Chain:${RESET}  ${chainName}`);
      console.log(`  ${BOLD}Type:${RESET}   unsigned (bare)`);
      console.log(`  ${BOLD}Call:${RESET}   ${callHex}`);
      printDecodedCall(decodedObj, decodedStr);
      console.log(`  ${BOLD}Fees:${RESET}   ${DIM}N/A (unsigned transaction)${RESET}`);
      return;
    }

    if (opts.dryRun) {
      const signerAddress = toSs58(signer!.publicKey);

      let estimatedFees: string | undefined;
      let estimationError: string | undefined;
      try {
        estimatedFees = String(
          await withStalenessSuggestion(chainName, clientHandle!, () =>
            withBlockAvailabilityHint(opts.at, () =>
              tx.getEstimatedFees(signer?.publicKey, txOptions),
            ),
          ),
        );
      } catch (err) {
        estimationError = err instanceof Error ? err.message : String(err);
      }

      if (isJsonOutput(opts)) {
        const result: Record<string, unknown> = {
          chain: chainName,
          from: { name: opts.from, address: signerAddress },
          callHex,
          decoded: decodedStr,
          estimatedFees,
        };
        if (estimationError !== undefined) result.estimationError = estimationError;
        if (nonce !== undefined) result.nonce = nonce;
        if (tip !== undefined) result.tip = String(tip);
        if (asset !== undefined) result.asset = asset;
        if (mortality !== undefined)
          result.mortality = mortality.mortal ? `mortal (period ${mortality.period})` : "immortal";
        if (at !== undefined) result.at = at;
        console.log(formatJson(result));
        return;
      }

      console.log(`  ${BOLD}Chain:${RESET}  ${chainName}`);
      console.log(`  ${BOLD}From:${RESET}   ${opts.from} (${signerAddress})`);
      console.log(`  ${BOLD}Call:${RESET}   ${callHex}`);
      printDecodedCall(decodedObj, decodedStr);
      if (nonce !== undefined) console.log(`  ${BOLD}Nonce:${RESET} ${nonce}`);
      if (tip !== undefined) console.log(`  ${BOLD}Tip:${RESET}   ${tip}`);
      if (asset !== undefined) console.log(`  ${BOLD}Asset:${RESET} ${JSON.stringify(asset)}`);
      if (mortality !== undefined)
        console.log(
          `  ${BOLD}Mortality:${RESET} ${mortality.mortal ? `mortal (period ${mortality.period})` : "immortal"}`,
        );
      if (at !== undefined) console.log(`  ${BOLD}At:${RESET}    ${at}`);

      if (estimatedFees !== undefined) {
        console.log(`  ${BOLD}Estimated fees:${RESET} ${estimatedFees}`);
      } else {
        console.log(`  ${BOLD}Estimated fees:${RESET} ${YELLOW}unable to estimate${RESET}`);
        if (estimationError) {
          const formatted = formatRuntimeError(estimationError).replace(/\n/g, `\n  `);
          console.log(`  ${YELLOW}⚠${RESET} ${formatted}`);
          console.log(`  ${DIM}Submitting this transaction is likely to fail.${RESET}`);
        }
      }
      return;
    }

    const waitLevel = parseWaitLevel(opts.wait);

    // --- Unsigned submission ---
    if (opts.unsigned) {
      const callDataBytes = await tx.getEncodedData();
      const userExtOverrides = parseExtOption(opts.ext);
      const generalTx = buildGeneralTx(meta, callDataBytes, userExtOverrides);

      if (opts.encode) {
        const hex = Binary.toHex(generalTx);
        if (isJsonOutput(opts)) {
          console.log(formatJson({ generalTxHex: hex }));
        } else {
          console.log(hex);
        }
        return;
      }

      const observable = clientHandle!.client.submitAndWatch(
        generalTx,
        at,
      ) as import("rxjs").Observable<TxEvent>;

      if (isJsonOutput(opts)) {
        const result = await withStalenessSuggestion(chainName, clientHandle!, () =>
          withBlockAvailabilityHint(opts.at, () =>
            watchTransactionJson(observable, waitLevel, { unsigned: true }),
          ),
        );
        const rpcUrl = primaryRpc(opts.rpc ?? chainConfig.rpc);
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
          unsigned: true,
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

      const result = await withStalenessSuggestion(chainName, clientHandle!, () =>
        withBlockAvailabilityHint(opts.at, () =>
          watchTransaction(observable, waitLevel, { unsigned: true }),
        ),
      );

      console.log();
      console.log(`  ${BOLD}Chain:${RESET}  ${chainName}`);
      console.log(`  ${BOLD}Type:${RESET}   unsigned (bare)`);
      console.log(`  ${BOLD}Call:${RESET}   ${callHex}`);
      printDecodedCall(decodedObj, decodedStr);
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
          result.type === "txBestBlocksState"
            ? ` ${DIM}(best block, not yet finalized)${RESET}`
            : "";
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
          const payload = event.value?.value;
          if (payload && typeof payload === "object") {
            const fields = Object.entries(payload)
              .map(([k, v]) => `${k}: ${formatEventValue(v)}`)
              .join(", ");
            console.log(`    ${name} { ${fields} }`);
          } else {
            console.log(`    ${name}`);
          }
        }
      }

      const rpcUrl = primaryRpc(opts.rpc ?? chainConfig.rpc);
      if (rpcUrl) {
        const blockHash = result.block.hash;
        console.log(`  ${BOLD}Block:${RESET}  #${result.block.number} (${blockHash})`);
        console.log(`  ${DIM}${pjsAppsLink(rpcUrl, blockHash)}${RESET}`);
        console.log(`  ${DIM}${papiLink(rpcUrl, blockHash)}${RESET}`);
      }
      console.log();

      if (!result.ok) {
        throw new CliError(`Transaction dispatch error: ${dispatchErrorMsg}`);
      }
      return;
    }

    // JSON output: NDJSON stream
    if (isJsonOutput(opts)) {
      const result = await withStalenessSuggestion(chainName, clientHandle!, () =>
        withBlockAvailabilityHint(opts.at, () =>
          watchTransactionJson(tx.signSubmitAndWatch(signer, txOptions), waitLevel),
        ),
      );
      const rpcUrl = primaryRpc(opts.rpc ?? chainConfig.rpc);
      if (result.type === "broadcasted") {
        printJsonLine({ event: "broadcasted", txHash: result.txHash });
        return;
      }
      // result is now TxFinalized | TxBestBlocksState (both have .ok, .block, .events)
      const blockHash = result.block.hash;
      const explorer: Record<string, string> = {};
      if (rpcUrl) {
        explorer.polkadotjs = pjsAppsLink(rpcUrl, blockHash);
        explorer.papi = papiLink(rpcUrl, blockHash);
      }
      printJsonLine({
        event: result.type === "finalized" ? "finalized" : "bestBlock",
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

    const result = await withStalenessSuggestion(chainName, clientHandle!, () =>
      withBlockAvailabilityHint(opts.at, () =>
        watchTransaction(tx.signSubmitAndWatch(signer, txOptions), waitLevel),
      ),
    );

    console.log();
    console.log(`  ${BOLD}Chain:${RESET}  ${chainName}`);
    console.log(`  ${BOLD}Call:${RESET}   ${callHex}`);
    printDecodedCall(decodedObj, decodedStr);
    if (nonce !== undefined) console.log(`  ${BOLD}Nonce:${RESET} ${nonce}`);
    if (tip !== undefined) console.log(`  ${BOLD}Tip:${RESET}   ${tip}`);
    if (asset !== undefined) console.log(`  ${BOLD}Asset:${RESET} ${JSON.stringify(asset)}`);
    if (mortality !== undefined)
      console.log(
        `  ${BOLD}Mortality:${RESET} ${mortality.mortal ? `mortal (period ${mortality.period})` : "immortal"}`,
      );
    if (at !== undefined) console.log(`  ${BOLD}At:${RESET}    ${at}`);
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
        const payload = event.value?.value;
        if (payload && typeof payload === "object") {
          const fields = Object.entries(payload)
            .map(([k, v]) => `${k}: ${formatEventValue(v)}`)
            .join(", ");
          console.log(`    ${name} { ${fields} }`);
        } else {
          console.log(`    ${name}`);
        }
      }
    }

    const rpcUrl = primaryRpc(opts.rpc ?? chainConfig.rpc);
    if (rpcUrl) {
      const blockHash = result.block.hash;
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

function formatDispatchError(err: { type: string; value?: unknown }): string {
  if (err.type === "Module" && err.value && typeof err.value === "object") {
    const mod = err.value as { type?: string; value?: unknown };
    if (mod.type) {
      const inner = mod.value as { type?: string } | undefined;
      if (inner && typeof inner === "object" && inner.type) {
        return `${mod.type}.${inner.type}`;
      }
      return mod.type;
    }
  }
  if (err.value !== undefined && err.value !== null) {
    const val = typeof err.value === "string" ? err.value : JSON.stringify(err.value);
    return `${err.type}: ${val}`;
  }
  return err.type;
}

function decodeCall(meta: MetadataBundle, callHex: string): string {
  // Primary: view-builder (nicely structured output)
  try {
    const viewBuilder = getViewBuilder(meta.lookup);
    const decoded = viewBuilder.callDecoder(callHex);
    const palletName = decoded.pallet.value.name;
    const callName = decoded.call.value.name;
    const argsStr = formatDecodedArgs(decoded.args.value);
    return `${palletName}.${callName}${argsStr}`;
  } catch {
    // Fallback: DynamicBuilder codec (handles XCM and other complex types)
  }
  try {
    return decodeCallFallback(meta, callHex);
  } catch {
    return "(unable to decode)";
  }
}

interface DecodedCallObject {
  palletName: string;
  callName: string;
  args: unknown;
}

/** Decode a call to a structured object suitable for JSON-style display. */
function decodeCallObject(meta: MetadataBundle, callHex: string): DecodedCallObject | null {
  try {
    const callTypeId = meta.lookup.call;
    if (callTypeId == null) return null;
    const codec = meta.builder.buildDefinition(callTypeId);
    const decoded = codec.dec(Binary.fromHex(callHex as `0x${string}`));
    return {
      palletName: decoded.type,
      callName: decoded.value.type,
      args: sanitizeForSerialization(decoded.value.value),
    };
  } catch {
    return null;
  }
}

/** Print "Decode: Pallet.call" header followed by indented pretty-JSON args. */
function printDecodedCall(obj: DecodedCallObject | null, fallback: string): void {
  if (!obj) {
    console.log(`  ${BOLD}Decode:${RESET} ${fallback}`);
    return;
  }
  const header = `${CYAN}${obj.palletName}${RESET}.${CYAN}${obj.callName}${RESET}`;
  const hasArgs =
    obj.args !== null &&
    obj.args !== undefined &&
    !(typeof obj.args === "object" && Object.keys(obj.args).length === 0);
  if (!hasArgs) {
    console.log(`  ${BOLD}Decode:${RESET} ${header}`);
    return;
  }
  console.log(`  ${BOLD}Decode:${RESET} ${header}`);
  const indented = formatPretty(obj.args)
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
  console.log(indented);
}

function decodeCallFallback(meta: MetadataBundle, callHex: string): string {
  const callTypeId = meta.lookup.call;
  if (callTypeId == null) throw new Error("No RuntimeCall type ID");
  const codec = meta.builder.buildDefinition(callTypeId);
  const decoded = codec.dec(Binary.fromHex(callHex as `0x${string}`));
  // decoded is { type: "PalletName", value: { type: "call_name", value: { ...args } } }
  const palletName = decoded.type;
  const call = decoded.value;
  const callName = call.type;
  const args = call.value;
  if (args === undefined || args === null) {
    return `${palletName}.${callName}`;
  }
  const argsStr = formatRawDecoded(args);
  return `${palletName}.${callName} ${argsStr}`;
}

function decodeCallToFileFormat(
  meta: MetadataBundle,
  callHex: string,
  chainName: string,
): Record<string, unknown> {
  const callTypeId = meta.lookup.call;
  if (callTypeId == null) throw new Error("No RuntimeCall type ID in metadata");
  const codec = meta.builder.buildDefinition(callTypeId);
  const decoded = codec.dec(Binary.fromHex(callHex as `0x${string}`));
  // decoded is { type: "PalletName", value: { type: "call_name", value: { ...args } } }
  const palletName: string = decoded.type;
  const call = decoded.value;
  const callName: string = call.type;
  const args = call.value;
  return {
    chain: chainName,
    tx: {
      [palletName]: {
        [callName]: sanitizeForSerialization(args) ?? null,
      },
    },
  };
}

function sanitizeForSerialization(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Uint8Array) return Binary.toHex(value);
  if (typeof value === "bigint") {
    if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
      return Number(value);
    }
    return value.toString();
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForSerialization);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = sanitizeForSerialization(v);
    }
    return result;
  }
  return String(value);
}

function outputFileFormat(obj: Record<string, unknown>, asYaml: boolean): void {
  if (asYaml) {
    process.stdout.write(stringifyYaml(obj));
  } else {
    console.log(JSON.stringify(obj, null, 2));
  }
}

function formatRawDecoded(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (value instanceof Uint8Array) return Binary.toHex(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value.toString();
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.map(formatRawDecoded).join(", ")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Enum-like: { type, value }
    if ("type" in obj && typeof obj.type === "string") {
      const inner = obj.value;
      if (inner === undefined || inner === null) return obj.type;
      const innerStr = formatRawDecoded(inner);
      // If inner formatted as struct "{ ... }", show Type { ... }
      if (innerStr.startsWith("{")) return `${obj.type} ${innerStr}`;
      return `${obj.type}(${innerStr})`;
    }
    // Plain struct
    const entries = Object.entries(obj);
    if (entries.length === 0) return "{}";
    const fields = entries.map(([k, v]) => `${k}: ${formatRawDecoded(v)}`).join(", ");
    return `{ ${fields} }`;
  }
  return String(value);
}

function formatDecodedArgs(decoded: { codec: string; value: any }): string {
  return formatDecoded(decoded as Decoded);
}

function formatDecoded(d: Decoded): string {
  switch (d.codec) {
    case "_void":
      return "";
    case "bool":
      return d.value.toString();
    case "str":
    case "char":
      return d.value;
    case "u8":
    case "u16":
    case "u32":
    case "i8":
    case "i16":
    case "i32":
    case "compactNumber":
      return d.value.toString();
    case "u64":
    case "u128":
    case "u256":
    case "i64":
    case "i128":
    case "i256":
    case "compactBn":
      return d.value.toString();
    case "bitSequence":
      return `0x${Buffer.from(d.value.bytes).toString("hex")}`;
    case "AccountId":
      return d.value.address;
    case "ethAccount":
      return d.value;
    case "Bytes":
      return d.value;
    case "BytesArray":
      return d.value;
    case "Enum": {
      const inner = formatDecoded(d.value.value);
      if (!inner) return d.value.type;
      return `${d.value.type}(${inner})`;
    }
    case "Struct": {
      const entries = Object.entries(d.value as Record<string, Decoded>);
      if (entries.length === 0) return " {}";
      const fields = entries.map(([k, v]) => `${k}: ${formatDecoded(v)}`).join(", ");
      return ` { ${fields} }`;
    }
    case "Tuple": {
      const items = (d.value as Decoded[]).map(formatDecoded).join(", ");
      return `(${items})`;
    }
    case "Option": {
      if (d.value.codec === "_void") return "None";
      return formatDecoded(d.value);
    }
    case "Result": {
      if (d.value.success) {
        return `Ok(${formatDecoded(d.value.value)})`;
      }
      return `Err(${formatDecoded(d.value.value)})`;
    }
    case "Sequence":
    case "Array": {
      const items = (d.value as Decoded[]).map(formatDecoded);
      if (items.length === 0) return "[]";
      return `[${items.join(", ")}]`;
    }
    default:
      return String((d as any).value ?? "");
  }
}

function formatEventValue(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toString();
  if (typeof v === "boolean") return v.toString();
  if (v === null || v === undefined) return "null";
  if (v instanceof Uint8Array) {
    return binaryToDisplay(v);
  }
  return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
}

async function parseCallArgs(
  meta: MetadataBundle,
  palletName: string,
  callName: string,
  args: string[],
): Promise<unknown> {
  // Look up the calls enum to find the variant's inner type
  const palletMeta = meta.unified.pallets.find((p) => p.name === palletName);
  if (!palletMeta?.calls) return undefined;

  const callsEntry = meta.lookup(palletMeta.calls.type);
  if (callsEntry.type !== "enum") return undefined;

  const variant = (callsEntry.value as Record<string, any>)[callName];
  if (!variant) return undefined;

  // Determine the fields based on variant type
  if (variant.type === "void") {
    if (args.length > 0) {
      throw new Error(`${palletName}.${callName} takes no arguments, but ${args.length} provided.`);
    }
    return undefined;
  }

  if (variant.type === "struct") {
    return await parseStructArgs(meta, variant.value, args, `${palletName}.${callName}`);
  }

  if (variant.type === "lookupEntry") {
    const inner = variant.value;
    if (inner.type === "struct") {
      return await parseStructArgs(meta, inner.value, args, `${palletName}.${callName}`);
    }
    if (inner.type === "void") return undefined;
    // Single arg
    if (args.length !== 1) {
      throw new Error(
        `${palletName}.${callName} takes 1 argument (${describeType(meta.lookup, inner.id)}), but ${args.length} provided.`,
      );
    }
    try {
      return await parseTypedArg(meta, inner, args[0]!);
    } catch (err) {
      const typeDesc = describeType(meta.lookup, inner.id);
      throw new Error(
        `Invalid value for argument 0 (expected ${typeDesc}): ${JSON.stringify(args[0])}`,
        { cause: err },
      );
    }
  }

  if (variant.type === "tuple") {
    const entries = variant.value as any[];
    if (args.length !== entries.length) {
      throw new Error(
        `${palletName}.${callName} takes ${entries.length} arguments, but ${args.length} provided.`,
      );
    }
    return Promise.all(
      entries.map(async (entry: any, i: number) => {
        try {
          return await parseTypedArg(meta, entry, args[i]!);
        } catch (err) {
          const typeDesc = describeType(meta.lookup, entry.id);
          throw new Error(
            `Invalid value for argument ${i} (expected ${typeDesc}): ${JSON.stringify(args[i])}`,
            { cause: err },
          );
        }
      }),
    );
  }

  // Fallback: parse all args generically
  return args.length === 0 ? undefined : args.map(parseValue);
}

async function parseStructArgs(
  meta: MetadataBundle,
  fields: Record<string, any>,
  args: string[],
  callLabel: string,
): Promise<Record<string, unknown>> {
  const fieldNames = Object.keys(fields);
  if (args.length !== fieldNames.length) {
    const expected = fieldNames
      .map((name) => `${name}: ${describeType(meta.lookup, fields[name].id)}`)
      .join(", ");
    throw new Error(
      `${callLabel} takes ${fieldNames.length} argument(s): ${expected}\n` +
        `  Got ${args.length} argument(s).`,
    );
  }
  const result: Record<string, unknown> = {};
  for (let i = 0; i < fieldNames.length; i++) {
    const name = fieldNames[i]!;
    const entry = fields[name];
    try {
      result[name] = await parseTypedArg(meta, entry, args[i]!);
    } catch (err) {
      const typeDesc = describeType(meta.lookup, entry.id);
      throw new Error(
        `Invalid value for argument '${name}' (expected ${typeDesc}): ${JSON.stringify(args[i])}\n` +
          `  Hint: ${typeHint(entry, meta)}`,
        { cause: err },
      );
    }
  }
  return result;
}

function typeHint(entry: any, meta: MetadataBundle): string {
  const resolved = entry.type === "lookupEntry" ? entry.value : entry;
  switch (resolved.type) {
    case "enum": {
      const variants = Object.keys(resolved.value);
      if (variants.length <= 6) return `a variant: ${variants.join(" | ")}`;
      return `one of ${variants.length} variants (e.g. ${variants.slice(0, 3).join(", ")})`;
    }
    case "struct":
      return `a JSON object with fields: ${Object.keys(resolved.value).join(", ")}`;
    case "tuple":
      return "a JSON array";
    case "sequence":
    case "array": {
      const inner = resolved.value;
      if (inner?.type === "primitive" && inner.value === "u8") return "hex-encoded bytes or text";
      return "a JSON array, comma-separated values, or hex-encoded bytes";
    }
    default:
      return describeType(meta.lookup, entry.id);
  }
}

/**
 * Recursively normalize a JSON value to match polkadot-api's metadata types.
 *
 * polkadot-api unwraps single-element fixed arrays (e.g. `[Junction; 1]` becomes
 * just `Junction`). XCM types like `Junctions::X1` are defined as `X1([Junction; 1])`
 * in the spec, so users naturally pass `{"type":"X1","value":[{...}]}`. This function
 * detects that mismatch — enum variant inner is NOT array/sequence but the provided
 * value IS a single-element array — and unwraps it.
 */
function normalizeValue(lookup: Lookup, entry: any, value: unknown): unknown {
  let resolved = entry;
  while (resolved.type === "lookupEntry") {
    resolved = resolved.value;
  }

  switch (resolved.type) {
    case "enum": {
      if (value !== null && typeof value === "object" && !Array.isArray(value) && "type" in value) {
        const enumValue = value as { type: string; value?: unknown };
        const variant = (resolved.value as Record<string, any>)[enumValue.type];
        if (variant) {
          let innerEntry = variant;
          while (innerEntry.type === "lookupEntry") {
            innerEntry = innerEntry.value;
          }

          let normalizedInner = enumValue.value;

          // Unwrap single-element array when inner type is not array/sequence
          if (
            innerEntry.type !== "array" &&
            innerEntry.type !== "sequence" &&
            innerEntry.type !== "void" &&
            Array.isArray(normalizedInner) &&
            normalizedInner.length === 1
          ) {
            normalizedInner = normalizedInner[0];
          }

          if (normalizedInner !== undefined && innerEntry.type !== "void") {
            normalizedInner = normalizeValue(lookup, innerEntry, normalizedInner);
          }

          return { type: enumValue.type, value: normalizedInner };
        }
      }
      return value;
    }

    case "struct": {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const fields = resolved.value as Record<string, any>;
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
          if (key in fields) {
            result[key] = normalizeValue(lookup, fields[key], val);
          } else {
            result[key] = val;
          }
        }
        return result;
      }
      return value;
    }

    case "array":
    case "sequence": {
      // Convert hex/text strings to Binary for byte arrays (Vec<u8>, [u8; N])
      let innerResolved = resolved.value;
      while (innerResolved.type === "lookupEntry") {
        innerResolved = innerResolved.value;
      }
      if (
        innerResolved.type === "primitive" &&
        innerResolved.value === "u8" &&
        typeof value === "string"
      ) {
        const isHex = /^0x[0-9a-fA-F]*$/.test(value);
        // Sized [u8; N]: papi's isCompatible only accepts a 0x hex string for
        // sized binary typedefs (Uint8Array is rejected). Mirrors the
        // top-level parseTypedArg rule so nested byte arrays inside JSON args
        // round-trip through the same compat check.
        if (resolved.type === "array" && isHex) return value;
        if (isHex) return Binary.fromHex(value as `0x${string}`);
        return Binary.fromText(value);
      }

      if (Array.isArray(value)) {
        const innerEntry = resolved.value;
        return value.map((item) => normalizeValue(lookup, innerEntry, item));
      }
      return value;
    }

    case "tuple": {
      if (Array.isArray(value)) {
        const entries = resolved.value as any[];
        return value.map((item, i) =>
          i < entries.length ? normalizeValue(lookup, entries[i], item) : item,
        );
      }
      return value;
    }

    case "option": {
      if (value !== null && value !== undefined) {
        return normalizeValue(lookup, resolved.value, value);
      }
      // polkadot-api uses undefined (not null) for Option::None
      return undefined;
    }

    case "primitive": {
      const prim = resolved.value as string;
      // Convert string values from JSON to proper primitive types
      if (typeof value === "string") {
        switch (prim) {
          case "bool":
            return value === "true";
          case "u64":
          case "u128":
          case "u256":
          case "i64":
          case "i128":
          case "i256":
            return BigInt(value);
          case "u8":
          case "u16":
          case "u32":
          case "i8":
          case "i16":
          case "i32":
            return parseInt(value, 10);
        }
      }
      // Convert JS numbers to BigInt for large-integer SCALE types (file/YAML input)
      if (typeof value === "number") {
        switch (prim) {
          case "u64":
          case "u128":
          case "u256":
          case "i64":
          case "i128":
          case "i256":
            return BigInt(value);
        }
      }
      return value;
    }

    case "compact": {
      // Convert string values from JSON to proper compact types
      if (typeof value === "string") {
        return resolved.isBig ? BigInt(value) : parseInt(value, 10);
      }
      // Convert JS numbers to BigInt for big compact types (file/YAML input)
      if (typeof value === "number" && resolved.isBig) {
        return BigInt(value);
      }
      return value;
    }

    default:
      return value;
  }
}

/**
 * Convert pre-parsed file args to string[] for the existing parseCallArgs pipeline.
 *
 * File args are already typed (from YAML/JSON parsing) but parseCallArgs expects
 * string arguments. We serialize each value individually so both struct-variant
 * (named fields matched by position) and tuple-variant calls work correctly.
 */
export function fileArgsToStrings(args: unknown): string[] {
  if (args == null) return [];
  if (typeof args === "object" && !Array.isArray(args)) {
    // Named args: serialize each value as a separate positional arg
    return Object.values(args as Record<string, unknown>).map(serializeForCli);
  }
  if (Array.isArray(args)) {
    return args.map(serializeForCli);
  }
  // Scalar
  return [serializeForCli(args)];
}

function serializeForCli(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean" || v === null) return String(v);
  return JSON.stringify(v);
}

function parseEnumShorthand(arg: string): { variant: string; inner: string } | null {
  if (arg.startsWith("{") || arg.startsWith("[") || arg.startsWith("0x")) return null;
  const firstParen = arg.indexOf("(");
  if (firstParen === -1 || !arg.endsWith(")")) return null;
  const variant = arg.slice(0, firstParen);
  if (!/^[a-zA-Z_]\w*$/.test(variant)) return null;
  return { variant, inner: arg.slice(firstParen + 1, -1) };
}

async function parseTypedArg(meta: MetadataBundle, entry: any, arg: string): Promise<unknown> {
  // Resolve lookupEntry indirection
  if (entry.type === "lookupEntry") return parseTypedArg(meta, entry.value, arg);

  switch (entry.type) {
    case "primitive":
      return parsePrimitive(entry.value, arg);

    case "compact":
      return entry.isBig ? BigInt(arg) : parseInt(arg, 10);

    case "AccountId32":
      return resolveAccountAddress(arg);

    case "AccountId20":
      return arg; // polkadot-api handles decoding

    case "option": {
      if (arg === "null" || arg === "undefined" || arg === "none") {
        return undefined;
      }
      return parseTypedArg(meta, entry.value, arg);
    }

    case "enum": {
      // Hex-encoded RuntimeCall (e.g. from --encode output used with Sudo.sudo)
      if (
        /^0x[0-9a-fA-F]+$/.test(arg) &&
        meta.lookup.call != null &&
        entry.id === meta.lookup.call
      ) {
        const callCodec = meta.builder.buildDefinition(meta.lookup.call);
        return callCodec.dec(Binary.fromHex(arg as `0x${string}`));
      }

      // Try JSON parse for complex enums like MultiAddress
      if (arg.startsWith("{")) {
        try {
          return normalizeValue(meta.lookup, entry, JSON.parse(arg));
        } catch {
          // fall through
        }
      }

      // Enum shorthand: Variant(value)
      const variants = Object.keys(entry.value);
      const shorthand = parseEnumShorthand(arg);
      if (shorthand) {
        const matched = variants.find((v) => v.toLowerCase() === shorthand.variant.toLowerCase());
        if (matched) {
          const variantDef = entry.value[matched];
          const resolvedDef = variantDef.type === "lookupEntry" ? variantDef.value : variantDef;
          if (resolvedDef.type === "void" || shorthand.inner === "") {
            return { type: matched };
          }
          const innerValue = await parseTypedArg(meta, variantDef, shorthand.inner);
          return normalizeValue(meta.lookup, entry, { type: matched, value: innerValue });
        }
      }

      // Auto-wrap MultiAddress-like enums: if "Id" variant has AccountId32
      // inner type and the arg looks like an SS58 address, wrap automatically
      if (variants.includes("Id")) {
        const idVariant = entry.value.Id;
        const innerType = idVariant.type === "lookupEntry" ? idVariant.value : idVariant;
        if (innerType.type === "AccountId32" && !arg.startsWith("{")) {
          const resolved = await resolveAccountAddress(arg);
          return { type: "Id", value: resolved };
        }
      }

      // Simple variant name (e.g., "Id" for MultiAddress)
      const matched = variants.find((v) => v.toLowerCase() === arg.toLowerCase());
      if (matched) {
        const variant = entry.value[matched];
        const resolved = variant.type === "lookupEntry" ? variant.value : variant;
        if (resolved.type === "void") {
          return { type: matched };
        }
      }
      return parseValue(arg);
    }

    case "sequence":
    case "array": {
      // Vec<u8> / [u8; N] -> Binary
      const inner = entry.value;
      if (inner.type === "primitive" && inner.value === "u8") {
        const isHex = /^0x[0-9a-fA-F]*$/.test(arg);
        // Sized [u8; N]: papi's isCompatible wants a 0x hex string for sized
        // binary typedefs (Uint8Array is only accepted for unsized Vec<u8>).
        if (entry.type === "array" && isHex) return arg;
        if (isHex) return Binary.fromHex(arg as any);
        return Binary.fromText(arg);
      }
      // Try JSON array
      if (arg.startsWith("[")) {
        try {
          return normalizeValue(meta.lookup, entry, JSON.parse(arg));
        } catch {
          // fall through
        }
      }
      // Comma-separated elements → parse each individually
      if (arg.includes(",")) {
        const elements = arg.split(",");
        return Promise.all(elements.map((el) => parseTypedArg(meta, inner, el.trim())));
      }
      // Hex bytes
      if (/^0x[0-9a-fA-F]*$/.test(arg)) return Binary.fromHex(arg as any);
      return parseValue(arg);
    }

    case "struct":
      // Must be JSON
      if (arg.startsWith("{")) {
        try {
          return normalizeValue(meta.lookup, entry, JSON.parse(arg));
        } catch {
          // fall through
        }
      }
      return parseValue(arg);

    case "tuple":
      if (arg.startsWith("[")) {
        try {
          return normalizeValue(meta.lookup, entry, JSON.parse(arg));
        } catch {
          // fall through
        }
      }
      return parseValue(arg);

    default:
      return parseValue(arg);
  }
}

function parsePrimitive(prim: string, arg: string): string | number | bigint | boolean {
  switch (prim) {
    case "bool":
      return arg === "true";
    case "char":
    case "str":
      return arg;
    case "u8":
    case "u16":
    case "u32":
    case "i8":
    case "i16":
    case "i32":
      return parseInt(arg, 10);
    case "u64":
    case "u128":
    case "u256":
    case "i64":
    case "i128":
    case "i256":
      return BigInt(arg);
    default:
      return parseValue(arg) as any;
  }
}

// --- Custom signed extensions support ---

function parseExtOption(ext: string | undefined): Record<string, any> {
  if (!ext) return {};
  try {
    const parsed = JSON.parse(ext);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error('--ext must be a JSON object, e.g. \'{"ExtName":{"value":...}}\'');
    }
    return parsed;
  } catch (err: any) {
    if (err.message?.startsWith("--ext")) throw err;
    throw new Error(
      `Failed to parse --ext JSON: ${err.message}\n` +
        'Expected format: \'{"ExtName":{"value":...}}\'',
    );
  }
}

/** Sentinel value: type could not be auto-defaulted */
const NO_DEFAULT = Symbol("no-default");

function buildCustomSignedExtensions(
  meta: MetadataBundle,
  userOverrides: Record<string, any>,
  builtins: ReadonlySet<string> = PAPI_BUILTIN_EXTENSIONS,
): Record<string, { value?: any; additionalSigned?: any }> {
  const result: Record<string, { value?: any; additionalSigned?: any }> = {};
  const extensions = getSignedExtensions(meta);

  for (const ext of extensions) {
    if (builtins.has(ext.identifier)) continue;

    // User override takes priority
    if (ext.identifier in userOverrides) {
      result[ext.identifier] = userOverrides[ext.identifier];
      continue;
    }

    // Auto-default based on type structure
    const valueEntry = meta.lookup(ext.type);
    const addEntry = meta.lookup(ext.additionalSigned);

    const value = autoDefaultForType(valueEntry);
    const add = autoDefaultForType(addEntry);

    if (value !== NO_DEFAULT || add !== NO_DEFAULT) {
      result[ext.identifier] = {
        ...(value !== NO_DEFAULT ? { value } : {}),
        ...(add !== NO_DEFAULT ? { additionalSigned: add } : {}),
      };
    }
    // If neither can be auto-defaulted, skip — polkadot-api will error
    // with a clear message about the missing extension
  }
  return result;
}

function autoDefaultForType(entry: any): any {
  if (entry.type === "void") return new Uint8Array([]);
  // Option<T> → undefined tells polkadot-api to encode as None (0x00)
  if (entry.type === "option") return undefined;
  if (entry.type === "enum") {
    // Look for a "Disabled" variant (e.g. VerifyMultiSignature)
    const variants = entry.value as Record<string, any>;
    if ("Disabled" in variants) {
      return { type: "Disabled", value: undefined };
    }
  }
  // Cannot auto-default
  return NO_DEFAULT;
}

// --- General (unsigned) transaction construction ---

/**
 * Determine the default "extra" (transaction body) value for an extension
 * in an unsigned general transaction. More aggressive than autoDefaultForType:
 * also handles primitives, compacts, enums with Immortal, and structs.
 */
function unsignedDefaultForType(identifier: string, entry: any): any {
  // Handle well-known builtin extensions with specific unsigned defaults
  switch (identifier) {
    case "CheckMortality":
      return { type: "Immortal" };
    case "CheckNonce":
      return 0;
    case "ChargeTransactionPayment":
      return 0n;
    case "ChargeAssetTxPayment":
      return { tip: 0n, asset_id: undefined };
  }

  // Try the existing auto-default logic (void, option, enum with Disabled)
  const auto = autoDefaultForType(entry);
  if (auto !== NO_DEFAULT) return auto;

  // Additional defaults for unsigned transactions
  if (entry.type === "primitive") {
    switch (entry.value) {
      case "bool":
        return false;
      case "u8":
      case "u16":
      case "u32":
      case "i8":
      case "i16":
      case "i32":
        return 0;
      case "u64":
      case "u128":
      case "u256":
      case "i64":
      case "i128":
      case "i256":
        return 0n;
      case "str":
      case "char":
        return "";
    }
  }
  if (entry.type === "compact") return 0;

  // Enum: pick first variant that is void (simplest default)
  if (entry.type === "enum") {
    const variants = entry.value as Record<string, any>;
    if ("Immortal" in variants) return { type: "Immortal" };
    for (const [name, variant] of Object.entries(variants)) {
      if ((variant as any).type === "void") return { type: name };
    }
  }

  return NO_DEFAULT;
}

/**
 * Build a v5 general transaction (0x45) with all extension "extra" values
 * defaulted for unsigned/authorized submission.
 *
 * Byte layout:
 *   compact(payload_len) | 0x45 | ext_version(0x00) | ext_extras... | call_data
 */
function buildGeneralTx(
  meta: MetadataBundle,
  callData: Uint8Array,
  userExtOverrides: Record<string, any>,
): Uint8Array {
  const extensions = getSignedExtensions(meta);
  const extBytes: Uint8Array[] = [];

  for (const ext of extensions) {
    const valueEntry = meta.lookup(ext.type);

    // void types encode as nothing
    if (valueEntry.type === "void") continue;

    // Check for user override
    let value: any;
    if (ext.identifier in userExtOverrides) {
      const override = userExtOverrides[ext.identifier];
      value = override.value !== undefined ? override.value : override;
    } else {
      value = unsignedDefaultForType(ext.identifier, valueEntry);
      if (value === NO_DEFAULT) {
        throw new CliError(
          `Cannot determine default unsigned value for extension "${ext.identifier}" ` +
            `(type: ${valueEntry.type}). Provide it via --ext '{"${ext.identifier}":{"value":...}}'`,
        );
      }
    }

    // SCALE-encode the value using the metadata builder
    const codec = meta.builder.buildDefinition(ext.type);
    extBytes.push(codec.enc(value));
  }

  // Assemble: 0x45 | ext_version(0x00) | ext_extras | call_data
  const extVersion = new Uint8Array([0x00]);
  const versionByte = new Uint8Array([0x45]);

  // Calculate total payload length
  let payloadLen = 1 + 1; // version byte + ext version
  for (const b of extBytes) payloadLen += b.length;
  payloadLen += callData.length;

  const lengthPrefix = scaleCompact.enc(payloadLen);

  // Concatenate all parts
  const total = new Uint8Array(lengthPrefix.length + payloadLen);
  let offset = 0;

  total.set(lengthPrefix, offset);
  offset += lengthPrefix.length;

  total.set(versionByte, offset);
  offset += 1;

  total.set(extVersion, offset);
  offset += 1;

  for (const b of extBytes) {
    total.set(b, offset);
    offset += b.length;
  }

  total.set(callData, offset);

  return total;
}

// --- Progressive transaction tracking ---

type WatchResult = TxFinalized | (TxBestBlocksState & { found: true }) | TxBroadcasted;

function watchTransaction(
  observable: import("rxjs").Observable<TxEvent>,
  level: WaitLevel,
  options?: { unsigned?: boolean },
): Promise<WatchResult> {
  const spinner = new Spinner();
  return new Promise<WatchResult>((resolve, reject) => {
    let settled = false;
    spinner.start(options?.unsigned ? "Submitting..." : "Signing...");
    const subscription = observable.subscribe({
      next(event: TxEvent) {
        if (settled) return;
        switch (event.type) {
          case "signed":
            if (!options?.unsigned) {
              spinner.succeed("Signed");
              console.log(`  ${BOLD}Tx:${RESET}     ${event.txHash}`);
              spinner.start("Broadcasting...");
            }
            break;
          case "broadcasted":
            if (level === "broadcast") {
              spinner.succeed("Broadcasted");
              settled = true;
              subscription.unsubscribe();
              resolve(event);
            } else {
              spinner.succeed("Broadcasted");
              spinner.start("In best block...");
            }
            break;
          case "txBestBlocksState":
            if (event.found) {
              if (level === "best-block") {
                spinner.succeed(`In best block #${event.block.number}`);
                settled = true;
                subscription.unsubscribe();
                resolve(event);
              } else {
                spinner.succeed(`In best block #${event.block.number}`);
                spinner.start("Finalizing...");
              }
            } else {
              spinner.start("In best block...");
            }
            break;
          case "finalized":
            spinner.succeed(`Finalized in block #${event.block.number}`);
            settled = true;
            resolve(event);
            break;
        }
      },
      error(err: unknown) {
        if (settled) return;
        spinner.stop();
        reject(err);
      },
    });
  });
}

function watchTransactionJson(
  observable: import("rxjs").Observable<TxEvent>,
  level: WaitLevel,
  options?: { unsigned?: boolean },
): Promise<WatchResult> {
  return new Promise<WatchResult>((resolve, reject) => {
    let settled = false;
    const subscription = observable.subscribe({
      next(event: TxEvent) {
        if (settled) return;
        switch (event.type) {
          case "signed":
            if (!options?.unsigned) {
              printJsonLine({ event: "signed", txHash: event.txHash });
            }
            break;
          case "broadcasted":
            printJsonLine({ event: "broadcasted", txHash: event.txHash });
            if (level === "broadcast") {
              settled = true;
              subscription.unsubscribe();
              resolve(event);
            }
            break;
          case "txBestBlocksState":
            if (event.found) {
              printJsonLine({ event: "bestBlock", blockNumber: event.block.number, found: true });
              if (level === "best-block") {
                settled = true;
                subscription.unsubscribe();
                resolve(event);
              }
            }
            break;
          case "finalized":
            settled = true;
            resolve(event);
            break;
        }
      },
      error(err: unknown) {
        if (settled) return;
        reject(err);
      },
    });
  });
}

export {
  autoDefaultForType,
  buildCustomSignedExtensions,
  buildGeneralTx,
  decodeCallFallback,
  decodeCallToFileFormat,
  formatDispatchError,
  formatEventValue,
  formatRawDecoded,
  NO_DEFAULT,
  normalizeValue,
  parseCallArgs,
  parseEnumShorthand,
  parseExtOption,
  parsePrimitive,
  parseStructArgs,
  parseTypedArg,
  sanitizeForSerialization,
  typeHint,
  unsignedDefaultForType,
};
