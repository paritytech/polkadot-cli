import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config/types.ts";
import { runCli } from "./__fixtures__/run-cli.ts";
import {
  handleCalls,
  handleErrors,
  handleEvents,
  handleExtensions,
  handleStorage,
  showItemHelp,
} from "./focused-inspect.ts";

// ---------------------------------------------------------------------------
// Ensure metadata + config exist in real $HOME for in-process tests.
// On CI runners $HOME/.polkadot/ doesn't exist; runCli subprocess tests
// create isolated temp HOMEs, but in-process calls use the real HOME.
// ---------------------------------------------------------------------------
const FIXTURE_METADATA = join(import.meta.dir, "__fixtures__/polkadot-metadata.bin");
const DOT_DIR = join(homedir(), ".polkadot");

beforeAll(() => {
  const metaDir = join(DOT_DIR, "chains", "polkadot");
  const metaPath = join(metaDir, "metadata.bin");
  if (!existsSync(metaPath)) {
    mkdirSync(metaDir, { recursive: true });
    linkSync(FIXTURE_METADATA, metaPath);
  }
  const configPath = join(DOT_DIR, "config.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG));
  }
});

// ---------------------------------------------------------------------------
// Direct unit tests for showItemHelp (in-process, counted by coverage).
// Output assertions use runCli (subprocess) to avoid console.log conflicts
// with --concurrent. These in-process calls exercise all code paths for
// coverage without asserting on console output.
// ---------------------------------------------------------------------------

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("showItemHelp (in-process coverage)", { timeout: 15_000 }, () => {
  test("tx item completes without error", async () => {
    await showItemHelp("tx", "System.remark", { chain: "polkadot" });
  });

  test("query map item completes without error", async () => {
    await showItemHelp("query", "System.Account", { chain: "polkadot" });
  });

  test("query plain item completes without error", async () => {
    await showItemHelp("query", "System.Number", { chain: "polkadot" });
  });

  test("const item completes without error", async () => {
    await showItemHelp("const", "Balances.ExistentialDeposit", { chain: "polkadot" });
  });

  test("events item completes without error", async () => {
    await showItemHelp("events", "Balances.Transfer", { chain: "polkadot" });
  });

  test("errors item completes without error", async () => {
    await showItemHelp("errors", "Balances.InsufficientBalance", { chain: "polkadot" });
  });

  test("unknown tx item throws with suggestion", async () => {
    await expect(showItemHelp("tx", "System.remrk", { chain: "polkadot" })).rejects.toThrow(
      /remark/,
    );
  });

  test("unknown query item throws with suggestion", async () => {
    await expect(showItemHelp("query", "System.Acccount", { chain: "polkadot" })).rejects.toThrow(
      /Account/,
    );
  });

  test("unknown const item throws with suggestion", async () => {
    await expect(
      showItemHelp("const", "Balances.ExistentialDepoist", { chain: "polkadot" }),
    ).rejects.toThrow(/ExistentialDeposit/);
  });

  test("unknown event item throws with suggestion", async () => {
    await expect(
      showItemHelp("events", "Balances.Transferr", { chain: "polkadot" }),
    ).rejects.toThrow(/Transfer/);
  });

  test("unknown error item throws with suggestion", async () => {
    await expect(
      showItemHelp("errors", "Balances.InsufficientBalanc", { chain: "polkadot" }),
    ).rejects.toThrow(/InsufficientBalance/);
  });

  test("pallet-only tx delegates to listing", async () => {
    await showItemHelp("tx", "System", { chain: "polkadot" });
  });

  test("pallet-only query delegates to listing", async () => {
    await showItemHelp("query", "System", { chain: "polkadot" });
  });

  test("pallet-only events delegates to listing", async () => {
    await showItemHelp("events", "Balances", { chain: "polkadot" });
  });

  test("pallet-only errors delegates to listing", async () => {
    await showItemHelp("errors", "Balances", { chain: "polkadot" });
  });
});

