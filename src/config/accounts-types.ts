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

export interface StoredAccount {
  name: string;
  secret?: string | EnvSecret; // hex mini-secret (0x...), BIP39 mnemonic, or env var reference; undefined = watch-only
  publicKey: string; // hex 0x-prefixed, 32 bytes (may be "" for deferred env accounts)
  derivationPath: string; // "" for root
  source?: AccountSource;
  // RFC-0022 ring-VRF member keys: "full" = //peopl.dot//0, "lite" = //peopl.dot//1.
  // A --product override stores under "<productId>/<index>".
  bandersnatch?: Record<string, string>;
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
