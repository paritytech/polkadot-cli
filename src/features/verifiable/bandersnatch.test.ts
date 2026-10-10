import { describe, expect, test } from "bun:test";
import { DEV_PHRASE, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import {
  derivationIndex32,
  deriveBandersnatchMember,
  deriveLegacyMemberEntropy,
  deriveMemberKey,
  derivePersonEntropy,
  deriveRingVrfEntropyFromRoot,
  hardChainCode,
  PERSON_INDEX,
  PERSONHOOD_PRODUCT_ID,
  parseRawEntropy,
} from "./lib.ts";

// 24-word mnemonic, to prove the tree is rooted at BIP39 entropy of any length.
const MNEMONIC_24 =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

const utf8 = (s: string) => new TextEncoder().encode(s);

function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("RFC-0022 derivation primitives", () => {
  test("hardChainCode SCALE-encodes and zero-pads to 32 bytes", () => {
    // 0x24 = compact(9), then UTF-8 "peopl.dot", then zero padding.
    expect(toHex(hardChainCode("peopl.dot"))).toBe(
      "0x2470656f706c2e646f7400000000000000000000000000000000000000000000",
    );
  });

  test("hardChainCode blake2b-hashes segments whose encoding exceeds 32 bytes", () => {
    // 40 UTF-8 bytes + a 1-byte compact prefix (0xa0) is 41 > 32, so Substrate
    // hashes the SCALE encoding rather than truncating it.
    const cc = hardChainCode("a".repeat(40));
    expect(toHex(cc)).toBe("0x02ac7775ba44703a066694f26190321465637e184af457eefabbdefa677c3d18");
  });

  test("hardChainCode rejects all-digit segments (Substrate encodes those as u64)", () => {
    expect(() => hardChainCode("0")).toThrow(/must not be all digits/);
    expect(() => hardChainCode("42")).toThrow(/must not be all digits/);
    expect(() => hardChainCode("")).toThrow(/must not be empty/);
    // Digits are fine as long as the segment is not entirely numeric.
    expect(hardChainCode("dim2.dot").length).toBe(32);
  });

  test("derivationIndex32 is u32_le ++ blake2b256('product-account-index')[..28]", () => {
    const magic = "12e86013736c5498f050b03cdc16957dff0e422fb92ca77ec3ab168f";
    expect(toHex(derivationIndex32(0))).toBe(`0x00000000${magic}`);
    expect(toHex(derivationIndex32(1))).toBe(`0x01000000${magic}`);
    expect(() => derivationIndex32(-1)).toThrow(/u32/);
    expect(() => derivationIndex32(1.5)).toThrow(/u32/);
  });

  test("personhood product id is pinned to .dot on every network", () => {
    // Matches iOS BuiltInProduct.personhood and Android ReservedProductIds.PERSONHOOD.
    // The network axis lives in the ring, not the key — see lib.ts header.
    expect(PERSONHOOD_PRODUCT_ID).toBe("peopl.dot");
    expect(PERSON_INDEX).toEqual({ full: 0, lite: 1 });
  });
});

describe("cross-platform vectors (iOS KeyedHashChainDeriverTests / Android)", () => {
  // Root entropy 0x01..0x20, the fixture published alongside the reference
  // implementations. These pin the whole keyed-hash chain; if they drift, this
  // CLI has diverged from the phone apps and every proof it makes is unusable.
  const rootEntropy = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));

  test("full person entropy — //peopl.dot//index_bytes(0)", () => {
    expect(toHex(deriveRingVrfEntropyFromRoot(rootEntropy, PERSONHOOD_PRODUCT_ID, 0))).toBe(
      "0xc47086f94a7f4c05b7afd9f2339d3fea168f3823b5424ba1f7b31043d8ef60af",
    );
  });

  test("lite person entropy — //peopl.dot//index_bytes(1)", () => {
    expect(toHex(deriveRingVrfEntropyFromRoot(rootEntropy, PERSONHOOD_PRODUCT_ID, 1))).toBe(
      "0x8d7f5e1510a7e8d813887e100f5a260ec9de60e68695477b93360ee7e3d16a9f",
    );
  });
});

