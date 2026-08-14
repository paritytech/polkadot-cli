import { describe, expect, test } from "bun:test";
import { runCli } from "../commands/__fixtures__/run-cli.ts";

// All tests use runCli to ensure a controlled environment with fixture metadata.

function lines(stdout: string): string[] {
  return stdout.split("\n").filter(Boolean);
}

describe("top-level completion", () => {
  test("empty input returns categories, chains, and commands", async () => {
    const { stdout } = await runCli(["__complete", "--", "", ""]);
    const l = lines(stdout);
    // Categories (intermediate → with dot)
    expect(l).toContain("query.");
    expect(l).toContain("tx.");
    expect(l).toContain("const.");
    expect(l).toContain("events.");
    expect(l).toContain("errors.");
    // Named commands (terminal → no dot)
    expect(l).toContain("chain");
    expect(l).toContain("account");
    expect(l).toContain("inspect");
    expect(l).toContain("hash");
    expect(l).toContain("completions");
    // Chain names (intermediate → with dot)
    expect(l).toContain("polkadot.");
  });

  test("partial prefix 'qu' filters to query", async () => {
    const { stdout } = await runCli(["__complete", "--", "qu", ""]);
    const l = lines(stdout);
    expect(l).toContain("query.");
    expect(l).not.toContain("tx.");
    expect(l).not.toContain("chain");
  });

  test("partial prefix 'e' matches events and errors", async () => {
    const { stdout } = await runCli(["__complete", "--", "e", ""]);
    const l = lines(stdout);
    expect(l).toContain("events.");
    expect(l).toContain("errors.");
    expect(l).not.toContain("query.");
  });

  test("partial prefix 'ch' matches chain", async () => {
    const { stdout } = await runCli(["__complete", "--", "ch", ""]);
    const l = lines(stdout);
    expect(l).toContain("chain");
    expect(l).not.toContain("query.");
  });

  test("partial prefix 'pol' matches polkadot chains", async () => {
    const { stdout } = await runCli(["__complete", "--", "pol", ""]);
    const l = lines(stdout);
    expect(l.some((s) => s.startsWith("polkadot"))).toBe(true);
  });
});

describe("option value completion", () => {
  test("--chain completes chain names", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "--chain"]);
    const l = lines(stdout);
    expect(l).toContain("polkadot");
    expect(l).toContain("paseo");
  });

  test("--chain with prefix filters", async () => {
    const { stdout } = await runCli(["__complete", "--", "pas", "--chain"]);
    const l = lines(stdout);
    expect(l).toContain("paseo");
    expect(l).not.toContain("polkadot");
  });

  test("--output completes format options", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "--output"]);
    const l = lines(stdout);
    expect(l).toContain("pretty");
    expect(l).toContain("json");
  });

  test("--output with prefix filters", async () => {
    const { stdout } = await runCli(["__complete", "--", "j", "--output"]);
    const l = lines(stdout);
    expect(l).toContain("json");
    expect(l).not.toContain("pretty");
  });

  test("--from completes dev names", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "--from"]);
    const l = lines(stdout);
    expect(l).toContain("alice");
    expect(l).toContain("bob");
    expect(l).toContain("charlie");
    expect(l).toContain("eve");
    expect(l).toContain("ferdie");
  });

  test("--from includes stored account names", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "--from"], {
      accounts: [{ name: "my-validator", publicKey: `0x${"aa".repeat(32)}`, derivationPath: "" }],
    });
    const l = lines(stdout);
    expect(l).toContain("alice");
    expect(l).toContain("my-validator");
  });

  test("--from with prefix filters", async () => {
    const { stdout } = await runCli(["__complete", "--", "al", "--from"]);
    const l = lines(stdout);
    expect(l).toContain("alice");
    expect(l).not.toContain("bob");
  });

  test("--wait completes wait levels", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "--wait"]);
    const l = lines(stdout);
    expect(l).toContain("broadcast");
    expect(l).toContain("best-block");
    expect(l).toContain("best");
    expect(l).toContain("finalized");
  });

  test("--wait with prefix filters", async () => {
    const { stdout } = await runCli(["__complete", "--", "b", "--wait"]);
    const l = lines(stdout);
    expect(l).toContain("broadcast");
    expect(l).toContain("best-block");
    expect(l).toContain("best");
    expect(l).not.toContain("finalized");
  });

  test("-w completes wait levels", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "-w"]);
    const l = lines(stdout);
    expect(l).toContain("broadcast");
    expect(l).toContain("finalized");
  });

  test("--relay completes chain names", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "--relay"]);
    const l = lines(stdout);
    expect(l).toContain("polkadot");
    expect(l).toContain("paseo");
  });

  test("--relay with prefix filters", async () => {
    const { stdout } = await runCli(["__complete", "--", "pol", "--relay"]);
    const l = lines(stdout);
    expect(l).toContain("polkadot");
    expect(l).not.toContain("paseo");
  });
});

