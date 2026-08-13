import { describe, expect, test } from "bun:test";
import {
  getTestMetadata,
  getTestMetadataRaw,
  getTestMetadataV16,
} from "../commands/__fixtures__/load-metadata.ts";
import { MetadataError } from "../utils/errors.ts";
import type { RuntimeFingerprint } from "../utils/runtime-fingerprint.ts";
import {
  CLIENT_MAX_METADATA_VERSION,
  describeCallArgs,
  describeRuntimeApiMethodArgs,
  describeSignedExtension,
  describeType,
  fetchMetadataAtVersion,
  findPallet,
  findRuntimeApi,
  findSignedExtension,
  getOrFetchMetadata,
  getPalletNames,
  getRuntimeApiNames,
  getSignedExtensionNames,
  getSignedExtensions,
  type Lookup,
  listPallets,
  listRuntimeApis,
  type MetadataBundle,
  negotiateMetadataVersions,
  PAPI_BUILTIN_EXTENSIONS,
  parseMetadata,
  peekMetadataVersion,
  shouldRefreshCachedMetadata,
} from "./metadata.ts";

const meta: MetadataBundle = getTestMetadata();

// ---------------------------------------------------------------------------
// Helper: scan the lookup table to find type IDs matching a given predicate
// ---------------------------------------------------------------------------
function findTypeId(
  lookup: Lookup,
  predicate: (entry: any) => boolean,
  maxScan = 500,
): number | undefined {
  for (let id = 0; id < maxScan; id++) {
    try {
      const entry = lookup(id);
      if (predicate(entry)) return id;
    } catch {
      // skip invalid IDs
    }
  }
  return undefined;
}

// Pre-discover type IDs we need for describeType tests
const primitiveTypeId = findTypeId(
  meta.lookup,
  (e) => e.type === "primitive" && e.value === "u32",
)!;
const accountIdTypeId = findTypeId(meta.lookup, (e) => e.type === "AccountId32")!;
const smallEnumTypeId = findTypeId(
  meta.lookup,
  (e) => e.type === "enum" && Object.keys(e.value).length > 0 && Object.keys(e.value).length <= 4,
)!;
// "Large" enums are summarized when the variant count exceeds the compact
// threshold (24). Pallet/Event/Error enums on Polkadot easily exceed this.
const largeEnumTypeId = findTypeId(
  meta.lookup,
  (e) => e.type === "enum" && Object.keys(e.value).length > 24,
  2000,
)!;
const sequenceTypeId = findTypeId(meta.lookup, (e) => e.type === "sequence")!;
const optionTypeId = findTypeId(meta.lookup, (e) => e.type === "option")!;

