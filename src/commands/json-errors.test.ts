import { describe, expect, test } from "bun:test";
import { runCli } from "./__fixtures__/run-cli.ts";

// Issue #163: with --json, errors must also be valid JSON on stdout and the
// exit code must stay non-zero.

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("errors honour --json", { timeout: 15_000 }, () => {
  test("--json prints the error as JSON on stdout", async () => {
    const { stdout, stderr, exitCode } = await runCli(["query.System.Number", "--json"], {
      noDefaultChain: true,
    });
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.error).toContain("No chain specified");
    expect(stderr).not.toContain("Error:");
  });

  test("--output json behaves the same", async () => {
    const { stdout, exitCode } = await runCli(["query.System.Number", "--output", "json"], {
      noDefaultChain: true,
    });
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error).toContain("No chain specified");
  });

  test("--output=json behaves the same", async () => {
    const { stdout, exitCode } = await runCli(["query.System.Number", "--output=json"], {
      noDefaultChain: true,
    });
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error).toContain("No chain specified");
  });

  test("without --json errors stay plain text on stderr", async () => {
    const { stdout, stderr, exitCode } = await runCli(["query.System.Number"], {
      noDefaultChain: true,
    });
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Error: No chain specified");
  });
});

// Subcommand validation errors used to print to stderr and exit directly,
// bypassing the --json handler. They now throw, so they honour it too.
// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("subcommand errors honour --json", { timeout: 15_000 }, () => {
  test("account inspect with unparseable input", async () => {
    const { stdout, stderr, exitCode } = await runCli(["account", "inspect", "nosuch", "--json"]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error).toContain('Cannot identify "nosuch"');
    expect(stderr).toBe("");
  });

  test("usage errors carry the usage hint as a separate field", async () => {
    const { stdout, exitCode } = await runCli(["chain", "add", "--json"]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.error).toBe("Chain name is required.");
    expect(parsed.usage).toBe("Usage: dot chain add <name> --rpc <url>");
  });

  test("usage errors in text mode print the message and the usage on stderr", async () => {
    const { stdout, stderr, exitCode } = await runCli(["chain", "add"]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Error: Chain name is required.");
    expect(stderr).toContain("Usage: dot chain add <name> --rpc <url>");
  });

  test("unknown completions shell", async () => {
    const { stdout, exitCode } = await runCli(["completions", "tcsh", "--json"]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error).toContain('Unsupported shell "tcsh"');
  });
});

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("DOT_OUTPUT env var", { timeout: 15_000 }, () => {
  test("DOT_OUTPUT=json switches results to JSON without a flag", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "alice"], {
      env: { DOT_OUTPUT: "json" },
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).ss58).toBe("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  });

  test("DOT_OUTPUT=json switches errors to JSON without a flag", async () => {
    const { stdout, exitCode } = await runCli(["query.System.Number"], {
      noDefaultChain: true,
      env: { DOT_OUTPUT: "json" },
    });
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error).toContain("No chain specified");
  });

  test("--output pretty overrides DOT_OUTPUT=json", async () => {
    const { stdout, stderr, exitCode } = await runCli(
      ["query.System.Number", "--output", "pretty"],
      { noDefaultChain: true, env: { DOT_OUTPUT: "json" } },
    );
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Error: No chain specified");
  });
});
