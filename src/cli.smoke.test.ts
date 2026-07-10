import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tmpHome = mkdtempSync(join(tmpdir(), "dot-smoke-"));
  const dotDir = join(tmpHome, ".polkadot");
  mkdirSync(dotDir, { recursive: true });
  writeFileSync(join(dotDir, "config.json"), JSON.stringify(DEFAULT_CONFIG));
  try {
    const proc = Bun.spawn(["node", BUNDLE, ...args], {
      env: { ...process.env, HOME: tmpHome, DOT_HOME: dotDir },
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
  ];
  for (const { args, needle } of cases) {
    test(`${args.join(" ")} prints usage and exits 0`, async () => {
      const { stdout, stderr, exitCode } = await runBuilt(args);
      expect(exitCode).toBe(0);
      expect(stdout + stderr).toContain(needle);
    });
  }

  test("required-positional commands still print help, not an arg error", async () => {
    const metadata = await runBuilt(["metadata", "--help"]);
    expect(metadata.exitCode).toBe(0);
    const completions = await runBuilt(["completions", "--help"]);
    expect(completions.exitCode).toBe(0);
  });
});
