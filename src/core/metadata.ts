import { getDynamicBuilder, getLookupFn } from "@polkadot-api/metadata-builders";
import {
  Bytes,
  decAnyMetadata,
  Option,
  u32,
  unifyMetadata,
  Vector,
} from "@polkadot-api/substrate-bindings";
import { toHex } from "@polkadot-api/utils";
import { loadMetadata, loadMetadataFingerprint, saveMetadata } from "../config/store.ts";
import {
  CliError,
  ConnectionError,
  formatRuntimeError,
  isBlockUnavailableError,
  isLikelyStaleMetadataError,
  MetadataError,
} from "../utils/errors.ts";
import { fingerprintsMatch, type RuntimeFingerprint } from "../utils/runtime-fingerprint.ts";
import type { ClientHandle } from "./client.ts";
import {
  _getCallFields,
  _getEventFields,
  compactArgsString,
  compactTypeString,
} from "./pretty-type.ts";

const METADATA_TIMEOUT_MS = 15_000;
const optionalOpaqueBytes = Option(Bytes());
const u32Vector = Vector(u32);

// Metadata versions this CLI build can decode. The ceiling participates in the
// cache refresh rule, so raising it invalidates existing caches naturally.
export const CLIENT_MIN_METADATA_VERSION = 14;
export const CLIENT_MAX_METADATA_VERSION = 16;

export interface PalletInfo {
  name: string;
  index: number;
  docs: string[];
  storage: StorageItemInfo[];
  constants: ConstantInfo[];
  calls: CallInfo[];
  events: EventInfo[];
  errors: ErrorInfo[];
}

export interface StorageItemInfo {
  name: string;
  docs: string[];
  type: "plain" | "map";
  keyTypeId: number | null;
  valueTypeId: number;
}

export interface ConstantInfo {
  name: string;
  docs: string[];
  typeId: number;
}

export interface CallInfo {
  name: string;
  docs: string[];
  typeId: number | null; // lookup ID for the call variant's inner type
}

export interface EventInfo {
  name: string;
  docs: string[];
  typeId: number | null;
}

export interface ErrorInfo {
  name: string;
  docs: string[];
}

export type UnifiedMeta = ReturnType<typeof unifyMetadata>;
export type Lookup = ReturnType<typeof getLookupFn>;
export type DynamicBuilder = ReturnType<typeof getDynamicBuilder>;

export interface MetadataBundle {
  unified: UnifiedMeta;
  lookup: Lookup;
  builder: DynamicBuilder;
  version: number;
}

export function parseMetadata(raw: Uint8Array): MetadataBundle {
  const decoded = decAnyMetadata(raw);
  const version = Number(decoded.metadata.tag.replace("v", ""));
  const unified = unifyMetadata(decoded);
  const lookup = getLookupFn(unified);
  const builder = getDynamicBuilder(lookup);
  return { unified, lookup, builder, version };
}

interface RuntimeVersionRpc {
  specName: string;
  specVersion: number;
  transactionVersion: number;
  implName: string;
  implVersion: number;
  authoringVersion: number;
}

