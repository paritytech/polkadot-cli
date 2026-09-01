import { describe, expect, test } from "bun:test";
import { toHex } from "../../core/hash.ts";
import {
  bandersnatchSign,
  compactEncode,
  DEFAULT_RING_EXPONENT,
  deriveAlias,
  deriveMemberEntropy,
  deriveMemberKey,
  encodeContext,
  encodeMembers,
  isRingExponent,
  resolveEntropyKey,
  ringProve,
  ringRoot,
  verifyBandersnatchSig,
  verifyRingProof,
} from "./lib.ts";

const DEV_PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk";

describe("encodeContext", () => {
  test('"dotns" zero-pads right to 32 bytes (matches bytes32)', () => {
    const ctx = encodeContext("dotns");
    expect(ctx.length).toBe(32);
    expect(toHex(ctx)).toBe(`0x646f746e73${"00".repeat(27)}`);
  });

  test("hex input is decoded and zero-padded", () => {
    expect(toHex(encodeContext("0xdeadbeef"))).toBe(`0xdeadbeef${"00".repeat(28)}`);
  });

  test("rejects input longer than 32 bytes", () => {
    expect(() => encodeContext("a".repeat(33))).toThrow("at most 32 bytes");
  });

  test("rejects odd-length hex", () => {
    expect(() => encodeContext("0xabc")).toThrow("odd number");
  });
});

describe("compactEncode", () => {
  test.each([
    [0, "0x00"],
    [1, "0x04"],
    [63, "0xfc"],
    [64, "0x0101"],
  ])("compact(%i) = %s", (n, expected) => {
    expect(toHex(compactEncode(n as number))).toBe(expected as string);
  });
});

describe("encodeMembers", () => {
  test("encodes Vec<[u8;32]> as compact len + raw concat", () => {
    const a = new Uint8Array(32).fill(0x11);
    const b = new Uint8Array(32).fill(0x22);
    const enc = encodeMembers([a, b]);
    expect(enc.length).toBe(1 + 64); // 1-byte prefix + 2*32
    expect(enc[0]).toBe(0x08); // compact(2) = 2 << 2
    expect(toHex(enc.slice(1, 33))).toBe(`0x${"11".repeat(32)}`);
    expect(toHex(enc.slice(33))).toBe(`0x${"22".repeat(32)}`);
  });

  test("rejects non-32-byte members", () => {
    expect(() => encodeMembers([new Uint8Array(31)])).toThrow("32 bytes");
  });
});

describe("resolveEntropyKey", () => {
  test("empty / undefined → undefined (lite)", () => {
    expect(resolveEntropyKey(undefined)).toBeUndefined();
    expect(resolveEntropyKey("")).toBeUndefined();
  });

  test('"candidate" → UTF-8 bytes', () => {
    expect(toHex(resolveEntropyKey("candidate")!)).toBe("0x63616e646964617465");
  });

  test("0x hex → raw bytes", () => {
    expect(toHex(resolveEntropyKey("0xdead")!)).toBe("0xdead");
  });
});

describe("member entropy derivation", () => {
  test("is deterministic and 32 bytes", () => {
    const e1 = deriveMemberEntropy(DEV_PHRASE);
    const e2 = deriveMemberEntropy(DEV_PHRASE);
    expect(e1.length).toBe(32);
    expect(toHex(e1)).toBe(toHex(e2));
  });

  test("lite (unkeyed) and full (candidate-keyed) differ", () => {
    const lite = deriveMemberEntropy(DEV_PHRASE);
    const full = deriveMemberEntropy(DEV_PHRASE, resolveEntropyKey("candidate"));
    expect(toHex(lite)).not.toBe(toHex(full));
  });

  test("member key is 32 bytes and stable", () => {
    const member = deriveMemberKey(deriveMemberEntropy(DEV_PHRASE));
    expect(member.length).toBe(32);
    expect(toHex(member)).toBe(toHex(deriveMemberKey(deriveMemberEntropy(DEV_PHRASE))));
  });
});

describe("bandersnatch sign / verify", () => {
  test("round-trips and rejects a tampered message", () => {
    const entropy = deriveMemberEntropy(DEV_PHRASE);
    const member = deriveMemberKey(entropy);
    const msg = new TextEncoder().encode("hello");
    const sig = bandersnatchSign(entropy, msg);
    // Pins the verifiablejs wire size (was 96 before 1.x).
    expect(sig.length).toBe(64);
    expect(verifyBandersnatchSig(sig, msg, member)).toBe(true);
    expect(verifyBandersnatchSig(sig, new TextEncoder().encode("world"), member)).toBe(false);
  });
});

describe("ring proof", () => {
  const entropy = deriveMemberEntropy(DEV_PHRASE, resolveEntropyKey("candidate"));
  const member = deriveMemberKey(entropy);
  const members = encodeMembers([member]);
  const context = encodeContext("dotns");
  const message = new TextEncoder().encode("challenge");

  test("verifies locally against members and recovers the alias", () => {
    const { proof, alias } = ringProve(DEFAULT_RING_EXPONENT, entropy, members, context, message);
    // Pins the verifiablejs wire size (was 788 before 1.3.0).
    expect(proof.length).toBe(785);
    expect(toHex(alias)).toBe(toHex(deriveAlias(entropy, context)));
    const recovered = verifyRingProof(DEFAULT_RING_EXPONENT, proof, { members }, context, message);
    expect(toHex(recovered)).toBe(toHex(alias));
  });

  test("verifies against the 288-byte ring root (commitment)", () => {
    const { proof, alias } = ringProve(DEFAULT_RING_EXPONENT, entropy, members, context, message);
    const commitment = ringRoot(DEFAULT_RING_EXPONENT, members);
    // Pins the verifiablejs wire size (was 768 before 1.6.0 / verifiable 0.3.0).
    expect(commitment.length).toBe(288);
    const recovered = verifyRingProof(
      DEFAULT_RING_EXPONENT,
      proof,
      { commitment },
      context,
      message,
    );
    expect(toHex(recovered)).toBe(toHex(alias));
  });

  test("alias is stable across proofs; proof bytes are not pinned", () => {
    const p1 = ringProve(DEFAULT_RING_EXPONENT, entropy, members, context, message);
    const p2 = ringProve(DEFAULT_RING_EXPONENT, entropy, members, context, message);
    expect(toHex(p1.alias)).toBe(toHex(p2.alias));
  });
});

describe("isRingExponent", () => {
  test("accepts 9/10/14, rejects others", () => {
    expect(isRingExponent(9)).toBe(true);
    expect(isRingExponent(14)).toBe(true);
    expect(isRingExponent(8)).toBe(false);
    expect(isRingExponent(0)).toBe(false);
  });
});
