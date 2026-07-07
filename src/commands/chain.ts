import { readFile, writeFile } from "node:fs/promises";
import type { CAC } from "cac";
import {
  findChainName,
  loadConfig,
  loadMetadataFingerprint,
  loadRpcMethods,
  removeChainData,
  resolveChain,
  saveConfig,
  saveRpcMethods,
} from "../config/store.ts";
import {
  BUILTIN_CHAIN_NAMES,
  type ChainConfig,
  type Config,
  DEFAULT_CONFIG,
} from "../config/types.ts";
import { fetchChainProperties } from "../core/chain-properties.ts";
import { createChainClient, getParachainId } from "../core/client.ts";
import { fetchMetadataFromChain } from "../core/metadata.ts";
import {
  BOLD,
  CHECK_MARK,
  CYAN,
  DIM,
  formatJson,
  GREEN,
  isJsonOutput,
  printHeading,
  printImportResults,
  RED,
  RESET,
  YELLOW,
} from "../core/output.ts";
import { fetchRpcMethods } from "../core/rpc.ts";
import { inferFamily, RPC_REGISTRY } from "../data/rpc-registry.ts";
import { withHelp } from "../platform/cli.ts";

const CHAIN_HELP = `
${BOLD}Usage:${RESET}
  $ dot chain add <name> --rpc <url>    Add a chain via WebSocket RPC
  $ dot chain remove <name>             Remove a chain
  $ dot chain update <name>             Re-fetch metadata for a chain
  $ dot chain update --all              Re-fetch metadata for all configured chains
  $ dot chain list                      List configured chains
  $ dot chain info <name>               Show details for a single chain
  $ dot chain properties <name>         Show token decimals/symbol and ss58 prefix
  $ dot chain <name>                    Shortcut for \`chain info <name>\`
  $ dot chain export [names...]         Export chain configuration to stdout
  $ dot chain import <file>             Import chain configuration from a file

${BOLD}Examples:${RESET}
  $ dot chain add kusama --rpc wss://kusama-rpc.polkadot.io
  $ dot chain add kusama --rpc wss://kusama-rpc.polkadot.io --rpc wss://kusama-rpc.dwellir.com
  $ dot chain add my-para --rpc wss://rpc.example.com --relay polkadot
  $ dot chain add my-para --rpc wss://rpc.example.com --relay polkadot --parachain-id 2000
  $ dot chain list
  $ dot chains -v
  $ dot chain info polkadot
  $ dot chain polkadot
  $ dot chain properties polkadot
  $ dot chain properties polkadot --json
  $ dot chain update kusama
  $ dot chain update --all
  $ dot chain remove kusama
  $ dot chain export
  $ dot chain export my-relay my-para --file my-chains.json
  $ dot chain export --all
  $ dot chain import my-chains.json
  $ dot chain import my-chains.json --dry-run
  $ dot chain import my-chains.json --overwrite
  $ dot chain import my-chains.json --no-metadata
`.trimStart();

export function registerChainCommands(cli: CAC) {
  const command = cli
    .command(
      "chain [action] [...names]",
      "Manage chains (add, remove, update, list, export, import)",
    )
    .alias("chains")
    .option("--all", "Update/export all configured chains")
    .option("--relay <name>", "Parent relay chain for this parachain")
    .option("--parachain-id <id>", "Parachain ID (auto-detected if omitted with --relay)")
    .option("--file <path>", "Output/input file for export/import")
    .option("--overwrite", "Overwrite existing chains on import")
    .option("--dry-run", "Preview import without applying changes")
    .option("--no-metadata", "Skip automatic metadata fetch after import")
    .option("-v, --verbose", "Show RPC endpoints in `chains` list output")
    .action(
      async (
        action: string | undefined,
        names: string[],
        opts: {
          rpc?: string | string[];
          all?: boolean;
          relay?: string;
          parachainId?: string;
          file?: string;
          overwrite?: boolean;
          dryRun?: boolean;
          metadata?: boolean;
          verbose?: boolean;
          output?: string;
          json?: boolean;
        },
      ) => {
        if (!action) {
          if (process.argv[2] === "chains") return chainList(opts);
          console.log(CHAIN_HELP);
          return;
        }
        switch (action) {
          case "add":
            return chainAdd(names[0], opts);
          case "remove":
            return chainRemove(names[0], opts);
          case "list":
            return chainList(opts);
          case "info":
            return chainInfo(names[0], opts);
          case "properties":
            return chainProperties(names[0], opts);
          case "update":
            return chainUpdate(names[0], opts);
          case "export":
            return chainExport(names, opts);
          case "import":
            return chainImport(names[0], opts);
          default: {
            const config = await loadConfig();
            if (findChainName(config, action)) {
              return chainInfo(action, opts);
            }
            console.error(`Unknown action "${action}".\n`);
            console.log(CHAIN_HELP);
            process.exit(1);
          }
        }
      },
    );
  withHelp(command, () => console.log(CHAIN_HELP));
}

