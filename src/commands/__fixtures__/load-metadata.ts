import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MetadataBundle } from "../../core/metadata.ts";
import { parseMetadata } from "../../core/metadata.ts";

let cached: MetadataBundle | null = null;
let cachedV16: MetadataBundle | null = null;

export function getTestMetadata(): MetadataBundle {
  if (!cached) {
    const raw = readFileSync(join(import.meta.dir, "polkadot-metadata.bin"));
    cached = parseMetadata(new Uint8Array(raw));
  }
  return cached;
}

export function getTestMetadataRaw(): Uint8Array {
  return new Uint8Array(readFileSync(join(import.meta.dir, "polkadot-metadata.bin")));
}

// v16 snapshot of the same chain (polkadot), so tests cover both the v15
// blob shape and the v16 one that metadata negotiation prefers.
export function getTestMetadataV16(): MetadataBundle {
  if (!cachedV16) {
    const raw = readFileSync(join(import.meta.dir, "polkadot-metadata-v16.bin"));
    cachedV16 = parseMetadata(new Uint8Array(raw));
  }
  return cachedV16;
}

// v16 snapshot of preview-people — a runtime that carries the
// VerifyMultiSignature transaction extension, i.e. one that can authorize
// signed Extrinsic V5 General transactions (polkadot cannot).
export function getPeopleMetadataRaw(): Uint8Array {
  return new Uint8Array(readFileSync(join(import.meta.dir, "people-metadata-v16.bin")));
}

let cachedPeople: MetadataBundle | null = null;
export function getPeopleMetadata(): MetadataBundle {
  if (!cachedPeople) {
    cachedPeople = parseMetadata(getPeopleMetadataRaw());
  }
  return cachedPeople;
}