export async function getRuntimeFingerprint(
  clientHandle: ClientHandle,
  chainName: string,
): Promise<RuntimeFingerprint> {
  const { client } = clientHandle;
  const [version, codeHash] = await Promise.all([
    withTimeout(client._request<RuntimeVersionRpc>("state_getRuntimeVersion", []), chainName),
    withTimeout(client._request<string>("state_getStorageHash", ["0x3a636f6465"]), chainName),
  ]);
  return {
    specName: version.specName,
    specVersion: version.specVersion,
    transactionVersion: version.transactionVersion,
    implName: version.implName,
    implVersion: version.implVersion,
    authoringVersion: version.authoringVersion,
    codeHash,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Ask the runtime which metadata versions it can serve, filtered to the window
 * this CLI understands (this drops the u32::MAX "unstable" sentinel). Runtimes
 * predating the `Metadata_metadata_versions` API (pre-2023) fail the call, in
 * which case v14 via `state_getMetadata` is the only option.
 */
export async function negotiateMetadataVersions(
  clientHandle: ClientHandle,
  chainName: string,
): Promise<number[]> {
  try {
    const hex = await withTimeout(
      clientHandle.client._request<string>("state_call", ["Metadata_metadata_versions", "0x"]),
      chainName,
    );
    const versions = u32Vector
      .dec(hexToBytes(hex))
      .filter((v) => v >= CLIENT_MIN_METADATA_VERSION && v <= CLIENT_MAX_METADATA_VERSION);
    if (versions.length > 0) return versions;
  } catch {
    // fall through
  }
  return [CLIENT_MIN_METADATA_VERSION];
}

/**
 * Fetch a specific metadata version via `Metadata_metadata_at_version` without
 * touching the cache. Returns undefined when the runtime doesn't serve that
 * version. Besides the negotiated fetch below, this is the seam that lets a
 * future `CheckMetadataHash` implementation obtain v15 bytes for the hasher
 * even when the cache holds v16 — the merkleized hash must always be computed
 * from v15 (the runtime side hashes nothing else; v15/v16 hashes diverge).
 */
export async function fetchMetadataAtVersion(
  clientHandle: ClientHandle,
  chainName: string,
  version: number,
): Promise<Uint8Array | undefined> {
  try {
    const hex = await withTimeout(
      clientHandle.client._request<string>("state_call", [
        "Metadata_metadata_at_version",
        toHex(u32.enc(version)),
      ]),
      chainName,
    );
    const decoded = optionalOpaqueBytes.dec(hexToBytes(hex));
    return decoded !== undefined ? new Uint8Array(decoded) : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchMetadataFromChain(
  clientHandle: ClientHandle,
  chainName: string,
): Promise<Uint8Array> {
  const { client } = clientHandle;

  const supportedVersions = await negotiateMetadataVersions(clientHandle, chainName);
  const target = Math.max(...supportedVersions);

  let bytes: Uint8Array | undefined;

  if (target >= 15) {
    bytes = await fetchMetadataAtVersion(clientHandle, chainName, target);
  }

  if (!bytes) {
    // v14, served by `state_getMetadata`. Note this RPC returns v14 forever by
    // construction (`construct_runtime` generates `metadata() -> into_v14`),
    // so it is a fallback, never a negotiation target.
    try {
      const hex = await withTimeout(client._request<string>("state_getMetadata", []), chainName);
      bytes = hexToBytes(hex);
    } catch (err) {
      if (err instanceof ConnectionError) throw err;
      throw new ConnectionError(
        `Failed to fetch metadata for "${chainName}": ${err instanceof Error ? err.message : err}. ` +
          "Check that the RPC endpoint is correct and reachable.",
      );
    }
  }

  // Best-effort: alongside the metadata, persist a runtime fingerprint so we
  // can detect stale local metadata after a future failure. Don't fail the
  // metadata fetch if the fingerprint RPCs are unavailable on this endpoint.
  let fingerprint: RuntimeFingerprint | undefined;
  try {
    fingerprint = await getRuntimeFingerprint(clientHandle, chainName);
    fingerprint.metadataVersion = peekMetadataVersion(bytes) ?? undefined;
    fingerprint.chainSupportedVersions = supportedVersions;
    fingerprint.clientMaxVersion = CLIENT_MAX_METADATA_VERSION;
  } catch {
    fingerprint = undefined;
  }
  await saveMetadata(chainName, bytes, fingerprint);
  return bytes;
}

/**
 * Read the version out of a raw metadata blob without decoding it: the blob is
 * the "meta" magic (0x6d657461) followed by a u8 version. Returns null when
 * the bytes don't look like metadata.
 */
export function peekMetadataVersion(bytes: Uint8Array): number | null {
  if (bytes.length < 5) return null;
  if (bytes[0] !== 0x6d || bytes[1] !== 0x65 || bytes[2] !== 0x74 || bytes[3] !== 0x61) return null;
  return bytes[4]!;
}

/**
 * Decide whether a cached blob should be refetched, given the versions the
 * chain reported when it was written. Pure so it can be unit-tested; the
 * comparison uses this build's ceiling, so a CLI upgrade that raises
 * CLIENT_MAX_METADATA_VERSION invalidates old caches naturally. Costs no RPC:
 * both inputs come from the cache.
 */
export function shouldRefreshCachedMetadata(
  blobVersion: number | null,
  fingerprint: RuntimeFingerprint | null,
): boolean {
  // No sidecar, or one written before negotiation existed: unknown provenance
  // (e.g. polkadot-api used to rewrite the blob without one) — renegotiate.
  if (!fingerprint?.chainSupportedVersions?.length) return true;
  if (blobVersion === null) return true;
  const target = Math.min(
    Math.max(...fingerprint.chainSupportedVersions),
    CLIENT_MAX_METADATA_VERSION,
  );
  return blobVersion < target;
}

function withTimeout<T>(promise: Promise<T>, chainName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new ConnectionError(
              `Timed out fetching metadata for "${chainName}" after ${METADATA_TIMEOUT_MS / 1000}s. ` +
                "Check that the RPC endpoint is correct and reachable.",
            ),
          ),
        METADATA_TIMEOUT_MS,
      ),
    ),
  ]);
}