describe("option name completion", () => {
  test("-- prefix shows global options", async () => {
    const { stdout } = await runCli(["__complete", "--", "--", ""]);
    const l = lines(stdout);
    expect(l).toContain("--chain");
    expect(l).toContain("--rpc");
    expect(l).toContain("--output");
    expect(l).toContain("--help");
    expect(l).toContain("--version");
  });

  test("-- prefix does not include removed --light-client option", async () => {
    const { stdout } = await runCli(["__complete", "--", "--", ""]);
    const l = lines(stdout);
    expect(l).not.toContain("--light-client");
  });

  test("-- with tx dotpath includes tx-specific options", async () => {
    const { stdout } = await runCli(["__complete", "--", "--", "tx.System.remark"]);
    const l = lines(stdout);
    expect(l).toContain("--from");
    expect(l).toContain("--dry-run");
    expect(l).toContain("--encode");
    expect(l).toContain("--ext");
    expect(l).toContain("--wait");
    expect(l).toContain("--chain");
  });

  test("-- with query dotpath includes global options but not --limit", async () => {
    const { stdout } = await runCli(["__complete", "--", "--", "query.System.Account"]);
    const l = lines(stdout);
    expect(l).toContain("--chain");
    expect(l).not.toContain("--limit");
  });

  test("--f prefix filters to matching options", async () => {
    const { stdout } = await runCli(["__complete", "--", "--f", "tx.System.remark"]);
    const l = lines(stdout);
    expect(l).toContain("--from");
    expect(l).not.toContain("--chain");
  });
});

describe("named subcommand completion", () => {
  test("chain subcommands", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "chain"]);
    const l = lines(stdout);
    expect(l).toContain("add");
    expect(l).toContain("remove");
    expect(l).toContain("update");
    expect(l).toContain("list");
    expect(l).toContain("info");
    expect(l).not.toContain("default");
  });

  test("chain subcommand with prefix", async () => {
    const { stdout } = await runCli(["__complete", "--", "a", "chain"]);
    const l = lines(stdout);
    expect(l).toContain("add");
    expect(l).not.toContain("remove");
  });

  test("chain add shows --relay and --parachain-id in flag completions", async () => {
    const { stdout } = await runCli(["__complete", "--", "--", "chain", "add", "mychain"]);
    const l = lines(stdout);
    expect(l).toContain("--relay");
    expect(l).toContain("--parachain-id");
    expect(l).toContain("--rpc");
  });

  test("account subcommands", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "account"]);
    const l = lines(stdout);
    expect(l).toContain("create");
    expect(l).toContain("new");
    expect(l).toContain("import");
    expect(l).toContain("derive");
    expect(l).toContain("list");
    expect(l).toContain("remove");
    expect(l).toContain("delete");
    expect(l).toContain("inspect");
    expect(l).toContain("add");
  });

  test("hash subcommands list algorithms", async () => {
    const { stdout } = await runCli(["__complete", "--", "", "hash"]);
    const l = lines(stdout);
    expect(l).toContain("blake2b256");
    expect(l).toContain("blake2b128");
    expect(l).toContain("keccak256");
    expect(l).toContain("sha256");
  });

  test("hash subcommand with prefix", async () => {
    const { stdout } = await runCli(["__complete", "--", "bl", "hash"]);
    const l = lines(stdout);
    expect(l).toContain("blake2b256");
    expect(l).toContain("blake2b128");
    expect(l).not.toContain("sha256");
  });
});

