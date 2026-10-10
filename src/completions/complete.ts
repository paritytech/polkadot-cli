import { loadAccounts } from "../config/accounts-store.ts";
import { loadConfig, loadMetadata, loadRpcMethods } from "../config/store.ts";
import type { Config } from "../config/types.ts";
import { DEV_NAMES } from "../core/accounts.ts";
import { getAlgorithmNames } from "../core/hash.ts";
import type { PalletInfo } from "../core/metadata.ts";
import {
  getSignedExtensionNames,
  listPallets,
  listRuntimeApis,
  parseMetadata,
} from "../core/metadata.ts";
import { RPC_REGISTRY } from "../data/rpc-registry.ts";

const CATEGORIES = [
  "query",
  "tx",
  "const",
  "events",
  "errors",
  "apis",
  "extensions",
  "rpc",
] as const;

const CATEGORY_ALIASES: Record<string, string> = {
  query: "query",
  tx: "tx",
  const: "const",
  consts: "const",
  constants: "const",
  events: "events",
  event: "events",
  errors: "errors",
  error: "errors",
  apis: "apis",
  api: "apis",
  extensions: "extensions",
  extension: "extensions",
  ext: "extensions",
  rpc: "rpc",
};

const NAMED_COMMANDS = [
  "chain",
  "account",
  "inspect",
  "hash",
  "sign",
  "completions",
  "init",
  "which",
];

const CHAIN_SUBCOMMANDS = ["add", "info", "list", "properties", "remove", "update"];
const ACCOUNT_SUBCOMMANDS = [
  "add",
  "create",
  "new",
  "import",
  "derive",
  "list",
  "remove",
  "delete",
  "inspect",
];

const GLOBAL_OPTIONS = ["--chain", "--rpc", "--output", "--help", "--version"];
const TX_OPTIONS = [
  "--from",
  "--general",
  "--dry-run",
  "--encode",
  "--ext",
  "--wait",
  "--nonce",
  "--tip",
  "--mortality",
  "--at",
];
const QUERY_OPTIONS: string[] = [];

function matchCategory(s: string): string | undefined {
  return CATEGORY_ALIASES[s.toLowerCase()];
}

async function loadPallets(_config: Config, chainName: string): Promise<PalletInfo[] | null> {
  const raw = await loadMetadata(chainName);
  if (!raw) return null;
  const meta = parseMetadata(raw);
  return listPallets(meta);
}

async function loadRuntimeApiNames(
  _config: Config,
  chainName: string,
): Promise<{ name: string; methodNames: string[] }[] | null> {
  const raw = await loadMetadata(chainName);
  if (!raw) return null;
  const meta = parseMetadata(raw);
  return listRuntimeApis(meta).map((a) => ({
    name: a.name,
    methodNames: a.methods.map((m) => m.name),
  }));
}

async function loadExtensionIdentifiers(
  _config: Config,
  chainName: string,
): Promise<string[] | null> {
  const raw = await loadMetadata(chainName);
  if (!raw) return null;
  return getSignedExtensionNames(parseMetadata(raw));
}

function filterPallets(pallets: PalletInfo[], category: string): PalletInfo[] {
  switch (category) {
    case "query":
      return pallets.filter((p) => p.storage.length > 0);
    case "tx":
      return pallets.filter((p) => p.calls.length > 0);
    case "const":
      return pallets.filter((p) => p.constants.length > 0);
    case "events":
      return pallets.filter((p) => p.events.length > 0);
    case "errors":
      return pallets.filter((p) => p.errors.length > 0);
    default:
      return pallets;
  }
}

function getItemNames(pallet: PalletInfo, category: string): string[] {
  switch (category) {
    case "query":
      return pallet.storage.map((s) => s.name);
    case "tx":
      return pallet.calls.map((c) => c.name);
    case "const":
      return pallet.constants.map((c) => c.name);
    case "events":
      return pallet.events.map((e) => e.name);
    case "errors":
      return pallet.errors.map((e) => e.name);
    default:
      return [];
  }
}

function resolveChainFromArgs(precedingWords: string[], _config: Config): string | undefined {
  // Check for --chain <name> in preceding words
  for (let i = 0; i < precedingWords.length - 1; i++) {
    if (precedingWords[i] === "--chain") {
      return precedingWords[i + 1];
    }
  }
  return undefined;
}

