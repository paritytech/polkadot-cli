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
