import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../commands/__fixtures__/run-cli.ts";
import { findExternalCommand, isExternalCommandCandidate } from "./external-command.ts";

describe("isExternalCommandCandidate", () => {
  test("accepts bare words", () => {
    expect(isExternalCommandCandidate("fellowship")).toBe(true);
    expect(isExternalCommandCandidate("my-plugin")).toBe(true);
    expect(isExternalCommandCandidate("plugin_2")).toBe(true);
  });

  test("rejects dot-paths, file paths, options, and empty input", () => {
    expect(isExternalCommandCandidate("query.System")).toBe(false);
    expect(isExternalCommandCandidate("polkdot.query.System.Account")).toBe(false);
    expect(isExternalCommandCandidate("./transfer.yaml")).toBe(false);
    expect(isExternalCommandCandidate("some/path")).toBe(false);
    expect(isExternalCommandCandidate("--json")).toBe(false);
    expect(isExternalCommandCandidate("-x")).toBe(false);
    expect(isExternalCommandCandidate("")).toBe(false);
  });
});

describe("findExternalCommand", () => {
  let pluginDir: string;
  let savedPath: string | undefined;

  beforeAll(() => {
    pluginDir = mkdtempSync(join(tmpdir(), "dot-plugin-unit-"));
    const bin = join(pluginDir, "dot-unittestplugin");
    writeFileSync(bin, "#!/bin/sh\nexit 0\n");
    chmodSync(bin, 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = `${pluginDir}:${savedPath}`;
  });

  afterAll(() => {
    process.env.PATH = savedPath;
    rmSync(pluginDir, { recursive: true, force: true });
  });

  test("resolves dot-<name> on PATH", () => {
    expect(findExternalCommand("unittestplugin")).toBe(join(pluginDir, "dot-unittestplugin"));
  });

  test("returns null for missing plugins and non-candidates", () => {
    expect(findExternalCommand("no-such-plugin-xyz")).toBeNull();
    expect(findExternalCommand("query.System")).toBeNull();
  });
});

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("external subcommand dispatch (end to end)", { timeout: 30_000 }, () => {
  let pluginDir: string;

  beforeAll(() => {
    pluginDir = mkdtempSync(join(tmpdir(), "dot-plugin-e2e-"));
    const bin = join(pluginDir, "dot-testplugin");
    // Echoes its argv and DOT_BIN, then exits 7 — covers arg forwarding,
    // env contract, and exit-code passthrough in one fixture.
    writeFileSync(bin, '#!/bin/sh\necho "plugin-ran args=[$@]"\necho "DOT_BIN=$DOT_BIN"\nexit 7\n');
    chmodSync(bin, 0o755);
  });

  afterAll(() => {
    rmSync(pluginDir, { recursive: true, force: true });
  });

  const pathEnv = () => ({ PATH: `${pluginDir}:${process.env.PATH}` });

  test("dot <name> runs dot-<name>, forwards args verbatim, passes exit code through", async () => {
    const { stdout, exitCode } = await runCli(["testplugin", "vote", "312", "--json"], {
      env: pathEnv(),
      noDefaultChain: true,
    });
    expect(stdout).toContain("plugin-ran args=[vote 312 --json]");
    expect(exitCode).toBe(7);
  });

  test("sets DOT_BIN for the plugin", async () => {
    const { stdout } = await runCli(["testplugin"], { env: pathEnv(), noDefaultChain: true });
    expect(stdout).toMatch(/DOT_BIN=\S+/);
  });

  test("forwards --help to the plugin instead of handling it", async () => {
    const { stdout, exitCode } = await runCli(["testplugin", "--help"], {
      env: pathEnv(),
      noDefaultChain: true,
    });
    expect(stdout).toContain("plugin-ran args=[--help]");
    expect(exitCode).toBe(7);
  });

  test("dotted tokens are never dispatched, even with a matching plugin on PATH", async () => {
    // "testplugin.foo" is dot-path syntax, not a plugin invocation.
    const { stderr, exitCode } = await runCli(["testplugin.foo"], {
      env: pathEnv(),
      noDefaultChain: true,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });

  test("unknown command without a plugin mentions the dot-<name> convention", async () => {
    const { stderr, exitCode } = await runCli(["fellowsh1p"], {
      env: pathEnv(),
      noDefaultChain: true,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown command "fellowsh1p"');
    expect(stderr).toContain('No "dot-fellowsh1p" plugin found on PATH');
  });
});
