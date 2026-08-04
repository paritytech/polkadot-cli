import { hexToBytes as nobleHexToBytes } from "@noble/hashes/utils.js";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  generateMnemonic,
  mnemonicToEntropy,
  ss58Address,
  ss58Decode,
  validateMnemonic,
} from "@polkadot-labs/hdkd-helpers";
import { getPublicKey, HDKD, secretFromSeed, sign } from "@scure/sr25519";
import type { PolkadotSigner } from "polkadot-api/signer";
import { getPolkadotSigner } from "polkadot-api/signer";
import { findAccount, loadAccounts } from "../config/accounts-store.ts";
import type { AccountsFile } from "../config/accounts-types.ts";
import { type EnvSecret, isEnvSecret, isEthereumAccount } from "../config/accounts-types.ts";
import { describeConfigDir } from "../config/store.ts";
import { findClosest } from "../utils/fuzzy-match.ts";
import { isEthereumPrivateKey } from "./ethereum.ts";

export const DEV_NAMES = ["alice", "bob", "charlie", "dave", "eve", "ferdie"] as const;

export function isDevAccount(name: string): boolean {
  return DEV_NAMES.includes(name.toLowerCase() as any);
}

function devDerivationPath(name: string): string {
  return `//${name.charAt(0).toUpperCase()}${name.slice(1).toLowerCase()}`;
}

function deriveFromMnemonic(
  mnemonic: string,
  path: string,
): { publicKey: Uint8Array; sign: (msg: Uint8Array) => Uint8Array } {
  const entropy = mnemonicToEntropy(mnemonic);
  const miniSecret = entropyToMiniSecret(entropy);
  const derive = sr25519CreateDerive(miniSecret);
  return derive(path);
}

function deriveFromHexSeed(
  hexSeed: string,
  path: string,
): { publicKey: Uint8Array; sign: (msg: Uint8Array) => Uint8Array } {
  const derive = sr25519CreateDerive(hexToBytes(hexSeed));
  return derive(path);
}

function getDevKeypair(name: string) {
  const path = devDerivationPath(name);
  return deriveFromMnemonic(DEV_PHRASE, path);
}

// Decode 0x-prefixed (or bare) hex to bytes. Delegates to @noble/hashes, which
// throws on malformed hex rather than silently producing zero bytes.
function hexToBytes(hex: string): Uint8Array {
  return nobleHexToBytes(hex.startsWith("0x") ? hex.slice(2) : hex);
}

// A 64-byte sr25519 *expanded* secret (the value `--show-secret` prints), as
// 0x-prefixed hex (128 hex chars). Distinct from a 32-byte mini-secret/seed.
const EXPANDED_SECRET_RE = /^0x[0-9a-fA-F]{128}$/;

export function isExpandedSecret(secret: string): boolean {
  return EXPANDED_SECRET_RE.test(secret);
}

// A 32-byte mini-secret/seed as 0x-prefixed hex (64 hex chars). Note this is the
// same byte shape as a hex public key (see `isHexPublicKey`); the two are
// distinguished by context, not format.
const HEX_SEED_RE = /^0x[0-9a-fA-F]{64}$/;

export function isHexSeed(secret: string): boolean {
  return HEX_SEED_RE.test(secret);
}

export type SecretKind = "mnemonic" | "seed" | "expanded";

// Classify a stored secret string by its 0x-hex shape. This is a display/branch
// helper, NOT a validator: anything that isn't a 128- or 64-hex-char string
// falls through to "mnemonic" without checking the BIP39 wordlist. Callers are
// expected to pass an already-validated secret (e.g. from a store written by
// `importAccount`); don't rely on the "mnemonic" result as proof of validity.
export function secretKind(secret: string): SecretKind {
  if (isExpandedSecret(secret)) return "expanded";
  if (isHexSeed(secret)) return "seed";
  return "mnemonic";
}

// A stored expanded secret carrying a derivation path is a contradiction: the
// path can't be applied, so honoring the secret would silently sign with a key
// that doesn't match the path the config claims. Only reachable via a
// hand-edited accounts.json (import rejects --path for expanded secrets), so we
// fail loudly rather than guess.
function assertNoPathForExpandedSecret(derivationPath: string): void {
  if (derivationPath) {
    throw new Error(
      "Stored account has a 64-byte expanded secret with a derivation path, which cannot be applied. An expanded secret cannot be HD-derived; remove the derivationPath from accounts.json.",
    );
  }
}

// Build a keypair directly from a 64-byte expanded secret, bypassing HDKD.
// Expanded secrets cannot be HD-derived, so there is no derivation path.
function keypairFromExpandedSecret(secret: Uint8Array): {
  publicKey: Uint8Array;
  sign: (msg: Uint8Array) => Uint8Array;
} {
  return {
    publicKey: getPublicKey(secret),
    sign: (msg: Uint8Array) => sign(secret, msg),
  };
}

