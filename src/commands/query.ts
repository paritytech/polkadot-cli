import { loadConfig, resolveChain } from "../config/store.ts";
import { connectedEndpoint } from "../config/types.ts";
import { createChainClient } from "../core/client.ts";
import type { MetadataBundle, StorageItemInfo } from "../core/metadata.ts";
import {
  describeType,
  findPallet,
  getOrFetchMetadata,
  getPalletNames,
  listPallets,
  withBlockAvailabilityHint,
  withStalenessSuggestion,
} from "../core/metadata.ts";
import {
  CYAN,
  DIM,
  firstSentence,
  formatJson,
  formatPretty,
  isJsonOutput,
  printHeading,
  printHeadingWithEndpoint,
  printItem,
  RESET,
  writeStdout,
} from "../core/output.ts";
import { prettyTypeById } from "../core/pretty-type.ts";
import { suggestMessage } from "../utils/fuzzy-match.ts";
import { parseValue } from "../utils/parse-value.ts";
import { loadMeta, resolvePallet, showItemHelp } from "./focused-inspect.ts";
import { parseAtForRead, parseStructArgs, parseTypedArg } from "./tx.ts";

export async function handleQuery(
  target: string | undefined,
  keys: string[],
  opts: {
    chain?: string;
    rpc?: string;
    output?: string;
    json?: boolean;
    dump?: boolean;
    at?: string;
    /** Pre-parsed args from a file */
    parsedArgs?: unknown;
  },
) {
  if (!target) {
    const config = await loadConfig();
    const { name: chainName, chain: chainConfig } = resolveChain(config, opts.chain);
    const endpoint = connectedEndpoint(chainConfig.rpc, opts.rpc);
    const meta = await loadMeta(chainName, chainConfig, opts.rpc);
    const pallets = listPallets(meta);
    const withStorage = pallets.filter((p) => p.storage.length > 0);

    if (isJsonOutput(opts)) {
      await writeStdout(
        `${formatJson({
          chain: chainName,
          rpc: endpoint,
          pallets: withStorage.map((p) => ({ name: p.name, storage: p.storage.length })),
        })}\n`,
      );
      return;
    }

    printHeadingWithEndpoint(
      `Pallets with storage on ${chainName} (${withStorage.length})`,
      endpoint,
    );
    for (const p of withStorage) {
      printItem(p.name, `${p.storage.length} storage items`);
    }
    console.log();
    return;
  }

  // Check if target is pallet-only (no dot)
  const dotIdx = target.indexOf(".");
  if (dotIdx === -1) {
    // Listing mode: show storage items in the pallet
    const config = await loadConfig();
    const { name: chainName, chain: chainConfig } = resolveChain(config, opts.chain);
    const meta = await loadMeta(chainName, chainConfig, opts.rpc);
    const pallet = resolvePallet(meta, palletName(target));

    if (pallet.storage.length === 0) {
      if (isJsonOutput(opts)) {
        await writeStdout(
          `${formatJson({ chain: chainName, pallet: pallet.name, storage: [] })}\n`,
        );
      } else {
        console.log(`No storage items in ${pallet.name}.`);
      }
      return;
    }

    if (isJsonOutput(opts)) {
      await writeStdout(
        `${formatJson({
          chain: chainName,
          pallet: pallet.name,
          storage: pallet.storage.map((s) => {
            const valueType = describeType(meta.lookup, s.valueTypeId);
            const keyType =
              s.keyTypeId != null ? describeType(meta.lookup, s.keyTypeId) : undefined;
            return { name: s.name, type: s.type, valueType, keyType, docs: firstSentence(s.docs) };
          }),
        })}\n`,
      );
      return;
    }

    printHeading(`${pallet.name} Storage`);
    for (const s of pallet.storage) {
      const isMap = s.keyTypeId != null;
      const tag = isMap ? `${DIM} [map]${RESET}` : "";
      console.log(`  ${CYAN}${s.name}${RESET}${tag}`);
      if (isMap) {
        const keyType = prettyTypeById(meta.lookup, s.keyTypeId!, {
          indent: 4,
          prefix: 5, // "Key: "
        });
        console.log(`    ${DIM}Key:${RESET}   ${keyType}`);
      }
      const valueType = prettyTypeById(meta.lookup, s.valueTypeId, {
        indent: 4,
        prefix: 7, // "Value: "
      });
      console.log(`    ${DIM}Value:${RESET} ${valueType}`);
      const summary = firstSentence(s.docs);
      if (summary) {
        console.log(`      ${DIM}${summary}${RESET}`);
      }
    }
    console.log();
    return;
  }

  const pallet = target.slice(0, dotIdx);
  const item = target.slice(dotIdx + 1);

  const config = await loadConfig();
  const { name: chainName, chain: chainConfig } = resolveChain(config, opts.chain);

  const clientHandle = await createChainClient(chainName, chainConfig, opts.rpc);

  try {
    const meta = await getOrFetchMetadata(chainName, clientHandle);
    const palletNames = getPalletNames(meta);
    const palletInfo = findPallet(meta, pallet);
    if (!palletInfo) {
      throw new Error(suggestMessage("pallet", pallet, palletNames));
    }

    const storageItem = palletInfo.storage.find((s) => s.name.toLowerCase() === item.toLowerCase());
    if (!storageItem) {
      const storageNames = palletInfo.storage.map((s) => s.name);
      throw new Error(suggestMessage(`storage item in ${palletInfo.name}`, item, storageNames));
    }

    const unsafeApi = clientHandle.client.getUnsafeApi();
    const storageApi = (unsafeApi as any).query[palletInfo.name][storageItem.name];

    // Merge file args into keys: convert pre-parsed values to strings for parseStorageKeys
    const effectiveKeys =
      keys.length > 0 || opts.parsedArgs == null
        ? keys
        : Array.isArray(opts.parsedArgs)
          ? opts.parsedArgs.map((v: unknown) =>
              typeof v === "object" ? JSON.stringify(v) : String(v),
            )
          : [
              typeof opts.parsedArgs === "object"
                ? JSON.stringify(opts.parsedArgs)
                : String(opts.parsedArgs),
            ];
    const parsedKeys = await parseStorageKeys(meta, palletInfo.name, storageItem, effectiveKeys);
    const atArg = parseAtForRead(opts.at);
    const pullOpts = atArg !== undefined ? [{ at: atArg }] : [];
    const format = isJsonOutput(opts) ? "json" : (opts.output ?? "pretty");

    // Determine expected key count for maps
    const expectedLen =
      storageItem.type === "map" && storageItem.keyTypeId != null
        ? meta.builder.buildStorage(palletInfo.name, storageItem.name).len
        : 0;

    if (storageItem.type === "map" && parsedKeys.length < expectedLen) {
      // Partial keys (including 0 keys) → getEntries()
      if (parsedKeys.length === 0 && !opts.dump) {
        // No key and no --dump: show help instead of fetching all entries
        clientHandle.destroy();
        await showItemHelp("query", target!, { chain: opts.chain, rpc: opts.rpc });
        console.log(`${DIM}Hint: use --dump to fetch all entries${RESET}`);
        return;
      }
      // Fetch entries with partial (or no) keys
      const entries: Array<{ keyArgs: any; value: any }> = await withStalenessSuggestion(
        chainName,
        clientHandle,
        () =>
          withBlockAvailabilityHint(opts.at, () =>
            storageApi.getEntries(...parsedKeys, ...pullOpts),
          ),
      );

      const rows = entries.map((e: any) => ({
        keys: e.keyArgs,
        value: e.value,
      }));
      const text = format === "json" ? formatJson(rows) : formatPretty(rows);
      await writeStdout(`${text}\n`);
    } else {
      // Full key → single value lookup
      const result = await withStalenessSuggestion(chainName, clientHandle, () =>
        withBlockAvailabilityHint(opts.at, () => storageApi.getValue(...parsedKeys, ...pullOpts)),
      );
      const text = format === "json" ? formatJson(result) : formatPretty(result);
      await writeStdout(`${text}\n`);
    }
  } finally {
    clientHandle.destroy();
  }
}

