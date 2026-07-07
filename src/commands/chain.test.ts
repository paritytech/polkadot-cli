import { describe, expect, test } from "bun:test";
import { runCli } from "./__fixtures__/run-cli.ts";

describe("dot chain", () => {
  test("no action shows help", async () => {
    const { stdout, exitCode } = await runCli(["chain"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("dot chain add");
    expect(stdout).toContain("dot chain list");
  });

  test("--help shows same custom help as bare command", async () => {
    const bare = await runCli(["chain"]);
    const help = await runCli(["chain", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("dot chain add");
    expect(help.stdout).toContain("dot chain list");
    expect(help.stdout).toBe(bare.stdout);
  });

  test("chains shorthand lists chains", async () => {
    const { stdout, exitCode } = await runCli(["chains"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Configured Chains");
    expect(stdout).toContain("polkadot");
  });

  test("unknown action foo errors", async () => {
    const { stderr, exitCode } = await runCli(["chain", "foo"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown action "foo"');
  });

  test("list shows all built-in chains", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("polkadot");
    expect(stdout).not.toContain("(default)");
    // Default list output no longer includes RPC URLs; use --verbose for that.
    expect(stdout).not.toContain("rpc.polkadot.io");
    expect(stdout).toContain("paseo");
    // Polkadot system parachains
    expect(stdout).toContain("polkadot-asset-hub");
    expect(stdout).toContain("polkadot-bridge-hub");
    expect(stdout).toContain("polkadot-collectives");
    expect(stdout).toContain("polkadot-coretime");
    expect(stdout).toContain("polkadot-people");
    // Paseo system parachains
    expect(stdout).toContain("paseo-asset-hub");
    expect(stdout).toContain("paseo-bridge-hub");
    expect(stdout).toContain("paseo-collectives");
    expect(stdout).toContain("paseo-coretime");
    expect(stdout).toContain("paseo-people");
  });

  test("list with multiple chains shows all", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list"], {
      config: {
        chains: {
          kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
          westend: { rpc: "wss://westend-rpc.polkadot.io" },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("polkadot");
    expect(stdout).toContain("kusama");
    expect(stdout).toContain("westend");
  });

  test("list -v with multi-RPC chain shows all endpoints", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "-v"], {
      config: {
        chains: {
          kusama: { rpc: ["wss://kusama-rpc.polkadot.io", "wss://kusama-rpc.dwellir.com"] },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kusama");
    expect(stdout).toContain("kusama-rpc.polkadot.io");
    expect(stdout).toContain("kusama-rpc.dwellir.com");
  });

  test("list with single-string rpc still works (backward compat)", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "-v"], {
      config: {
        chains: {
          kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kusama");
    expect(stdout).toContain("kusama-rpc.polkadot.io");
  });

  test("list -v shows built-in chains with multiple RPCs", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "-v"]);
    expect(exitCode).toBe(0);
    // polkadot should show primary + fallback RPCs
    expect(stdout).toContain("polkadot.ibp.network");
    expect(stdout).toContain("polkadot-rpc.n.dwellir.com");
    expect(stdout).toContain("rpc.polkadot.io");
  });

  test("list with single-element array rpc", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "-v"], {
      config: {
        chains: {
          kusama: { rpc: ["wss://kusama-rpc.polkadot.io"] },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kusama");
    expect(stdout).toContain("kusama-rpc.polkadot.io");
  });

  test("list default (no -v) hides RPC URLs", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list"], {
      config: {
        chains: {
          kusama: { rpc: ["wss://kusama-rpc.polkadot.io", "wss://kusama-rpc.dwellir.com"] },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kusama");
    expect(stdout).not.toContain("kusama-rpc.polkadot.io");
    expect(stdout).not.toContain("kusama-rpc.dwellir.com");
  });

  test("chains --verbose hides nothing (alias of -v)", async () => {
    const { stdout, exitCode } = await runCli(["chains", "--verbose"], {
      config: {
        chains: {
          kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kusama-rpc.polkadot.io");
  });

  test("help text shows multi-rpc example", async () => {
    const { stdout, exitCode } = await runCli(["chain"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "--rpc wss://kusama-rpc.polkadot.io --rpc wss://kusama-rpc.dwellir.com",
    );
  });

  test("help text does not mention --light-client", async () => {
    const { stdout, exitCode } = await runCli(["chain"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("--light-client");
    expect(stdout).not.toContain("light client");
    expect(stdout).not.toContain("Smoldot");
  });

  test("add mychain (no --rpc) error does not mention --light-client", async () => {
    const { stderr, exitCode } = await runCli(["chain", "add", "mychain"]);
    expect(exitCode).toBe(1);
    expect(stderr).not.toContain("--light-client");
  });

  test("list does not mention light-client", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("light-client");
  });

  test("default action is now unknown (feature removed)", async () => {
    const { stderr, exitCode } = await runCli(["chain", "default", "kusama"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown action "default"');
  });

  test("update (no name, no --all) errors with usage", async () => {
    const { stderr, exitCode } = await runCli(["chain", "update"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: dot chain update");
  });

  test("remove kusama succeeds", async () => {
    const { stdout, exitCode } = await runCli(["chain", "remove", "kusama"], {
      config: {
        chains: {
          kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("removed");
  });

  test("remove polkadot errors", async () => {
    const { stderr, exitCode } = await runCli(["chain", "remove", "polkadot"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot remove");
  });

  test("remove paseo errors (built-in)", async () => {
    const { stderr, exitCode } = await runCli(["chain", "remove", "paseo"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Cannot remove the built-in "paseo" chain');
  });

  test("remove polkadot-asset-hub errors (built-in)", async () => {
    const { stderr, exitCode } = await runCli(["chain", "remove", "polkadot-asset-hub"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Cannot remove the built-in "polkadot-asset-hub" chain');
  });

  test("remove polkadot-bridge-hub errors (built-in)", async () => {
    const { stderr, exitCode } = await runCli(["chain", "remove", "polkadot-bridge-hub"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Cannot remove the built-in "polkadot-bridge-hub" chain');
  });

  test("remove paseo-people errors (built-in)", async () => {
    const { stderr, exitCode } = await runCli(["chain", "remove", "paseo-people"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Cannot remove the built-in "paseo-people" chain');
  });

  test("remove polkadot-coretime errors (built-in)", async () => {
    const { stderr, exitCode } = await runCli(["chain", "remove", "polkadot-coretime"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Cannot remove the built-in "polkadot-coretime" chain');
  });

  test("remove nonexistent errors", async () => {
    const { stderr, exitCode } = await runCli(["chain", "remove", "nonexistent"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("remove (no name) errors", async () => {
    const { stderr, exitCode } = await runCli(["chain", "remove"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("add (no name) errors", async () => {
    const { stderr, exitCode } = await runCli(["chain", "add"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Chain name is required");
  });

  test("help text shows --all flag", async () => {
    const { stdout, exitCode } = await runCli(["chain"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--all");
  });

  test("add mychain (no --rpc) errors", async () => {
    const { stderr, exitCode } = await runCli(["chain", "add", "mychain"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Must provide --rpc");
  });

  test("remove Polkadot (case-insensitive) errors as built-in", async () => {
    const { stderr, exitCode } = await runCli(["chain", "remove", "Polkadot"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot remove");
  });

  // --json output tests
  test("list --json returns valid JSON with all chains", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.chains)).toBe(true);
    const polkadot = parsed.chains.find((c: any) => c.name === "polkadot");
    expect(polkadot).toBeDefined();
    expect(polkadot.default).toBeUndefined();
    expect(Array.isArray(polkadot.rpc)).toBe(true);
    expect(polkadot.rpc[0]).toContain("polkadot");
  });

  test("chains shorthand --json returns JSON", async () => {
    const { stdout, exitCode } = await runCli(["chains", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.chains)).toBe(true);
  });

  // Topology tests
  test("list groups parachains under relay chains with tree structure", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("├─");
    expect(stdout).toContain("└─");
  });

  test("list shows parachain IDs in brackets", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[1000]");
    expect(stdout).toContain("[1002]");
    expect(stdout).toContain("[1001]");
    expect(stdout).toContain("[1004]");
    expect(stdout).toContain("[1005]");
  });

  test("list shows standalone chains separately", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "-v"], {
      config: {
        chains: {
          "my-solo": { rpc: "wss://solo.example" },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-solo");
    expect(stdout).toContain("solo.example");
  });

  test("list --json includes relay and parachainId for parachains", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const assetHub = parsed.chains.find((c: any) => c.name === "polkadot-asset-hub");
    expect(assetHub).toBeDefined();
    expect(assetHub.relay).toBe("polkadot");
    expect(assetHub.parachainId).toBe(1000);
  });

  test("list --json does not include relay for relay chains", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const polkadot = parsed.chains.find((c: any) => c.name === "polkadot");
    expect(polkadot).toBeDefined();
    expect(polkadot.relay).toBeUndefined();
    expect(polkadot.parachainId).toBeUndefined();
  });

  test("add with --parachain-id but no --relay errors", async () => {
    const { stderr, exitCode } = await runCli([
      "chain",
      "add",
      "mychain",
      "--rpc",
      "wss://example.com",
      "--parachain-id",
      "1000",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot set --parachain-id without --relay");
  });

  test("help text shows --relay example", async () => {
    const { stdout, exitCode } = await runCli(["chain"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--relay");
    expect(stdout).toContain("--parachain-id");
  });

  test("remove relay chain warns about orphaned parachains", async () => {
    const { stderr, stdout, exitCode } = await runCli(["chain", "remove", "local-relay"], {
      config: {
        chains: {
          "local-relay": { rpc: "wss://local-relay.example" },
          "local-para": {
            rpc: "wss://local-para.example",
            relay: "local-relay",
            parachainId: 1000,
          },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Warning");
    expect(stderr).toContain("local-para");
    expect(stdout).toContain("removed");
  });

  test("list with custom relay and parachain shows tree", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list"], {
      config: {
        chains: {
          "local-relay": { rpc: "wss://local-relay.example" },
          "local-para": {
            rpc: "wss://local-para.example",
            relay: "local-relay",
            parachainId: 2000,
          },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("local-relay");
    expect(stdout).toContain("local-para");
    expect(stdout).toContain("[2000]");
    expect(stdout).toContain("└─");
  });

  test("list with multiple parachains under custom relay uses ├─ and └─", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list"], {
      config: {
        chains: {
          "local-relay": { rpc: "wss://local-relay.example" },
          "local-para-a": {
            rpc: "wss://local-para-a.example",
            relay: "local-relay",
            parachainId: 1000,
          },
          "local-para-b": {
            rpc: "wss://local-para-b.example",
            relay: "local-relay",
            parachainId: 2000,
          },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("├─");
    expect(stdout).toContain("└─");
    expect(stdout).toContain("[1000]");
    expect(stdout).toContain("[2000]");
  });

  test("list --json includes relay and parachainId for custom chains", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "--json"], {
      config: {
        chains: {
          "local-relay": { rpc: "wss://local-relay.example" },
          "local-para": {
            rpc: "wss://local-para.example",
            relay: "local-relay",
            parachainId: 2000,
          },
        },
      },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const para = parsed.chains.find((c: any) => c.name === "local-para");
    expect(para).toBeDefined();
    expect(para.relay).toBe("local-relay");
    expect(para.parachainId).toBe(2000);
    const relay = parsed.chains.find((c: any) => c.name === "local-relay");
    expect(relay).toBeDefined();
    expect(relay.relay).toBeUndefined();
  });

  test("list parachain without parachainId omits bracket suffix", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list"], {
      config: {
        chains: {
          "local-relay": { rpc: "wss://local-relay.example" },
          "no-id-para": {
            rpc: "wss://no-id-para.example",
            relay: "local-relay",
          },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("no-id-para");
    expect(stdout).not.toContain("[undefined]");
  });

  test("remove non-relay chain does not warn about orphans", async () => {
    const { stderr, stdout, exitCode } = await runCli(["chain", "remove", "standalone"], {
      config: {
        chains: {
          standalone: { rpc: "wss://standalone.example" },
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Warning");
    expect(stdout).toContain("removed");
  });

  test("list all built-in parachains have topology", async () => {
    const { stdout, exitCode } = await runCli(["chain", "list", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const parachains = [
      "polkadot-asset-hub",
      "polkadot-bridge-hub",
      "polkadot-collectives",
      "polkadot-coretime",
      "polkadot-people",
      "paseo-asset-hub",
      "paseo-bridge-hub",
      "paseo-collectives",
      "paseo-coretime",
      "paseo-people",
    ];
    for (const name of parachains) {
      const chain = parsed.chains.find((c: any) => c.name === name);
      expect(chain).toBeDefined();
      expect(chain.relay).toBeDefined();
      expect(chain.parachainId).toBeGreaterThan(0);
    }
  });

  test("chains shorthand shows tree structure", async () => {
    const { stdout, exitCode } = await runCli(["chains"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("├─");
    expect(stdout).toContain("└─");
    expect(stdout).toContain("[1000]");
  });

  // Export / Import tests
  test("export with no custom chains produces empty chains object", async () => {
    const { stdout, exitCode } = await runCli(["chain", "export"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed.chains).length).toBe(0);
  });

  test("export --all includes built-in chains", async () => {
    const { stdout, exitCode } = await runCli(["chain", "export", "--all"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chains.polkadot).toBeDefined();
    expect(parsed.chains.paseo).toBeDefined();
    expect(parsed.chains["polkadot-asset-hub"]).toBeDefined();
  });

  test("export includes custom chains", async () => {
    const { stdout, exitCode } = await runCli(["chain", "export"], {
      config: {
        chains: {
          kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
        },
      },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chains.kusama).toBeDefined();
    expect(parsed.chains.kusama.rpc).toBe("wss://kusama-rpc.polkadot.io");
  });

  test("export specific chains by name", async () => {
    const { stdout, exitCode } = await runCli(["chain", "export", "kusama"], {
      config: {
        chains: {
          kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
          westend: { rpc: "wss://westend-rpc.polkadot.io" },
        },
      },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chains.kusama).toBeDefined();
    expect(parsed.chains.westend).toBeUndefined();
  });

  test("export nonexistent chain errors", async () => {
    const { stderr, exitCode } = await runCli(["chain", "export", "nonexistent"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("export to --file writes to disk", async () => {
    const { stdout, exitCode } = await runCli([
      "chain",
      "export",
      "--all",
      "--file",
      "{{HOME}}/chains.json",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Exported");
  });

  test("export preserves relay and parachainId", async () => {
    const { stdout, exitCode } = await runCli(["chain", "export", "local-para"], {
      config: {
        chains: {
          "local-relay": { rpc: "wss://local-relay.example" },
          "local-para": {
            rpc: "wss://local-para.example",
            relay: "local-relay",
            parachainId: 2000,
          },
        },
      },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chains["local-para"].relay).toBe("local-relay");
    expect(parsed.chains["local-para"].parachainId).toBe(2000);
  });

  test("import from file adds new chains", async () => {
    const importData = JSON.stringify({
      defaultChain: "polkadot",
      chains: {
        kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
      },
    });
    const { stdout, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--no-metadata"],
      {
        files: { "import.json": importData },
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kusama");
    expect(stdout).toContain("1 added");

    // Verify it was actually added
    const list = await runCli(["chain", "list", "--json"], {
      config: {
        chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
      },
    });
    const parsed = JSON.parse(list.stdout);
    const kusama = parsed.chains.find((c: any) => c.name === "kusama");
    expect(kusama).toBeDefined();
  });

  test("import skips existing chains without --overwrite", async () => {
    const importData = JSON.stringify({
      defaultChain: "polkadot",
      chains: {
        kusama: { rpc: "wss://new-endpoint.example" },
      },
    });
    const { stdout, stderr, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--no-metadata"],
      {
        config: {
          chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
        },
        files: { "import.json": importData },
      },
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Skipped");
    expect(stdout).toContain("kusama (skipped)");
    expect(stdout).toContain("1 skipped");
  });

  test("import --overwrite replaces existing chains", async () => {
    const importData = JSON.stringify({
      defaultChain: "polkadot",
      chains: {
        kusama: { rpc: "wss://new-endpoint.example" },
      },
    });
    const { stdout, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--overwrite", "--no-metadata"],
      {
        config: {
          chains: { kusama: { rpc: "wss://kusama-rpc.polkadot.io" } },
        },
        files: { "import.json": importData },
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kusama");
    expect(stdout).toContain("(overwritten)");
    expect(stdout).toContain("1 overwritten");
  });

  test("import --dry-run does not persist changes", async () => {
    const importData = JSON.stringify({
      defaultChain: "polkadot",
      chains: {
        kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
      },
    });
    const { stdout, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--dry-run"],
      {
        files: { "import.json": importData },
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(dry run)");
    expect(stdout).toContain("kusama");
    expect(stdout).toContain("1 added");
  });

  test("import bare (no file, no stdin) errors without hanging", async () => {
    const { exitCode } = await runCli(["chain", "import"]);
    expect(exitCode).toBe(1);
  });

  test("import warns about missing relay reference", async () => {
    const importData = JSON.stringify({
      defaultChain: "polkadot",
      chains: {
        "orphan-para": {
          rpc: "wss://orphan.example",
          relay: "nonexistent-relay",
          parachainId: 2000,
        },
      },
    });
    const { stderr, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--no-metadata"],
      {
        files: { "import.json": importData },
      },
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("nonexistent-relay");
    expect(stderr).toContain("does not exist");
  });

  test("import invalid JSON errors", async () => {
    const { stderr, exitCode } = await runCli(["chain", "import", "{{HOME}}/bad.json"], {
      files: { "bad.json": "not valid json {{{" },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid JSON");
  });

  test("import invalid format (missing chains) errors", async () => {
    const { stderr, exitCode } = await runCli(["chain", "import", "{{HOME}}/bad.json"], {
      files: { "bad.json": '{"foo": "bar"}' },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing");
  });

  test("import --json returns structured output", async () => {
    const importData = JSON.stringify({
      defaultChain: "polkadot",
      chains: {
        kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
      },
    });
    const { stdout, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--json"],
      {
        files: { "import.json": importData },
      },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.action).toBe("imported");
    expect(parsed.added).toContain("kusama");
  });

  test("import from stdin", async () => {
    const importData = JSON.stringify({
      defaultChain: "polkadot",
      chains: {
        kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
      },
    });
    const { stdout, exitCode } = await runCli(["chain", "import", "-", "--no-metadata"], {
      stdin: importData,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kusama");
    expect(stdout).toContain("1 added");
  });

  test("export round-trip: export then import is consistent", async () => {
    const configOpts = {
      config: {
        chains: {
          "local-relay": { rpc: "wss://local-relay.example" },
          "local-para": {
            rpc: "wss://local-para.example",
            relay: "local-relay",
            parachainId: 2000,
          },
        } as Record<string, any>,
      },
    };
    const exported = await runCli(["chain", "export"], configOpts);
    expect(exported.exitCode).toBe(0);
    const parsed = JSON.parse(exported.stdout);
    expect(parsed.chains["local-relay"]).toBeDefined();
    expect(parsed.chains["local-para"]).toBeDefined();

    // Import the exported data into a clean environment
    const imported = await runCli(["chain", "import", "-", "--dry-run", "--json"], {
      stdin: exported.stdout,
    });
    expect(imported.exitCode).toBe(0);
    const result = JSON.parse(imported.stdout);
    expect(result.added).toContain("local-relay");
    expect(result.added).toContain("local-para");
  });

  test("import --no-metadata skips metadata fetch", async () => {
    const importData = JSON.stringify({
      defaultChain: "polkadot",
      chains: {
        kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
      },
    });
    const { stderr, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--no-metadata"],
      {
        files: { "import.json": importData },
      },
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Updating metadata");
    expect(stderr).not.toContain("dot chain update --all");
  });

  test("import prints per-item lines, not comma-joined summary", async () => {
    const importData = JSON.stringify({
      chains: {
        "new-a": { rpc: "wss://a.example" },
        "new-b": { rpc: "wss://b.example" },
        "new-c": { rpc: "wss://c.example" },
      },
    });
    const { stdout, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--dry-run"],
      { files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    // Each chain name appears on its own line prefixed by the ✓ tick
    expect(stdout).toMatch(/✓ new-a\b/);
    expect(stdout).toMatch(/✓ new-b\b/);
    expect(stdout).toMatch(/✓ new-c\b/);
    // The old comma-joined "Added: a, b, c" format should be gone
    expect(stdout).not.toContain("new-a, new-b, new-c");
    expect(stdout).not.toContain("Added: new-a");
    // Count summary replaces the old format
    expect(stdout).toContain("3 added");
  });

  test("import summary lists added, overwritten, and skipped counts", async () => {
    const importData = JSON.stringify({
      chains: {
        kusama: { rpc: "wss://new-kusama.example" },
        westend: { rpc: "wss://westend.example" },
        polkadot: { rpc: "wss://existing.example" },
      },
    });
    const { stdout, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--overwrite", "--dry-run"],
      {
        config: { chains: { kusama: { rpc: "wss://old-kusama.example" } } },
        files: { "import.json": importData },
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 added");
    expect(stdout).toContain("overwritten");
    expect(stdout).toContain("(dry run)");
  });

  test("import empty file prints no-chains message", async () => {
    const importData = JSON.stringify({ chains: {} });
    const { stdout, exitCode } = await runCli(
      ["chain", "import", "{{HOME}}/import.json", "--dry-run"],
      { files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No chains imported");
  });

  // chain info / bare shortcut
  test("info polkadot shows rpc, parachains, metadata block", async () => {
    const { stdout, exitCode } = await runCli(["chain", "info", "polkadot"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("polkadot");
    expect(stdout).toContain("rpc:");
    expect(stdout).toContain("rpc.polkadot.io");
    expect(stdout).toContain("parachains:");
    expect(stdout).toContain("polkadot-asset-hub");
    expect(stdout).toContain("metadata:");
  });

  test("info on parachain shows relay and parachain id", async () => {
    const { stdout, exitCode } = await runCli(["chain", "info", "polkadot-asset-hub"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("relay:");
    expect(stdout).toContain("polkadot");
    expect(stdout).toContain("parachain id:");
    expect(stdout).toContain("1000");
    expect(stdout).not.toContain("parachains:");
  });

  test("info on cached chain shows specName, version, and fetchedAt", async () => {
    const fingerprint = {
      specName: "polkadot",
      specVersion: 1003000,
      transactionVersion: 26,
      implName: "parity-polkadot",
      implVersion: 0,
      authoringVersion: 0,
      codeHash: `0x${"ab".repeat(32)}`,
      fetchedAt: "2026-04-29T12:34:56.000Z",
    };
    const { stdout, exitCode } = await runCli(["chain", "info", "polkadot"], {
      files: {
        ".polkadot/chains/polkadot/metadata.fingerprint.json": JSON.stringify(fingerprint),
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("metadata:");
    expect(stdout).toContain("polkadot v1003000");
    expect(stdout).toContain("2026-04-29T12:34:56.000Z");
    // Metadata block must not be in the "not cached" state.
    expect(stdout).not.toMatch(/metadata:\s*\n\s*not cached/);
  });

  test("info --json on cached chain emits structured metadata block", async () => {
    const fingerprint = {
      specName: "polkadot",
      specVersion: 1003000,
      transactionVersion: 26,
      implName: "parity-polkadot",
      implVersion: 0,
      authoringVersion: 0,
      codeHash: `0x${"ab".repeat(32)}`,
      fetchedAt: "2026-04-29T12:34:56.000Z",
    };
    const { stdout, exitCode } = await runCli(["chain", "info", "polkadot", "--json"], {
      files: {
        ".polkadot/chains/polkadot/metadata.fingerprint.json": JSON.stringify(fingerprint),
      },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.metadata).toEqual({
      specName: "polkadot",
      specVersion: 1003000,
      fetchedAt: "2026-04-29T12:34:56.000Z",
    });
  });

  test("info on uncached chain shows `not cached` hint", async () => {
    const { stdout, exitCode } = await runCli(["chain", "info", "polkadot"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("metadata:");
    expect(stdout).toContain("not cached");
    expect(stdout).toContain("dot chain update polkadot");
  });

  test("info --json returns structured object with metadata: null when not cached", async () => {
    const { stdout, exitCode } = await runCli(["chain", "info", "polkadot", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("polkadot");
    expect(Array.isArray(parsed.rpc)).toBe(true);
    expect(parsed.metadata).toBeNull();
    expect(Array.isArray(parsed.parachains)).toBe(true);
    expect(parsed.parachains.find((p: any) => p.name === "polkadot-asset-hub")).toBeDefined();
  });

  test("info --json on parachain includes relay + parachainId, omits parachains", async () => {
    const { stdout, exitCode } = await runCli(["chain", "info", "polkadot-asset-hub", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.relay).toBe("polkadot");
    expect(parsed.parachainId).toBe(1000);
    expect(parsed.parachains).toBeUndefined();
  });

  test("bare `dot chain <name>` is a shortcut for `chain info <name>`", async () => {
    const direct = await runCli(["chain", "info", "polkadot", "--json"]);
    const shortcut = await runCli(["chain", "polkadot", "--json"]);
    expect(direct.exitCode).toBe(0);
    expect(shortcut.exitCode).toBe(0);
    expect(shortcut.stdout).toBe(direct.stdout);
  });

  test("info nonexistent chain errors with available list", async () => {
    const { stderr, exitCode } = await runCli(["chain", "info", "nonexistent-chain"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("nonexistent-chain");
  });

  test("info (no name) errors with usage", async () => {
    const { stderr, exitCode } = await runCli(["chain", "info"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: dot chain info");
  });

  test("info case-insensitive name resolution", async () => {
    const { stdout, exitCode } = await runCli(["chain", "info", "Polkadot", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("polkadot");
  });

  test("help text mentions info action and shortcut", async () => {
    const { stdout, exitCode } = await runCli(["chain"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("dot chain info <name>");
    expect(stdout).toContain("dot chain <name>");
  });

  test("help text mentions properties action", async () => {
    const { stdout, exitCode } = await runCli(["chain"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("dot chain properties <name>");
  });
});

/**
 * Minimal JSON-RPC-over-WebSocket server so the properties command can be
 * exercised end-to-end (through the real one-shot RPC client) without a live
 * node. `responder` maps a method name to either a result value or an Error
 * (returned as a JSON-RPC error, mimicking an unsupported method).
 */
function startRpcServer(responder: (method: string) => unknown): {
  url: string;
  stop: () => void;
} {
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined;
      return new Response("expected websocket", { status: 426 });
    },
    websocket: {
      message(ws, raw) {
        const msg = JSON.parse(String(raw)) as { id: number | string; method: string };
        // The polkadot-api ws provider probes `rpc_methods` on connect to pick
        // its legacy/modern routing — answer it before delegating to responder.
        if (msg.method === "rpc_methods") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                methods: ["system_properties", "chainSpec_v1_properties", "rpc_methods"],
                version: 1,
              },
            }),
          );
          return;
        }
        let payload: unknown;
        try {
          const result = responder(msg.method);
          if (result instanceof Error) throw result;
          payload = { jsonrpc: "2.0", id: msg.id, result };
        } catch (err) {
          payload = {
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32601, message: err instanceof Error ? err.message : "error" },
          };
        }
        ws.send(JSON.stringify(payload));
      },
    },
  });
  return {
    url: `ws://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

describe("dot chain properties", () => {
  test("no name errors with usage", async () => {
    const { stderr, exitCode } = await runCli(["chain", "properties"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: dot chain properties");
  });

  test("unknown chain errors before any RPC call", async () => {
    const { stderr, exitCode } = await runCli(["chain", "properties", "nonexistent-chain"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("nonexistent-chain");
  });

  test("--json returns scalar properties from system_properties", async () => {
    const server = startRpcServer((method) => {
      if (method === "system_properties") {
        return { tokenDecimals: 10, tokenSymbol: "DOT", ss58Format: 0 };
      }
      return new Error("Method not found");
    });
    try {
      const { stdout, exitCode } = await runCli(
        ["chain", "properties", "polkadot", "--rpc", server.url, "--json"],
        { noDefaultChain: true },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({ tokenDecimals: 10, tokenSymbol: "DOT", ss58Format: 0 });
    } finally {
      server.stop();
    }
  });

  test("--json preserves array-typed properties (multi-token chains)", async () => {
    const server = startRpcServer((method) => {
      if (method === "system_properties") {
        return { tokenDecimals: [12, 10], tokenSymbol: ["ACA", "AUSD"], ss58Format: 10 };
      }
      return new Error("Method not found");
    });
    try {
      const { stdout, exitCode } = await runCli(
        ["chain", "properties", "polkadot", "--rpc", server.url, "--json"],
        { noDefaultChain: true },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.tokenDecimals).toEqual([12, 10]);
      expect(parsed.tokenSymbol).toEqual(["ACA", "AUSD"]);
      expect(parsed.ss58Format).toBe(10);
    } finally {
      server.stop();
    }
  });

  test("--json handles empty {} properties as nulls", async () => {
    const server = startRpcServer((method) => {
      if (method === "system_properties") return {};
      return new Error("Method not found");
    });
    try {
      const { stdout, exitCode } = await runCli(
        ["chain", "properties", "polkadot", "--rpc", server.url, "--json"],
        { noDefaultChain: true },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({ tokenDecimals: null, tokenSymbol: null, ss58Format: null });
    } finally {
      server.stop();
    }
  });

  test("falls back to chainSpec_v1_properties when system_properties is unavailable", async () => {
    const server = startRpcServer((method) => {
      if (method === "chainSpec_v1_properties") {
        return { tokenDecimals: 12, tokenSymbol: "KSM", ss58Format: 2 };
      }
      return new Error("Method not found");
    });
    try {
      const { stdout, exitCode } = await runCli(
        ["chain", "properties", "polkadot", "--rpc", server.url, "--json"],
        { noDefaultChain: true },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({ tokenDecimals: 12, tokenSymbol: "KSM", ss58Format: 2 });
    } finally {
      server.stop();
    }
  });

  test("human-readable output shows labels", async () => {
    const server = startRpcServer((method) => {
      if (method === "system_properties") {
        return { tokenDecimals: 10, tokenSymbol: "DOT", ss58Format: 0 };
      }
      return new Error("Method not found");
    });
    try {
      const { stdout, exitCode } = await runCli(
        ["chain", "properties", "polkadot", "--rpc", server.url],
        { noDefaultChain: true },
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("token decimals");
      expect(stdout).toContain("DOT");
      expect(stdout).toContain("ss58 format");
    } finally {
      server.stop();
    }
  });
});