// Build a signing keypair from an already-resolved secret string. Mnemonics and
// 32-byte seeds are HD-derived along `derivationPath`; a 64-byte expanded secret
// signs directly (the path is irrelevant — it cannot be HD-derived, so a stored
// expanded-secret account is expected to carry an empty derivationPath).
export function keypairFromSecret(
  secret: string,
  derivationPath = "",
): { publicKey: Uint8Array; sign: (msg: Uint8Array) => Uint8Array } {
  if (isExpandedSecret(secret)) {
    assertNoPathForExpandedSecret(derivationPath);
    return keypairFromExpandedSecret(hexToBytes(secret));
  }
  return isHexSeed(secret)
    ? deriveFromHexSeed(secret, derivationPath)
    : deriveFromMnemonic(secret, derivationPath);
}

// Resolve the 64-byte sr25519 expanded secret from an already-resolved secret
// string. A stored expanded secret is returned as-is; mnemonics/seeds are
// expanded and HD-derived along `derivationPath`.
export function expandedSecretFromStored(secret: string, derivationPath = ""): Uint8Array {
  if (isExpandedSecret(secret)) {
    assertNoPathForExpandedSecret(derivationPath);
    return hexToBytes(secret);
  }
  return deriveExpandedSecret(miniSecretFromSecret(secret), derivationPath);
}

// Mirrors @polkadot-labs/hdkd-helpers internals (parseDerivations.ts, createChainCode.ts)
// which are not re-exported from its barrel.
const DERIVATION_RE = /(\/{1,2})([^/]+)/g;

function parseDerivations(path: string): Array<["hard" | "soft", string]> {
  const out: Array<["hard" | "soft", string]> = [];
  for (const [, type, code] of path.matchAll(DERIVATION_RE)) {
    out.push([type === "//" ? "hard" : "soft", code!]);
  }
  return out;
}

function createChainCode(code: string): Uint8Array {
  const chainCode = new Uint8Array(32);
  const asNumber = +code;
  if (Number.isNaN(asNumber)) {
    // SCALE str.enc: compact length prefix + UTF-8 bytes. For length < 64 (all realistic
    // junction names) the compact prefix is a single byte of (length << 2).
    const bytes = new TextEncoder().encode(code);
    if (bytes.length >= 32) {
      throw new Error(`Derivation component "${code}" is too long (max 31 bytes)`);
    }
    chainCode[0] = bytes.length << 2;
    chainCode.set(bytes, 1);
  } else {
    // SCALE u32.enc: little-endian 4 bytes
    const n = asNumber >>> 0;
    chainCode[0] = n & 0xff;
    chainCode[1] = (n >>> 8) & 0xff;
    chainCode[2] = (n >>> 16) & 0xff;
    chainCode[3] = (n >>> 24) & 0xff;
  }
  return chainCode;
}

export function deriveExpandedSecret(miniSecret: Uint8Array, path: string): Uint8Array {
  return parseDerivations(path).reduce(
    (sk, [type, code]) =>
      type === "hard"
        ? HDKD.secretHard(sk, createChainCode(code))
        : HDKD.secretSoft(sk, createChainCode(code)),
    secretFromSeed(miniSecret),
  );
}

export function miniSecretFromSecret(secret: string): Uint8Array {
  if (isHexSeed(secret)) {
    return hexToBytes(secret);
  }
  if (!validateMnemonic(secret)) {
    throw new Error("Invalid secret. Expected a BIP39 mnemonic or a 0x-prefixed 32-byte hex seed.");
  }
  return entropyToMiniSecret(mnemonicToEntropy(secret));
}

export function getDevAddress(name: string, prefix = 42): string {
  const keypair = getDevKeypair(name);
  return ss58Address(keypair.publicKey, prefix);
}

export function createNewAccount(path = ""): {
  mnemonic: string;
  publicKey: Uint8Array;
} {
  const mnemonic = generateMnemonic();
  const entropy = mnemonicToEntropy(mnemonic);
  const miniSecret = entropyToMiniSecret(entropy);
  const derive = sr25519CreateDerive(miniSecret);
  const keypair = derive(path);
  return { mnemonic, publicKey: keypair.publicKey };
}

export function importAccount(secret: string, path = ""): { publicKey: Uint8Array } {
  if (isExpandedSecret(secret)) {
    if (path) {
      throw new Error(
        "Derivation paths are not supported for raw private key (64-byte expanded secret) import. An expanded secret cannot be HD-derived; omit --path.",
      );
    }
    const keypair = keypairFromExpandedSecret(hexToBytes(secret));
    return { publicKey: keypair.publicKey };
  }

  if (isHexSeed(secret)) {
    const keypair = deriveFromHexSeed(secret, path);
    return { publicKey: keypair.publicKey };
  }

  if (!validateMnemonic(secret)) {
    throw new Error(
      "Invalid secret. Expected a BIP39 mnemonic, a 0x-prefixed 32-byte hex seed, or a 0x-prefixed 64-byte sr25519 expanded secret.",
    );
  }

  const keypair = deriveFromMnemonic(secret, path);
  return { publicKey: keypair.publicKey };
}