/**
 * Best-effort fetch + cache of the node's `rpc_methods` list. Failures are
 * non-fatal — the metadata operation that called us still succeeds.
 */
async function refreshRpcMethods(
  chainName: string,
  rpcUrl: string | string[],
  silent = false,
): Promise<void> {
  try {
    const { methods, version } = await fetchRpcMethods(rpcUrl);
    await saveRpcMethods(chainName, methods, version);
  } catch (err) {
    if (!silent) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${YELLOW}Warning:${RESET} could not fetch rpc_methods — ${msg}\n`);
    }
  }
}

async function chainAdd(
  name: string | undefined,
  opts: {
    rpc?: string | string[];
    relay?: string;
    parachainId?: string;
    output?: string;
    json?: boolean;
  },
) {
  if (!name) {
    console.error("Chain name is required.\n");
    console.error("Usage: dot chain add <name> --rpc <url>");
    process.exit(1);
  }
  if (!opts.rpc) {
    console.error("Must provide --rpc <url>.\n");
    console.error("Usage: dot chain add <name> --rpc <url>");
    process.exit(1);
  }

  const parachainIdRaw = opts.parachainId != null ? Number(opts.parachainId) : undefined;
  if (parachainIdRaw != null && !opts.relay) {
    console.error("Cannot set --parachain-id without --relay.\n");
    console.error("Usage: dot chain add <name> --rpc <url> --relay <relay> --parachain-id <id>");
    process.exit(1);
  }

  const chainConfig: ChainConfig = { rpc: opts.rpc };

  process.stderr.write(`Connecting to ${name}...\n`);
  const clientHandle = await createChainClient(name, chainConfig, opts.rpc);

  try {
    process.stderr.write("Fetching metadata...\n");
    await fetchMetadataFromChain(clientHandle, name);
    await refreshRpcMethods(name, opts.rpc);

    if (opts.relay) {
      const config = await loadConfig();
      const relayResolved = findChainName(config, opts.relay);
      if (!relayResolved) {
        throw new Error(
          `Relay chain "${opts.relay}" not found. Add it first with: dot chain add ${opts.relay} --rpc <url>`,
        );
      }
      chainConfig.relay = relayResolved;

      if (parachainIdRaw != null) {
        chainConfig.parachainId = parachainIdRaw;
      } else {
        process.stderr.write("Detecting parachain ID...\n");
        const detected = await getParachainId(clientHandle);
        if (detected != null) {
          chainConfig.parachainId = detected;
          process.stderr.write(`Detected parachain ID: ${detected}\n`);
        } else {
          process.stderr.write(
            "Could not detect parachain ID. Use --parachain-id to set it manually.\n",
          );
        }
      }
    }

    // Only save config after successful connection + metadata fetch
    const config = await loadConfig();
    config.chains[name] = chainConfig;
    await saveConfig(config);

    const result: Record<string, unknown> = { action: "added", chain: name };
    if (chainConfig.relay) result.relay = chainConfig.relay;
    if (chainConfig.parachainId != null) result.parachainId = chainConfig.parachainId;

    if (isJsonOutput(opts)) {
      console.log(formatJson(result));
    } else {
      console.log(`Chain "${name}" added successfully.`);
    }
  } finally {
    clientHandle.destroy();
  }
}

async function chainRemove(
  name: string | undefined,
  opts: { output?: string; json?: boolean } = {},
) {
  if (!name) {
    console.error("Usage: dot chain remove <name>");
    process.exit(1);
  }

  const config = await loadConfig();

  const resolved = findChainName(config, name);
  if (!resolved) {
    throw new Error(`Chain "${name}" not found.`);
  }

  if (BUILTIN_CHAIN_NAMES.has(resolved)) {
    throw new Error(`Cannot remove the built-in "${resolved}" chain.`);
  }

  const orphans = Object.entries(config.chains)
    .filter(([, c]) => c.relay === resolved)
    .map(([n]) => n);
  if (orphans.length > 0) {
    console.error(
      `Warning: ${orphans.length} chain(s) reference "${resolved}" as their relay: ${orphans.join(", ")}`,
    );
  }

  delete config.chains[resolved];

  await saveConfig(config);
  await removeChainData(resolved);

  if (isJsonOutput(opts)) {
    console.log(formatJson({ action: "removed", chain: resolved }));
  } else {
    console.log(`Chain "${resolved}" removed.`);
  }
}

async function chainList(opts: { output?: string; json?: boolean; verbose?: boolean } = {}) {
  const config = await loadConfig();

  if (isJsonOutput(opts)) {
    const chains = Object.entries(config.chains).map(([name, chainConfig]) => ({
      name,
      rpc: Array.isArray(chainConfig.rpc) ? chainConfig.rpc : [chainConfig.rpc],
      ...(chainConfig.relay && { relay: chainConfig.relay }),
      ...(chainConfig.parachainId != null && { parachainId: chainConfig.parachainId }),
    }));
    console.log(formatJson({ chains }));
    return;
  }

  const verbose = opts.verbose === true;

  printHeading("Configured Chains");

  const parachainsByRelay = new Map<string, [string, ChainConfig][]>();
  const standalone: [string, ChainConfig][] = [];

  for (const [name, chainConfig] of Object.entries(config.chains)) {
    if (chainConfig.relay) {
      const paras = parachainsByRelay.get(chainConfig.relay) ?? [];
      paras.push([name, chainConfig]);
      parachainsByRelay.set(chainConfig.relay, paras);
    }
  }

  const relayNames = new Set(parachainsByRelay.keys());

  for (const [name, chainConfig] of Object.entries(config.chains)) {
    if (relayNames.has(name)) continue;
    if (chainConfig.relay) continue;
    standalone.push([name, chainConfig]);
  }

  for (const relayName of relayNames) {
    const relayConfig = config.chains[relayName];
    if (relayConfig) {
      printChainLine("  ", relayName, relayConfig, "", verbose);
    }

    const paras = parachainsByRelay.get(relayName) ?? [];
    for (let i = 0; i < paras.length; i++) {
      const [name, chainConfig] = paras[i]!;
      const isLast = i === paras.length - 1;
      const prefix = isLast ? "  └─ " : "  ├─ ";
      const idSuffix =
        chainConfig.parachainId != null ? ` ${DIM}[${chainConfig.parachainId}]${RESET}` : "";
      printChainLine(prefix, name, chainConfig, idSuffix, verbose);
    }
    console.log();
  }

  for (const [name, chainConfig] of standalone) {
    printChainLine("  ", name, chainConfig, "", verbose);
  }
  if (standalone.length > 0) console.log();
}

function printChainLine(
  prefix: string,
  name: string,
  chainConfig: ChainConfig,
  suffix = "",
  verbose = false,
) {
  if (!verbose) {
    console.log(`${prefix}${CYAN}${name}${RESET}${suffix}`);
    return;
  }
  const rpcs = Array.isArray(chainConfig.rpc) ? chainConfig.rpc : [chainConfig.rpc];
  console.log(`${prefix}${CYAN}${name}${RESET}${suffix}  ${DIM}${rpcs[0]}${RESET}`);
  const indent = prefix.replace(/[^\s]/g, " ");
  for (let i = 1; i < rpcs.length; i++) {
    console.log(`${indent}  ${DIM}${rpcs[i]}${RESET}`);
  }
}

async function chainInfo(name: string | undefined, opts: { output?: string; json?: boolean } = {}) {
  if (!name) {
    console.error("Usage: dot chain info <name>");
    process.exit(1);
  }

  const config = await loadConfig();
  const { name: resolved, chain } = resolveChain(config, name);

  const rpcs = Array.isArray(chain.rpc) ? chain.rpc : [chain.rpc];
  const parachains = Object.entries(config.chains)
    .filter(([, c]) => c.relay === resolved)
    .map(([n, c]) => ({ name: n, parachainId: c.parachainId }));

  const fingerprint = await loadMetadataFingerprint(resolved);
  const rpcCache = await loadRpcMethods(resolved);
  const rpcSummary = rpcCache
    ? {
        count: rpcCache.methods.length,
        fetchedAt: rpcCache.fetchedAt,
        byFamily: countByFamily(rpcCache.methods),
      }
    : null;

  if (isJsonOutput(opts)) {
    console.log(
      formatJson({
        name: resolved,
        rpc: rpcs,
        ...(chain.relay && { relay: chain.relay }),
        ...(chain.parachainId != null && { parachainId: chain.parachainId }),
        ...(parachains.length > 0 && { parachains }),
        metadata: fingerprint
          ? {
              specName: fingerprint.specName,
              specVersion: fingerprint.specVersion,
              fetchedAt: fingerprint.fetchedAt,
            }
          : null,
        rpcMethods: rpcSummary,
      }),
    );
    return;
  }

  printHeading(resolved);

  console.log(`  ${CYAN}rpc:${RESET}`);
  for (const rpc of rpcs) {
    console.log(`    ${DIM}${rpc}${RESET}`);
  }

  if (chain.relay) {
    console.log(`  ${CYAN}relay:${RESET}        ${chain.relay}`);
  }
  if (chain.parachainId != null) {
    console.log(`  ${CYAN}parachain id:${RESET} ${chain.parachainId}`);
  }

  if (parachains.length > 0) {
    console.log(`  ${CYAN}parachains:${RESET}`);
    for (const p of parachains) {
      const idSuffix = p.parachainId != null ? ` ${DIM}[${p.parachainId}]${RESET}` : "";
      console.log(`    ${p.name}${idSuffix}`);
    }
  }

  console.log(`  ${CYAN}metadata:${RESET}`);
  if (fingerprint) {
    console.log(
      `    ${fingerprint.specName} v${fingerprint.specVersion} ${DIM}(cached ${fingerprint.fetchedAt})${RESET}`,
    );
  } else {
    console.log(`    ${DIM}not cached — run \`dot chain update ${resolved}\`${RESET}`);
  }

  console.log(`  ${CYAN}rpc methods:${RESET}`);
  if (rpcSummary) {
    const families = Object.entries(rpcSummary.byFamily)
      .map(([f, n]) => `${f}: ${n}`)
      .join(", ");
    console.log(`    ${rpcSummary.count} ${DIM}(${families})${RESET}`);
    console.log(`    ${DIM}cached ${rpcSummary.fetchedAt}${RESET}`);
  } else {
    console.log(`    ${DIM}not cached — run \`dot chain update ${resolved}\`${RESET}`);
  }
}

