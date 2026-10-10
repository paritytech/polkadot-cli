import { blake2b } from "@noble/hashes/blake2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import {
  alias_in_context,
  encode_members,
  member_from_entropy,
  members_root,
  one_shot,
  sign,
  validate,
  validate_with_commitment,
  verify_signature,
} from "verifiablejs/nodejs";

/**
 * Bandersnatch / ring-VRF primitives over `verifiablejs`.
 *
 * Member keys follow RFC-0022 (truAPI "Account key derivations"): a keyed-hash
 * HDKD tree, rooted at the BIP39 entropy, with **hard junctions only**.
 *
 *   mnemonic ─BIP39─▶ entropy ─┬─ blake2b(key "ring-vrf")        = tree root
 *                              ├─ blake2b(key cc("//peopl.dot")) = product node
 *                              └─ blake2b(key index_bytes(0|1))  = member entropy
 *                                                    │
 *                                                    ▼
 *                                     one_shot(…, context, message)
 *                                              └─ context = 32-byte ring/proof
 *                                                 namespace (e.g. "dotns")
 *
 * - `index_bytes(0)` is the **full** person key (ring `pop:polkadot.network/people`);
 *   `index_bytes(1)` is the **lite** person key (`…/people-lite`). They are two
 *   simultaneously-held keys, not a rotation.
 * - The product id is `peopl.dot` on **every** network. It is a governance-reserved
 *   dotNS constant, not a registered name, and the reference apps hardcode it (the
 *   Android `ProductId` regex cannot even express a non-`.dot` TLD). The network
 *   axis for personhood lives in the ring — `chainId` + collection id — not in the
 *   key. See {@link PERSONHOOD_PRODUCT_ID}.
 * - The 32-byte ring **context** is a different thing entirely: it is named
 *   `context` across the whole stack (runtime `type Context = [u8;32]`, iOS
 *   `deriveAlias(context:)`, verifiablejs `one_shot(…, context, …)`) and is the
 *   app/namespace identifier the alias is bound to. It is NOT part of the key
 *   derivation. Do not conflate the two.
 *
 * This is the default scheme, but not the only one the CLI can produce. See
 * {@link deriveLegacyMemberEntropy} for the pre-RFC-0022 single keyed hash, which
 * identities registered before the cutover still hold on-chain, and
 * {@link parseRawEntropy} for using a secret from any other implementation
 * verbatim. Every command names the scheme it used in its output, because a key
 * from the wrong tier is indistinguishable until it fails to validate.
 */

/** On-chain `RingExponent` discriminants (verifiablejs `RingExponent`). Capacity = 2^x − 257. */
const RING_EXPONENTS = [9, 10, 14] as const;
export type RingExponent = (typeof RING_EXPONENTS)[number];
/** R2e9 — capacity 255, smallest/fastest; the People ring exponent on nextv2. */
export const DEFAULT_RING_EXPONENT: RingExponent = 9;

export function isRingExponent(n: number): n is RingExponent {
  return (RING_EXPONENTS as readonly number[]).includes(n);
}

/** Decode a text-or-`0x`-hex flag value to bytes. `label` names the flag in errors. */
function textOrHexBytes(value: string, label: string): Uint8Array {
  if (value.startsWith("0x")) {
    const hex = value.slice(2);
    if (hex.length % 2 !== 0) {
      throw new Error(`Invalid hex ${label}: odd number of characters`);
    }
    return hexToBytes(hex);
  }
  return new TextEncoder().encode(value);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * RFC-0022 governance-reserved dotNS product id for personhood ring-VRF keys.
 *
 * Pinned to `.dot` on every network, matching iOS `BuiltInProduct.personhood` and
 * Android `ReservedProductIds.PERSONHOOD`. Overridable via `--product` only as an
 * escape hatch for clients that deliberately diverge.
 */
export const PERSONHOOD_PRODUCT_ID = "peopl.dot";

/** Root key of the ring-VRF keyed-hash tree (RFC-0022). */
const RING_VRF_ROOT_KEY = utf8("ring-vrf");

/** `blake2b256("product-account-index")[..28]` — separates plain-index space from raw indices. */
const INDEX_MAGIC = blake2b(utf8("product-account-index"), { dkLen: 32 }).slice(0, 28);

/** Which personhood key: `full` = ring `…/people`, `lite` = ring `…/people-lite`. */
export type PersonKind = "full" | "lite";

/** RFC-0022 index allocations within the personhood product's own index space. */
export const PERSON_INDEX: Record<PersonKind, number> = { full: 0, lite: 1 };

export function isPersonKind(value: string): value is PersonKind {
  return value === "full" || value === "lite";
}

/**
 * Expand a plain index to a 32-byte RFC-0022 derivation index:
 * `u32_le(index) ++ blake2b256("product-account-index")[..28]`.
 */
export function derivationIndex32(index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new Error(`derivation index must be a u32 (got ${index})`);
  }
  const out = new Uint8Array(32);
  new DataView(out.buffer).setUint32(0, index, true);
  out.set(INDEX_MAGIC, 4);
  return out;
}

