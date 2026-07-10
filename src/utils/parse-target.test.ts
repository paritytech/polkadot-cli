import { describe, expect, test } from "bun:test";
import { parseTarget, resolveTargetChain } from "./parse-target.ts";

describe("parseTarget (default, item required)", () => {
  test("2-segment returns pallet and item", () => {
    expect(parseTarget("System.Account")).toEqual({ pallet: "System", item: "Account" });
  });

  test("3-segment returns chain, pallet, and item", () => {
    expect(parseTarget("kusama.System.Account")).toEqual({
      chain: "kusama",
      pallet: "System",
      item: "Account",
    });
  });

  test("1-segment throws", () => {
    expect(() => parseTarget("System")).toThrow(/Expected format/);
  });

  test("4-segment throws", () => {
    expect(() => parseTarget("a.b.c.d")).toThrow(/Expected format/);
  });

  test("3-segment with empty parts throws", () => {
    expect(() => parseTarget(".System.Account")).toThrow(/Expected format/);
    expect(() => parseTarget("kusama..Account")).toThrow(/Expected format/);
    expect(() => parseTarget("kusama.System.")).toThrow(/Expected format/);
  });

  test("2-segment with empty parts throws", () => {
    expect(() => parseTarget(".Account")).toThrow(/Expected format/);
    expect(() => parseTarget("System.")).toThrow(/Expected format/);
  });

  test("3-segment preserves user casing for chain prefix", () => {
    expect(parseTarget("Polkadot.System.Account")).toEqual({
      chain: "Polkadot",
      pallet: "System",
      item: "Account",
    });
  });
});

describe("parseTarget (allowPalletOnly)", () => {
  const knownChains = ["kusama", "westend", "polkadot"];

  test("1-segment returns pallet only", () => {
    expect(parseTarget("System", { allowPalletOnly: true })).toEqual({ pallet: "System" });
  });

  test("2-segment with known chain returns chain + pallet", () => {
    expect(parseTarget("kusama.System", { knownChains, allowPalletOnly: true })).toEqual({
      chain: "kusama",
      pallet: "System",
    });
  });

  test("2-segment with unknown first segment returns pallet + item", () => {
    expect(parseTarget("System.Account", { knownChains, allowPalletOnly: true })).toEqual({
      pallet: "System",
      item: "Account",
    });
  });

  test("2-segment chain match is case-insensitive", () => {
    expect(parseTarget("Kusama.System", { knownChains, allowPalletOnly: true })).toEqual({
      chain: "Kusama",
      pallet: "System",
    });
  });

  test("3-segment returns chain + pallet + item", () => {
    expect(parseTarget("kusama.System.Account", { knownChains, allowPalletOnly: true })).toEqual({
      chain: "kusama",
      pallet: "System",
      item: "Account",
    });
  });

  test("4-segment without a kind segment throws", () => {
    expect(() => parseTarget("a.b.c.d", { allowPalletOnly: true })).toThrow(/Expected format/);
  });

  test("empty 1-segment throws", () => {
    expect(() => parseTarget("", { allowPalletOnly: true })).toThrow(/Expected format/);
  });

  // Forgiving inspect: tolerate a `kind` segment (tx/query/const/events/errors)
  // so the same dot-path that invokes a call also inspects it (#255).
  test("Chain.kind.Pallet.Item strips the kind", () => {
    expect(
      parseTarget("polkadot.tx.System.remark", { knownChains, allowPalletOnly: true }),
    ).toEqual({
      chain: "polkadot",
      pallet: "System",
      item: "remark",
    });
  });

  test("Chain.kind.Pallet strips the kind and degrades to pallet listing", () => {
    expect(parseTarget("polkadot.query.System", { knownChains, allowPalletOnly: true })).toEqual({
      chain: "polkadot",
      pallet: "System",
    });
  });

  test("kind.Pallet.Item (no chain) strips the kind", () => {
    expect(parseTarget("tx.System.remark", { knownChains, allowPalletOnly: true })).toEqual({
      pallet: "System",
      item: "remark",
    });
  });

  test("kind.Pallet (no chain) strips the kind", () => {
    expect(parseTarget("const.System", { knownChains, allowPalletOnly: true })).toEqual({
      pallet: "System",
    });
  });

  test("kind aliases are recognized (events/errors/consts)", () => {
    expect(parseTarget("polkadot.events.Balances", { knownChains, allowPalletOnly: true })).toEqual(
      { chain: "polkadot", pallet: "Balances" },
    );
    expect(parseTarget("errors.Balances", { knownChains, allowPalletOnly: true })).toEqual({
      pallet: "Balances",
    });
    expect(parseTarget("polkadot.consts.System", { knownChains, allowPalletOnly: true })).toEqual({
      chain: "polkadot",
      pallet: "System",
    });
  });

  test("kind matching is case-insensitive", () => {
    expect(
      parseTarget("polkadot.TX.System.remark", { knownChains, allowPalletOnly: true }),
    ).toEqual({ chain: "polkadot", pallet: "System", item: "remark" });
  });

  test("a kind in the wrong position is NOT stripped (Pallet.kind.Item)", () => {
    // "System" is not a known chain, so this stays a 3-segment Chain.Pallet.Item
    // and does not get the kind stripped — genuinely-odd input is preserved.
    expect(parseTarget("System.tx.Account", { knownChains, allowPalletOnly: true })).toEqual({
      chain: "System",
      pallet: "tx",
      item: "Account",
    });
  });

  test("a kind-named pallet without a following segment is treated as the pallet", () => {
    // Bare "tx" has nothing after it, so it is taken as a pallet name to list,
    // not stripped as a kind.
    expect(parseTarget("tx", { knownChains, allowPalletOnly: true })).toEqual({ pallet: "tx" });
  });

  test("still throws on too many segments after stripping the kind", () => {
    expect(() => parseTarget("polkadot.tx.a.b.c", { knownChains, allowPalletOnly: true })).toThrow(
      /Expected format/,
    );
  });
});

describe("resolveTargetChain", () => {
  test("prefix only returns prefix", () => {
    expect(resolveTargetChain({ pallet: "System", chain: "kusama" })).toBe("kusama");
  });

  test("flag only returns flag", () => {
    expect(resolveTargetChain({ pallet: "System" }, "westend")).toBe("westend");
  });

  test("neither returns undefined", () => {
    expect(resolveTargetChain({ pallet: "System" })).toBeUndefined();
  });

  test("both prefix and flag throws", () => {
    expect(() => resolveTargetChain({ pallet: "System", chain: "kusama" }, "westend")).toThrow(
      /Chain specified both as prefix/,
    );
  });
});