async function chainProperties(
  name: string | undefined,
  opts: { rpc?: string | string[]; output?: string; json?: boolean } = {},
) {
  if (!name) {
    console.error("Usage: dot chain properties <name>");
    process.exit(1);
  }

  const config = await loadConfig();
  const { name: resolved, chain } = resolveChain(config, name);
  const rpcUrl = opts.rpc ?? chain.rpc;

  process.stderr.write(`Fetching properties for ${resolved}...\n`);
  const { properties } = await fetchChainProperties(rpcUrl);

  if (isJsonOutput(opts)) {
    console.log(formatJson(properties));
    return;
  }

  printHeading(resolved);
  printProperty("token decimals", properties.tokenDecimals);
  printProperty("token symbol", properties.tokenSymbol);
  printProperty("ss58 format", properties.ss58Format);
}

function printProperty(label: string, value: unknown) {
  const rendered =
    value == null ? `${DIM}—${RESET}` : Array.isArray(value) ? value.join(", ") : String(value);
  console.log(`  ${CYAN}${label}:${RESET} ${rendered}`);
}

function countByFamily(methods: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of methods) {
    const family = RPC_REGISTRY[m]?.family ?? inferFamily(m);
    counts[family] = (counts[family] ?? 0) + 1;
  }
  return counts;
}