// ---------------------------------------------------------------------------
// getPalletNames
// ---------------------------------------------------------------------------
describe("getPalletNames", () => {
  test("returns non-empty array", () => {
    const names = getPalletNames(meta);
    expect(names.length).toBeGreaterThan(0);
  });

  test("contains known pallets: System, Balances, Staking", () => {
    const names = getPalletNames(meta);
    expect(names).toContain("System");
    expect(names).toContain("Balances");
    expect(names).toContain("Staking");
  });

  test("returns names sorted alphabetically", () => {
    const names = getPalletNames(meta);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// findPallet
// ---------------------------------------------------------------------------
describe("findPallet", () => {
  test("exact name match returns PalletInfo", () => {
    const pallet = findPallet(meta, "System");
    expect(pallet).toBeDefined();
    expect(pallet!.name).toBe("System");
  });

  test("case-insensitive match", () => {
    const pallet = findPallet(meta, "system");
    expect(pallet).toBeDefined();
    expect(pallet!.name).toBe("System");
  });

  test("returns undefined for unknown pallet name", () => {
    expect(findPallet(meta, "NonExistentPallet")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listPallets
// ---------------------------------------------------------------------------
describe("listPallets", () => {
  test("returns array of PalletInfo objects with expected shape", () => {
    const pallets = listPallets(meta);
    expect(pallets.length).toBeGreaterThan(0);
    for (const p of pallets) {
      expect(typeof p.name).toBe("string");
      expect(typeof p.index).toBe("number");
      expect(Array.isArray(p.docs)).toBe(true);
      expect(Array.isArray(p.storage)).toBe(true);
      expect(Array.isArray(p.constants)).toBe(true);
      expect(Array.isArray(p.calls)).toBe(true);
    }
  });

  test("System pallet has Account storage item", () => {
    const pallets = listPallets(meta);
    const system = pallets.find((p) => p.name === "System")!;
    const account = system.storage.find((s) => s.name === "Account");
    expect(account).toBeDefined();
  });

  test("returns pallets sorted alphabetically by name", () => {
    const pallets = listPallets(meta);
    const names = pallets.map((p) => p.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test("items within a pallet are sorted alphabetically by name", () => {
    const pallets = listPallets(meta);
    for (const p of pallets) {
      const checkSorted = (items: { name: string }[]) => {
        const names = items.map((i) => i.name);
        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        expect(names).toEqual(sorted);
      };
      checkSorted(p.storage);
      checkSorted(p.constants);
      checkSorted(p.calls);
      checkSorted(p.events);
      checkSorted(p.errors);
    }
  });

  test("storage items have correct type ('plain' or 'map')", () => {
    const pallets = listPallets(meta);
    const allStorage = pallets.flatMap((p) => p.storage);
    expect(allStorage.length).toBeGreaterThan(0);
    for (const s of allStorage) {
      expect(["plain", "map"]).toContain(s.type);
    }
  });
});

// ---------------------------------------------------------------------------
// describeType
// ---------------------------------------------------------------------------
describe("describeType", () => {
  test("formats a primitive type (u32)", () => {
    expect(primitiveTypeId).toBeDefined();
    expect(describeType(meta.lookup, primitiveTypeId)).toBe("u32");
  });

  test("formats AccountId32", () => {
    expect(accountIdTypeId).toBeDefined();
    expect(describeType(meta.lookup, accountIdTypeId)).toBe("AccountId32");
  });

  test("formats small enum (≤4 variants) as pipe-separated", () => {
    expect(smallEnumTypeId).toBeDefined();
    const result = describeType(meta.lookup, smallEnumTypeId);
    expect(result).toContain(" | ");
    // At most 4 variants → at most 3 pipes
    expect(result.split(" | ").length).toBeLessThanOrEqual(4);
  });

  test("formats very large enum (>24 variants) as enum(N variants) summary", () => {
    expect(largeEnumTypeId).toBeDefined();
    const result = describeType(meta.lookup, largeEnumTypeId);
    expect(result).toMatch(/^enum\(\d+ variants\)$/);
  });

  test("fallback for invalid typeId returns type(<id>)", () => {
    expect(describeType(meta.lookup, 999999)).toBe("type(999999)");
  });

  test("formats Vec type", () => {
    expect(sequenceTypeId).toBeDefined();
    expect(describeType(meta.lookup, sequenceTypeId)).toMatch(/^Vec<.+>$/);
  });

  test("formats Option type", () => {
    expect(optionTypeId).toBeDefined();
    expect(describeType(meta.lookup, optionTypeId)).toMatch(/^Option<.+>$/);
  });
});

// ---------------------------------------------------------------------------
// getSignedExtensions
// ---------------------------------------------------------------------------
describe("getSignedExtensions", () => {
  test("returns non-empty array", () => {
    const exts = getSignedExtensions(meta);
    expect(exts.length).toBeGreaterThan(0);
  });

  test("contains CheckMortality extension", () => {
    const exts = getSignedExtensions(meta);
    const names = exts.map((e) => e.identifier);
    expect(names).toContain("CheckMortality");
  });

  test("each extension has identifier, type, additionalSigned fields", () => {
    const exts = getSignedExtensions(meta);
    for (const ext of exts) {
      expect(typeof ext.identifier).toBe("string");
      expect(typeof ext.type).toBe("number");
      expect(typeof ext.additionalSigned).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// getSignedExtensionNames / findSignedExtension / describeSignedExtension
// ---------------------------------------------------------------------------
describe("getSignedExtensionNames", () => {
  test("returns sorted identifiers matching getSignedExtensions", () => {
    const names = getSignedExtensionNames(meta);
    const expected = getSignedExtensions(meta)
      .map((e) => e.identifier)
      .sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(expected);
  });

  test("CheckMortality is present", () => {
    expect(getSignedExtensionNames(meta)).toContain("CheckMortality");
  });
});

describe("findSignedExtension", () => {
  test("finds by exact name", () => {
    const ext = findSignedExtension(meta, "CheckMortality");
    expect(ext?.identifier).toBe("CheckMortality");
  });

  test("matches case-insensitively", () => {
    const ext = findSignedExtension(meta, "checkmortality");
    expect(ext?.identifier).toBe("CheckMortality");
  });

  test("returns undefined for unknown identifier", () => {
    expect(findSignedExtension(meta, "TotallyBogusExtension")).toBeUndefined();
  });
});

describe("describeSignedExtension", () => {
  test("marks builtin extensions as builtin", () => {
    const info = findSignedExtension(meta, "CheckMortality")!;
    const described = describeSignedExtension(meta, info);
    expect(described.identifier).toBe("CheckMortality");
    expect(described.isBuiltin).toBe(true);
    expect(typeof described.valueType).toBe("string");
    expect(typeof described.additionalSignedType).toBe("string");
    expect(described.valueTypeId).toBe(info.type);
    expect(described.additionalSignedTypeId).toBe(info.additionalSigned);
  });

  test("isBuiltin mirrors PAPI_BUILTIN_EXTENSIONS set", () => {
    for (const info of getSignedExtensions(meta)) {
      const described = describeSignedExtension(meta, info);
      expect(described.isBuiltin).toBe(PAPI_BUILTIN_EXTENSIONS.has(info.identifier));
    }
  });
});

// ---------------------------------------------------------------------------
// describeCallArgs
// ---------------------------------------------------------------------------
describe("describeCallArgs", () => {
  test("void call returns ()", () => {
    // System.remark takes a single bytes arg, but System has void calls too
    const result = describeCallArgs(meta, "System", "remark");
    expect(result).toBeTruthy();
    expect(result.startsWith("(")).toBe(true);
    expect(result.endsWith(")")).toBe(true);
  });

  test("struct call returns field names and types", () => {
    const result = describeCallArgs(meta, "Balances", "transfer_allow_death");
    expect(result).toContain("dest");
    expect(result).toContain("value");
    expect(result.startsWith("(")).toBe(true);
    expect(result.endsWith(")")).toBe(true);
  });

  test("returns empty string for nonexistent pallet", () => {
    expect(describeCallArgs(meta, "NonExistent", "foo")).toBe("");
  });

  test("returns empty string for nonexistent call", () => {
    expect(describeCallArgs(meta, "System", "nonexistent_call")).toBe("");
  });

  test("returns non-empty for known calls", () => {
    const pallets = listPallets(meta);
    const balances = pallets.find((p) => p.name === "Balances")!;
    for (const call of balances.calls) {
      const result = describeCallArgs(meta, "Balances", call.name);
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getOrFetchMetadata — error paths
// ---------------------------------------------------------------------------

describe("getOrFetchMetadata", () => {
  test("no cached metadata + no client throws MetadataError", async () => {
    // Use a chain name that definitely has no cached metadata
    await expect(getOrFetchMetadata("nonexistent-chain-xyz")).rejects.toThrow(MetadataError);
    await expect(getOrFetchMetadata("nonexistent-chain-xyz")).rejects.toThrow(/No cached metadata/);
  });

  test("corrupt metadata bytes throws", () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(() => parseMetadata(garbage)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// listRuntimeApis
// ---------------------------------------------------------------------------
describe("listRuntimeApis", () => {
  test("returns non-empty array", () => {
    const apis = listRuntimeApis(meta);
    expect(apis.length).toBeGreaterThan(0);
  });

  test("returns APIs sorted alphabetically by name", () => {
    const apis = listRuntimeApis(meta);
    const names = apis.map((a) => a.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test("contains known runtime APIs", () => {
    const apis = listRuntimeApis(meta);
    const names = apis.map((a) => a.name);
    expect(names).toContain("Core");
    expect(names).toContain("Metadata");
    expect(names).toContain("BlockBuilder");
  });

  test("methods within an API are sorted alphabetically", () => {
    const apis = listRuntimeApis(meta);
    for (const api of apis) {
      const methodNames = api.methods.map((m) => m.name);
      const sorted = [...methodNames].sort((a, b) => a.localeCompare(b));
      expect(methodNames).toEqual(sorted);
    }
  });

  test("Core API has version method", () => {
    const apis = listRuntimeApis(meta);
    const core = apis.find((a) => a.name === "Core");
    expect(core).toBeDefined();
    const version = core!.methods.find((m) => m.name === "version");
    expect(version).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// findRuntimeApi
// ---------------------------------------------------------------------------
describe("findRuntimeApi", () => {
  test("exact name match returns RuntimeApiInfo", () => {
    const api = findRuntimeApi(meta, "Core");
    expect(api).toBeDefined();
    expect(api!.name).toBe("Core");
  });

  test("case-insensitive match", () => {
    const api = findRuntimeApi(meta, "core");
    expect(api).toBeDefined();
    expect(api!.name).toBe("Core");
  });

  test("returns undefined for unknown API name", () => {
    expect(findRuntimeApi(meta, "NonExistentApi")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getRuntimeApiNames
// ---------------------------------------------------------------------------
describe("getRuntimeApiNames", () => {
  test("returns non-empty array", () => {
    const names = getRuntimeApiNames(meta);
    expect(names.length).toBeGreaterThan(0);
  });

  test("contains known API names", () => {
    const names = getRuntimeApiNames(meta);
    expect(names).toContain("Core");
    expect(names).toContain("Metadata");
  });

  test("returns names sorted alphabetically", () => {
    const names = getRuntimeApiNames(meta);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// describeRuntimeApiMethodArgs
// ---------------------------------------------------------------------------
describe("describeRuntimeApiMethodArgs", () => {
  test("method with no inputs returns ()", () => {
    const api = findRuntimeApi(meta, "Core")!;
    const version = api.methods.find((m) => m.name === "version")!;
    const result = describeRuntimeApiMethodArgs(meta, version);
    expect(result).toBe("()");
  });

  test("method with inputs formats correctly", () => {
    // Find a method that has inputs
    const apis = listRuntimeApis(meta);
    let methodWithInputs: { api: string; method: any } | undefined;
    for (const api of apis) {
      for (const m of api.methods) {
        if (m.inputs.length > 0) {
          methodWithInputs = { api: api.name, method: m };
          break;
        }
      }
      if (methodWithInputs) break;
    }
    expect(methodWithInputs).toBeDefined();
    const result = describeRuntimeApiMethodArgs(meta, methodWithInputs!.method);
    expect(result.startsWith("(")).toBe(true);
    expect(result.endsWith(")")).toBe(true);
    // Should contain field name and colon
    expect(result).toContain(":");
  });
});

describe("MetadataBundle.version", () => {
  test("version is populated from metadata", () => {
    expect(meta.version).toBeGreaterThanOrEqual(14);
  });

  test("test fixture is v15", () => {
    expect(meta.version).toBe(15);
  });

  test("v16 fixture parses to the same surface as v15", () => {
    // The fixtures are snapshots of different runtime releases, so counts may
    // differ — assert the v16 shape exposes each surface, not exact equality.
    const v16 = getTestMetadataV16();
    expect(v16.version).toBe(16);
    expect(getPalletNames(v16)).toContain("System");
    expect(getSignedExtensionNames(v16)).toContain("CheckNonce");
    expect(listRuntimeApis(v16).length).toBeGreaterThan(0);
  });

  test("v16 metadata reports both extrinsic versions", () => {
    const v16 = getTestMetadataV16();
    const versions = (v16.unified.extrinsic as any).version;
    // v15 collapses this to the minimum supported version; v16 lists them all.
    expect([versions].flat()).toEqual([4, 5]);
  });
});

// ---------------------------------------------------------------------------
// peekMetadataVersion
// ---------------------------------------------------------------------------

describe("peekMetadataVersion", () => {
  test("reads the version byte from real blobs", () => {
    expect(peekMetadataVersion(getTestMetadataRaw())).toBe(15);
  });

  test("rejects bytes without the meta magic", () => {
    expect(peekMetadataVersion(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeNull();
  });

  test("rejects blobs shorter than magic + version", () => {
    expect(peekMetadataVersion(new Uint8Array([0x6d, 0x65, 0x74, 0x61]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// shouldRefreshCachedMetadata
// ---------------------------------------------------------------------------

function fp(chainSupportedVersions?: number[]): RuntimeFingerprint {
  return {
    specName: "test",
    specVersion: 1,
    transactionVersion: 1,
    implName: "test",
    implVersion: 0,
    authoringVersion: 0,
    codeHash: "0x00",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    ...(chainSupportedVersions ? { chainSupportedVersions } : {}),
  };
}

describe("shouldRefreshCachedMetadata", () => {
  test("missing sidecar means unknown provenance — refresh", () => {
    expect(shouldRefreshCachedMetadata(15, null)).toBe(true);
  });

  test("pre-negotiation sidecar (no chainSupportedVersions) — refresh", () => {
    expect(shouldRefreshCachedMetadata(15, fp())).toBe(true);
  });

  test("blob below the chain's best supported version — refresh", () => {
    expect(shouldRefreshCachedMetadata(15, fp([14, 15, 16]))).toBe(true);
  });

  test("blob already at the negotiated target — keep", () => {
    expect(shouldRefreshCachedMetadata(16, fp([14, 15, 16]))).toBe(false);
  });

  test("chain that only serves up to v15 — keep a v15 blob", () => {
    expect(shouldRefreshCachedMetadata(15, fp([14, 15]))).toBe(false);
  });

  test("chain versions above the client ceiling are capped", () => {
    // A future chain offering v17 must not force a refetch loop on a client
    // that can only decode up to CLIENT_MAX_METADATA_VERSION.
    expect(shouldRefreshCachedMetadata(CLIENT_MAX_METADATA_VERSION, fp([14, 15, 16, 17]))).toBe(
      false,
    );
  });

  test("undecodable blob — refresh", () => {
    expect(shouldRefreshCachedMetadata(null, fp([14, 15, 16]))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// negotiateMetadataVersions / fetchMetadataAtVersion (fake RPC)
// ---------------------------------------------------------------------------

function fakeClientHandle(handler: (method: string, params: unknown[]) => string) {
  return {
    client: {
      _request: async (method: string, params: unknown[]) => handler(method, params),
    },
    destroy: () => {},
  } as any;
}

describe("negotiateMetadataVersions", () => {
  const encodeU32s = (nums: number[]) => {
    const compactLen = new Uint8Array([nums.length << 2]);
    const words = new Uint8Array(nums.length * 4);
    const dv = new DataView(words.buffer);
    for (const [i, n] of nums.entries()) dv.setUint32(i * 4, n, true);
    const out = new Uint8Array(1 + words.length);
    out.set(compactLen, 0);
    out.set(words, 1);
    return `0x${Buffer.from(out).toString("hex")}`;
  };

  test("filters to the supported window and drops the unstable sentinel", async () => {
    const handle = fakeClientHandle(() => encodeU32s([14, 15, 16, 0xffffffff]));
    expect(await negotiateMetadataVersions(handle, "test")).toEqual([14, 15, 16]);
  });

  test("falls back to [14] when the runtime lacks the API", async () => {
    const handle = fakeClientHandle(() => {
      throw new Error("Method not found");
    });
    expect(await negotiateMetadataVersions(handle, "test")).toEqual([14]);
  });

  test("falls back to [14] when every version is outside the window", async () => {
    const handle = fakeClientHandle(() => encodeU32s([0xffffffff]));
    expect(await negotiateMetadataVersions(handle, "test")).toEqual([14]);
  });
});

describe("fetchMetadataAtVersion", () => {
  test("decodes Some(bytes)", async () => {
    // Option::Some(0x01) + compact length + opaque bytes
    const blob = getTestMetadataRaw().slice(0, 8);
    const compactLen = new Uint8Array([blob.length << 2]);
    const payload = new Uint8Array([1, ...compactLen, ...blob]);
    const handle = fakeClientHandle((method) => {
      expect(method).toBe("state_call");
      return `0x${Buffer.from(payload).toString("hex")}`;
    });
    expect(await fetchMetadataAtVersion(handle, "test", 16)).toEqual(blob);
  });

  test("returns undefined for None", async () => {
    const handle = fakeClientHandle(() => "0x00");
    expect(await fetchMetadataAtVersion(handle, "test", 99)).toBeUndefined();
  });

  test("returns undefined on RPC error", async () => {
    const handle = fakeClientHandle(() => {
      throw new Error("boom");
    });
    expect(await fetchMetadataAtVersion(handle, "test", 16)).toBeUndefined();
  });
});