// ---------------------------------------------------------------------------
// In-process JSON output coverage for handler functions.
// Same approach as above — call handlers directly with { json: true } so
// coverage instrumentation can see the JSON branches.
// ---------------------------------------------------------------------------

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("handler JSON output (in-process coverage)", { timeout: 15_000 }, () => {
  // handleCalls
  test("handleCalls category-only with json", async () => {
    await handleCalls(undefined, { json: true, chain: "polkadot" });
  });
  test("handleCalls pallet-only with json", async () => {
    await handleCalls("System", { json: true, chain: "polkadot" });
  });
  test("handleCalls pallet.item with json", async () => {
    await handleCalls("System.remark", { json: true, chain: "polkadot" });
  });

  // handleEvents
  test("handleEvents category-only with json", async () => {
    await handleEvents(undefined, { json: true, chain: "polkadot" });
  });
  test("handleEvents pallet-only with json", async () => {
    await handleEvents("Balances", { json: true, chain: "polkadot" });
  });
  test("handleEvents pallet.item with json", async () => {
    await handleEvents("Balances.Transfer", { json: true, chain: "polkadot" });
  });

  // handleErrors
  test("handleErrors category-only with json", async () => {
    await handleErrors(undefined, { json: true, chain: "polkadot" });
  });
  test("handleErrors pallet-only with json", async () => {
    await handleErrors("Balances", { json: true, chain: "polkadot" });
  });
  test("handleErrors pallet.item with json", async () => {
    await handleErrors("Balances.InsufficientBalance", { json: true, chain: "polkadot" });
  });

  // handleStorage
  test("handleStorage category-only with json", async () => {
    await handleStorage(undefined, { json: true, chain: "polkadot" });
  });
  test("handleStorage pallet-only with json", async () => {
    await handleStorage("System", { json: true, chain: "polkadot" });
  });
  test("handleStorage pallet.item with json", async () => {
    await handleStorage("System.Account", { json: true, chain: "polkadot" });
  });

  // handleExtensions
  test("handleExtensions category-only with json", async () => {
    await handleExtensions(undefined, { json: true, chain: "polkadot" });
  });
  test("handleExtensions identifier with json", async () => {
    await handleExtensions("CheckMortality", { json: true, chain: "polkadot" });
  });
  test("handleExtensions category-only pretty", async () => {
    await handleExtensions(undefined, { chain: "polkadot" });
  });
  test("handleExtensions identifier pretty", async () => {
    await handleExtensions("CheckMortality", { chain: "polkadot" });
  });
  test("handleExtensions unknown identifier throws with suggestion", async () => {
    await expect(handleExtensions("CheckMortalty", { chain: "polkadot" })).rejects.toThrow(
      /CheckMortality/,
    );
  });

  // showItemHelp with json
  test("showItemHelp tx item with json", async () => {
    await showItemHelp("tx", "System.remark", { json: true, chain: "polkadot" });
  });
  test("showItemHelp query item with json", async () => {
    await showItemHelp("query", "System.Account", { json: true, chain: "polkadot" });
  });
  test("showItemHelp events item with json", async () => {
    await showItemHelp("events", "Balances.Transfer", { json: true, chain: "polkadot" });
  });
  test("showItemHelp errors item with json", async () => {
    await showItemHelp("errors", "Balances.InsufficientBalance", { json: true, chain: "polkadot" });
  });
});

describe("dot tx listing (calls)", () => {
  test("lists calls with arg signatures", async () => {
    const { stdout, exitCode } = await runCli(["tx.Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Calls");
    expect(stdout).toContain("transfer_allow_death");
    expect(stdout).toContain("dest:");
    expect(stdout).toContain("value:");
  });

  test("tx category-only lists pallets with calls", async () => {
    const { stdout, exitCode } = await runCli(["tx"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Pallets with calls");
    expect(stdout).toContain("System");
    expect(stdout).toContain("Balances");
  });

  test("typo suggests correct name", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.Balances.transfer_alow_death",
      "0xaa",
      "--encode",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("transfer_allow_death");
  });

  test("chain prefix works", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stdout, exitCode } = await runCli(["kusama.tx.Balances"], { config });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Calls");
  });
});