async function chainUpdate(
  name: string | undefined,
  opts: { rpc?: string | string[]; all?: boolean; output?: string; json?: boolean },
) {
  const config = await loadConfig();

  if (opts.all) {
    await chainUpdateAll(config);
    return;
  }

  if (!name) {
    console.error("Usage: dot chain update <name> | --all");
    process.exit(1);
  }

  const { name: chainName, chain: chainConfig } = resolveChain(config, name);

  process.stderr.write(`Connecting to ${chainName}...\n`);
  const clientHandle = await createChainClient(chainName, chainConfig, opts.rpc);

  try {
    process.stderr.write("Fetching metadata...\n");
    await fetchMetadataFromChain(clientHandle, chainName);
    await refreshRpcMethods(chainName, opts.rpc ?? chainConfig.rpc);
    if (isJsonOutput(opts)) {
      console.log(formatJson({ action: "updated", chain: chainName }));
    } else {
      console.log(`Metadata for "${chainName}" updated.`);
    }
  } finally {
    clientHandle.destroy();
  }
}

async function chainUpdateAll(config: {
  chains: Record<string, import("../config/types.ts").ChainConfig>;
}) {
  const chainNames = Object.keys(config.chains).sort();
  const failed = await updateChainsMetadata(config, chainNames);
  if (failed > 0) {
    console.error(`\n${failed} of ${chainNames.length} chains failed to update.`);
    process.exit(1);
  }
}