/**
 * Chain code for a hard string junction, matching Substrate's `DeriveJunction`:
 * SCALE-encode the string (compact length prefix + UTF-8), then zero-pad to 32
 * bytes — or blake2b-256 the encoding if it exceeds 32 bytes.
 *
 * Rejects all-digit segments: Substrate encodes those as `u64` rather than as a
 * string, so a numeric product id would silently derive a different key. RFC-0022
 * itself never produces one — product ids are dotNS names (the reference apps'
 * `ProductId` pattern requires letters) — so an all-digit segment is always a
 * caller mistake, not a valid path.
 */
export function hardChainCode(segment: string): Uint8Array {
  if (segment.length === 0) {
    throw new Error("derivation segment must not be empty");
  }
  if (/^\d+$/.test(segment)) {
    throw new Error(
      `Product id "${segment}" must not be all digits: Substrate SCALE-encodes numeric ` +
        `junctions as u64, which derives a different key than the string form.`,
    );
  }
  const bytes = utf8(segment);
  const prefix = compact.enc(bytes.length);
  const encoded = new Uint8Array(prefix.length + bytes.length);
  encoded.set(prefix, 0);
  encoded.set(bytes, prefix.length);
  if (encoded.length > 32) {
    return blake2b(encoded, { dkLen: 32 });
  }
  const out = new Uint8Array(32);
  out.set(encoded, 0);
  return out;
}

const keyedHash = (data: Uint8Array, key: Uint8Array) => blake2b(data, { dkLen: 32, key });

/**
 * Derive the 32-byte ring-VRF member entropy for `//{productId}//{index}` from a
 * raw 32-byte root entropy (RFC-0022). Mirrors iOS `RingVrfEntropyDeriver` and
 * Android `deriveKeyedEntropy` exactly, so the published cross-platform test
 * vectors pin this function directly.
 */
export function deriveRingVrfEntropyFromRoot(
  rootEntropy: Uint8Array,
  productId: string,
  index: number,
): Uint8Array {
  const treeRoot = keyedHash(rootEntropy, RING_VRF_ROOT_KEY);
  const product = keyedHash(treeRoot, hardChainCode(productId));
  return keyedHash(product, derivationIndex32(index));
}

/**
 * Derive the 32-byte Bandersnatch member entropy for `//{productId}//{index}` in
 * the ring-VRF keyed-hash tree (RFC-0022). This is the long-term member *secret*
 * — it signs, proves, and produces aliases, so an incorrect derivation yields
 * output no ring will accept.
 *
 * The tree is rooted at the BIP39 **entropy**, not the 64-byte seed and not the
 * sr25519 mini-secret — which is why a hex-seed account cannot produce one.
 */
export function deriveRingVrfEntropy(
  mnemonic: string,
  productId: string,
  index: number,
): Uint8Array {
  return deriveRingVrfEntropyFromRoot(mnemonicToEntropy(mnemonic), productId, index);
}

/** 32-byte Bandersnatch member public key from member entropy. */
export function deriveMemberKey(entropy: Uint8Array): Uint8Array {
  return member_from_entropy(entropy);
}

/**
 * Resolve a legacy `--entropy-key` flag value to the raw keyed-blake2b key bytes.
 * `0x`-prefixed input is hex; anything else is UTF-8 (matching iOS's old
 * `Data("candidate".utf8)`). Empty / undefined → unkeyed.
 */
export function resolveEntropyKey(value: string | undefined): Uint8Array | undefined {
  if (value === undefined || value === "") return undefined;
  return textOrHexBytes(value, "entropy-key");
}

/**
 * Pre-RFC-0022 member entropy: a **single** keyed blake2b over the BIP39 entropy,
 * with no junctions and no tree — `blake2b256(bip39Entropy, key = entropyKey?)`.
 * Keyed with `"candidate"` it was a full person, unkeyed a lite person.
 *
 * Retained because the reference apps cut over to {@link deriveRingVrfEntropy}
 * without migrating existing installs: identities registered before the switch
 * still hold these keys on-chain until `migrate_included_key` moves them, and
 * reproducing one is exactly what this CLI is for. It is not how new keys should
 * be derived.
 *
 * Note this can reproduce only the *first* level of the RFC-0022 tree — passing
 * `"ring-vrf"` yields the tree root — and can never reach a member entropy,
 * because the tree hashes each level's output as the next level's data while
 * this always hashes the BIP39 entropy.
 */
export function deriveLegacyMemberEntropy(mnemonic: string, entropyKey?: Uint8Array): Uint8Array {
  const entropy = mnemonicToEntropy(mnemonic);
  const opts: { dkLen: number; key?: Uint8Array } = { dkLen: 32 };
  if (entropyKey !== undefined && entropyKey.length > 0) {
    opts.key = entropyKey;
  }
  return blake2b(entropy, opts);
}

/**
 * Validate a raw 32-byte member entropy supplied directly by the caller
 * (`--entropy`), bypassing derivation entirely. Lets the tool sign, alias, and
 * prove for a secret produced by any other implementation — including the
 * unhashed `member_from_entropy(bip39Entropy)` form — without an account.
 */
