import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "../utils/errors.ts";
import { isRuntimeFingerprint, type RuntimeFingerprint } from "../utils/runtime-fingerprint.ts";
import type { ChainConfig, Config } from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";
import { findWorkspace } from "./workspace.ts";

export type ConfigDirSource = "env" | "workspace" | "global";

export interface ResolvedConfigDir {
  path: string;
  source: ConfigDirSource;
}

/**
 * Resolve the active config root and how it was chosen.
 * Precedence: DOT_HOME env var → discovered local workspace (`.polkadot/`
 * in cwd or a parent, see findWorkspace) → global ~/.polkadot.
 */
export function resolveConfigDir(cwd: string = process.cwd()): ResolvedConfigDir {
  const override = process.env.DOT_HOME;
  if (override && override.length > 0) return { path: override, source: "env" };
  const workspace = findWorkspace(cwd);
  if (workspace) return { path: workspace, source: "workspace" };
  return { path: join(homedir(), ".polkadot"), source: "global" };
}

/** Human-readable label of the active config root, for error messages. */
export function describeConfigDir(resolved: ResolvedConfigDir = resolveConfigDir()): string {
  switch (resolved.source) {
    case "env":
      return `DOT_HOME ${resolved.path}`;
    case "workspace":
      return `workspace ${resolved.path}`;
    case "global":
      return `global config ${resolved.path}`;
  }
}

export function getConfigDir(): string {
  return resolveConfigDir().path;
}

export function getChainsDir(): string {
  return join(getConfigDir(), "chains");
}

export function getChainDir(chainName: string): string {
  return join(getChainsDir(), chainName);
}

export function getMetadataPath(chainName: string): string {
  return join(getChainDir(chainName), "metadata.bin");
}

export function getMetadataFingerprintPath(chainName: string): string {
  return join(getChainDir(chainName), "metadata.fingerprint.json");
}

export function getRpcMethodsPath(chainName: string): string {
  return join(getChainDir(chainName), "rpc-methods.json");
}

export interface RpcMethodsCache {
  methods: string[];
  version: number;
  fetchedAt: string;
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(): Promise<Config> {
  await ensureDir(getConfigDir());
  const configPath = getConfigPath();
  if (await fileExists(configPath)) {
    const saved = JSON.parse(await readFile(configPath, "utf-8")) as Config;
    const chains: Record<string, ChainConfig> = {};
    for (const [name, defaultConfig] of Object.entries(DEFAULT_CONFIG.chains)) {
      chains[name] = saved.chains[name]
        ? { ...defaultConfig, ...saved.chains[name] }
        : defaultConfig;
    }
    for (const [name, config] of Object.entries(saved.chains)) {
      if (!(name in DEFAULT_CONFIG.chains)) {
        chains[name] = config;
      }
    }
    return { chains };
  }
  await saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureDir(getConfigDir());
  await writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Read the chain names present in the `config.json` under `dir` without the
 * side effects of `loadConfig` (no default seeding, no directory creation).
 * Returns `[]` when there is no readable config there. Used to peek at a root
 * that a new workspace is about to shadow.
 */
export async function peekConfiguredChains(dir: string): Promise<string[]> {
  const path = join(dir, "config.json");
  if (!(await fileExists(path))) return [];
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as Config;
    return parsed.chains && typeof parsed.chains === "object" ? Object.keys(parsed.chains) : [];
  } catch {
    return [];
  }
}

export async function loadMetadata(chainName: string): Promise<Uint8Array | null> {
  const path = getMetadataPath(chainName);
  if (await fileExists(path)) {
    return await readFile(path);
  }
  return null;
}

// Write-then-rename so a crash mid-write never leaves a truncated blob, and a
// concurrent reader sees either the old cache or the new one, never a mix.
async function writeFileAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export async function saveMetadata(
  chainName: string,
  data: Uint8Array,
  fingerprint?: RuntimeFingerprint,
): Promise<void> {
  const dir = getChainDir(chainName);
  await ensureDir(dir);
  await writeFileAtomic(getMetadataPath(chainName), data);
  if (fingerprint) {
    await writeFileAtomic(
      getMetadataFingerprintPath(chainName),
      `${JSON.stringify(fingerprint, null, 2)}\n`,
    );
  }
}

export async function loadMetadataFingerprint(
  chainName: string,
): Promise<RuntimeFingerprint | null> {
  const path = getMetadataFingerprintPath(chainName);
  if (!(await fileExists(path))) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8"));
    return isRuntimeFingerprint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadRpcMethods(chainName: string): Promise<RpcMethodsCache | null> {
  const path = getRpcMethodsPath(chainName);
  if (!(await fileExists(path))) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8"));
    if (
      parsed &&
      Array.isArray(parsed.methods) &&
      typeof parsed.version === "number" &&
      typeof parsed.fetchedAt === "string"
    ) {
      return parsed as RpcMethodsCache;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveRpcMethods(
  chainName: string,
  methods: string[],
  version: number,
): Promise<void> {
  const dir = getChainDir(chainName);
  await ensureDir(dir);
  const cache: RpcMethodsCache = {
    methods,
    version,
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(getRpcMethodsPath(chainName), `${JSON.stringify(cache, null, 2)}\n`);
}

export async function removeChainData(chainName: string): Promise<void> {
  const dir = getChainDir(chainName);
  await rm(dir, { recursive: true, force: true });
}

export function findChainName(config: Config, input: string): string | undefined {
  if (config.chains[input]) return input;
  return Object.keys(config.chains).find((k) => k.toLowerCase() === input.toLowerCase());
}

export function resolveChain(
  config: Config,
  chainFlag: string | undefined,
): { name: string; chain: ChainConfig } {
  const available = Object.keys(config.chains).join(", ");
  if (!chainFlag) {
    throw new CliError(
      `No chain specified. Pass --chain <name> or use a dotpath prefix (e.g. "dot polkadot.query.System.Number"). Available chains: ${available}`,
    );
  }
  const name = findChainName(config, chainFlag);
  if (!name) {
    throw new CliError(
      `Unknown chain "${chainFlag}" in ${describeConfigDir()}. Available chains: ${available}`,
    );
  }
  return { name, chain: config.chains[name]! };
}