describe("dot events", () => {
  test("lists events with field signatures", async () => {
    const { stdout, exitCode } = await runCli(["events.Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Events");
    expect(stdout).toContain("Transfer");
    expect(stdout).toContain("from:");
    expect(stdout).toContain("to:");
  });

  test("shows event detail", async () => {
    const { stdout, exitCode } = await runCli(["events.Balances.Transfer"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Event)");
    expect(stdout).toContain("Fields:");
    expect(stdout).toContain("from:");
  });

  test("event alias works", async () => {
    const { stdout, exitCode } = await runCli(["event.Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Events");
  });

  test("typo suggests correct name", async () => {
    const { stderr, exitCode } = await runCli(["events.Balances.Transferr"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Transfer");
  });

  test("chain prefix works", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stdout, exitCode } = await runCli(["kusama.events.Balances"], { config });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Events");
  });

  test("category-only lists pallets with events", async () => {
    const { stdout, exitCode } = await runCli(["events"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Pallets with events");
    expect(stdout).toContain("Balances");
  });

  test("events category-only shows multiple pallets", async () => {
    const { stdout, exitCode } = await runCli(["events"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System");
    expect(stdout).toContain("Staking");
  });

  test("chain prefix works for events: kusama.events.Balances", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stdout, exitCode } = await runCli(["kusama.events.Balances"], { config });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Events");
    expect(stdout).toContain("Transfer");
  });

  test("dot events.Balances.Transfer shows event detail", async () => {
    const { stdout, exitCode } = await runCli(["events.Balances.Transfer"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Event)");
    expect(stdout).toContain("Fields:");
    expect(stdout).toContain("from:");
    expect(stdout).toContain("to:");
    expect(stdout).toContain("amount:");
  });
});

describe("dot errors", () => {
  test("lists errors with docs", async () => {
    const { stdout, exitCode } = await runCli(["errors.Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Errors");
    expect(stdout).toContain("InsufficientBalance");
  });

  test("shows error detail", async () => {
    const { stdout, exitCode } = await runCli(["errors.Balances.InsufficientBalance"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Error)");
  });

  test("error alias works", async () => {
    const { stdout, exitCode } = await runCli(["error.Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Errors");
  });

  test("typo suggests correct name", async () => {
    const { stderr, exitCode } = await runCli(["errors.Balances.InsufficientBalanc"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("InsufficientBalance");
  });

  test("category-only lists pallets with errors", async () => {
    const { stdout, exitCode } = await runCli(["errors"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Pallets with errors");
    expect(stdout).toContain("Balances");
  });

  test("errors category-only shows multiple pallets", async () => {
    const { stdout, exitCode } = await runCli(["errors"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System");
    expect(stdout).toContain("Staking");
  });

  test("chain prefix works for errors: kusama.errors.Balances", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stdout, exitCode } = await runCli(["kusama.errors.Balances"], { config });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Errors");
    expect(stdout).toContain("InsufficientBalance");
  });

  test("dot errors.Balances.InsufficientBalance shows error detail", async () => {
    const { stdout, exitCode } = await runCli(["errors.Balances.InsufficientBalance"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Error)");
    // Should have docs about the error
    expect(stdout).toContain("Balance too low");
  });
});

describe("dot apis", () => {
  test("lists runtime APIs", async () => {
    const { stdout, exitCode } = await runCli(["apis"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Runtime APIs");
    expect(stdout).toContain("Core");
    expect(stdout).toContain("methods");
  });

  test("does not show v14 hint when metadata is v15", async () => {
    const { stdout, exitCode } = await runCli(["apis"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Hint");
    expect(stdout).not.toContain("chain update");
  });

  test("lists methods in a specific API", async () => {
    const { stdout, exitCode } = await runCli(["apis.Core"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Core Methods");
    expect(stdout).toContain("version");
  });

  test("api alias works", async () => {
    const { stdout, exitCode } = await runCli(["api.Core"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Core Methods");
  });

  test("typo suggests correct API name", async () => {
    const { stderr, exitCode } = await runCli(["apis.Cor"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Core");
  });

  test("chain prefix works for apis", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stdout, exitCode } = await runCli(["kusama.apis.Core"], { config });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Core Methods");
  });

  test("space-separated pallet works for apis", async () => {
    const { stdout, exitCode } = await runCli(["api", "Core"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Core Methods");
  });

  test("--chain flag with space-separated pallet works for apis", async () => {
    const { stdout, exitCode } = await runCli(["--chain", "POLKADOT", "api", "Core"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Core Methods");
  });
});

describe("space-separated arguments", () => {
  test("query pallet: dot query System", async () => {
    const { stdout, exitCode } = await runCli(["query", "System"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Storage");
    expect(stdout).toContain("Account");
  });

  test("query pallet + item: dot query System Number", async () => {
    const { stdout, exitCode } = await runCli(["query", "System", "Number"]);
    expect(exitCode).toBe(0);
    // Should resolve to query.System.Number — a plain storage value
    expect(stdout).toMatch(/\d+/);
  });

  test("tx pallet: dot tx Balances", async () => {
    const { stdout, exitCode } = await runCli(["tx", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Calls");
    expect(stdout).toContain("transfer_allow_death");
  });

  test("events pallet: dot events Balances", async () => {
    const { stdout, exitCode } = await runCli(["events", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Events");
    expect(stdout).toContain("Transfer");
  });

  test("events pallet + item: dot events Balances Transfer", async () => {
    const { stdout, exitCode } = await runCli(["events", "Balances", "Transfer"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Event)");
    expect(stdout).toContain("from:");
  });

  test("errors pallet: dot errors Balances", async () => {
    const { stdout, exitCode } = await runCli(["errors", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Errors");
    expect(stdout).toContain("InsufficientBalance");
  });

  test("errors pallet + item: dot errors Balances InsufficientBalance", async () => {
    const { stdout, exitCode } = await runCli(["errors", "Balances", "InsufficientBalance"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Error)");
    expect(stdout).toContain("Balance too low");
  });

  test("const pallet: dot const Balances", async () => {
    const { stdout, exitCode } = await runCli(["const", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Constants");
    expect(stdout).toContain("ExistentialDeposit");
  });

  test("const pallet + item: dot const Balances ExistentialDeposit", async () => {
    const { stdout, exitCode } = await runCli(["const", "Balances", "ExistentialDeposit"]);
    expect(exitCode).toBe(0);
    // Should resolve to the constant value
    expect(stdout).toMatch(/\d+/);
  });

  test("apis pallet: dot apis Core", async () => {
    const { stdout, exitCode } = await runCli(["apis", "Core"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Core Methods");
    expect(stdout).toContain("version");
  });

  test("--chain flag with space-separated args: dot --chain POLKADOT events Balances", async () => {
    const { stdout, exitCode } = await runCli(["--chain", "POLKADOT", "events", "Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Balances Events");
  });

  test("--chain flag with pallet + item: dot --chain POLKADOT errors Balances InsufficientBalance", async () => {
    const { stdout, exitCode } = await runCli([
      "--chain",
      "POLKADOT",
      "errors",
      "Balances",
      "InsufficientBalance",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Error)");
    expect(stdout).toContain("Balance too low");
  });
});

describe("no truncation", () => {
  test("call docs show first complete sentence", async () => {
    const { stdout, exitCode } = await runCli(["tx.Balances"]);
    expect(exitCode).toBe(0);
    // force_transfer docs span multiple metadata lines — listing should show the full first sentence
    expect(stdout).toContain(
      "Exactly as `transfer_allow_death`, except the origin must be root and the source account may be specified.",
    );
  });

  test("event docs show complete sentence with e.g. abbreviation", async () => {
    const { stdout, exitCode } = await runCli(["events.Balances"]);
    expect(exitCode).toBe(0);
    // Deposit event doc contains "e.g." — should not be cut off at the abbreviation
    expect(stdout).toContain("Some amount was deposited (e.g. for transaction fees).");
    // Withdraw has same pattern
    expect(stdout).toContain(
      "Some amount was withdrawn from the account (e.g. for transaction fees).",
    );
  });

  test("error docs show complete first sentence", async () => {
    const { stdout, exitCode } = await runCli(["errors.Balances"]);
    expect(exitCode).toBe(0);
    // Error docs should show complete first sentences
    expect(stdout).toContain("Balance too low to send value.");
    expect(stdout).toContain("Vesting balance too high to send value.");
  });
});

describe("item-level --help", () => {
  test("events.Balances.Transfer --help shows event help with usage", async () => {
    const { stdout, exitCode } = await runCli(["events.Balances.Transfer", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Event)");
    expect(stdout).toContain("Fields:");
    expect(stdout).toContain("Usage:");
  });

  test("errors.System.CallFiltered --help shows error help with usage", async () => {
    const { stdout, exitCode } = await runCli(["errors.System.CallFiltered", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Error)");
    expect(stdout).toContain("Usage:");
  });

  test("apis.Core.version --help shows runtime API help with usage", async () => {
    const { stdout, exitCode } = await runCli(["apis.Core.version", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Runtime API)");
    expect(stdout).toContain("Usage:");
  });

  test("runtime API detail uses pretty-printed Args / Returns blocks", async () => {
    const { stdout, exitCode } = await runCli(["apis.Core.execute_block", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Runtime API)");
    expect(stdout).toMatch(/Args:\s+/);
    expect(stdout).toMatch(/Returns:\s+/);
    // No truncation of long types
    expect(stdout).not.toMatch(/\.\.\./);
  });

  test("transaction extension detail page renders pretty Value type (no truncation)", async () => {
    const { stdout, exitCode } = await runCli(["extensions.CheckMortality"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Transaction Extension)");
    expect(stdout).toMatch(/Value type:\s+/);
    expect(stdout).toMatch(/AdditionalSigned:\s+/);
    expect(stdout).not.toMatch(/\.\.\./);
  });
});

describe("stdout/stderr separation (pipe-safe output)", () => {
  test("dot tx listing stdout has no progress messages", async () => {
    const { stdout, exitCode } = await runCli(["tx.Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Fetching metadata");
    expect(stdout).not.toContain("Connecting");
  });

  test("dot events stdout has no progress messages", async () => {
    const { stdout, exitCode } = await runCli(["events.Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Fetching metadata");
    expect(stdout).not.toContain("Connecting");
  });

  test("dot errors stdout has no progress messages", async () => {
    const { stdout, exitCode } = await runCli(["errors.Balances"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Fetching metadata");
    expect(stdout).not.toContain("Connecting");
  });

  // --json output tests
  test("events --json lists pallets with event counts", async () => {
    const { stdout, exitCode } = await runCli(["events", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chain).toBe("polkadot");
    expect(Array.isArray(parsed.pallets)).toBe(true);
    const balances = parsed.pallets.find((p: any) => p.name === "Balances");
    expect(balances).toBeDefined();
    expect(balances.events).toBeGreaterThan(0);
  });

  test("events.Balances --json lists events in pallet", async () => {
    const { stdout, exitCode } = await runCli(["events.Balances", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.pallet).toBe("Balances");
    expect(Array.isArray(parsed.events)).toBe(true);
    const transfer = parsed.events.find((e: any) => e.name === "Transfer");
    expect(transfer).toBeDefined();
    expect(transfer.fields).toBeDefined();
    expect(transfer.docs).toBeDefined();
  });

  test("events.Balances.Transfer --json returns event detail", async () => {
    const { stdout, exitCode } = await runCli(["events.Balances.Transfer", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.pallet).toBe("Balances");
    expect(parsed.item).toBe("Transfer");
    expect(parsed.category).toBe("event");
  });

  test("errors --json lists pallets with error counts", async () => {
    const { stdout, exitCode } = await runCli(["errors", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chain).toBe("polkadot");
    expect(Array.isArray(parsed.pallets)).toBe(true);
  });

  test("errors.Balances --json lists errors in pallet", async () => {
    const { stdout, exitCode } = await runCli(["errors.Balances", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.pallet).toBe("Balances");
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });
});

describe("connected RPC endpoint in category headers (#164)", () => {
  test("tx category header shows endpoint", async () => {
    const { stdout, exitCode } = await runCli(["tx"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Pallets with calls on polkadot \(\d+\)\s+\[wss:\/\/[^\]]+\]/);
  });

  test("events category header shows endpoint", async () => {
    const { stdout, exitCode } = await runCli(["events"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Pallets with events on polkadot \(\d+\)\s+\[wss:\/\/[^\]]+\]/);
  });

  test("errors category header shows endpoint", async () => {
    const { stdout, exitCode } = await runCli(["errors"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Pallets with errors on polkadot \(\d+\)\s+\[wss:\/\/[^\]]+\]/);
  });

  test("query category header shows endpoint", async () => {
    const { stdout, exitCode } = await runCli(["query"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Pallets with storage on polkadot \(\d+\)\s+\[wss:\/\/[^\]]+\]/);
  });

  test("extensions category header shows endpoint", async () => {
    const { stdout, exitCode } = await runCli(["extensions"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Transaction extensions on polkadot \(\d+\)\s+\[wss:\/\/[^\]]+\]/);
  });

  test("category --json includes rpc endpoint field", async () => {
    const { stdout, exitCode } = await runCli(["tx", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.rpc).toMatch(/^wss:\/\//);
  });

  test("extensions --json includes rpc endpoint field", async () => {
    const { stdout, exitCode } = await runCli(["extensions", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.rpc).toMatch(/^wss:\/\//);
  });
});

describe("dot extensions", () => {
  test("lists extensions with types", async () => {
    const { stdout, exitCode } = await runCli(["extensions"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Transaction extensions");
    expect(stdout).toContain("CheckMortality");
    expect(stdout).toContain("[builtin]");
  });

  test("shows extension detail", async () => {
    const { stdout, exitCode } = await runCli(["extensions.CheckMortality"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Transaction Extension)");
    expect(stdout).toContain("Value type:");
    expect(stdout).toContain("AdditionalSigned:");
    expect(stdout).toContain("polkadot-api (builtin)");
  });

  test("extension alias works", async () => {
    const { stdout, exitCode } = await runCli(["extension.CheckMortality"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Transaction Extension)");
  });

  test("typo suggests correct name", async () => {
    const { stderr, exitCode } = await runCli(["extensions.CheckMortalty"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("CheckMortality");
  });

  test("chain prefix works", async () => {
    const config = {
      chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
    };
    const { stdout, exitCode } = await runCli(["kusama.extensions"], { config });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Transaction extensions");
  });

  test("rejects sub-items with a helpful message", async () => {
    const { stderr, exitCode } = await runCli(["extensions.CheckMortality.value"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("no sub-items");
  });

  test("extensions --json lists identifiers", async () => {
    const { stdout, exitCode } = await runCli(["extensions", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chain).toBe("polkadot");
    expect(Array.isArray(parsed.extensions)).toBe(true);
    const mortality = parsed.extensions.find((e: any) => e.identifier === "CheckMortality");
    expect(mortality).toBeDefined();
    expect(mortality.isBuiltin).toBe(true);
    expect(typeof mortality.valueType).toBe("string");
    expect(typeof mortality.additionalSignedType).toBe("string");
  });

  test("extensions.CheckMortality --json returns extension detail", async () => {
    const { stdout, exitCode } = await runCli(["extensions.CheckMortality", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.identifier).toBe("CheckMortality");
    expect(parsed.isBuiltin).toBe(true);
    expect(typeof parsed.valueTypeId).toBe("number");
    expect(typeof parsed.additionalSignedTypeId).toBe("number");
  });
});