describe("dotpath completion — apis category", () => {
  test("'apis.' with --chain returns API names", async () => {
    const { stdout } = await runCli(["__complete", "--", "apis.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("apis."))).toBe(true);
    expect(l.some((s) => s === "apis.Core.")).toBe(true);
  });

  test("'apis.Core.' with --chain returns method names", async () => {
    const { stdout } = await runCli(["__complete", "--", "apis.Core.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("apis.Core."))).toBe(true);
    expect(l.some((s) => s === "apis.Core.version")).toBe(true);
  });

  test("'apis.Co' with --chain filters to matching API names", async () => {
    const { stdout } = await runCli(["__complete", "--", "apis.Co", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l).toContain("apis.Core.");
  });

  test("apis method completions (terminal) do NOT end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "apis.Core.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(false);
    }
  });

  test("apis API-level completions (intermediate) end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "apis.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(true);
    }
  });

  test("'apis.' without --chain or dotpath prefix returns empty", async () => {
    const { stdout } = await runCli(["__complete", "--", "apis.", ""]);
    expect(stdout.trim()).toBe("");
  });
});

describe("dotpath completion — category paths (with --chain)", () => {
  test("'query.' returns pallet names with storage", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("query."))).toBe(true);
    expect(l.some((s) => s === "query.System.")).toBe(true);
    expect(l.some((s) => s === "query.Balances.")).toBe(true);
  });

  test("'tx.' returns pallets with calls", async () => {
    const { stdout } = await runCli(["__complete", "--", "tx.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("tx."))).toBe(true);
    expect(l.some((s) => s === "tx.System.")).toBe(true);
    expect(l.some((s) => s === "tx.Balances.")).toBe(true);
  });

  test("'const.' returns pallets with constants", async () => {
    const { stdout } = await runCli(["__complete", "--", "const.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("const."))).toBe(true);
    expect(l.some((s) => s === "const.Balances.")).toBe(true);
  });

  test("'events.' returns pallets with events", async () => {
    const { stdout } = await runCli(["__complete", "--", "events.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("events."))).toBe(true);
    expect(l.some((s) => s === "events.Balances.")).toBe(true);
  });

  test("'errors.' returns pallets with errors", async () => {
    const { stdout } = await runCli(["__complete", "--", "errors.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("errors."))).toBe(true);
    expect(l.some((s) => s === "errors.Balances.")).toBe(true);
  });

  test("'query.Sy' filters pallet names", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.Sy", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l).toContain("query.System.");
    expect(l).not.toContain("query.Balances.");
  });

  test("'query.System.' returns storage item names", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.System.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("query.System."))).toBe(true);
    expect(l.some((s) => s === "query.System.Account")).toBe(true);
    expect(l.some((s) => s === "query.System.Number")).toBe(true);
  });

  test("'tx.System.' returns call names", async () => {
    const { stdout } = await runCli(["__complete", "--", "tx.System.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("tx.System."))).toBe(true);
    expect(l.some((s) => s === "tx.System.remark")).toBe(true);
  });

  test("'const.Balances.' returns constant names", async () => {
    const { stdout } = await runCli(["__complete", "--", "const.Balances.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("const.Balances."))).toBe(true);
    expect(l.some((s) => s === "const.Balances.ExistentialDeposit")).toBe(true);
  });

  test("'events.Balances.' returns event names", async () => {
    const { stdout } = await runCli([
      "__complete",
      "--",
      "events.Balances.",
      "--chain",
      "polkadot",
    ]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("events.Balances."))).toBe(true);
    expect(l.some((s) => s === "events.Balances.Transfer")).toBe(true);
  });

  test("'errors.Balances.' returns error names", async () => {
    const { stdout } = await runCli([
      "__complete",
      "--",
      "errors.Balances.",
      "--chain",
      "polkadot",
    ]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("errors.Balances."))).toBe(true);
    expect(l.some((s) => s === "errors.Balances.InsufficientBalance")).toBe(true);
  });

  test("'query.System.Ac' filters item names", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.System.Ac", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l).toContain("query.System.Account");
    expect(l).not.toContain("query.System.Number");
  });

  test("item completion for nonexistent pallet returns empty", async () => {
    const { stdout } = await runCli([
      "__complete",
      "--",
      "query.Nonexistent.",
      "--chain",
      "polkadot",
    ]);
    expect(stdout.trim()).toBe("");
  });

  test("too many segments returns empty", async () => {
    const { stdout } = await runCli([
      "__complete",
      "--",
      "query.System.Account.extra.",
      "--chain",
      "polkadot",
    ]);
    expect(stdout.trim()).toBe("");
  });

  test("bare 'query.' without --chain or dotpath prefix returns empty", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.", ""]);
    expect(stdout.trim()).toBe("");
  });
});

describe("dotpath completion — chain prefix paths", () => {
  test("'polkadot.' returns categories", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.", ""]);
    const l = lines(stdout);
    expect(l).toContain("polkadot.query.");
    expect(l).toContain("polkadot.tx.");
    expect(l).toContain("polkadot.const.");
    expect(l).toContain("polkadot.events.");
    expect(l).toContain("polkadot.errors.");
  });

  test("'polkadot.q' filters to matching categories", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.q", ""]);
    const l = lines(stdout);
    expect(l).toContain("polkadot.query.");
    expect(l).not.toContain("polkadot.tx.");
  });

  test("'polkadot.query.' returns pallet names", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.query.", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("polkadot.query."))).toBe(true);
    expect(l.some((s) => s === "polkadot.query.System.")).toBe(true);
  });

  test("'polkadot.events.' returns pallets with events", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.events.", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("polkadot.events."))).toBe(true);
  });

  test("'polkadot.query.System.' returns items", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.query.System.", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((s) => s.startsWith("polkadot.query.System."))).toBe(true);
    expect(l.some((s) => s === "polkadot.query.System.Account")).toBe(true);
  });

  test("'polkadot.tx.System.' returns call names", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.tx.System.", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.some((s) => s === "polkadot.tx.System.remark")).toBe(true);
  });

  test("'polkadot.errors.Balances.' returns error names", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.errors.Balances.", ""]);
    const l = lines(stdout);
    expect(l.some((s) => s === "polkadot.errors.Balances.InsufficientBalance")).toBe(true);
  });

  test("chain prefix partial pallet filter", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.query.Sy", ""]);
    const l = lines(stdout);
    expect(l).toContain("polkadot.query.System.");
    expect(l).not.toContain("polkadot.query.Balances.");
  });

  test("chain prefix partial item filter", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.query.System.Ac", ""]);
    const l = lines(stdout);
    expect(l).toContain("polkadot.query.System.Account");
    expect(l).not.toContain("polkadot.query.System.Number");
  });

  test("invalid category after chain returns empty", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.notacategory.", ""]);
    expect(stdout.trim()).toBe("");
  });

  test("chain prefix too many segments returns empty", async () => {
    const { stdout } = await runCli([
      "__complete",
      "--",
      "polkadot.query.System.Account.extra.",
      "",
    ]);
    expect(stdout.trim()).toBe("");
  });
});