// Run `task` and, if it fails with an error that smells like stale metadata,
// verify by comparing the cached runtime fingerprint against the live chain.
// If they differ, re-throw with a CliError that wraps the original error and
// suggests `dot chain update <chain>`. Never refreshes metadata automatically.
export async function withStalenessSuggestion<T>(
  chainName: string,
  clientHandle: ClientHandle,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (err) {
    if (process.env.DOT_TRUST_CACHED_METADATA === "1") throw err;
    if (!isLikelyStaleMetadataError(err)) throw err;

    let live: RuntimeFingerprint;
    try {
      live = await getRuntimeFingerprint(clientHandle, chainName);
    } catch {
      throw err;
    }
    const cached = await loadMetadataFingerprint(chainName);
    if (!cached) throw err;
    if (fingerprintsMatch(cached, live)) throw err;

    const original = err instanceof Error ? formatRuntimeError(err) : String(err);
    const versionNote =
      cached.specVersion !== live.specVersion
        ? `spec ${cached.specVersion} → ${live.specVersion}`
        : `runtime code hash changed (same spec ${live.specVersion}; likely a node restart with new wasm)`;
    throw new CliError(
      `${original}\n\n` +
        `⚠ Local metadata for "${chainName}" is out of date (${versionNote}).\n` +
        `   Run: dot chain update ${chainName}`,
    );
  }
}

// Catch papi errors raised when --at <hash> points at a block the RPC can't
// serve and re-throw as a CliError that tells the user to use an archive node.
// Pure error-shape detection — no extra RPC roundtrip, so this composes cheaply
// inside the staleness wrapper at call sites.
export async function withBlockAvailabilityHint<T>(
  atRaw: string | undefined,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (err) {
    if (!isBlockUnavailableError(err)) throw err;
    const original = err instanceof Error ? err.message : String(err);
    const isExplicitHash = atRaw && atRaw !== "best" && atRaw !== "finalized";
    const target = isExplicitHash ? atRaw : "the requested block";
    const exampleAt = isExplicitHash ? atRaw : "<hash>";
    throw new CliError(
      `${original}\n\n` +
        `⚠ ${target} is not available on the current RPC endpoint.\n` +
        `   Public nodes serve only recent (pinned) blocks via chainHead_v1_*.\n` +
        `   For deep historical reads, point --rpc at an archive endpoint, e.g.:\n` +
        `     dot ... --at ${exampleAt} --rpc wss://<archive-endpoint>`,
    );
  }
}

export async function getOrFetchMetadata(
  chainName: string,
  clientHandle?: ClientHandle,
): Promise<MetadataBundle> {
  let raw = await loadMetadata(chainName);

  if (!raw) {
    if (!clientHandle) {
      throw new MetadataError(
        `No cached metadata for chain "${chainName}". Run a command that connects to the chain first, ` +
          `e.g.: dot chain add ${chainName} --rpc <url>`,
      );
    }
    raw = await fetchMetadataFromChain(clientHandle, chainName);
  } else if (clientHandle) {
    // Connected anyway — upgrade the cache if the chain offers a newer
    // metadata version than the blob holds (or if the blob's provenance is
    // unknown). Steady state is a fingerprint read plus a 5-byte peek, no RPC.
    const fingerprint = await loadMetadataFingerprint(chainName);
    if (shouldRefreshCachedMetadata(peekMetadataVersion(raw), fingerprint)) {
      try {
        raw = await fetchMetadataFromChain(clientHandle, chainName);
      } catch {
        // Refresh is opportunistic — a cached blob beats a failed fetch.
      }
    }
  }

  return parseMetadata(raw);
}