function palletName(name: string): string {
  return name;
}

/**
 * Parse CLI key arguments for a storage query using metadata awareness.
 *
 * - Plain storage (no keys): returns []
 * - Single-hasher map with struct key: composes positional args into a struct,
 *   or accepts a single JSON arg
 * - Single-hasher map with non-struct key: parses 1 arg via parseTypedArg
 * - Multi-hasher NMap: parses each CLI arg against its corresponding key type
 */
async function parseStorageKeys(
  meta: MetadataBundle,
  palletName: string,
  storageItem: StorageItemInfo,
  args: string[],
): Promise<unknown[]> {
  // Plain storage — no keys expected
  if (storageItem.type === "plain" || storageItem.keyTypeId == null) {
    return args.map(parseValue);
  }

  // No args provided — caller will use getEntries()
  if (args.length === 0) return [];

  const storageEntry = meta.builder.buildStorage(palletName, storageItem.name);
  const len = storageEntry.len; // number of getValue() arguments (= number of hashers)
  const keyEntry = meta.lookup(storageItem.keyTypeId);

  if (len === 1) {
    // Single-hasher map: getValue() takes exactly 1 argument
    if (args.length === 1) {
      // Single CLI arg — parse it typed (handles JSON structs, primitives, AccountId, etc.)
      return [await parseTypedArg(meta, keyEntry, args[0]!)];
    }

    // Multiple CLI args — only valid if the key type is a struct
    if (keyEntry.type === "struct") {
      const label = `${palletName}.${storageItem.name} key`;
      return [await parseStructArgs(meta, keyEntry.value, args, label)];
    }

    // Wrong arg count for a non-struct single-hasher key
    const typeDesc = describeType(meta.lookup, storageItem.keyTypeId);
    throw new Error(
      `${palletName}.${storageItem.name} key expects ${typeDesc}\n` +
        `  Pass 1 argument. Got ${args.length}.`,
    );
  }

  // Multi-hasher NMap: getValue() takes N separate arguments
  if (args.length > len) {
    // Too many args — error
    let typeDesc: string;
    if (keyEntry.type === "tuple") {
      typeDesc = (keyEntry.value as any[])
        .map((e: any) => describeType(meta.lookup, e.id))
        .join(", ");
    } else {
      typeDesc = describeType(meta.lookup, storageItem.keyTypeId);
    }
    throw new Error(
      `${palletName}.${storageItem.name} expects at most ${len} key arg(s): (${typeDesc}). Got ${args.length}.`,
    );
  }

  // Parse provided args (may be partial or full) against corresponding tuple element types
  if (keyEntry.type === "tuple") {
    const entries = keyEntry.value as any[];
    return Promise.all(
      entries
        .slice(0, args.length)
        .map((entry: any, i: number) => parseTypedArg(meta, entry, args[i]!)),
    );
  }

  // Fallback for non-tuple multi-hasher (shouldn't normally happen)
  return Promise.all(args.map((arg) => parseTypedArg(meta, keyEntry, arg)));
}

export { parseStorageKeys };
