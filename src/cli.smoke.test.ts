import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./config/types.ts";

// Post-build smoke test (issue #238 follow-up). The `runCli` fixture spawns the
// unbundled TypeScript source via `bun`, so it cannot catch bugs introduced by
// `bun build` — most notably module duplication, which split the per-command
// `--help` registry across two copies and silently dropped help in the shipped
// `dist/cli.mjs` while every source-level test stayed green. These tests build
// the bundle the same way `bun run build` does and execute it with `node`, the
// way the published binary actually runs.

const REPO_ROOT = join(import.meta.dir, "..");
// Built into the repo tree so `--packages external` deps resolve against the
// repo's node_modules; a unique name avoids collisions if test files run in
// parallel.
const BUNDLE = join(REPO_ROOT, `.smoke-cli.${process.pid}.mjs`);

async function build(): Promise<void> {
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      join(import.meta.dir, "cli.ts"),
      "--outfile",
      BUNDLE,
      "--target",
      "node",
      "--packages",
      "external",
    ],
    { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  const stderr = await new Response(proc.stderr as ReadableStream).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`build failed:\n${stderr}`);
}

async function runBuilt(
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tmpHome = mkdtempSync(join(tmpdir(), "dot-smoke-"));
  const dotDir = join(tmpHome, ".polkadot");
  mkdirSync(dotDir, { recursive: true });
  writeFileSync(join(dotDir, "config.json"), JSON.stringify(DEFAULT_CONFIG));
  try {
    const proc = Bun.spawn(["node", BUNDLE, ...args], {
      env: { ...process.env, HOME: tmpHome, DOT_HOME: dotDir, ...extraEnv },
      cwd: tmpHome,
      stdout: "pipe",
      stderr: "pipe",
    });
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

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("built bundle: nested --help (issue #238)", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await build();
  });
  afterAll(() => {
    rmSync(BUNDLE, { force: true });
  });

  // One case per import shape that feeds the help registry:
  //   - account / chain / hash: import withHelp directly from platform/cli.ts
  //   - verifiable: imports withHelp via the platform/index.ts re-export barrel
  //     (the barrel import is what triggered the bundler to duplicate the module
  //     and split the registry — keep it covered).
  const cases: { args: string[]; needle: string }[] = [
    { args: ["account", "add", "--help"], needle: "dot account add" },
    { args: ["account", "inspect", "--help"], needle: "dot account inspect" },
    { args: ["chain", "add", "--help"], needle: "dot chain add" },
    { args: ["hash", "blake2b256", "--help"], needle: "dot hash" },
    { args: ["verifiable", "prove", "--help"], needle: "dot verifiable" },
    { args: ["parachain", "1000", "--help"], needle: "dot parachain" },
    { args: ["skill", "--help"], needle: "dot skill" },
  ];
  for (const { args, needle } of cases) {
    test(`${args.join(" ")} prints usage and exits 0`, async () => {
      const { stdout, stderr, exitCode } = await runBuilt(args);
      expect(exitCode).toBe(0);
      expect(stdout + stderr).toContain(needle);
    });
  }

  test("skill show prints the embedded guide from the bundle", async () => {
    // The skill markdown is embedded at build time; source-level tests run
    // under bun (native text imports) and can't prove the string survived
    // `bun build --target node`. Assert the frontmatter is present in dist.
    const { stdout, exitCode } = await runBuilt(["skill", "show"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("name: dot-cli");
  });

  test("required-positional commands still print help, not an arg error", async () => {
    const metadata = await runBuilt(["metadata", "--help"]);
    expect(metadata.exitCode).toBe(0);
    const completions = await runBuilt(["completions", "--help"]);
    expect(completions.exitCode).toBe(0);
  });
});

// The external-plugin fallback runs for every unknown first token — including
// typos — and once used `Bun.which`/`Bun.spawnSync`. Source-level tests spawn
// the CLI with `bun`, where that works, so `dot accouts` printing
// "Bun is not defined" under node went unnoticed. These tests pin the two
// code paths on the real runtime. (biome's `noRestrictedGlobals` bans the
// `Bun` global in shipped source as the first line of defence.)
// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("built bundle: unknown command and plugin dispatch (node)", { timeout: 60_000 }, () => {
  let pluginDir: string;

  beforeAll(async () => {
    await build();
    pluginDir = mkdtempSync(join(tmpdir(), "dot-smoke-plugin-"));
    const bin = join(pluginDir, "dot-smokeplugin");
    writeFileSync(bin, '#!/bin/sh\necho "plugin-ran args=[$@]"\necho "DOT_BIN=$DOT_BIN"\nexit 7\n');
    chmodSync(bin, 0o755);
  });
  afterAll(() => {
    rmSync(BUNDLE, { force: true });
    rmSync(pluginDir, { recursive: true, force: true });
  });

  const pathEnv = () => ({ PATH: `${pluginDir}:${process.env.PATH}` });

  test("a typo'd command prints the unknown-command error, not a runtime crash", async () => {
    const { stdout, stderr, exitCode } = await runBuilt(["accouts"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown command "accouts"');
    expect(stderr).toContain('No "dot-accouts" plugin found on PATH');
    expect(stdout + stderr).not.toMatch(/Bun is not defined|ReferenceError/);
  });

  test("dot <name> runs dot-<name>, forwards args, passes exit code through", async () => {
    const { stdout, exitCode } = await runBuilt(
      ["smokeplugin", "vote", "312", "--json"],
      pathEnv(),
    );
    expect(stdout).toContain("plugin-ran args=[vote 312 --json]");
    expect(stdout).toMatch(/DOT_BIN=\S+/);
    expect(exitCode).toBe(7);
  });
});
