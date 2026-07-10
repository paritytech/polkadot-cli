import { describe, expect, test } from "bun:test";
import { runCli } from "./__fixtures__/run-cli.ts";

describe("dot inspect", () => {
  test("explore alias lists all pallets", async () => {
    const { stdout, exitCode } = await runCli(["explore"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System");
    expect(stdout).toContain("Balances");
    expect(stdout).toContain("Pallets on polkadot");
  });

  test("explore alias with target works", async () => {
    const { stdout, exitCode } = await runCli(["explore", "System"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Pallet");
    expect(stdout).toContain("Storage Items:");
  });

  test("no target lists all pallets", async () => {
    const { stdout, exitCode } = await runCli(["inspect"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System");
    expect(stdout).toContain("Balances");
    expect(stdout).toContain("Pallets on polkadot");
  });

  test("inspect System lists pallet items with types", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Storage Items:");
    expect(stdout).toContain("Account");
    expect(stdout).toContain("[map]");
    expect(stdout).toContain("Constants:");
    expect(stdout).toContain("SS58Prefix");
    // Constants should show type info
    expect(stdout).toContain("SS58Prefix");
    expect(stdout).toContain("u16");
  });

  test("inspect system (lowercase) works", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "system"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Pallet");
    expect(stdout).toContain("Storage Items:");
  });

  test("inspect Balances lists items with types", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    // Constants show type
    expect(stdout).toContain("ExistentialDeposit");
    expect(stdout).toContain("u128");
  });

  test("inspect System.Account shows storage detail", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System.Account"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Storage)");
    expect(stdout).toContain("Type:");
    expect(stdout).toContain("map");
    expect(stdout).toContain("Value:");
    expect(stdout).toContain("Key:");
  });

  test("inspect System.SS58Prefix shows constant detail", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System.SS58Prefix"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Constant)");
    expect(stdout).toContain("Type:");
  });

  test("inspect Balances.ExistentialDeposit shows constant detail", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances.ExistentialDeposit"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Constant)");
  });

  test("inspect Systm (typo) suggests System", async () => {
    const { stderr, exitCode } = await runCli(["inspect", "Systm"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("System");
    expect(stderr).toContain("Did you mean");
  });

  test("inspect System.Accont (typo) suggests Account", async () => {
    const { stderr, exitCode } = await runCli(["inspect", "System.Accont"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Account");
  });

  test("inspect System.FooBarBaz errors", async () => {
    const { exitCode } = await runCli(["inspect", "System.FooBarBaz"]);
    expect(exitCode).toBe(1);
  });

  test("chain prefix lists pallet items", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stdout, exitCode } = await runCli(["inspect", "kusama.System"], { config });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Pallet");
    expect(stdout).toContain("Storage Items:");
  });

  test("chain prefix with item shows detail", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stdout, exitCode } = await runCli(["inspect", "kusama.System.Account"], { config });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Storage)");
  });

  test("chain prefix + --chain flag errors", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stderr, exitCode } = await runCli(["inspect", "kusama.System", "--chain", "polkadot"], {
      config,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Chain specified both as prefix");
  });

  test("case-insensitive chain prefix resolves correctly", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Polkadot.System"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Pallet");
  });

  test("case-insensitive --chain flag resolves correctly", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System", "--chain", "POLKADOT"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Pallet");
  });

  test("no-target view shows calls count", async () => {
    const { stdout, exitCode } = await runCli(["inspect"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("calls");
  });

  test("pallet overview shows Calls section", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Calls:");
  });

  test("call listing shows call names with args", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("transfer_allow_death");
    // Calls should show argument signatures (names may be padded for alignment
    // when expanded across multiple lines).
    expect(stdout).toMatch(/dest\s*:/);
    expect(stdout).toMatch(/value\s*:/);
  });

  test("call detail view", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances.transfer_allow_death"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Call)");
    expect(stdout).toContain("Args:");
  });

  test("void call detail", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System.remark"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Call)");
    expect(stdout).toContain("Args:");
  });

  test("call typo suggests correct name", async () => {
    const { stderr, exitCode } = await runCli(["inspect", "Balances.transfer_alow_death"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("transfer_allow_death");
  });

  test("storage listing shows map tag for map items", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System"]);
    expect(exitCode).toBe(0);
    // Account is a map storage item — should show [map] tag and a Key line
    expect(stdout).toContain("Account");
    expect(stdout).toContain("[map]");
    expect(stdout).toMatch(/Key:\s+AccountId32/);
  });

  test("storage listing shows plain type without map tag", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System"]);
    expect(exitCode).toBe(0);
    // Number is a plain storage item — should show type but not [map]
    expect(stdout).toContain("Number");
    expect(stdout).toContain("u32");
    // Number line specifically should not have [map] — check via lines
    const lines = stdout.split("\n");
    const numberLine = lines.find((l: string) => l.includes("Number") && !l.includes("Block"));
    expect(numberLine).toBeDefined();
    expect(numberLine).not.toContain("[map]");
  });

  test("constants listing shows type info", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System"]);
    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    const ss58Line = lines.find((l: string) => l.includes("SS58Prefix"));
    expect(ss58Line).toContain("u16");
  });

  test("calls listing shows argument signatures", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System"]);
    expect(exitCode).toBe(0);
    // System.remark takes a remark: Vec<u8> argument
    expect(stdout).toContain("remark");
    expect(stdout).toContain("Vec<u8>");
  });

  test("call detail shows documentation", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances.transfer_allow_death"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Call)");
    // Should contain actual doc text from metadata, not be empty
    expect(stdout).toContain("Transfer some liquid free balance");
  });

  test("call listing shows doc on indented line below the signature", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    // The doc line should be indented at 8 spaces and follow the signature
    // (which may span multiple lines when it doesn't fit). Just find the
    // doc line directly by its content.
    const docLine = lines.find((l: string) => l.includes("Transfer some liquid free balance"));
    expect(docLine).toBeDefined();
    expect(docLine!).toMatch(/^\s{8}/);
  });

  test("docs appear on indented second line", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    // Find ExistentialDeposit line (has type), next line should be indented doc
    const edIdx = lines.findIndex(
      (l: string) => l.includes("ExistentialDeposit") && l.includes("u128"),
    );
    expect(edIdx).toBeGreaterThan(-1);
    const docLine = lines[edIdx + 1];
    expect(docLine).toMatch(/^\s{8}/); // 8-space indent for doc line
    expect(docLine).toContain("minimum amount");
  });

  // --- Events & Errors ---

  test("overview shows events and errors counts", async () => {
    const { stdout, exitCode } = await runCli(["inspect"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("events");
    expect(stdout).toContain("errors");
  });

  test("pallet listing shows Events section", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Events:");
  });

  test("pallet listing shows Errors section", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Errors:");
  });

  test("event listing shows names with field signatures", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Transfer");
    // Transfer event should show field signature
    expect(stdout).toContain("from:");
    expect(stdout).toContain("to:");
    expect(stdout).toContain("amount:");
  });

  test("error listing shows names with docs", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("InsufficientBalance");
  });

  test("event detail view", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances.Transfer"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Event)");
    expect(stdout).toContain("Fields:");
    expect(stdout).toContain("from:");
    expect(stdout).toContain("to:");
    expect(stdout).toContain("amount:");
  });

  test("error detail view", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances.InsufficientBalance"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Error)");
  });

  test("event doc indentation", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    const transferIdx = lines.findIndex(
      (l: string) => l.includes("Transfer") && l.includes("from:"),
    );
    expect(transferIdx).toBeGreaterThan(-1);
    const docLine = lines[transferIdx + 1];
    expect(docLine).toMatch(/^\s{8}/); // 8-space indent for doc line
  });

  test("error doc indentation", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    const errIdx = lines.findIndex((l: string) => l.includes("InsufficientBalance"));
    expect(errIdx).toBeGreaterThan(-1);
    const docLine = lines[errIdx + 1];
    expect(docLine).toMatch(/^\s{8}/); // 8-space indent for doc line
  });

  test("event typo suggests correct name", async () => {
    const { stderr, exitCode } = await runCli(["inspect", "Balances.Transferr"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Transfer");
  });

  test("error typo suggests correct name", async () => {
    const { stderr, exitCode } = await runCli(["inspect", "Balances.InsufficientBalanc"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("InsufficientBalance");
  });

  // --- No truncation ---

  test("doc strings show first complete sentence", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    // firstSentence extracts only the first sentence — "MUST BE GREATER THAN ZERO!" is sentence #2
    expect(stdout).toContain("The minimum amount required to keep an account open.");
    // force_transfer listing should show full first sentence joined from multiple doc lines
    expect(stdout).toContain(
      "Exactly as `transfer_allow_death`, except the origin must be root and the source account may be specified.",
    );
  });

  test("event docs handle e.g. abbreviation without truncation", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    // Deposit/Withdraw/Slashed events contain "e.g." — should not be cut at the abbreviation
    expect(stdout).toContain("Some amount was deposited (e.g. for transaction fees).");
  });

  test("error docs show complete first sentence in listing", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balance too low to send value.");
  });

  test("type strings are not truncated at 60 chars", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System"]);
    expect(exitCode).toBe(0);
    // Account value type is well over 60 chars — every field (incl. data, free,
    // reserved) must still appear, and no truncation marker.
    expect(stdout).toContain("sufficients");
    expect(stdout).toContain("data");
    expect(stdout).toContain("free");
    expect(stdout).toContain("reserved");
    expect(stdout).not.toMatch(/\.\.\./);
  });

  test("stdout has no progress messages (pipe-safe)", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Fetching metadata");
    expect(stdout).not.toContain("Connecting");
  });

  test("pallet list stdout has no progress messages", async () => {
    const { stdout, exitCode } = await runCli(["inspect"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Fetching metadata");
    expect(stdout).not.toContain("Connecting");
  });

  test("explore alias with chain prefix works: explore polkadot.System", async () => {
    const { stdout, exitCode } = await runCli(["explore", "polkadot.System"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Pallet");
    expect(stdout).toContain("Storage Items:");
  });

  test("explore alias with item detail: explore System.Account", async () => {
    const { stdout, exitCode } = await runCli(["explore", "System.Account"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Storage)");
    expect(stdout).toContain("Type:");
    expect(stdout).toContain("map");
    expect(stdout).toContain("Key:");
    expect(stdout).toContain("Value:");
  });

  test("explore alias with chain prefix and item detail", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stdout, exitCode } = await runCli(["explore", "kusama.System.Account"], { config });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Storage)");
  });

  // --- Forgiving dot-paths with a kind segment (#255) ---

  test("inspect polkadot.tx.System.remark inspects the call (kind stripped)", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "polkadot.tx.System.remark"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System.remark");
    expect(stdout).toContain("(Call)");
    expect(stdout).toContain("Args:");
  });

  test("inspect tx.System.remark inspects the call (no chain prefix)", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "tx.System.remark"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System.remark");
    expect(stdout).toContain("(Call)");
  });

  test("inspect polkadot.query.System degrades to listing the pallet", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "polkadot.query.System"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Pallet");
    expect(stdout).toContain("Storage Items:");
  });

  test("inspect const.System degrades to listing the pallet (no chain prefix)", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "const.System"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Pallet");
  });

  test("inspect polkadot.events.Balances.Transfer inspects the event", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "polkadot.events.Balances.Transfer"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Event)");
    expect(stdout).toContain("Fields:");
  });

  // --json output tests
  test("--json lists all pallets as JSON", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chain).toBe("polkadot");
    expect(Array.isArray(parsed.pallets)).toBe(true);
    const system = parsed.pallets.find((p: any) => p.name === "System");
    expect(system).toBeDefined();
    expect(system.storage).toBeGreaterThan(0);
    expect(system.constants).toBeGreaterThan(0);
    expect(system.calls).toBeGreaterThan(0);
    expect(system.events).toBeGreaterThan(0);
    expect(system.errors).toBeGreaterThan(0);
  });

  test("--json for pallet detail returns structured data", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chain).toBe("polkadot");
    expect(parsed.pallet).toBe("System");
    expect(Array.isArray(parsed.storage)).toBe(true);
    expect(Array.isArray(parsed.constants)).toBe(true);
    expect(Array.isArray(parsed.calls)).toBe(true);
    expect(Array.isArray(parsed.events)).toBe(true);
    expect(Array.isArray(parsed.errors)).toBe(true);
    // Check structure of a storage item
    const account = parsed.storage.find((s: any) => s.name === "Account");
    expect(account).toBeDefined();
    expect(account.type).toBeDefined();
    expect(account.valueType).toBeDefined();
  });

  test("--json for item detail returns structured data", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System.Account", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chain).toBe("polkadot");
    expect(parsed.pallet).toBe("System");
    expect(parsed.item).toBe("Account");
    expect(parsed.category).toBe("storage");
    expect(parsed.valueType).toBeDefined();
    expect(parsed.keyType).toBeDefined();
    expect(Array.isArray(parsed.docs)).toBe(true);
  });

  test("--json for constant item detail", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "System.SS58Prefix", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.pallet).toBe("System");
    expect(parsed.item).toBe("SS58Prefix");
    expect(parsed.category).toBe("constant");
  });

  test("--json for event item detail", async () => {
    const { stdout, exitCode } = await runCli(["inspect", "Balances.Transfer", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.pallet).toBe("Balances");
    expect(parsed.item).toBe("Transfer");
    expect(parsed.category).toBe("event");
    expect(parsed.fields).toBeDefined();
  });

  test("--json for error item detail", async () => {
    const { stdout, exitCode } = await runCli([
      "inspect",
      "Balances.InsufficientBalance",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.pallet).toBe("Balances");
    expect(parsed.category).toBe("error");
  });

  // ---------------------------------------------------------------------------
  // Pretty-print integration: width-aware multi-line layout
  // ---------------------------------------------------------------------------
  describe("pretty-printed output", () => {
    test("storage detail with composite Value expands struct fields", async () => {
      const { stdout, exitCode } = await runCli(["inspect", "System.Account"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("(Storage)");
      // Expanded struct fields appear on separate indented lines, aligned by colon
      const lines = stdout.split("\n");
      const fieldLines = lines.filter((l) => /^\s+\w+\s*:\s/.test(l) && !l.includes("Type:"));
      const colonCols = fieldLines.map((l) => l.indexOf(":"));
      // All child-field colons (skipping the "Key:" / "Value:" labels) must
      // align in the same column when the struct expands.
      const childCols = colonCols.filter((c) => c > 8);
      if (childCols.length > 1) {
        expect(new Set(childCols).size).toBe(1);
      }
    });

    test("pallet listing shows long call signature on multiple lines", async () => {
      const { stdout, exitCode } = await runCli(["inspect", "Referenda"]);
      expect(exitCode).toBe(0);
      // submit() args don't fit on 80 chars — should expand
      expect(stdout).toMatch(/submit\(\s*\n/);
      expect(stdout).toMatch(/proposal_origin\s*:\s+/);
      expect(stdout).toMatch(/enactment_moment\s*:\s+/);
    });

    test("storage Map item shows separate Key/Value lines, no arrow", async () => {
      const { stdout, exitCode } = await runCli(["inspect", "System.Account"]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/Key:\s+AccountId32/);
      expect(stdout).toMatch(/Value:\s/);
      expect(stdout).not.toContain("→");
    });

    test("call detail shows all arg names and aligned colons", async () => {
      const { stdout, exitCode } = await runCli(["inspect", "Balances.transfer_allow_death"]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/dest\s*:/);
      expect(stdout).toMatch(/value\s*:/);
    });

    test("plain JSON output unchanged — single-line type strings", async () => {
      const { stdout, exitCode } = await runCli(["inspect", "System.Account", "--json"]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      // JSON `valueType` must remain a single-line string (no embedded newlines)
      expect(parsed.valueType).toBeDefined();
      expect(parsed.valueType.split("\n").length).toBe(1);
      expect(parsed.valueType).toContain("nonce");
    });

    test("pretty output contains no ANSI escapes when stdout is piped", async () => {
      const { stdout } = await runCli(["inspect", "Referenda"]);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI strip
      expect(stdout).not.toMatch(/\x1b\[[0-9;]*m/);
    });
  });
});