export function listPallets(meta: MetadataBundle): PalletInfo[] {
  const sortByName = <T extends { name: string }>(arr: T[]) =>
    arr.sort((a, b) => a.name.localeCompare(b.name));

  return sortByName(
    meta.unified.pallets.map((p) => ({
      name: p.name,
      index: p.index,
      docs: p.docs ?? [],
      storage: sortByName(
        (p.storage?.items ?? []).map((s) => ({
          name: s.name,
          docs: s.docs ?? [],
          type: s.type.tag,
          keyTypeId: s.type.tag === "map" ? s.type.value.key : null,
          valueTypeId: s.type.tag === "plain" ? s.type.value : s.type.value.value,
        })),
      ),
      constants: sortByName(
        (p.constants ?? []).map((c) => ({
          name: c.name,
          docs: c.docs ?? [],
          typeId: c.type,
        })),
      ),
      calls: sortByName(extractEnumVariants(meta, p.calls)),
      events: sortByName(extractEnumVariants(meta, p.events)),
      errors: sortByName(
        extractEnumVariants(meta, p.errors).map(({ name, docs }) => ({ name, docs })),
      ),
    })),
  );
}

function extractEnumVariants(meta: MetadataBundle, ref: { type: number } | undefined): CallInfo[] {
  if (!ref) return [];
  try {
    const entry = meta.lookup(ref.type);
    if (entry.type !== "enum") return [];
    return Object.entries(entry.value as Record<string, any>).map(([name, variant]) => ({
      name,
      docs: (entry as any).innerDocs?.[name] ?? [],
      typeId: resolveVariantTypeId(variant),
    }));
  } catch {
    return [];
  }
}

function resolveVariantTypeId(variant: any): number | null {
  if (variant.type === "lookupEntry") return variant.value?.id ?? null;
  if (variant.type === "struct") return null; // inline struct, no single typeId
  if (variant.type === "void" || variant.type === "empty") return null;
  return null;
}

export function findPallet(meta: MetadataBundle, palletName: string): PalletInfo | undefined {
  const pallets = listPallets(meta);
  return pallets.find((p) => p.name.toLowerCase() === palletName.toLowerCase());
}

export interface SignedExtensionInfo {
  identifier: string;
  type: number;
  additionalSigned: number;
}

/** Signed extensions that polkadot-api fills in automatically when building a tx. */
export const PAPI_BUILTIN_EXTENSIONS: ReadonlySet<string> = new Set([
  "CheckNonZeroSender",
  "CheckSpecVersion",
  "CheckTxVersion",
  "CheckGenesis",
  "CheckMortality",
  "CheckNonce",
  "CheckWeight",
  "ChargeTransactionPayment",
  "ChargeAssetTxPayment",
  "CheckMetadataHash",
  "StorageWeightReclaim",
  "PrevalidateAttests",
]);

/**
 * Keys of the transaction-extension version map, ascending. The map is keyed
 * by transaction-extension (pipeline) version, NOT extrinsic version — the
 * frame-metadata v16 doc comment says "extrinsic versions" and is wrong: v4
 * Signed extrinsics always use pipeline version 0, and only v5 General
 * extrinsics carry an explicit extension-version byte. v14/v15 metadata
 * expose exactly one entry, keyed 0.
 */