describe("deriveBandersnatchMember", () => {
  // Regression pins for the dev mnemonic. These depend on verifiablejs
  // `member_from_entropy`, whose output has changed across releases — a failure
  // here after a dependency bump is identity-breaking, not a test to relax.
  test("dev mnemonic full member key is stable", () => {
    expect(toHex(deriveBandersnatchMember(DEV_PHRASE, "full"))).toBe(
      "0x69ef2ed666eb7bfabcf93b4360c59439a03d6de3cccf77a411fcaa7017caf4a3",
    );
  });

  test("dev mnemonic lite member key is stable", () => {
    expect(toHex(deriveBandersnatchMember(DEV_PHRASE, "lite"))).toBe(
      "0x9dc979d9e8d3861c55fc7a0a15b439b5f22b619dd3b2e76a62a78156b79273ea",
    );
  });

  test("dev mnemonic member entropies are stable", () => {
    expect(toHex(derivePersonEntropy(DEV_PHRASE, "full"))).toBe(
      "0xd84a29dce4179ef9eda1a9c189a9a2fd1bb4d2a3eb048b37d48264180af3b38b",
    );
    expect(toHex(derivePersonEntropy(DEV_PHRASE, "lite"))).toBe(
      "0x0c1166e7047bf0cbe529949e50685b2a7a636a40087cedad1dea28c431c67a6a",
    );
  });

  test("full and lite are different keys", () => {
    expect(toHex(deriveBandersnatchMember(DEV_PHRASE, "full"))).not.toBe(
      toHex(deriveBandersnatchMember(DEV_PHRASE, "lite")),
    );
  });

  test("different mnemonics produce different keys", () => {
    expect(toHex(deriveBandersnatchMember(DEV_PHRASE, "full"))).not.toBe(
      toHex(deriveBandersnatchMember(MNEMONIC_24, "full")),
    );
  });

  test("24-word mnemonic derives a 32-byte key", () => {
    const key = deriveBandersnatchMember(MNEMONIC_24, "full");
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  test("legacy keyed-hash reproduces the pre-RFC-0022 keys", () => {
    // One hash, no junctions. These are what pre-cutover identities hold on-chain.
    expect(toHex(deriveMemberKey(deriveLegacyMemberEntropy(DEV_PHRASE, utf8("candidate"))))).toBe(
      "0x5f915576987547d3e55bb4129ac8cae1d338f8933073dc74272b4c825f738592",
    );
    expect(toHex(deriveMemberKey(deriveLegacyMemberEntropy(DEV_PHRASE)))).toBe(
      "0xbb6ee099b568f1844d62fc00e6305c2e83aa8da30ce59e664ef39e089204d43c",
    );
  });

  test("legacy with key 'ring-vrf' reaches the tree root but never a member entropy", () => {
    // The legacy scheme can reproduce level 1 of the RFC-0022 tree, because both
    // hash the BIP39 entropy. It cannot reach level 3: the tree feeds each level's
    // output in as the next level's data, and the legacy key only ever varies the key.
    const treeRoot = deriveLegacyMemberEntropy(DEV_PHRASE, utf8("ring-vrf"));
    const full = derivePersonEntropy(DEV_PHRASE, "full");
    expect(toHex(treeRoot)).not.toBe(toHex(full));
    // Proof it really is level 1: rebuilding levels 2 and 3 on top of it lands on `full`.
    expect(toHex(deriveRingVrfEntropyFromRoot(mnemonicToEntropy(DEV_PHRASE), "peopl.dot", 0))).toBe(
      toHex(full),
    );
  });

  test("parseRawEntropy accepts exactly 32 bytes of 0x-hex", () => {
    expect(parseRawEntropy(`0x${"11".repeat(32)}`).length).toBe(32);
    expect(() => parseRawEntropy("0xdead")).toThrow(/exactly 32 bytes/);
    expect(() => parseRawEntropy(`0x${"11".repeat(33)}`)).toThrow(/exactly 32 bytes/);
    // Text input is rejected outright — 32 characters would otherwise pass as bytes.
    expect(() => parseRawEntropy("a".repeat(32))).toThrow(/0x-prefixed/);
  });

  test("a --product override derives a different key than the reserved id", () => {
    expect(toHex(deriveBandersnatchMember(DEV_PHRASE, "full", "peopl.paseo"))).not.toBe(
      toHex(deriveBandersnatchMember(DEV_PHRASE, "full")),
    );
  });
});
