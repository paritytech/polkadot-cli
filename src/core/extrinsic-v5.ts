import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { CommonSignerTxCreator } from "@polkadot-api/signers-common";
import { getSignBytes, withCommonExtensions, withNonce } from "@polkadot-api/signers-common";
import { AccountId, compact as scaleCompact } from "@polkadot-api/substrate-bindings";
import type { TxCreator } from "polkadot-api/tx-creator";
import type { MetadataBundle } from "./metadata.ts";
import { getSignedExtensions, getTransactionExtensionVersion, parseMetadata } from "./metadata.ts";

/**
 * Extrinsic V5 "General" transaction signing.
 *
 * A v5 General transaction has no signature field: authorization moves into a
 * transaction extension — pallet-verify-signature, metadata identifier
 * `VerifyMultiSignature`. A runtime that does not carry that extension has
 * nowhere in a v5 transaction to put a signature (submitting one anyway fails
 * with `UnknownOrigin`), so v5 signing is strictly capability-gated: most live
 * runtimes, including Polkadot and all asset hubs, must keep signing v4.
 *
 * The byte assembly here is pure and papi-free. Only the TxCreator at the
 * bottom adapts it to polkadot-api's tx-creator seam, which hands us the
 * already-encoded extension values and broadcasts whatever bytes we return
 * untouched — papi itself has no v5 transaction builder (papi issue #760).
 */

/** Preamble byte: 0b0100_0000 (General) | extrinsic version 5. */
export const V5_GENERAL_PREAMBLE = 0x45;

// The metadata identifier of pallet-verify-signature's extension is
// "VerifyMultiSignature" while the Rust type is `VerifySignature`; match both
// defensively, like subxt does. Other authorization extensions (AsPerson,
// AuthorizeCall, ...) exist but none carries an account signature — their
// presence neither satisfies nor blocks this capability.
const SIGNATURE_AUTH_IDENTIFIERS = ["VerifyMultiSignature", "VerifySignature"];

export type V5SignedCapability =
  | { ok: true; extensionVersion: number; authIdentifier: string }
  | { ok: false; reason: string };

/**
 * Can this chain accept a *signed* v5 General transaction? True iff the
 * runtime advertises extrinsic version 5 AND the transaction-extension list we
 * would encode contains a `VerifyMultiSignature` extension of the expected
 * shape. Nearly every chain advertises v5; almost none can carry a signature.
 */
export function checkV5SignedCapability(meta: MetadataBundle): V5SignedCapability {
  const advertised = meta.unified.extrinsic.version;
  if (!advertised.includes(5)) {
    return {
      ok: false,
      reason: `the runtime only advertises extrinsic version(s) ${advertised.join(", ")}`,
    };
  }
  const extensionVersion = getTransactionExtensionVersion(meta);
  if (extensionVersion === null || extensionVersion > 0xff) {
    return { ok: false, reason: "the metadata declares no usable transaction-extension version" };
  }
  const extensions = getSignedExtensions(meta, extensionVersion);
  const auth = extensions.filter((e) => SIGNATURE_AUTH_IDENTIFIERS.includes(e.identifier)).at(-1);
  if (!auth) {
    return {
      ok: false,
      reason:
        "the runtime has no VerifyMultiSignature transaction extension, " +
        "so a v5 transaction has nowhere to carry a signature",
    };
  }
  if (!hasSignedDisabledShape(meta, auth.type)) {
    return {
      ok: false,
      reason:
        `the ${auth.identifier} extension does not have the expected ` +
        "Signed { signature, account } / Disabled shape",
    };
  }
  return { ok: true, extensionVersion, authIdentifier: auth.identifier };
}

function resolveEntry(entry: any): any {
  while (entry?.type === "lookupEntry") entry = entry.value;
  return entry;
}

function hasSignedDisabledShape(meta: MetadataBundle, typeId: number): boolean {
  const entry = meta.lookup(typeId);
  if (entry.type !== "enum") return false;
  const variants = entry.value as Record<string, any>;
  if (!("Disabled" in variants) || !("Signed" in variants)) return false;
  const signed = resolveEntry(variants.Signed);
  return signed?.type === "struct" && "signature" in signed.value && "account" in signed.value;
}

