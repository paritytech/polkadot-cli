import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  getPeopleMetadata,
  getPeopleMetadataRaw,
  getTestMetadata,
  getTestMetadataRaw,
  getTestMetadataV16,
} from "../commands/__fixtures__/load-metadata.ts";
import {
  assembleV5General,
  checkV5SignedCapability,
  computeV5Implication,
  createV5GeneralSigner,
  type ExtensionByteValues,
  V5_GENERAL_PREAMBLE,
  v5SignerPayload,
} from "./extrinsic-v5.ts";
import { getSignedExtensions } from "./metadata.ts";

const hex = (bytes: Uint8Array) => `0x${bytesToHex(bytes)}`;

const ext = (identifier: string, extra: number[], additionalSigned: number[]) =>
  ({
    identifier,
    extra: Uint8Array.from(extra),
    additionalSigned: Uint8Array.from(additionalSigned),
  }) satisfies ExtensionByteValues;

describe("computeV5Implication", () => {
  const callData = Uint8Array.from([0x00, 0x01, 0xaa, 0xbb]);

  test("extension-version byte leads, then call data", () => {
    const implication = computeV5Implication(7, callData, [], -1);
    expect(implication).toEqual(Uint8Array.from([7, 0x00, 0x01, 0xaa, 0xbb]));
  });

  test("extensions at or before the cut contribute nothing", () => {
    const extensions = [
      ext("Before", [0x11], [0x22]),
      ext("VerifyMultiSignature", [0x33], [0x44]),
      ext("After", [0x55], [0x66]),
    ];
    const implication = computeV5Implication(0, callData, extensions, 1);
    // no 0x11/0x22 (before) and no 0x33/0x44 (the cut itself)
    expect(implication).toEqual(Uint8Array.from([0, 0x00, 0x01, 0xaa, 0xbb, 0x55, 0x66]));
  });

  test("all extras precede all implicits — never interleaved", () => {
    const extensions = [ext("Auth", [], []), ext("A", [0x01], [0x0a]), ext("B", [0x02], [0x0b])];
    const implication = computeV5Implication(0, callData, extensions, 0);
    expect(implication).toEqual(
      Uint8Array.from([0, 0x00, 0x01, 0xaa, 0xbb, 0x01, 0x02, 0x0a, 0x0b]),
    );
  });

  test("disabled extensions after the cut still contribute their bytes", () => {
    const extensions = [
      ext("Auth", [], []),
      // a disabled enum-typed extension still encodes as 0x00
      ext("OtherAuthDisabled", [0x00], []),
    ];
    const implication = computeV5Implication(0, callData, extensions, 0);
    expect(implication).toEqual(Uint8Array.from([0, 0x00, 0x01, 0xaa, 0xbb, 0x00]));
  });
});

describe("v5SignerPayload", () => {
  test("always hashes, even payloads far below v4's 256-byte rule", () => {
    // pinned blake2b-256 of [0x00, 0x00, 0x01, 0xaa, 0xbb, 0xcc, 0xdd]
    const implication = Uint8Array.from([0x00, 0x00, 0x01, 0xaa, 0xbb, 0xcc, 0xdd]);
    const payload = v5SignerPayload(implication);
    expect(payload.length).toBe(32);
    expect(hex(payload)).toBe("0xa73a2803482d48e7dca8c820e9f563c40b0f3042af21de39b8cddd0df90dcc54");
  });
});

describe("assembleV5General", () => {
  test("wire layout: compact(len) | 0x45 | ext_version | extras | call", () => {
    const wire = assembleV5General(
      0,
      [Uint8Array.from([0x11]), Uint8Array.from([0x22, 0x33])],
      Uint8Array.from([0x00, 0x01]),
    );
    // body = 0x45 00 11 22 33 00 01 (7 bytes) -> compact(7) = 0x1c
    expect(wire).toEqual(Uint8Array.from([0x1c, 0x45, 0x00, 0x11, 0x22, 0x33, 0x00, 0x01]));
    expect(wire[1]).toBe(V5_GENERAL_PREAMBLE);
  });
});