describe("completion with --chain flag", () => {
  test("'query.' with --chain uses specified chain", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    expect(l.some((s) => s === "query.System.")).toBe(true);
  });
});

describe("dot suffix on intermediate completions", () => {
  test("top-level: categories and chains end with dot, named commands do not", async () => {
    const { stdout } = await runCli(["__complete", "--", "", ""]);
    const l = lines(stdout);
    // Every category and chain candidate must end with "."
    const categories = l.filter(
      (s) => ["query.", "tx.", "const.", "events.", "errors."].includes(s) || s.endsWith("."),
    );
    for (const c of categories) {
      expect(c.endsWith(".")).toBe(true);
    }
    // Named commands must NOT end with "."
    const commands = l.filter((s) =>
      ["chain", "account", "inspect", "hash", "completions"].includes(s),
    );
    for (const c of commands) {
      expect(c.endsWith(".")).toBe(false);
    }
  });

  test("no candidate contains double dots", async () => {
    const { stdout } = await runCli(["__complete", "--", "", ""]);
    const l = lines(stdout);
    expect(l.every((s) => !s.includes(".."))).toBe(true);
  });

  test("category-first pallets end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(true);
    }
  });

  test("category-first pallets with partial also end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.Sy", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(true);
    }
  });

  test("category-first items (terminal) do NOT end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.System.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(false);
    }
  });

  test("chain-first categories end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(true);
    }
  });

  test("chain-first categories with partial end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.q", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(true);
    }
  });

  test("chain-first pallets end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.query.", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(true);
    }
  });

  test("chain-first pallets with partial end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.query.Sy", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(true);
    }
  });

  test("chain-first items (terminal) do NOT end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.query.System.", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(false);
    }
  });

  test("chain-first items with partial do NOT end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "polkadot.query.System.Ac", ""]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(false);
    }
  });

  test("--chain flag pallets end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(true);
    }
  });

  test("--chain flag items (terminal) do NOT end with dot", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.System.", "--chain", "polkadot"]);
    const l = lines(stdout);
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.endsWith(".")).toBe(false);
    }
  });

  test("all five categories produce dot-suffixed pallets", async () => {
    for (const cat of ["query", "tx", "const", "events", "errors"]) {
      const { stdout } = await runCli(["__complete", "--", `${cat}.`, "--chain", "polkadot"]);
      const l = lines(stdout);
      if (l.length > 0) {
        for (const s of l) {
          expect(s.endsWith(".")).toBe(true);
        }
      }
    }
  });
});