export interface ExtensionByteValues {
  identifier: string;
  /** Encoded "extra" — included in the transaction body. */
  extra: Uint8Array;
  /** Encoded implicit ("additionalSigned") — signed but not included. */
  additionalSigned: Uint8Array;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * The "inherited implication" the extension at `cutIndex` signs over:
 * everything the runtime hands it — the extension-version byte, the call data,
 * then the extras of every extension STRICTLY after it in metadata order,
 * then those same extensions' implicits (all extras first, not interleaved).
 * Extensions at or before the cut contribute nothing; disabled extensions
 * after the cut still contribute their bytes.
 */
export function computeV5Implication(
  extensionVersion: number,
  callData: Uint8Array,
  extensions: ExtensionByteValues[],
  cutIndex: number,
): Uint8Array {
  const suffix = extensions.slice(cutIndex + 1);
  return concatBytes([
    Uint8Array.of(extensionVersion),
    callData,
    ...suffix.map((s) => s.extra),
    ...suffix.map((s) => s.additionalSigned),
  ]);
}

/**
 * V5 signer payloads are ALWAYS blake2_256(implication) — the runtime's
 * VerifySignature extension hashes unconditionally, with no v4-style
 * ">256 bytes" rule.
 */
export function v5SignerPayload(implication: Uint8Array): Uint8Array {
  return blake2b(implication, { dkLen: 32 });
}

/**
 * Assemble the wire bytes of a v5 General extrinsic:
 * compact(len) | 0x45 | extension_version | extras (metadata order) | call.
 */
export function assembleV5General(
  extensionVersion: number,
  extras: Uint8Array[],
  callData: Uint8Array,
): Uint8Array {
  const body = concatBytes([
    Uint8Array.of(V5_GENERAL_PREAMBLE),
    Uint8Array.of(extensionVersion),
    ...extras,
    callData,
  ]);
  return concatBytes([scaleCompact.enc(body.length), body]);
}

function encodeSignedAuthValue(
  meta: MetadataBundle,
  typeId: number,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  const entry = meta.lookup(typeId) as any;
  const signed = resolveEntry(entry.value.Signed);
  const sigEntry = resolveEntry(signed.value.signature);
  if (sigEntry?.type !== "enum" || !("Sr25519" in sigEntry.value)) {
    throw new Error(
      "This chain's VerifyMultiSignature extension accepts no Sr25519 signature — " +
        "cannot sign with an sr25519 key.",
    );
  }
  // `Signed` is a struct variant { signature, account } — signature first.
  // Variant indices (Disabled = 0, Signed = 1) and the MultiSignature variant
  // index are resolved by name from metadata, never hardcoded.
  const codec = meta.builder.buildDefinition(typeId);
  return codec.enc({
    type: "Signed",
    value: {
      signature: { type: "Sr25519", value: `0x${bytesToHex(signature)}` },
      account: AccountId().dec(publicKey),
    },
  });
}

/** Mock used when papi asks for a fee-estimation signature (mocked=true). */
const SR25519_MOCK_SIGNATURE = new Uint8Array(64);

const hexBytes = (hex: string): Uint8Array => hexToBytes(hex.startsWith("0x") ? hex.slice(2) : hex);

/**
 * The bare v5 General TxCreator: turns papi's TxPayloadV1 into wire bytes.
 * Every transaction extension of the chosen version must be present in
 * `payload.extensions` (first entry per identifier wins, like papi's own v4
 * creator), except the VerifyMultiSignature slot, whose value is produced
 * here. Exported unwrapped for byte-exact tests — real callers want
 * createV5GeneralTxCreator, which adds papi's extension-filling enhancers.
 */
export function v5GeneralCreator(
  publicKey: Uint8Array,
  sign: (msg: Uint8Array) => Uint8Array | Promise<Uint8Array>,
): TxCreator {
  return async (payload, _opts, _bindings, mockedSignature) => {
    // Decode the metadata papi is operating on (it may be newer than our
    // cache after a runtime upgrade mid-session).
    const meta = parseMetadata(hexBytes(payload.context.metadata));
    const cap = checkV5SignedCapability(meta);
    if (!cap.ok) {
      throw new Error(`Cannot sign a v5 General transaction: ${cap.reason}.`);
    }
    if (payload.txExtVersion != null && payload.txExtVersion !== cap.extensionVersion) {
      throw new Error(
        `Only txExtVersion ${cap.extensionVersion} is supported for v5 General on this chain`,
      );
    }

    const callData = hexBytes(payload.callData);
    const list = getSignedExtensions(meta, cap.extensionVersion);
    const values: ExtensionByteValues[] = list.map(({ identifier }) => {
      if (identifier === cap.authIdentifier) {
        // The signature slot: it contributes nothing to the implication (it
        // sits at the cut) and its wire value is injected below — any
        // caller-provided value is deliberately ignored.
        return { identifier, extra: new Uint8Array(), additionalSigned: new Uint8Array() };
      }
      const provided = payload.extensions.find(({ id }) => id === identifier);
      if (!provided) throw new Error(`Missing ${identifier} signed extension`);
      return {
        identifier,
        extra: hexBytes(provided.extra),
        additionalSigned: hexBytes(provided.additionalSigned),
      };
    });

    const cutIndex = values.findLastIndex((v) => v.identifier === cap.authIdentifier);
    const implication = computeV5Implication(cap.extensionVersion, callData, values, cutIndex);
    const signature = mockedSignature
      ? SR25519_MOCK_SIGNATURE
      : await sign(v5SignerPayload(implication));

    // Two-pass: the payload above was computed with VerifyMultiSignature
    // disabled at the cut (it contributes nothing there); now inject the
    // signature as that extension's value and assemble the wire bytes.
    const extras = values.map((v, i) =>
      i === cutIndex
        ? encodeSignedAuthValue(meta, list[cutIndex]!.type, signature, publicKey)
        : v.extra,
    );
    return `0x${bytesToHex(assembleV5General(cap.extensionVersion, extras, callData))}`;
  };
}

/**
 * A SignerTxCreator producing signed v5 General extrinsics, carrying the
 * signature inside the VerifyMultiSignature extension value.
 *
 * Wrapped in papi's own enhancer chain (nonce, mortality, tip, genesis, ...),
 * so extension filling behaves exactly like the stock v4 creator — only the
 * final byte assembly differs. Honoring `mockedSignature` makes papi's
 * `getEstimatedFees`/`getPaymentInfo` work unchanged on the v5 path.
 */
export function createV5GeneralTxCreator(
  publicKey: Uint8Array,
  sign: (msg: Uint8Array) => Uint8Array | Promise<Uint8Array>,
): CommonSignerTxCreator {
  return Object.assign(
    withNonce(publicKey)(withCommonExtensions(v5GeneralCreator(publicKey, sign))),
    { publicKey, signBytes: getSignBytes(sign) },
  ) as CommonSignerTxCreator;
}