function filterPrefix(candidates: string[], prefix: string): string[] {
  if (!prefix) return candidates;
  const lower = prefix.toLowerCase();
  return candidates.filter((c) => c.toLowerCase().startsWith(lower));
}

export async function generateCompletions(
  currentWord: string,
  precedingWords: string[],
): Promise<string[]> {
  const config = await loadConfig();
  const knownChains = Object.keys(config.chains);

  // 1. Option value completion
  const prevWord = precedingWords[precedingWords.length - 1];
  if (prevWord === "--chain") {
    return filterPrefix(knownChains, currentWord);
  }
  if (prevWord === "--output") {
    return filterPrefix(["pretty", "json"], currentWord);
  }
  if (prevWord === "--from") {
    const accounts = await loadAccounts();
    const names = [...DEV_NAMES, ...accounts.accounts.map((a) => a.name)];
    return filterPrefix(names, currentWord);
  }
  if (prevWord === "--wait" || prevWord === "-w") {
    return filterPrefix(["broadcast", "best-block", "best", "finalized"], currentWord);
  }
  if (prevWord === "--relay") {
    return filterPrefix(knownChains, currentWord);
  }

  // 2. Option name completion
  if (currentWord.startsWith("--")) {
    // Determine active category from preceding words
    const activeCategory = detectCategory(precedingWords, knownChains);
    const options = [...GLOBAL_OPTIONS];
    if (activeCategory === "tx") options.push(...TX_OPTIONS);
    if (activeCategory === "query") options.push(...QUERY_OPTIONS);

    const chainIdx = precedingWords.indexOf("chain");
    if (chainIdx >= 0 && precedingWords[chainIdx + 1] === "add") {
      options.push("--relay", "--parachain-id");
    }

    return filterPrefix(options, currentWord);
  }

  // 3. Named subcommand completion
  const firstArg = precedingWords.find((w) => !w.startsWith("-"));
  if (firstArg === "chain") {
    const chainSubIdx = precedingWords.indexOf("chain");
    const subcommand = precedingWords[chainSubIdx + 1];
    if (subcommand === "add" && currentWord.startsWith("--")) {
      return filterPrefix(["--rpc", "--relay", "--parachain-id", ...GLOBAL_OPTIONS], currentWord);
    }
    return filterPrefix(CHAIN_SUBCOMMANDS, currentWord);
  }
  if (firstArg === "account") {
    return filterPrefix(ACCOUNT_SUBCOMMANDS, currentWord);
  }
  if (firstArg === "hash") {
    return filterPrefix(getAlgorithmNames(), currentWord);
  }

  if (firstArg === "account" && prevWord === "--parachain-type") {
    return filterPrefix(["child", "sibling"], currentWord);
  }

  // 4. Dotpath completion
  return completeDotpath(currentWord, config, knownChains, precedingWords);
}

function detectCategory(words: string[], _knownChains: string[]): string | undefined {
  for (const w of words) {
    if (w.startsWith("-")) continue;
    // Try as dotpath
    const parts = w.split(".");
    for (const part of parts) {
      const cat = matchCategory(part);
      if (cat) return cat;
    }
  }
  return undefined;
}

