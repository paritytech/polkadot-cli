import { describe, expect, test } from "bun:test";
import { findChainName, resolveChain } from "./store.ts";
import type { Config } from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";

const config: Config = {
  chains: {
    polkadot: { rpc: "wss://rpc.polkadot.io" },
    kusama: { rpc: "wss://kusama-rpc.polkadot.io" },
  },
};

describe("resolveChain", () => {
  test("throws with helpful error when no chain flag is provided", () => {
    expect(() => resolveChain(config, undefined)).toThrow(
      /No chain specified.*--chain.*polkadot, kusama/s,
    );
  });

  test("returns the flagged chain when flag is provided", () => {
    const result = resolveChain(config, "kusama");
    expect(result).toEqual({
      name: "kusama",
      chain: { rpc: "wss://kusama-rpc.polkadot.io" },
    });
  });

  test("throws with descriptive error naming the config root for unknown chain name", () => {
    expect(() => resolveChain(config, "westend")).toThrow(
      /Unknown chain "westend" in .+\. Available chains: polkadot, kusama/,
    );
  });

  test("resolves chain name case-insensitively", () => {
    const result = resolveChain(config, "Polkadot");
    expect(result).toEqual({
      name: "polkadot",
      chain: { rpc: "wss://rpc.polkadot.io" },
    });
  });

  test("resolves chain name with all-caps", () => {
    const result = resolveChain(config, "KUSAMA");
    expect(result).toEqual({
      name: "kusama",
      chain: { rpc: "wss://kusama-rpc.polkadot.io" },
    });
  });
});

describe("findChainName", () => {
  test("returns exact match when casing matches", () => {
    expect(findChainName(config, "polkadot")).toBe("polkadot");
  });

  test("returns config key for case-insensitive match", () => {
    expect(findChainName(config, "Polkadot")).toBe("polkadot");
    expect(findChainName(config, "KUSAMA")).toBe("kusama");
  });

  test("returns undefined for unknown chain", () => {
    expect(findChainName(config, "westend")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadConfig merge logic (inline simulation — the same spread pattern used in loadConfig)
// ---------------------------------------------------------------------------

describe("loadConfig merge behavior", () => {
  function simulateMerge(saved: Config): Config {
    const chains: Record<string, import("./types.ts").ChainConfig> = {};
    for (const [name, defaultConfig] of Object.entries(DEFAULT_CONFIG.chains)) {
      chains[name] = saved.chains[name]
        ? { ...defaultConfig, ...saved.chains[name] }
        : defaultConfig;
    }
    for (const [name, config] of Object.entries(saved.chains)) {
      if (!(name in DEFAULT_CONFIG.chains)) {
        chains[name] = config;
      }
    }
    return { chains };
  }

  test("saved config with only custom chains still includes all built-in chains", () => {
    const saved: Config = {
      chains: { "my-chain": { rpc: "wss://my-chain.example" } },
    };
    const merged = simulateMerge(saved);
    for (const name of Object.keys(DEFAULT_CONFIG.chains)) {
      expect(merged.chains[name]).toBeDefined();
    }
    expect(merged.chains["my-chain"]).toEqual({ rpc: "wss://my-chain.example" });
  });

  test("saved config overrides for built-in chain are preserved", () => {
    const saved: Config = {
      chains: { polkadot: { rpc: "wss://my-custom-rpc.example" } },
    };
    const merged = simulateMerge(saved);
    expect(merged.chains.polkadot!.rpc).toBe("wss://my-custom-rpc.example");
    // Other built-in chains still present
    expect(merged.chains.paseo).toBeDefined();
  });

  test("empty saved chains still gets all built-in chains", () => {
    const saved: Config = { chains: {} };
    const merged = simulateMerge(saved);
    expect(Object.keys(merged.chains)).toEqual(Object.keys(DEFAULT_CONFIG.chains));
  });

  test("merge silently drops legacy defaultChain field on saved config", () => {
    const saved = { defaultChain: "kusama", chains: {} } as unknown as Config;
    const merged = simulateMerge(saved);
    expect("defaultChain" in merged).toBe(false);
  });

  test("saved config with custom RPC for built-in chain preserves default topology", () => {
    const saved: Config = {
      chains: { "polkadot-asset-hub": { rpc: "wss://my-custom-asset-hub.example" } },
    };
    const merged = simulateMerge(saved);
    expect(merged.chains["polkadot-asset-hub"]!.rpc).toBe("wss://my-custom-asset-hub.example");
    expect(merged.chains["polkadot-asset-hub"]!.relay).toBe("polkadot");
    expect(merged.chains["polkadot-asset-hub"]!.parachainId).toBe(1000);
  });

  test("user-added chain with relay and parachainId is preserved", () => {
    const saved: Config = {
      chains: {
        "my-para": { rpc: "wss://my-para.example", relay: "polkadot", parachainId: 2000 },
      },
    };
    const merged = simulateMerge(saved);
    expect(merged.chains["my-para"]).toEqual({
      rpc: "wss://my-para.example",
      relay: "polkadot",
      parachainId: 2000,
    });
  });

  test("all built-in parachains have relay and parachainId in defaults", () => {
    const parachains = [
      ["polkadot-asset-hub", "polkadot", 1000],
      ["polkadot-bridge-hub", "polkadot", 1002],
      ["polkadot-collectives", "polkadot", 1001],
      ["polkadot-coretime", "polkadot", 1005],
      ["polkadot-people", "polkadot", 1004],
      ["paseo-asset-hub", "paseo", 1000],
      ["paseo-people", "paseo", 1004],
    ] as const;
    for (const [name, relay, parachainId] of parachains) {
      const chain = DEFAULT_CONFIG.chains[name];
      expect(chain).toBeDefined();
      expect(chain!.relay).toBe(relay);
      expect(chain!.parachainId).toBe(parachainId);
    }
  });

  test("relay chains have no relay or parachainId in defaults", () => {
    expect(DEFAULT_CONFIG.chains.polkadot!.relay).toBeUndefined();
    expect(DEFAULT_CONFIG.chains.polkadot!.parachainId).toBeUndefined();
    expect(DEFAULT_CONFIG.chains.paseo!.relay).toBeUndefined();
    expect(DEFAULT_CONFIG.chains.paseo!.parachainId).toBeUndefined();
  });

  test("user override of topology on built-in parachain takes precedence", () => {
    const saved: Config = {
      chains: {
        "polkadot-asset-hub": {
          rpc: "wss://custom.example",
          relay: "custom-relay",
          parachainId: 9999,
        },
      },
    };
    const merged = simulateMerge(saved);
    expect(merged.chains["polkadot-asset-hub"]!.relay).toBe("custom-relay");
    expect(merged.chains["polkadot-asset-hub"]!.parachainId).toBe(9999);
    expect(merged.chains["polkadot-asset-hub"]!.rpc).toBe("wss://custom.example");
  });
});

// DOT_HOME env var behavior is exercised end-to-end by every subprocess
// test via the runCli fixture (src/commands/__fixtures__/run-cli.ts), which
// sets DOT_HOME to a per-test tmpdir. In-process mutation of
// process.env.DOT_HOME races against other tests under `bun test
// --concurrent` (other tests in the suite read DOT_HOME via getConfigDir
// from real production code paths), so we verify the behavior via
// subprocess tests rather than in-process env mutation.
//
// A dedicated subprocess-based DOT_HOME test lives in
// src/config/dot-home.test.ts.