export function parseRawEntropy(value: string): Uint8Array {
  if (!value.startsWith("0x")) {
    throw new Error("raw entropy must be 0x-prefixed hex (64 hex chars)");
  }
  const bytes = textOrHexBytes(value, "entropy");
  if (bytes.length !== 32) {
    throw new Error(`raw entropy must be exactly 32 bytes (got ${bytes.length})`);
  }
  return bytes;
}

/**
 * Derive the member entropy for a personhood key — {@link deriveRingVrfEntropy}
 * with the RFC-0022 index allocation for `full` / `lite`.
 */
export function derivePersonEntropy(
  mnemonic: string,
  person: PersonKind,
  productId: string = PERSONHOOD_PRODUCT_ID,
): Uint8Array {
  return deriveRingVrfEntropy(mnemonic, productId, PERSON_INDEX[person]);
}

/** Personhood member public key — {@link derivePersonEntropy} → {@link deriveMemberKey}. */
export function deriveBandersnatchMember(
  mnemonic: string,
  person: PersonKind,
  productId: string = PERSONHOOD_PRODUCT_ID,
): Uint8Array {
  return deriveMemberKey(derivePersonEntropy(mnemonic, person, productId));
}

/** 32-byte alias for a member entropy under a given 32-byte ring context. */
export function deriveAlias(entropy: Uint8Array, context: Uint8Array): Uint8Array {
  return alias_in_context(entropy, context);
}

/** Standalone Bandersnatch signature (64 bytes) over `message`. */
export function bandersnatchSign(entropy: Uint8Array, message: Uint8Array): Uint8Array {
  return sign(entropy, message);
}

/** Verify a standalone Bandersnatch signature against a member public key. */
export function verifyBandersnatchSig(
  signature: Uint8Array,
  message: Uint8Array,
  member: Uint8Array,
): boolean {
  return verify_signature(signature, message, member);
}

export interface RingProof {
  /** Raw canonical ring-VRF proof bytes (785 on verifiablejs 1.3.0). */
  proof: Uint8Array;
  /** 32-byte alias the proof reveals — deterministic in (entropy, context). */
  alias: Uint8Array;
}

/**
 * Generate a ring-VRF proof (`one_shot`). The proof binds `message`; the alias
 * depends only on (entropy, context). `members` must be the SCALE-encoded
 * `Vec<[u8;32]>` ring (see {@link encodeMembers}). Proof bytes are
 * non-deterministic (randomised nonce); the alias is stable.
 */
export function ringProve(
  ringExp: RingExponent,
  entropy: Uint8Array,
  members: Uint8Array,
  context: Uint8Array,
  message: Uint8Array,
): RingProof {
  const result = one_shot(ringExp, entropy, members, context, message);
  return { proof: result.proof, alias: result.alias };
}

/**
 * Locally verify a ring-VRF proof, returning the recovered 32-byte alias or
 * throwing on failure. Pass either the SCALE-encoded `members` (`validate`) or
 * the 288-byte ring `commitment` / root as stored on chain
 * (`validate_with_commitment` — the recommended pre-flight before submitting).
 */
export function verifyRingProof(
  ringExp: RingExponent,
  proof: Uint8Array,
  source: { members?: Uint8Array; commitment?: Uint8Array },
  context: Uint8Array,
  message: Uint8Array,
): Uint8Array {
  if (source.commitment !== undefined) {
    return validate_with_commitment(ringExp, proof, source.commitment, context, message);
  }
  if (source.members !== undefined) {
    return validate(ringExp, proof, source.members, context, message);
  }
  throw new Error("verifyRingProof requires either `members` or `commitment`");
}

/** Compute the 288-byte ring root (MembersCommitment) from encoded members. */
export function ringRoot(ringExp: RingExponent, members: Uint8Array): Uint8Array {
  return members_root(ringExp, members);
}

/**
 * SCALE-encode `Vec<[u8; 32]>` — the ring members list that `one_shot`,
 * `validate`, and `members_root` decode. Layout: compact length prefix followed
 * by the raw 32-byte member keys concatenated in order (fixed-size arrays carry
 * no per-element prefix). Each member must be exactly 32 bytes.
 *
 * Delegates to verifiablejs `encode_members` (1.6.0+) so the encoding stays the
 * exact inverse of the decoding those functions perform internally.
 */
export function encodeMembers(members: Uint8Array[]): Uint8Array {
  return encode_members(members);
}

/**
 * Encode a ring `--context` value to 32 bytes, zero-padded on the right to match
 * Solidity `bytes32("…")` (NOT space-padded). `0x`-prefixed input is hex,
 * otherwise UTF-8. Rejects inputs longer than 32 bytes.
 */
export function encodeContext(input: string): Uint8Array {
  const bytes = textOrHexBytes(input, "context");
  if (bytes.length > 32) {
    throw new Error(`Context must be at most 32 bytes (got ${bytes.length})`);
  }
  const out = new Uint8Array(32);
  out.set(bytes, 0);
  return out;
}