async function completeDotpath(
  currentWord: string,
  config: Config,
  knownChains: string[],
  precedingWords: string[],
): Promise<string[]> {
  const endsWithDot = currentWord.endsWith(".");
  const parts = currentWord.split(".");
  // completeSegments: all parts except the trailing partial (or empty string after final dot)
  const completeSegments = parts.slice(0, -1);
  const partial = endsWithDot ? "" : (parts[parts.length - 1] ?? "");
  const numComplete = completeSegments.length;

  // Top-level: no complete segments, typing a partial
  if (numComplete === 0 && !endsWithDot) {
    const candidates = [
      ...CATEGORIES.map((c) => `${c}.`),
      ...knownChains.map((c) => `${c}.`),
      ...NAMED_COMMANDS,
    ];
    return filterPrefix(candidates, partial);
  }

  const first = completeSegments[0] ?? "";
  const firstIsCategory = matchCategory(first) !== undefined;
  const firstIsChain = knownChains.some((c) => c.toLowerCase() === first.toLowerCase());

  // Determine chain for metadata loading
  const chainFromFlag = resolveChainFromArgs(precedingWords, config);

  if (firstIsCategory) {
    const category = matchCategory(first)!;

    // Runtime APIs use API names / method names instead of pallets / items
    if (category === "apis") {
      return completeApisCategory(
        first,
        numComplete,
        endsWithDot,
        completeSegments,
        currentWord,
        config,
        chainFromFlag,
      );
    }

    // Transaction extensions are flat: <category>.<Identifier> (no sub-items)
    if (category === "extensions") {
      return completeExtensionsCategory(
        first,
        numComplete,
        endsWithDot,
        currentWord,
        config,
        chainFromFlag,
      );
    }

    // RPC methods are also flat: <category>.<method_name>
    if (category === "rpc") {
      return completeRpcCategory(first, numComplete, endsWithDot, currentWord, chainFromFlag);
    }

    if (numComplete === 1 && endsWithDot) {
      // "category." → pallet names
      const chainName = chainFromFlag;
      if (!chainName) return [];
      const pallets = await loadPallets(config, chainName);
      if (!pallets) return [];
      const filtered = filterPallets(pallets, category);
      const candidates = filtered.map((p) => `${first}.${p.name}.`);
      return filterPrefix(candidates, currentWord.slice(0, -1));
    }

    if (numComplete === 1 && !endsWithDot) {
      // "category.partial" → filter pallet names
      const chainName = chainFromFlag;
      if (!chainName) return [];
      const pallets = await loadPallets(config, chainName);
      if (!pallets) return [];
      const filtered = filterPallets(pallets, category);
      const candidates = filtered.map((p) => `${first}.${p.name}.`);
      return filterPrefix(candidates, currentWord);
    }

    if (numComplete === 2) {
      // "category.Pallet." or "category.Pallet.partial" → item names
      const palletName = completeSegments[1]!;
      const chainName = chainFromFlag;
      if (!chainName) return [];
      const pallets = await loadPallets(config, chainName);
      if (!pallets) return [];
      const pallet = pallets.find((p) => p.name.toLowerCase() === palletName.toLowerCase());
      if (!pallet) return [];
      const items = getItemNames(pallet, category);
      const candidates = items.map((i) => `${first}.${palletName}.${i}`);
      return filterPrefix(candidates, endsWithDot ? currentWord.slice(0, -1) : currentWord);
    }

    return [];
  }

  if (firstIsChain) {
    const chainName = first;

    if (numComplete === 1 && endsWithDot) {
      // "chain." → categories
      const candidates = CATEGORIES.map((c) => `${first}.${c}.`);
      return filterPrefix(candidates, currentWord.slice(0, -1));
    }

    if (numComplete === 1 && !endsWithDot) {
      // "chain.partial" → filter categories
      const candidates = CATEGORIES.map((c) => `${first}.${c}.`);
      return filterPrefix(candidates, currentWord);
    }

    if (numComplete === 2) {
      // "chain.category." or "chain.category.partial" → pallet/API names
      const category = matchCategory(completeSegments[1]!);
      if (!category) return [];

      if (category === "apis") {
        return completeApisCategory(
          `${first}.${completeSegments[1]!}`,
          numComplete - 1,
          endsWithDot,
          completeSegments.slice(1),
          currentWord,
          config,
          chainName,
        );
      }

      if (category === "extensions") {
        return completeExtensionsCategory(
          `${first}.${completeSegments[1]!}`,
          numComplete - 1,
          endsWithDot,
          currentWord,
          config,
          chainName,
        );
      }

      if (category === "rpc") {
        return completeRpcCategory(
          `${first}.${completeSegments[1]!}`,
          numComplete - 1,
          endsWithDot,
          currentWord,
          chainName,
        );
      }

      const pallets = await loadPallets(config, chainName);
      if (!pallets) return [];
      const filtered = filterPallets(pallets, category);
      const prefix = `${first}.${completeSegments[1]!}`;
      const candidates = filtered.map((p) => `${prefix}.${p.name}.`);
      return filterPrefix(candidates, endsWithDot ? currentWord.slice(0, -1) : currentWord);
    }

    if (numComplete === 3) {
      // "chain.category.Pallet." or "chain.category.Pallet.partial" → items/methods
      const category = matchCategory(completeSegments[1]!);
      if (!category) return [];

      if (category === "apis") {
        return completeApisCategory(
          `${first}.${completeSegments[1]!}`,
          numComplete - 1,
          endsWithDot,
          completeSegments.slice(1),
          currentWord,
          config,
          chainName,
        );
      }

      const palletName = completeSegments[2]!;
      const pallets = await loadPallets(config, chainName);
      if (!pallets) return [];
      const pallet = pallets.find((p) => p.name.toLowerCase() === palletName.toLowerCase());
      if (!pallet) return [];
      const items = getItemNames(pallet, category);
      const prefix = `${first}.${completeSegments[1]!}.${palletName}`;
      const candidates = items.map((i) => `${prefix}.${i}`);
      return filterPrefix(candidates, endsWithDot ? currentWord.slice(0, -1) : currentWord);
    }

    return [];
  }

  return [];
}

