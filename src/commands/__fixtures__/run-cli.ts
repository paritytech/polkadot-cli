import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { StoredAccount } from "../../config/accounts-types.ts";
import type { Config } from "../../config/types.ts";
import { DEFAULT_CONFIG } from "../../config/types.ts";

const FIXTURE_METADATA = join(import.meta.dir, "polkadot-metadata.bin");
// Version byte follows the 4-byte "meta" magic in the SCALE blob.
const FIXTURE_METADATA_VERSION = readFileSync(FIXTURE_METADATA)[4]!;
const CLI_PATH = join(import.meta.dir, "../../cli.ts");

export const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

export interface RunCliOptions {
  accounts?: StoredAccount[];
  config?: Partial<Config>;
  files?: Record<string, string | Uint8Array>;
  stdin?: string | Uint8Array;
  env?: Record<string, string>;
  /** Opt out of the default `--chain polkadot` auto-injection used by test fixtures. */
  noDefaultChain?: boolean;
  /**
   * Skip seeding metadata.fingerprint.json sidecars, so the cache presents as
   * "not cached" / unknown provenance. Connected commands will then renegotiate
   * and refetch metadata from the live chain.
   */
  noMetadataFingerprint?: boolean;
}

function deepMergeConfig(base: Config, override: Partial<Config>): Config {
  const chains: Record<string, import("../../config/types.ts").ChainConfig> = {};
  for (const [name, defaultConfig] of Object.entries(base.chains)) {
    chains[name] = override.chains?.[name]
      ? { ...defaultConfig, ...override.chains[name] }
      : defaultConfig;
  }
  if (override.chains) {
    for (const [name, chainConfig] of Object.entries(override.chains)) {
      if (!(name in base.chains)) {
        chains[name] = chainConfig;
      }
    }
  }
  return { chains };
}

export async function runCli(
  args: string[],
  options?: RunCliOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tmpHome = mkdtempSync(join(tmpdir(), "dot-test-"));
  const dotDir = join(tmpHome, ".polkadot");

  const finalConfig = options?.config
    ? deepMergeConfig(DEFAULT_CONFIG, options.config)
    : DEFAULT_CONFIG;

  // Create chain dirs with metadata for all configured chains
  for (const chainName of Object.keys(finalConfig.chains)) {
    const dir = join(dotDir, "chains", chainName);
    mkdirSync(dir, { recursive: true });
    // Hardlink — metadata.bin is read-only in tests, so sharing the inode
    // avoids ~5MB of copyFileSync I/O per test invocation. saveMetadata writes
    // via rename, so even a refresh breaks the link instead of writing through
    // it into the repo fixture.
    linkSync(FIXTURE_METADATA, join(dir, "metadata.bin"));
    if (options?.noMetadataFingerprint) continue;
    // Seed a fingerprint sidecar whose chainSupportedVersions ceiling is the
    // fixture's own version. Connected commands then treat the cache as
    // already at the negotiated target and never refetch — tests stay
    // deterministic against the fixture instead of live chain metadata.
    writeFileSync(
      join(dir, "metadata.fingerprint.json"),
      JSON.stringify({
        specName: chainName,
        specVersion: 0,
        transactionVersion: 0,
        implName: "test-fixture",
        implVersion: 0,
        authoringVersion: 0,
        codeHash: "0x-test-fixture",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        metadataVersion: FIXTURE_METADATA_VERSION,
        chainSupportedVersions: [FIXTURE_METADATA_VERSION],
        clientMaxVersion: FIXTURE_METADATA_VERSION,
      }),
    );
  }

  writeFileSync(join(dotDir, "config.json"), JSON.stringify(finalConfig));

  if (options?.accounts) {
    writeFileSync(join(dotDir, "accounts.json"), JSON.stringify({ accounts: options.accounts }));
  }

  if (options?.files) {
    for (const [relativePath, content] of Object.entries(options.files)) {
      const fullPath = join(tmpHome, relativePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      if (typeof content === "string") {
        writeFileSync(fullPath, content);
      } else {
        writeFileSync(fullPath, content);
      }
    }
  }

  // Replace {{HOME}} placeholder in args
  const resolvedArgs = args.map((arg) => arg.replace(/\{\{HOME\}\}/g, tmpHome));

  // Auto-inject `--chain polkadot` for command invocations so tests that don't
  // care about chain resolution still work after the default-chain removal.
  // Skip when:
  //   - the test opts out (noDefaultChain),
  //   - args already contain --chain,
  //   - args[0] is __complete (its own --chain handling lives in precedingWords),
  //   - any arg starts with a known chain name + "." (chain-prefixed dotpath).
  const hasChainFlag = resolvedArgs.some((a) => a === "--chain" || a.startsWith("--chain="));
  const isCompletion = resolvedArgs[0] === "__complete";
  const chainPrefixRegex = new RegExp(`^(${Object.keys(finalConfig.chains).join("|")})\\.`, "i");
  const hasChainPrefix = resolvedArgs.some((a) => chainPrefixRegex.test(a));
  if (
    !options?.noDefaultChain &&
    !hasChainFlag &&
    !isCompletion &&
    !hasChainPrefix &&
    resolvedArgs.length > 0
  ) {
    resolvedArgs.push("--chain", "polkadot");
  }

  try {
    const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
      env: { ...process.env, HOME: tmpHome, DOT_HOME: dotDir, ...options?.env },
      // Pin cwd inside the fake HOME so workspace discovery (walk-up from
      // cwd) can never escape into the developer's real ~/.polkadot.
      cwd: tmpHome,
      stdout: "pipe",
      stderr: "pipe",
    };

    if (options?.stdin != null) {
      const input = options.stdin;
      spawnOpts.stdin = new Blob([typeof input === "string" ? input : new Uint8Array(input)]);
    }

    const proc = Bun.spawn(["bun", CLI_PATH, ...resolvedArgs], spawnOpts);
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
}
