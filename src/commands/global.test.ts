import { describe, expect, test } from "bun:test";
import { runCli } from "./__fixtures__/run-cli.ts";

describe("global CLI", () => {
  test("no command shows help", async () => {
    const { stdout, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("inspect");
    expect(stdout).toContain("chain");
    expect(stdout).toContain("account");
    expect(stdout).toContain("hash");
    expect(stdout).toContain("query");
    expect(stdout).toContain("const");
    expect(stdout).toContain("tx");
    expect(stdout).toContain("events");
    expect(stdout).toContain("errors");
  });

  test("--help shows help with all categories and commands", async () => {
    const { stdout, exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("inspect");
    expect(stdout).toContain("chain");
    expect(stdout).toContain("account");
    expect(stdout).toContain("hash");
    expect(stdout).toContain("query");
    expect(stdout).toContain("const");
    expect(stdout).toContain("tx");
    expect(stdout).toContain("events");
    expect(stdout).toContain("errors");
  });

  test("--help and no args show the same global help", async () => {
    const bare = await runCli([]);
    const help = await runCli(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toBe(bare.stdout);
  });

  test("--version shows semver", async () => {
    const { stdout, exitCode } = await runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  test("--chain nonexistent errors", async () => {
    const { stderr, exitCode } = await runCli(["inspect", "--chain", "nonexistent"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown chain");
  });

  test("hash with --output json produces valid JSON", async () => {
    const { stdout, exitCode } = await runCli(["hash", "sha256", "hello", "--output", "json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("algorithm");
    expect(parsed).toHaveProperty("hash");
  });

  test("unknown dot-path shows error: dot foobar", async () => {
    const { stderr, exitCode } = await runCli(["foobar"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });

  test("explore alias works as command", async () => {
    const { stdout, exitCode } = await runCli(["explore"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System");
    expect(stdout).toContain("Balances");
    expect(stdout).toContain("Pallets on polkadot");
  });

  test("explore alias appears in help output", async () => {
    const { stdout, exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("explore");
  });

  test("dot-path with --help shows item help not global help", async () => {
    const { stdout, exitCode } = await runCli(["tx.System.remark", "--help"]);
    expect(exitCode).toBe(0);
    // Should show item-level help, not global help
    expect(stdout).toContain("(Call)");
    expect(stdout).not.toContain("Categories:");
  });

  test("unknown dot-path with chain prefix errors", async () => {
    const { stderr, exitCode } = await runCli(["polkadot.foobar"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });

  test("--json flag produces valid JSON for inspect", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chain).toBe("polkadot");
    expect(Array.isArray(parsed.pallets)).toBe(true);
    expect(parsed.pallets.length).toBeGreaterThan(0);
    expect(parsed.pallets[0]).toHaveProperty("name");
  });

  test("--json flag is equivalent to --output json", async () => {
    const jsonFlag = await runCli(["inspect", "--json"]);
    const outputJson = await runCli(["inspect", "--output", "json"]);
    expect(jsonFlag.exitCode).toBe(0);
    expect(outputJson.exitCode).toBe(0);
    expect(jsonFlag.stdout).toBe(outputJson.stdout);
  });

  test("--json flag shows in help", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("--json");
  });

  // Regression for #238: `--help` must reach the matched command for ALL nested
  // command levels, printing usage and exiting 0 — never running the action and
  // failing on a missing positional argument.
  describe("nested command --help (issue #238)", () => {
    const cases: { args: string[]; expect: string }[] = [
      { args: ["account", "add", "--help"], expect: "dot account add" },
      { args: ["account", "inspect", "--help"], expect: "dot account inspect" },
      { args: ["chain", "add", "--help"], expect: "dot chain add" },
      { args: ["chain", "remove", "--help"], expect: "dot chain remove" },
      { args: ["hash", "blake2b256", "--help"], expect: "dot hash" },
      { args: ["sign", "hello", "--help"], expect: "dot sign" },
      { args: ["verifiable", "prove", "--help"], expect: "dot verifiable" },
    ];
    for (const { args, expect: needle } of cases) {
      test(`${args.join(" ")} prints usage and exits 0`, async () => {
        const { stdout, stderr, exitCode } = await runCli(args, { noDefaultChain: true });
        expect(exitCode).toBe(0);
        expect(stdout + stderr).toContain(needle);
      });
    }

    test("metadata --help exits 0 despite required <chain> arg", async () => {
      const { exitCode } = await runCli(["metadata", "--help"], { noDefaultChain: true });
      expect(exitCode).toBe(0);
    });

    test("completions --help exits 0 despite required <shell> arg", async () => {
      const { exitCode } = await runCli(["completions", "--help"], { noDefaultChain: true });
      expect(exitCode).toBe(0);
    });
  });
});