async function updateChainsMetadata(
  config: { chains: Record<string, import("../config/types.ts").ChainConfig> },
  chainNames: string[],
): Promise<number> {
  if (chainNames.length === 0) return 0;

  process.stderr.write(`Updating metadata for ${chainNames.length} chain(s)...\n\n`);

  const results = await Promise.allSettled(
    chainNames.map(async (chainName) => {
      const chainConfig = config.chains[chainName]!;
      const clientHandle = await createChainClient(chainName, chainConfig);
      try {
        await fetchMetadataFromChain(clientHandle, chainName);
        await refreshRpcMethods(chainName, chainConfig.rpc, true);
      } finally {
        clientHandle.destroy();
      }
    }),
  );

  for (let i = 0; i < chainNames.length; i++) {
    const result = results[i]!;
    const name = chainNames[i]!;
    if (result.status === "fulfilled") {
      console.log(`  ${GREEN}${CHECK_MARK}${RESET} ${name}`);
    } else {
      console.log(
        `  ${RED}✗${RESET} ${name}${DIM} — ${result.reason?.message ?? "unknown error"}${RESET}`,
      );
    }
  }

  return results.filter((r) => r.status === "rejected").length;
}

function isBuiltinModified(name: string, config: Config): boolean {
  const defaultRpc = DEFAULT_CONFIG.chains[name]?.rpc;
  const currentRpc = config.chains[name]?.rpc;
  if (!defaultRpc || !currentRpc) return false;
  return JSON.stringify(currentRpc) !== JSON.stringify(defaultRpc);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

interface ChainExportData {
  chains: Record<string, ChainConfig>;
}

async function chainExport(
  names: string[],
  opts: {
    all?: boolean;
    file?: string;
    output?: string;
    json?: boolean;
  },
) {
  const config = await loadConfig();
  const exportChains: Record<string, ChainConfig> = {};

  if (names.length > 0) {
    for (const input of names) {
      const resolved = findChainName(config, input);
      if (!resolved) {
        throw new Error(`Chain "${input}" not found.`);
      }
      exportChains[resolved] = config.chains[resolved]!;
    }
  } else if (opts.all) {
    Object.assign(exportChains, config.chains);
  } else {
    // Export user-added chains + built-ins with modified RPC
    for (const [name, chainConfig] of Object.entries(config.chains)) {
      if (!BUILTIN_CHAIN_NAMES.has(name) || isBuiltinModified(name, config)) {
        exportChains[name] = chainConfig;
      }
    }
  }

  const exportData: ChainExportData = {
    chains: exportChains,
  };

  const json = `${JSON.stringify(exportData, null, 2)}\n`;

  if (opts.file) {
    await writeFile(opts.file, json);
    if (isJsonOutput(opts)) {
      console.log(
        formatJson({
          action: "exported",
          file: opts.file,
          count: Object.keys(exportChains).length,
        }),
      );
    } else {
      console.log(`Exported ${Object.keys(exportChains).length} chain(s) to ${opts.file}`);
    }
  } else {
    process.stdout.write(json);
  }
}

async function chainImport(
  filePath: string | undefined,
  opts: {
    file?: string;
    overwrite?: boolean;
    dryRun?: boolean;
    metadata?: boolean;
    output?: string;
    json?: boolean;
  },
) {
  const inputPath = filePath ?? opts.file;
  let raw: string;
  if (!inputPath || inputPath === "-") {
    if (process.stdin.isTTY) {
      console.log(CHAIN_HELP);
      return;
    }
    raw = await readStdin();
  } else {
    raw = await readFile(inputPath, "utf-8");
  }

  let importData: ChainExportData;
  try {
    importData = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON input.");
  }

  if (!importData.chains || typeof importData.chains !== "object") {
    throw new Error('Invalid import format: missing "chains" object.');
  }

  const config = await loadConfig();
  const added: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];
  const warnings: string[] = [];

  for (const [name, chainConfig] of Object.entries(importData.chains)) {
    const existing = findChainName(config, name);

    if (existing && !opts.overwrite) {
      skipped.push(existing);
      process.stderr.write(
        `${YELLOW}Skipped "${existing}": already exists (use --overwrite to replace)${RESET}\n`,
      );
      continue;
    }

    if (chainConfig.relay) {
      const relayInImport = Object.keys(importData.chains).some(
        (n) => n.toLowerCase() === chainConfig.relay!.toLowerCase(),
      );
      const relayInConfig = findChainName(config, chainConfig.relay);
      if (!relayInImport && !relayInConfig) {
        warnings.push(
          `Chain "${name}" references relay "${chainConfig.relay}" which does not exist.`,
        );
        process.stderr.write(
          `${YELLOW}Warning: "${name}" references relay "${chainConfig.relay}" which does not exist.${RESET}\n`,
        );
      }
    }

    if (existing) {
      overwritten.push(existing);
      config.chains[existing] = chainConfig;
    } else {
      added.push(name);
      config.chains[name] = chainConfig;
    }
  }

  if (!opts.dryRun) {
    await saveConfig(config);
  }

  if (isJsonOutput(opts)) {
    console.log(
      formatJson({
        action: opts.dryRun ? "dry-run" : "imported",
        added,
        overwritten,
        skipped,
        warnings,
      }),
    );
    return;
  }

  printImportResults({
    added,
    overwritten,
    skipped,
    dryRun: opts.dryRun ?? false,
    noun: "chain",
  });

  if (!opts.dryRun && opts.metadata !== false && (added.length > 0 || overwritten.length > 0)) {
    console.log();
    await updateChainsMetadata(config, [...added, ...overwritten]);
  }
}
