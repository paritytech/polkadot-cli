import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Installs spread-based polkadot-api mocks and captures the real
// createChainClient BEFORE this file stubs the whole client.ts module —
// client.test.ts depends on that capture regardless of file order.
import "../core/__fixtures__/papi-mocks.ts";

// ---------------------------------------------------------------------------
// Load fixture metadata and actual metadata functions before mocking.
// We only mock fetchMetadataFromChain and createChainClient — everything
// else (parseMetadata, getOrFetchMetadata, etc.) uses real implementations.
// ---------------------------------------------------------------------------
const FIXTURE_METADATA = new Uint8Array(
  readFileSync(join(import.meta.dir, "__fixtures__/polkadot-metadata.bin")),
);

// Import actual metadata module BEFORE mock.module so we can re-export
// real implementations alongside the mock.
const actualMetadata = await import("../core/metadata.ts");

const mockDestroy = mock(() => {});
const mockCreateChainClient = mock(async () => ({
  client: {} as any,
  destroy: mockDestroy,
}));
const mockFetchMetadataFromChain = mock(async () => FIXTURE_METADATA);

mock.module("../core/client.ts", () => ({
  createChainClient: mockCreateChainClient,
}));

mock.module("../core/metadata.ts", () => ({
  describeCallArgs: actualMetadata.describeCallArgs,
  describeEventFields: actualMetadata.describeEventFields,
  describeRuntimeApiMethodArgs: actualMetadata.describeRuntimeApiMethodArgs,
  describeType: actualMetadata.describeType,
  fetchMetadataFromChain: mockFetchMetadataFromChain,
  findPallet: actualMetadata.findPallet,
  findRuntimeApi: actualMetadata.findRuntimeApi,
  getOrFetchMetadata: actualMetadata.getOrFetchMetadata,
  getPalletNames: actualMetadata.getPalletNames,
  getRuntimeApiNames: actualMetadata.getRuntimeApiNames,
  listPallets: actualMetadata.listPallets,
  listRuntimeApis: actualMetadata.listRuntimeApis,
  parseMetadata: actualMetadata.parseMetadata,
}));

// Import loadMeta AFTER mocks are set up
const { loadMeta } = await import("./focused-inspect.ts");
const { saveMetadata } = await import("../config/store.ts");
const { withDotHome } = await import("../test-helpers/with-dot-home.ts");

// ---------------------------------------------------------------------------
// loadMeta — --rpc override bypasses metadata cache
// ---------------------------------------------------------------------------
describe("loadMeta", () => {
  const chainConfig = { rpc: "wss://default.example.com" };

  test("bypasses cache and fetches fresh metadata when rpcOverride is provided", async () => {
    mockCreateChainClient.mockClear();
    mockFetchMetadataFromChain.mockClear();
    mockDestroy.mockClear();

    const meta = await loadMeta("polkadot", chainConfig, "wss://override.example.com");

    expect(meta).toBeDefined();
    expect(meta.unified).toBeDefined();
    expect(mockCreateChainClient).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateChainClient.mock.calls[0] as unknown as unknown[];
    expect(callArgs[0]).toBe("polkadot");
    expect(callArgs[2]).toBe("wss://override.example.com");
    expect(mockFetchMetadataFromChain).toHaveBeenCalledTimes(1);
  });

  test("destroys client handle after fetching with rpcOverride", async () => {
    mockDestroy.mockClear();

    await loadMeta("polkadot", chainConfig, "wss://override.example.com");

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  test("uses cache when no rpcOverride is provided", async () => {
    // Without rpcOverride, loadMeta calls getOrFetchMetadata(chainName) which
    // reads from the on-disk cache. Seed that cache in an isolated DOT_HOME —
    // relying on another test file to have populated the shared store is a
    // scheduling race under --concurrent (issue #285).
    const tmpHome = realpathSync(mkdtempSync(join(tmpdir(), "dot-load-meta-")));
    try {
      await withDotHome(tmpHome, async () => {
        await saveMetadata("polkadot", FIXTURE_METADATA);
        mockCreateChainClient.mockClear();
        mockFetchMetadataFromChain.mockClear();

        const meta = await loadMeta("polkadot", chainConfig);

        expect(meta).toBeDefined();
        expect(meta.unified).toBeDefined();
        // Cache hit — no client created, no network fetch
        expect(mockCreateChainClient).not.toHaveBeenCalled();
        expect(mockFetchMetadataFromChain).not.toHaveBeenCalled();
      });
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