/**
 * Complete API names and method names for the `apis` category.
 * `prefix` is the dotpath prefix before the API name (e.g. "apis" or "polkadot.apis").
 * `numComplete` is the number of complete segments after the category (0, 1, or 2).
 * `segments` are the complete segments after the category.
 */
async function completeApisCategory(
  prefix: string,
  numComplete: number,
  endsWithDot: boolean,
  segments: string[],
  currentWord: string,
  config: Config,
  chainNameOverride?: string,
): Promise<string[]> {
  const chainName = chainNameOverride;
  if (!chainName) return [];
  const apis = await loadRuntimeApiNames(config, chainName);
  if (!apis) return [];

  if (numComplete === 1 && endsWithDot) {
    // "apis." → API names
    const candidates = apis.map((a) => `${prefix}.${a.name}.`);
    return filterPrefix(candidates, currentWord.slice(0, -1));
  }

  if (numComplete === 1 && !endsWithDot) {
    // "apis.partial" → filter API names
    const candidates = apis.map((a) => `${prefix}.${a.name}.`);
    return filterPrefix(candidates, currentWord);
  }

  if (numComplete === 2) {
    // "apis.Core." or "apis.Core.partial" → method names
    const apiName = segments[1]!;
    const api = apis.find((a) => a.name.toLowerCase() === apiName.toLowerCase());
    if (!api) return [];
    const candidates = api.methodNames.map((m) => `${prefix}.${apiName}.${m}`);
    return filterPrefix(candidates, endsWithDot ? currentWord.slice(0, -1) : currentWord);
  }

  return [];
}

/**
 * Complete transaction extension identifiers.
 * Extensions are flat: `extensions.<Identifier>` (no sub-items).
 * `prefix` is the dotpath prefix before the identifier (e.g. "extensions" or "polkadot.extensions").
 * `numComplete` is the number of complete segments after the category (0 or 1).
 */
async function completeExtensionsCategory(
  prefix: string,
  numComplete: number,
  endsWithDot: boolean,
  currentWord: string,
  config: Config,
  chainNameOverride?: string,
): Promise<string[]> {
  const chainName = chainNameOverride;
  if (!chainName) return [];
  const names = await loadExtensionIdentifiers(config, chainName);
  if (!names) return [];

  if (numComplete === 1 && endsWithDot) {
    const candidates = names.map((n) => `${prefix}.${n}`);
    return filterPrefix(candidates, currentWord.slice(0, -1));
  }

  if (numComplete === 1 && !endsWithDot) {
    const candidates = names.map((n) => `${prefix}.${n}`);
    return filterPrefix(candidates, currentWord);
  }

  return [];
}

/**
 * Complete JSON-RPC method names for the `rpc` category.
 * Flat: `[chain.]rpc.<method>`. Sources candidates from the cached
 * `rpc_methods` list; falls back to the curated registry when no cache exists.
 */
async function completeRpcCategory(
  prefix: string,
  numComplete: number,
  endsWithDot: boolean,
  currentWord: string,
  chainNameOverride?: string,
): Promise<string[]> {
  let names: string[];
  if (chainNameOverride) {
    const cached = await loadRpcMethods(chainNameOverride);
    names = cached?.methods ?? Object.keys(RPC_REGISTRY);
  } else {
    names = Object.keys(RPC_REGISTRY);
  }

  if (numComplete === 1 && endsWithDot) {
    const candidates = names.map((n) => `${prefix}.${n}`);
    return filterPrefix(candidates, currentWord.slice(0, -1));
  }

  if (numComplete === 1 && !endsWithDot) {
    const candidates = names.map((n) => `${prefix}.${n}`);
    return filterPrefix(candidates, currentWord);
  }

  return [];
}