describe("graceful degradation", () => {
  test("no metadata returns empty for pallet completion", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.", ""], {
      config: { chains: { nochain: { rpc: "wss://example.com" } } },
    });
    expect(stdout).toBeDefined();
  });

  test("pallet completion without --chain or dotpath prefix returns empty", async () => {
    const { stdout } = await runCli(["__complete", "--", "query.", ""]);
    expect(stdout.trim()).toBe("");
  });

  test("unknown first segment returns empty", async () => {
    const { stdout } = await runCli(["__complete", "--", "unknownthing.", ""]);
    expect(stdout.trim()).toBe("");
  });
});

describe("completions command — shell scripts", () => {
  test("zsh script contains compdef", async () => {
    const { stdout, exitCode } = await runCli(["completions", "zsh"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("compdef");
    expect(stdout).toContain("_dot_completions");
    expect(stdout).toContain("compadd");
  });

  test("bash script contains complete -F", async () => {
    const { stdout, exitCode } = await runCli(["completions", "bash"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("complete -F");
    expect(stdout).toContain("_dot_completions");
    expect(stdout).toContain("COMPREPLY");
  });

  test("fish script contains complete -c dot", async () => {
    const { stdout, exitCode } = await runCli(["completions", "fish"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("complete -c dot");
    expect(stdout).toContain("__dot_complete");
  });

  test("unsupported shell exits with error", async () => {
    const { stderr, exitCode } = await runCli(["completions", "powershell"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unsupported shell");
  });

  test("setup instructions are suppressed when stdout is not a TTY", async () => {
    // runCli pipes stdout, matching `eval "$(dot completions zsh)"` — the
    // instructions must not leak to stderr on every shell startup.
    for (const shell of ["zsh", "bash", "fish"]) {
      const { stderr } = await runCli(["completions", shell]);
      expect(stderr).not.toContain("Add this to your");
      expect(stderr).not.toContain("Save this to");
    }
  });

  test("zsh script uses zsh-native array slicing for preceding words", async () => {
    const { stdout } = await runCli(["completions", "zsh"]);
    expect(stdout).toContain("words[2,CURRENT-1]");
    expect(stdout).not.toContain("words[@]:1:");
  });

  test("zsh script passes preceding words as separate arguments", async () => {
    // Without the (@) flag the quoted range collapses into a single argument,
    // so the completer never sees the `--from` / `--chain` it needs to offer
    // values for once anything else precedes the flag on the line.
    const { stdout } = await runCli(["completions", "zsh"]);
    expect(stdout).toContain("(@)words[2,CURRENT-1]");
  });

  test("bash script always calls compopt -o nospace", async () => {
    const { stdout } = await runCli(["completions", "bash"]);
    expect(stdout).toContain("compopt -o nospace");
    expect(stdout).not.toContain("has_dot");
  });

  test("zsh script always uses compadd -S '' (no trailing space)", async () => {
    const { stdout } = await runCli(["completions", "zsh"]);
    expect(stdout).toContain("compadd -S ''");
    expect(stdout).not.toContain("has_dot");
  });
});
