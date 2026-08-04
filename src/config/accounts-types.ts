export interface EnvSecret {
  env: string; // environment variable name holding the secret
}

export function isEnvSecret(secret: string | EnvSecret): secret is EnvSecret {
  return typeof secret === "object" && secret !== null && "env" in secret;
}

// Records the derivation source of a watch-only stored account so that
// `account list` / `account inspect` can show what it was derived from.
// Stored alongside the publicKey; omitted on raw watch-only adds.
export type AccountSource =
  | { kind: "pallet"; palletId: string /* 0x-prefixed hex, 16 hex chars */ }
  | { kind: "parachain"; paraId: number; type: "child" | "sibling" };

// Signing scheme of a keyed account. Absent means sr25519 (the default for
// every account created before schemes existed, and for all substrate signers).
// "ethereum" accounts hold a secp256k1 key: they cannot sign substrate
// extrinsics — they act through `Revive.eth_transact` on pallet-revive chains.
export type AccountScheme = "sr25519" | "ethereum";

export interface StoredAccount {
  name: string;
  secret?: string | EnvSecret; // hex mini-secret (0x...), BIP39 mnemonic, or env var reference; undefined = watch-only
  publicKey: string; // hex 0x-prefixed, 32 bytes (may be "" for deferred env accounts). For ethereum accounts: the fallback AccountId32 (H160 ‖ 0xEE×12), so address resolution works unchanged.
  derivationPath: string; // "" for root
  scheme?: AccountScheme; // absent = sr25519
  source?: AccountSource;
  bandersnatch?: Record<string, string>; // key (""=unkeyed) → hex member key
}

export function isEthereumAccount(account: StoredAccount): boolean {
  return account.scheme === "ethereum";
}

export function isWatchOnly(account: StoredAccount): boolean {
  return account.secret === undefined;
}

export type AccountKind = "signer" | "watch-only" | "pallet" | "parachain";

export function classifyAccount(account: StoredAccount): AccountKind {
  if (account.source?.kind === "pallet") return "pallet";
  if (account.source?.kind === "parachain") return "parachain";
  if (account.secret !== undefined) return "signer";
  return "watch-only";
}

export interface AccountsFile {
  accounts: StoredAccount[];
}