export function getTransactionExtensionVersions(meta: MetadataBundle): number[] {
  return Object.keys(meta.unified.extrinsic.extensionsByVersion)
    .map(Number)
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

/**
 * The transaction-extension version to encode with: the highest key in the
 * map, matching subxt's transaction_extension_version_to_use_for_encoding.
 * Every live chain exposes exactly {0} today; this matters the day one
 * doesn't. Null when the map is empty.
 */
export function getTransactionExtensionVersion(meta: MetadataBundle): number | null {
  const versions = getTransactionExtensionVersions(meta);
  return versions.length > 0 ? versions[versions.length - 1]! : null;
}

export function getSignedExtensions(meta: MetadataBundle, version?: number): SignedExtensionInfo[] {
  const chosen = version ?? getTransactionExtensionVersion(meta);
  if (chosen === null) return [];
  // Metadata order is normative — signing payloads encode extensions in
  // exactly this order, so never sort or normalise it.
  return meta.unified.extrinsic.extensionsByVersion[chosen] ?? [];
}

export function getSignedExtensionNames(meta: MetadataBundle): string[] {
  return getSignedExtensions(meta)
    .map((e) => e.identifier)
    .sort((a, b) => a.localeCompare(b));
}

export function findSignedExtension(
  meta: MetadataBundle,
  identifier: string,
): SignedExtensionInfo | undefined {
  return getSignedExtensions(meta).find(
    (e) => e.identifier.toLowerCase() === identifier.toLowerCase(),
  );
}

export interface SignedExtensionDescription {
  identifier: string;
  valueType: string;
  additionalSignedType: string;
  valueTypeId: number;
  additionalSignedTypeId: number;
  isBuiltin: boolean;
}

export function describeSignedExtension(
  meta: MetadataBundle,
  info: SignedExtensionInfo,
): SignedExtensionDescription {
  return {
    identifier: info.identifier,
    valueType: describeType(meta.lookup, info.type),
    additionalSignedType: describeType(meta.lookup, info.additionalSigned),
    valueTypeId: info.type,
    additionalSignedTypeId: info.additionalSigned,
    isBuiltin: PAPI_BUILTIN_EXTENSIONS.has(info.identifier),
  };
}

export function getPalletNames(meta: MetadataBundle): string[] {
  return meta.unified.pallets.map((p) => p.name).sort((a, b) => a.localeCompare(b));
}

export interface RuntimeApiInfo {
  name: string;
  methods: RuntimeApiMethodInfo[];
  docs: string[];
}

export interface RuntimeApiMethodInfo {
  name: string;
  inputs: Array<{ name: string; type: number }>;
  output: number;
  docs: string[];
}

export function listRuntimeApis(meta: MetadataBundle): RuntimeApiInfo[] {
  const sortByName = <T extends { name: string }>(arr: T[]) =>
    arr.sort((a, b) => a.name.localeCompare(b.name));

  return sortByName(
    meta.unified.apis.map((api) => ({
      name: api.name,
      docs: api.docs ?? [],
      methods: sortByName(
        api.methods.map((m) => ({
          name: m.name,
          inputs: m.inputs.map((i) => ({ name: i.name, type: i.type })),
          output: m.output,
          docs: m.docs ?? [],
        })),
      ),
    })),
  );
}

export function findRuntimeApi(meta: MetadataBundle, apiName: string): RuntimeApiInfo | undefined {
  return listRuntimeApis(meta).find((a) => a.name.toLowerCase() === apiName.toLowerCase());
}

export function getRuntimeApiNames(meta: MetadataBundle): string[] {
  return meta.unified.apis.map((a) => a.name).sort((a, b) => a.localeCompare(b));
}

export function describeRuntimeApiMethodArgs(
  meta: MetadataBundle,
  method: RuntimeApiMethodInfo,
): string {
  if (method.inputs.length === 0) return "()";
  const fields = method.inputs
    .map((i) => `${i.name}: ${describeType(meta.lookup, i.type)}`)
    .join(", ");
  return `(${fields})`;
}

export function describeType(lookup: Lookup, typeId: number): string {
  try {
    const entry = lookup(typeId);
    if (!entry || typeof (entry as any).type !== "string") return `type(${typeId})`;
    return compactTypeString(entry);
  } catch {
    return `type(${typeId})`;
  }
}

export function describeCallArgs(
  meta: MetadataBundle,
  palletName: string,
  callName: string,
): string {
  return compactArgsString(_getCallFields(meta, palletName, callName));
}

export function describeEventFields(
  meta: MetadataBundle,
  palletName: string,
  eventName: string,
): string {
  return compactArgsString(_getEventFields(meta, palletName, eventName));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}
