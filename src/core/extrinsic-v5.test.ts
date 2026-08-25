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
  createV5GeneralTxCreator,
  type ExtensionByteValues,
  V5_GENERAL_PREAMBLE,
  v5GeneralCreator,
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

describe("v5GeneralCreator", () => {
  const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const fakeSignature = Uint8Array.from({ length: 64 }, (_, i) => 0xf0 - i);
  // The bare creator (and the wrapped one, when every extension is provided)
  // must never touch the bindings — fail loudly if it does.
  const bindings = new Proxy(
    {},
    {
      get(_, prop) {
        throw new Error(`unexpected bindings access: ${String(prop)}`);
      },
    },
  ) as any;

  function makePayload(
    metadataRaw: Uint8Array,
    extensions: Array<{ id: string; extra: string; additionalSigned: string }>,
    callData: Uint8Array,
  ) {
    return {
      version: 1 as const,
      signer: null,
      callData: hex(callData),
      extensions,
      txExtVersion: null,
      context: {
        metadata: hex(metadataRaw),
        token: null,
        bestBlockHeight: 0,
        bestBlockHash: "0x00",
        genesisHash: "0x00",
      },
    };
  }

  /** Synthetic per-extension encoded values, distinguishable per index. */
  function syntheticExtensions(meta = getPeopleMetadata()) {
    return getSignedExtensions(meta).map((e, i) => ({
      id: e.identifier,
      extra: hex(Uint8Array.from([0x10 + i])),
      additionalSigned: hex(Uint8Array.from([0x80 + i])),
    }));
  }

  test("signs blake2_256 of the implication and injects the signature at the cut", async () => {
    let signedMessage: Uint8Array | undefined;
    const creator = v5GeneralCreator(publicKey, (msg) => {
      signedMessage = msg;
      return fakeSignature;
    });

    const meta = getPeopleMetadata();
    const extensions = getSignedExtensions(meta);
    const callData = Uint8Array.from([0x00, 0x07, 0x04, 0xab]);
    const provided = syntheticExtensions(meta);

    const wire = await creator(
      makePayload(getPeopleMetadataRaw(), provided, callData),
      {},
      bindings,
      false,
    );

    // The signed message is the hash of the implication computed from the
    // provided bytes, cut at VerifyMultiSignature (index 1 on preview-people).
    const cutIndex = extensions.findIndex((e) => e.identifier === "VerifyMultiSignature");
    expect(cutIndex).toBe(1);
    const values = extensions.map((e, i) => ({
      identifier: e.identifier,
      extra: Uint8Array.from([0x10 + i]),
      additionalSigned: Uint8Array.from([0x80 + i]),
    }));
    const expectedPayload = v5SignerPayload(computeV5Implication(0, callData, values, cutIndex));
    expect(signedMessage).toEqual(expectedPayload);

    // Wire layout: compact(len) | 0x45 | 0x00 | extras... | callData, with the
    // VerifyMultiSignature slot replaced by Signed { Sr25519(sig), account }:
    // 0x01 (Signed, resolved by name) 0x01 (Sr25519, resolved by name) sig(64) account(32).
    const expectedSignedValue = Uint8Array.from([0x01, 0x01, ...fakeSignature, ...publicKey]);
    const extras = values.map((v, i) => (i === cutIndex ? expectedSignedValue : v.extra));
    const expected = assembleV5General(0, extras, callData);
    expect(wire).toBe(hex(expected));
  });

  test("mockedSignature substitutes 64 zero bytes without calling sign (fee estimation)", async () => {
    const creator = v5GeneralCreator(publicKey, () => {
      throw new Error("sign must not be called for a mocked signature");
    });
    const callData = Uint8Array.from([0x00, 0x07, 0x04, 0xab]);

    const wire = await creator(
      makePayload(getPeopleMetadataRaw(), syntheticExtensions(), callData),
      {},
      bindings,
      true,
    );

    const expectedSignedValue = Uint8Array.from([0x01, 0x01, ...new Uint8Array(64), ...publicKey]);
    expect(wire).toContain(bytesToHex(expectedSignedValue));
  });

  test("rejects on a chain that cannot carry a v5 signature", async () => {
    const creator = v5GeneralCreator(publicKey, () => fakeSignature);
    await expect(
      creator(
        makePayload(getTestMetadataRaw(), [], Uint8Array.from([0x00, 0x00])),
        {},
        bindings,
        false,
      ),
    ).rejects.toThrow("Cannot sign a v5 General transaction");
  });

  test("fails loudly when an extension we must encode was not provided", async () => {
    const creator = v5GeneralCreator(publicKey, () => fakeSignature);
    const provided = syntheticExtensions().filter((e) => e.id !== "CheckNonce");
    await expect(
      creator(
        makePayload(getPeopleMetadataRaw(), provided, Uint8Array.from([0x00, 0x00])),
        {},
        bindings,
        false,
      ),
    ).rejects.toThrow("Missing CheckNonce signed extension");
  });

  test("rejects a txExtVersion the chain does not authorize", async () => {
    const creator = v5GeneralCreator(publicKey, () => fakeSignature);
    const payload = {
      ...makePayload(getPeopleMetadataRaw(), syntheticExtensions(), Uint8Array.from([0x00, 0x00])),
      txExtVersion: 7,
    };
    await expect(creator(payload, {}, bindings, false)).rejects.toThrow(
      "Only txExtVersion 0 is supported",
    );
  });
});

describe("createV5GeneralTxCreator", () => {
  const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const fakeSignature = Uint8Array.from({ length: 64 }, (_, i) => 0xf0 - i);

  test("the enhancer chain passes fully-provided extensions through untouched", async () => {
    // With every extension pre-seeded, papi's enhancers (nonce, mortality,
    // tip, ...) must all skip — so the wrapped creator needs no bindings and
    // produces the exact bytes of the bare creator.
    const bindings = new Proxy(
      {},
      {
        get(_, prop) {
          throw new Error(`unexpected bindings access: ${String(prop)}`);
        },
      },
    ) as any;
    const meta = getPeopleMetadata();
    const callData = Uint8Array.from([0x00, 0x07, 0x04, 0xab]);
    const extensions = getSignedExtensions(meta).map((e, i) => ({
      id: e.identifier,
      extra: hex(Uint8Array.from([0x10 + i])),
      additionalSigned: hex(Uint8Array.from([0x80 + i])),
    }));
    const payload = {
      version: 1 as const,
      signer: null,
      callData: hex(callData),
      extensions,
      txExtVersion: null,
      context: {
        metadata: hex(getPeopleMetadataRaw()),
        token: null,
        bestBlockHeight: 0,
        bestBlockHash: "0x00",
        genesisHash: "0x00",
      },
    };

    const wrapped = createV5GeneralTxCreator(publicKey, () => fakeSignature);
    const bare = v5GeneralCreator(publicKey, () => fakeSignature);
    expect(await wrapped(payload, {}, bindings, false)).toBe(
      await bare(payload, {}, bindings, false),
    );
    expect(wrapped.publicKey).toBe(publicKey);
  });
});
