import { describe, expect, test } from "bun:test";
import { BUILTIN_CHAIN_NAMES, DEFAULT_CONFIG, primaryRpc } from "./types.ts";

describe("primaryRpc", () => {
  test("returns the string itself when given a string", () => {
    expect(primaryRpc("wss://rpc.polkadot.io")).toBe("wss://rpc.polkadot.io");
  });

  test("returns first element when given an array", () => {
    expect(primaryRpc(["wss://a", "wss://b", "wss://c"])).toBe("wss://a");
  });

  test("returns single element from single-element array", () => {
    expect(primaryRpc(["wss://only"])).toBe("wss://only");
  });

  test("returns empty string when given empty string", () => {
    expect(primaryRpc("")).toBe("");
  });
});

describe("ChainConfig", () => {
  test("no built-in chain has a lightClient field", () => {
    for (const [_name, config] of Object.entries(DEFAULT_CONFIG.chains)) {
      expect(config).not.toHaveProperty("lightClient");
    }
  });
});

describe("DEFAULT_CONFIG", () => {
  test("built-in chains use array rpc", () => {
    for (const [_name, config] of Object.entries(DEFAULT_CONFIG.chains)) {
      expect(Array.isArray(config.rpc)).toBe(true);
      expect((config.rpc as string[]).length).toBeGreaterThanOrEqual(1);
    }
  });

  test("polkadot has multiple RPC endpoints", () => {
    const rpcs = DEFAULT_CONFIG.chains.polkadot!.rpc;
    expect(Array.isArray(rpcs)).toBe(true);
    expect((rpcs as string[]).length).toBeGreaterThanOrEqual(2);
  });

  test("primaryRpc works with DEFAULT_CONFIG chains", () => {
    const primary = primaryRpc(DEFAULT_CONFIG.chains.polkadot!.rpc);
    expect(primary).toBe("wss://polkadot-rpc.n.dwellir.com");
  });

  test("BUILTIN_CHAIN_NAMES matches DEFAULT_CONFIG keys", () => {
    const configKeys = new Set(Object.keys(DEFAULT_CONFIG.chains));
    expect(BUILTIN_CHAIN_NAMES).toEqual(configKeys);
  });

  test("includes all Polkadot system parachains", () => {
    const expected = [
      "polkadot",
      "polkadot-asset-hub",
      "polkadot-bridge-hub",
      "polkadot-collectives",
      "polkadot-coretime",
      "polkadot-people",
      "polkadot-bulletin",
    ];
    for (const name of expected) {
      expect(BUILTIN_CHAIN_NAMES.has(name)).toBe(true);
    }
  });

  // Paseo only runs Asset Hub (1000), People (1004) and Bulletin (1010) as
  // system parachains; collectives/bridge-hub/coretime are not registered on
  // the relay.
  test("includes all Paseo system parachains", () => {
    const expected = ["paseo", "paseo-asset-hub", "paseo-people", "paseo-bulletin"];
    for (const name of expected) {
      expect(BUILTIN_CHAIN_NAMES.has(name)).toBe(true);
    }
  });

  test("all RPC URLs use wss:// protocol", () => {
    for (const [_name, config] of Object.entries(DEFAULT_CONFIG.chains)) {
      const rpcs = Array.isArray(config.rpc) ? config.rpc : [config.rpc];
      for (const url of rpcs) {
        expect(url).toMatch(/^wss:\/\//);
      }
    }
  });

  test("every chain has at least 2 RPC endpoints", () => {
    for (const [_name, config] of Object.entries(DEFAULT_CONFIG.chains)) {
      expect((config.rpc as string[]).length).toBeGreaterThanOrEqual(2);
    }
  });

  // IBP (ibp.network / dotters.network) was the primary for both relays until
  // its DNS was decommissioned; Dwellir is the replacement primary.
  test("relay chains use an independent provider as primary endpoint", () => {
    expect(primaryRpc(DEFAULT_CONFIG.chains.polkadot!.rpc)).toContain("dwellir.com");
    expect(primaryRpc(DEFAULT_CONFIG.chains.paseo!.rpc)).toContain("dwellir.com");
  });

  test("polkadot relay keeps rpc.polkadot.io as last fallback", () => {
    const rpcs = DEFAULT_CONFIG.chains.polkadot!.rpc as string[];
    expect(rpcs[rpcs.length - 1]).toBe("wss://rpc.polkadot.io");
  });
});