export function publicKeyToHex(publicKey: Uint8Array): string {
  return (
    "0x" +
    Array.from(publicKey)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function toSs58(publicKey: Uint8Array | string, prefix = 42): string {
  if (typeof publicKey === "string") {
    const clean = publicKey.startsWith("0x") ? publicKey.slice(2) : publicKey;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
    }
    return ss58Address(bytes, prefix);
  }
  return ss58Address(publicKey, prefix);
}

export function fromSs58(address: string): Uint8Array {
  const [payload] = ss58Decode(address);
  return payload;
}

export function isHexPublicKey(input: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(input);
}

export function resolveSecret(secret: string | EnvSecret): string {
  if (isEnvSecret(secret)) {
    const value = process.env[secret.env];
    if (!value) {
      throw new Error(`Environment variable "${secret.env}" is not set. Set it before signing.`);
    }
    return value;
  }
  return secret;
}

export function tryDerivePublicKey(envVarName: string, path = ""): string | null {
  const value = process.env[envVarName];
  if (!value) return null;
  try {
    const { publicKey } = importAccount(value, path);
    return publicKeyToHex(publicKey);
  } catch {
    return null;
  }
}

/**
 * Build the "Unknown account" error, naming the config root that was
 * searched — with workspace discovery, "wrong directory" is the most likely
 * cause of a missing account and the root makes that self-diagnosing.
 */
function unknownAccountError(name: string, accountsFile: AccountsFile): Error {
  const available = [...DEV_NAMES, ...accountsFile.accounts.map((a) => a.name)].sort((a, b) =>
    a.localeCompare(b),
  );
  const suggestions = findClosest(name, available);
  const hint = suggestions.length > 0 ? `\n  Did you mean: ${suggestions.join(", ")}?` : "";
  const list = available.map((a) => `\n    - ${a}`).join("");
  return new Error(
    `Unknown account "${name}" in ${describeConfigDir()}.${hint}\n  Available accounts:${list}`,
  );
}

export async function resolveAccountKeypair(
  name: string,
): Promise<{ publicKey: Uint8Array; sign: (msg: Uint8Array) => Uint8Array }> {
  // Check dev accounts first
  if (isDevAccount(name)) {
    return getDevKeypair(name);
  }

  // Check stored accounts
  const accountsFile = await loadAccounts();
  const account = findAccount(accountsFile, name);
  if (!account) {
    throw unknownAccountError(name, accountsFile);
  }

  if (account.secret === undefined) {
    throw new Error(
      `Account "${name}" is watch-only (no secret). Cannot sign. Import with --secret or --env.`,
    );
  }

  if (isEthereumAccount(account)) {
    throw new Error(
      `Account "${name}" is an Ethereum (secp256k1) account. It cannot sign substrate extrinsics — it acts through Revive.eth_transact on chains with pallet-revive (e.g. dot <chain>.tx.Revive.call … --from ${name}).`,
    );
  }

  return keypairFromSecret(resolveSecret(account.secret), account.derivationPath);
}

// Resolve the raw secp256k1 private key of a stored ethereum-scheme account.
export async function resolveEthereumPrivateKey(name: string): Promise<string> {
  const accountsFile = await loadAccounts();
  const account = findAccount(accountsFile, name);
  if (!account) {
    throw unknownAccountError(name, accountsFile);
  }
  if (!isEthereumAccount(account)) {
    throw new Error(`Account "${name}" is not an Ethereum account.`);
  }
  if (account.secret === undefined) {
    throw new Error(
      `Account "${name}" is watch-only (no secret). Cannot sign. Import with --secret or --env.`,
    );
  }
  const secret = resolveSecret(account.secret);
  if (!isEthereumPrivateKey(secret)) {
    throw new Error(
      `Account "${name}" does not hold a valid Ethereum private key (expected 0x + 64 hex chars).`,
    );
  }
  return secret;
}

// Load the stored account record for a name, or null for dev/unknown names.
// Used to branch on the account's scheme before committing to a signer type.
export async function findStoredAccount(name: string) {
  const accountsFile = await loadAccounts();
  return findAccount(accountsFile, name);
}

export async function resolveAccountSigner(name: string): Promise<PolkadotSigner> {
  const keypair = await resolveAccountKeypair(name);
  return getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign);
}

export async function resolveAccountExpandedSecret(name: string): Promise<Uint8Array> {
  if (isDevAccount(name)) {
    const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE));
    return deriveExpandedSecret(miniSecret, devDerivationPath(name));
  }

  const accountsFile = await loadAccounts();
  const account = findAccount(accountsFile, name);
  if (!account) {
    throw unknownAccountError(name, accountsFile);
  }

  if (account.secret === undefined) {
    throw new Error(
      `Account "${name}" is watch-only (no secret). Cannot derive private key. Import with --secret or --env.`,
    );
  }

  if (isEthereumAccount(account)) {
    throw new Error(
      `Account "${name}" is an Ethereum (secp256k1) account and has no sr25519 key. Use \`dot account inspect ${name} --show-secret\` to reveal its private key.`,
    );
  }

  return expandedSecretFromStored(resolveSecret(account.secret), account.derivationPath);
}

export function bytesToHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