describe("checkV5SignedCapability", () => {
  test("polkadot (v15 metadata) cannot sign v5", () => {
    const cap = checkV5SignedCapability(getTestMetadata());
    expect(cap.ok).toBe(false);
  });

  test("polkadot (v16 metadata) advertises v5 but has no signature extension", () => {
    const cap = checkV5SignedCapability(getTestMetadataV16());
    expect(cap.ok).toBe(false);
    if (!cap.ok) {
      // AuthorizeCall (present on polkadot) must NOT satisfy the predicate
      expect(cap.reason).toContain("no VerifyMultiSignature");
    }
  });

  test("preview-people can sign v5", () => {
    const cap = checkV5SignedCapability(getPeopleMetadata());
    expect(cap).toEqual({
      ok: true,
      extensionVersion: 0,
      authIdentifier: "VerifyMultiSignature",
    });
  });
});

describe("createV5GeneralSigner", () => {
  const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const fakeSignature = Uint8Array.from({ length: 64 }, (_, i) => 0xf0 - i);

  /** Synthetic per-extension encoded values, distinguishable per index. */
  function syntheticExtensions(meta = getPeopleMetadata()) {
    const record: Record<
      string,
      { identifier: string; value: Uint8Array; additionalSigned: Uint8Array }
    > = {};
    for (const [i, e] of getSignedExtensions(meta).entries()) {
      record[e.identifier] = {
        identifier: e.identifier,
        value: Uint8Array.from([0x10 + i]),
        additionalSigned: Uint8Array.from([0x80 + i]),
      };
    }
    return record;
  }

  test("signs blake2_256 of the implication and injects the signature at the cut", async () => {
    let signedMessage: Uint8Array | undefined;
    const signer = createV5GeneralSigner(publicKey, (msg) => {
      signedMessage = msg;
      return fakeSignature;
    });

    const meta = getPeopleMetadata();
    const extensions = getSignedExtensions(meta);
    const callData = Uint8Array.from([0x00, 0x07, 0x04, 0xab]);
    const provided = syntheticExtensions(meta);

    const wire = await signer.signTx(callData, provided, getPeopleMetadataRaw(), 0);

    // The signed message is the hash of the implication computed from the
    // provided bytes, cut at VerifyMultiSignature (index 1 on preview-people).
    const cutIndex = extensions.findIndex((e) => e.identifier === "VerifyMultiSignature");
    expect(cutIndex).toBe(1);
    const values = extensions.map((e) => ({
      identifier: e.identifier,
      extra: provided[e.identifier]!.value,
      additionalSigned: provided[e.identifier]!.additionalSigned,
    }));
    const expectedPayload = v5SignerPayload(computeV5Implication(0, callData, values, cutIndex));
    expect(signedMessage).toEqual(expectedPayload);

    // Wire layout: compact(len) | 0x45 | 0x00 | extras... | callData, with the
    // VerifyMultiSignature slot replaced by Signed { Sr25519(sig), account }:
    // 0x01 (Signed, resolved by name) 0x01 (Sr25519, resolved by name) sig(64) account(32).
    const expectedSignedValue = Uint8Array.from([0x01, 0x01, ...fakeSignature, ...publicKey]);
    const extras = values.map((v, i) => (i === cutIndex ? expectedSignedValue : v.extra));
    const expected = assembleV5General(0, extras, callData);
    expect(hex(wire)).toBe(hex(expected));
  });

  test("rejects on a chain that cannot carry a v5 signature", async () => {
    const signer = createV5GeneralSigner(publicKey, () => fakeSignature);
    await expect(
      signer.signTx(Uint8Array.from([0x00, 0x00]), {}, getTestMetadataRaw(), 0),
    ).rejects.toThrow("Cannot sign a v5 General transaction");
  });

  test("fails loudly when papi did not provide an extension we must encode", async () => {
    const signer = createV5GeneralSigner(publicKey, () => fakeSignature);
    const provided = syntheticExtensions();
    delete provided.CheckNonce;
    await expect(
      signer.signTx(Uint8Array.from([0x00, 0x00]), provided, getPeopleMetadataRaw(), 0),
    ).rejects.toThrow("Missing CheckNonce signed extension");
  });
});
