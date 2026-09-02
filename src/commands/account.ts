import { readFile, writeFile } from "node:fs/promises";
import { hexToBytes as nobleHexToBytes } from "@noble/hashes/utils.js";
import type { CAC } from "cac";
import { findAccount, loadAccounts, saveAccounts } from "../config/accounts-store.ts";
import {
  type AccountKind,
  classifyAccount,
  type EnvSecret,
  isEnvSecret,
  isWatchOnly,
  type StoredAccount,
} from "../config/accounts-types.ts";
import {
  bytesToHex,
  createNewAccount,
  DEV_NAMES,
  fromSs58,
  getDevAddress,
  importAccount,
  isDevAccount,
  isHexPublicKey,
  publicKeyToHex,
  resolveAccountExpandedSecret,
  secretKind,
  toSs58,
  tryDerivePublicKey,
} from "../core/accounts.ts";
import {
  accountIdToH160,
  h160FromHex,
  h160ToFallbackAccountId,
  isH160Hex,
  toEip55,
} from "../core/h160.ts";
import {
  BOLD,
  CYAN,
  DIM,
  formatJson,
  isJsonOutput,
  printHeading,
  printImportResults,
  RESET,
  YELLOW,
} from "../core/output.ts";
import { derivePalletAccount, formatPalletId, parsePalletId } from "../core/pallet.ts";
import {
  deriveSovereignAccount,
  isValidParaId,
  type SovereignAccountType,
} from "../core/parachain.ts";
import { withHelp } from "../platform/cli.ts";

const ACCOUNT_HELP = `
${BOLD}Usage:${RESET}
  $ dot account add <name> <ss58|hex>                                Add a watch-only address (no secret)
  $ dot account add <name> --secret <s> [--path <derivation>]        Import from BIP39 mnemonic or 32-byte hex seed
  $ dot account add <name> --secret 0x<128 hex>                      Import a raw 64-byte sr25519 private key (no --path)
  $ dot account add <name> --env <VAR> [--path <derivation>]         Import account backed by env variable
  $ dot account add <name> --parachain <id> --parachain-type <t>     Derive a parachain sovereign (t = child|sibling)
  $ dot account add <name> --pallet-id <8 chars or 0x hex>           Derive a pallet sovereign (e.g. py/trsry)
  $ dot account create|new <name> [--path <derivation>]              Create a new account
  $ dot account import <file>                                        Batch-import accounts from a file
  $ dot account export [names...]                                    Export accounts to stdout
  $ dot account derive <source> <new-name> --path <derivation>       Derive a child account
  $ dot account inspect <input> [--prefix <N>] [--show-secret]       Inspect an account/address/key
  $ dot account inspect --pallet-id <id> [--prefix <N>]              Derive a pallet sovereign (no save — script-friendly)
  $ dot account inspect --parachain <id> --parachain-type <t>        Derive a parachain sovereign (no save — script-friendly)
  $ dot account list                                                 List all accounts
  $ dot account remove|delete|rm <name> [name2] ...                  Remove stored account(s)

${BOLD}Examples:${RESET}
  $ dot account add treasury 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
  $ dot account add treasury --secret "word1 word2 ... word12"
  $ dot account add raw-key --secret 0x<128-hex-char sr25519 expanded secret>
  $ dot account add ci-signer --env MY_SECRET --path //ci
  $ dot account add Treasury --pallet-id py/trsry
  $ dot account add Bounties --pallet-id 0x70792f626f756e74
  $ dot account add People --parachain 1004 --parachain-type child
  $ dot account add People-Sibling --parachain 1004 --parachain-type sibling
  $ dot account create my-validator
  $ dot account create my-staking --path //staking
  $ dot account create multi --path //polkadot//0/wallet
  $ dot account import team-accounts.json
  $ dot account import accounts.json --dry-run
  $ dot account import accounts.json --overwrite
  $ dot account export
  $ dot account export treasury my-validator
  $ dot account export --include-secrets --file backup.json
  $ dot account export --watch-only
  $ dot account derive treasury treasury-staking --path //staking
  $ dot account inspect alice
  $ dot account inspect dave --show-secret
  $ dot account inspect 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
  $ dot account inspect 0xd435...a27d --prefix 0
  $ dot account inspect --pallet-id py/trsry --prefix 0
  $ dot account inspect --parachain 1004 --parachain-type child
  $ dot account list
  $ dot account remove my-validator stale-key

${YELLOW}Note: Secrets are stored unencrypted in ~/.polkadot/accounts.json.
      Use --env to keep secrets off disk entirely.
      --secret accepts a BIP39 mnemonic, a 0x 32-byte hex seed, or a
      0x 64-byte raw sr25519 private key (the value --show-secret prints).
      Raw private keys cannot be HD-derived, so --path is rejected for them.${RESET}
`.trimStart();

export function registerAccountCommands(cli: CAC) {
  const command = cli
    .command(
      "account [action] [...names]",
      "Manage local accounts (create, import, list, remove, export)",
    )
    .alias("accounts")
    .option(
      "--secret <value>",
      "Secret for import: BIP39 mnemonic, 0x 32-byte hex seed, or 0x 64-byte raw private key",
    )
    .option("--env <varName>", "Environment variable name holding the secret")
    .option("--path <derivation>", "Derivation path (e.g. //staking, //polkadot//0/wallet)")
    .option("--parachain <id>", "Derive a parachain sovereign account (requires --parachain-type)")
    .option("--parachain-type <type>", "Parachain sovereign type: child or sibling")
    .option("--pallet-id <id>", "Derive a pallet sovereign account from an 8-byte PalletId")
    .option("--prefix <number>", "SS58 prefix for address encoding (default: 42)")
    .option("--file <path>", "Input/output file for batch import/export")
    .option("--overwrite", "Overwrite existing accounts on batch import")
    .option("--dry-run", "Preview batch import without applying changes")
    .option("--include-secrets", "Include secrets in export (redacted by default)")
    .option("--watch-only", "Export only watch-only accounts")
    .option("--show-secret", "Reveal the 64-byte sr25519 expanded private key (inspect only)")
    .action(
      async (
        action: string | undefined,
        names: string[],
        opts: {
          secret?: string;
          env?: string;
          path?: string;
          parachain?: string;
          parachainType?: string;
          palletId?: string;
          prefix?: string;
          file?: string;
          overwrite?: boolean;
          dryRun?: boolean;
          includeSecrets?: boolean;
          watchOnly?: boolean;
          showSecret?: boolean;
          output?: string;
          json?: boolean;
        },
      ) => {
        if (!action) {
          if (process.argv[2] === "accounts") return accountList(opts);
          console.log(ACCOUNT_HELP);
          return;
        }
        // cac coerces 0x-prefixed --secret values via Number() (hex seeds and
        // 64-byte expanded secrets both look numeric), corrupting them. Recover
        // the original string token straight from argv.
        const rawSecret = rawArgValue("--secret");
        if (rawSecret != null) opts.secret = rawSecret;
        switch (action) {
          case "new":
          case "create":
            return accountCreate(names[0], opts);
          case "add":
            if (opts.secret || opts.env) {
              const hasDerivation =
                opts.parachain != null ||
                opts.palletId != null ||
                process.argv.includes("--parachain") ||
                process.argv.includes("--pallet-id") ||
                process.argv.some(
                  (a) => a.startsWith("--parachain=") || a.startsWith("--pallet-id="),
                );
              if (hasDerivation) {
                throw new Error(
                  "Derivation flags (--parachain, --pallet-id) cannot be combined with --secret or --env. A derived sovereign account has no secret.",
                );
              }
              return accountImport(names[0], opts);
            }
            return accountAddWatchOnly(names[0], names[1], opts);
          case "import":
            return accountBatchImport(names[0], opts);
          case "export":
            return accountExport(names, opts);
          case "derive":
            return accountDerive(names[0], names[1], opts);
          case "list":
            return accountList(opts);
          case "delete":
          case "remove":
          case "rm":
            return accountRemove(names, opts);
          case "inspect":
            return accountInspect(names[0], opts);
          default:
            return accountInspect(action, opts);
        }
      },
    );
  withHelp(command, () => console.log(ACCOUNT_HELP));
}

async function accountCreate(
  name: string | undefined,
  opts: { path?: string; output?: string; json?: boolean },
) {
  if (!name) {
    console.error("Account name is required.\n");
    console.error("Usage: dot account create <name>");
    process.exit(1);
  }

  if (isDevAccount(name)) {
    throw new Error(
      `"${name}" is a built-in dev account and cannot be used as a custom account name.`,
    );
  }

  const accountsFile = await loadAccounts();
  if (findAccount(accountsFile, name)) {
    throw new Error(`Account "${name}" already exists.`);
  }

  const path = opts.path ?? "";
  const { mnemonic, publicKey } = createNewAccount(path);
  const hexPub = publicKeyToHex(publicKey);
  const address = toSs58(publicKey);

  // Auto-derive the two RFC-0022 personhood member keys (//peopl.dot//0 and //1).
  const { deriveBandersnatchMember } = await import("../features/verifiable/lib.ts");
  const bandersnatch: Record<string, string> = {
    full: publicKeyToHex(deriveBandersnatchMember(mnemonic, "full")),
    lite: publicKeyToHex(deriveBandersnatchMember(mnemonic, "lite")),
  };

  accountsFile.accounts.push({
    name,
    secret: mnemonic,
    publicKey: hexPub,
    derivationPath: path,
    bandersnatch,
  });
  await saveAccounts(accountsFile);

  if (isJsonOutput(opts)) {
    console.log(
      formatJson({
        name,
        address,
        publicKey: hexPub,
        mnemonic,
        path: path || undefined,
        bandersnatch,
      }),
    );
    console.error(`Save this mnemonic phrase! It is the only way to recover this account.`);
    return;
  }

  printHeading("Account Created");
  console.log(`  ${BOLD}Name:${RESET}          ${name}`);
  if (path) console.log(`  ${BOLD}Path:${RESET}          ${path}`);
  console.log(`  ${BOLD}Address:${RESET}       ${address}`);
  console.log(`  ${BOLD}Bandersnatch:${RESET}  ${bandersnatch.full} ${BOLD}(full)${RESET}`);
  console.log(`                 ${bandersnatch.lite} ${BOLD}(lite)${RESET}`);
  console.log(`  ${BOLD}Mnemonic:${RESET}      ${mnemonic}`);
  console.log();
  console.log(
    `  ${YELLOW}Save this mnemonic phrase! It is the only way to recover this account.${RESET}`,
  );
  console.log();
}

async function accountImport(
  name: string | undefined,
  opts: { secret?: string; env?: string; path?: string; output?: string; json?: boolean },
) {
  if (!name) {
    console.error("Account name is required.\n");
    console.error('Usage: dot account import <name> --secret "mnemonic or hex seed"');
    process.exit(1);
  }

  if (opts.secret && opts.env) {
    console.error("Use --secret or --env, not both.\n");
    process.exit(1);
  }

  if (!opts.secret && !opts.env) {
    console.error("--secret or --env is required.\n");
    console.error('Usage: dot account import <name> --secret "mnemonic or hex seed"');
    console.error("       dot account import <name> --env <VAR>");
    process.exit(1);
  }

  if (isDevAccount(name)) {
    throw new Error(
      `"${name}" is a built-in dev account and cannot be used as a custom account name.`,
    );
  }

  const accountsFile = await loadAccounts();
  if (findAccount(accountsFile, name)) {
    throw new Error(`Account "${name}" already exists.`);
  }

  const path = opts.path ?? "";

  if (opts.env) {
    const publicKey = tryDerivePublicKey(opts.env, path) ?? "";

    accountsFile.accounts.push({
      name,
      secret: { env: opts.env },
      publicKey,
      derivationPath: path,
    });
    await saveAccounts(accountsFile);

    if (isJsonOutput(opts)) {
      const address = publicKey ? toSs58(publicKey) : undefined;
      console.log(formatJson({ name, address, env: opts.env, path: path || undefined }));
      return;
    }

    printHeading("Account Imported");
    console.log(`  ${BOLD}Name:${RESET}    ${name}`);
    if (path) console.log(`  ${BOLD}Path:${RESET}    ${path}`);
    console.log(`  ${BOLD}Env:${RESET}     ${opts.env}`);
    if (publicKey) {
      console.log(`  ${BOLD}Address:${RESET} ${toSs58(publicKey)}`);
    } else {
      console.log(`  ${YELLOW}Address will resolve when $${opts.env} is set.${RESET}`);
    }
    console.log();
  } else {
    const { publicKey } = importAccount(opts.secret!, path);
    const hexPub = publicKeyToHex(publicKey);
    const address = toSs58(publicKey);

    accountsFile.accounts.push({
      name,
      secret: opts.secret!,
      publicKey: hexPub,
      derivationPath: path,
    });
    await saveAccounts(accountsFile);

    if (isJsonOutput(opts)) {
      console.log(formatJson({ name, address, publicKey: hexPub, path: path || undefined }));
      return;
    }

    printHeading("Account Imported");
    console.log(`  ${BOLD}Name:${RESET}    ${name}`);
    if (path) console.log(`  ${BOLD}Path:${RESET}    ${path}`);
    console.log(`  ${BOLD}Address:${RESET} ${address}`);
    console.log();
  }
}

type SovereignSource =
  | { kind: "parachain"; paraId: number; type: SovereignAccountType }
  | { kind: "pallet"; palletId: Uint8Array };

async function accountAddWatchOnly(
  name: string | undefined,
  address: string | undefined,
  opts: {
    parachain?: string;
    parachainType?: string;
    palletId?: string;
    output?: string;
    json?: boolean;
  } = {},
) {
  if (!name) {
    console.error("Account name is required.\n");
    console.error("Usage: dot account add <name> <ss58-address|0x-public-key>");
    process.exit(1);
  }

  const sovereignSource = resolveSovereignSource(opts);

  if (sovereignSource && address) {
    throw new Error(
      "Cannot combine a positional address with --parachain or --pallet-id. Pass either an address OR a derivation flag, not both.",
    );
  }

  if (!sovereignSource && !address) {
    console.error("Address is required.\n");
    console.error("Usage: dot account add <name> <ss58-address|0x-public-key>");
    console.error(
      "       dot account add <name> --parachain <id> --parachain-type <child|sibling>",
    );
    console.error("       dot account add <name> --pallet-id <8 chars or 0x hex>");
    process.exit(1);
  }

  if (isDevAccount(name)) {
    throw new Error(
      `"${name}" is a built-in dev account and cannot be used as a custom account name.`,
    );
  }

  const accountsFile = await loadAccounts();
  if (findAccount(accountsFile, name)) {
    throw new Error(`Account "${name}" already exists.`);
  }

  let hexPub: string;
  if (sovereignSource) {
    const accountId =
      sovereignSource.kind === "parachain"
        ? deriveSovereignAccount(sovereignSource.paraId, sovereignSource.type)
        : derivePalletAccount(sovereignSource.palletId);
    hexPub = publicKeyToHex(accountId);
  } else if (isHexPublicKey(address as string)) {
    hexPub = address as string;
  } else {
    try {
      const decoded = fromSs58(address as string);
      hexPub = publicKeyToHex(decoded);
    } catch {
      throw new Error(
        `Invalid address "${address}". Expected an SS58 address or 0x-prefixed 32-byte hex public key.`,
      );
    }
  }

  let persistedSource: import("../config/accounts-types.ts").AccountSource | undefined;
  if (sovereignSource?.kind === "pallet") {
    persistedSource = {
      kind: "pallet",
      palletId: `0x${Array.from(sovereignSource.palletId, (b) => b.toString(16).padStart(2, "0")).join("")}`,
    };
  } else if (sovereignSource?.kind === "parachain") {
    persistedSource = {
      kind: "parachain",
      paraId: sovereignSource.paraId,
      type: sovereignSource.type,
    };
  }

  accountsFile.accounts.push({
    name,
    publicKey: hexPub,
    derivationPath: "",
    ...(persistedSource ? { source: persistedSource } : {}),
  });
  await saveAccounts(accountsFile);

  if (isJsonOutput(opts)) {
    const payload: Record<string, unknown> = {
      name,
      address: toSs58(hexPub),
      watchOnly: true,
    };
    if (sovereignSource?.kind === "parachain") {
      payload.derivation = {
        kind: "parachain",
        paraId: sovereignSource.paraId,
        type: sovereignSource.type,
      };
    } else if (sovereignSource?.kind === "pallet") {
      payload.derivation = {
        kind: "pallet",
        palletId: formatPalletId(sovereignSource.palletId),
        palletIdHex: `0x${Array.from(sovereignSource.palletId, (b) => b.toString(16).padStart(2, "0")).join("")}`,
      };
    }
    console.log(formatJson(payload));
    return;
  }

  printHeading("Account Added (watch-only)");
  console.log(`  ${BOLD}Name:${RESET}    ${name}`);
  console.log(`  ${BOLD}Address:${RESET} ${toSs58(hexPub)}`);
  if (sovereignSource?.kind === "parachain") {
    console.log(
      `  ${BOLD}Source:${RESET}  parachain ${sovereignSource.paraId} (${sovereignSource.type} sovereign)`,
    );
  } else if (sovereignSource?.kind === "pallet") {
    const display = formatPalletId(sovereignSource.palletId);
    const hex = `0x${Array.from(sovereignSource.palletId, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    console.log(`  ${BOLD}Source:${RESET}  pallet ${display} (${hex})`);
  }
  console.log();
}

// cac coerces values that look numeric (including 0x-hex) via Number(), which
// truncates hex PalletIds. Re-read the raw token from argv to bypass that.
function rawArgValue(flag: string): string | undefined {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1];
    const prefix = `${flag}=`;
    if (argv[i]?.startsWith(prefix)) return argv[i]!.slice(prefix.length);
  }
  return undefined;
}

function resolveSovereignSource(opts: {
  parachain?: string;
  parachainType?: string;
  palletId?: string;
}): SovereignSource | undefined {
  const rawPalletId = rawArgValue("--pallet-id") ?? opts.palletId;
  const rawParachain = rawArgValue("--parachain") ?? opts.parachain;

  if (rawParachain != null && rawPalletId != null) {
    throw new Error(
      "--parachain and --pallet-id are mutually exclusive. Pass only one derivation flag.",
    );
  }

  if (rawParachain != null) {
    const paraId = Number(rawParachain);
    if (!isValidParaId(paraId)) {
      throw new Error(
        `Invalid parachain ID "${rawParachain}". Must be a non-negative integer (0 to 4294967295).`,
      );
    }
    if (!opts.parachainType) {
      throw new Error(
        "--parachain-type is required when --parachain is given. Use --parachain-type child or --parachain-type sibling.",
      );
    }
    const type = opts.parachainType.toLowerCase();
    if (type !== "child" && type !== "sibling") {
      throw new Error(
        `Unknown parachain account type "${opts.parachainType}". Valid types: child, sibling.`,
      );
    }
    return { kind: "parachain", paraId, type: type as SovereignAccountType };
  }

  if (rawPalletId != null) {
    return { kind: "pallet", palletId: parsePalletId(String(rawPalletId)) };
  }

  if (opts.parachainType != null) {
    throw new Error("--parachain-type requires --parachain.");
  }

  return undefined;
}

async function accountDerive(
  sourceName: string | undefined,
  newName: string | undefined,
  opts: { path?: string; output?: string; json?: boolean },
) {
  if (!sourceName) {
    console.error("Source account name is required.\n");
    console.error("Usage: dot account derive <source> <new-name> --path <derivation>");
    process.exit(1);
  }

  if (!newName) {
    console.error("New account name is required.\n");
    console.error("Usage: dot account derive <source> <new-name> --path <derivation>");
    process.exit(1);
  }

  if (!opts.path) {
    console.error("--path is required for derive.\n");
    console.error("Usage: dot account derive <source> <new-name> --path <derivation>");
    process.exit(1);
  }

  if (isDevAccount(newName)) {
    throw new Error(
      `"${newName}" is a built-in dev account and cannot be used as a custom account name.`,
    );
  }

  const accountsFile = await loadAccounts();

  const source = findAccount(accountsFile, sourceName);
  if (!source) {
    throw new Error(`Source account "${sourceName}" not found.`);
  }

  if (isWatchOnly(source)) {
    throw new Error(`Cannot derive from "${sourceName}": watch-only, no secret.`);
  }

  if (findAccount(accountsFile, newName)) {
    throw new Error(`Account "${newName}" already exists.`);
  }

  const path = opts.path;

  // After the isWatchOnly guard, secret is guaranteed to be defined
  const sourceSecret = source.secret!;

  if (isEnvSecret(sourceSecret)) {
    const publicKey = tryDerivePublicKey(sourceSecret.env, path) ?? "";

    accountsFile.accounts.push({
      name: newName,
      secret: sourceSecret,
      publicKey,
      derivationPath: path,
    });
    await saveAccounts(accountsFile);

    if (isJsonOutput(opts)) {
      const address = publicKey ? toSs58(publicKey) : undefined;
      console.log(
        formatJson({ name: newName, source: sourceName, path, address, env: sourceSecret.env }),
      );
      return;
    }

    printHeading("Account Derived");
    console.log(`  ${BOLD}Name:${RESET}    ${newName}`);
    console.log(`  ${BOLD}Source:${RESET}  ${sourceName}`);
    console.log(`  ${BOLD}Path:${RESET}    ${path}`);
    console.log(`  ${BOLD}Env:${RESET}     ${sourceSecret.env}`);
    if (publicKey) {
      console.log(`  ${BOLD}Address:${RESET} ${toSs58(publicKey)}`);
    } else {
      console.log(`  ${YELLOW}Address will resolve when $${sourceSecret.env} is set.${RESET}`);
    }
    console.log();
  } else {
    const { publicKey } = importAccount(sourceSecret, path);
    const hexPub = publicKeyToHex(publicKey);
    const address = toSs58(publicKey);

    accountsFile.accounts.push({
      name: newName,
      secret: sourceSecret,
      publicKey: hexPub,
      derivationPath: path,
    });
    await saveAccounts(accountsFile);

    if (isJsonOutput(opts)) {
      console.log(
        formatJson({ name: newName, source: sourceName, path, address, publicKey: hexPub }),
      );
      return;
    }

    printHeading("Account Derived");
    console.log(`  ${BOLD}Name:${RESET}    ${newName}`);
    console.log(`  ${BOLD}Source:${RESET}  ${sourceName}`);
    console.log(`  ${BOLD}Path:${RESET}    ${path}`);
    console.log(`  ${BOLD}Address:${RESET} ${address}`);
    console.log();
  }
}

type AccountAttribute = { label: string; value: string };

type StoredAccountRow = {
  account: StoredAccount;
  kind: AccountKind;
  address: string;
  attributes: AccountAttribute[];
};

function resolveAddress(account: StoredAccount): string {
  if (isWatchOnly(account)) {
    return account.publicKey ? toSs58(account.publicKey) : "n/a";
  }
  if (account.secret !== undefined && isEnvSecret(account.secret)) {
    const pubKey =
      account.publicKey || tryDerivePublicKey(account.secret.env, account.derivationPath) || "";
    return pubKey ? toSs58(pubKey) : "n/a";
  }
  return toSs58(account.publicKey);
}

// Attribute labels mirror the `--flag` names that set the corresponding value
// (--path, --env, --pallet-id, --parachain, --parachain-type) so users can
// derive the flag from what they see and vice-versa.
function buildAttributes(account: StoredAccount): AccountAttribute[] {
  const attrs: AccountAttribute[] = [];
  if (account.derivationPath) attrs.push({ label: "path", value: account.derivationPath });
  if (account.secret !== undefined && isEnvSecret(account.secret)) {
    attrs.push({ label: "env", value: `$${account.secret.env}` });
  }
  if (account.source) {
    if (account.source.kind === "pallet") {
      const bytes = parsePalletId(account.source.palletId);
      attrs.push({
        label: "pallet-id",
        value: `${formatPalletId(bytes)} (${account.source.palletId})`,
      });
    } else {
      attrs.push({ label: "parachain", value: String(account.source.paraId) });
      attrs.push({ label: "parachain-type", value: account.source.type });
    }
  }
  return attrs;
}

function buildRow(account: StoredAccount): StoredAccountRow {
  return {
    account,
    kind: classifyAccount(account),
    address: resolveAddress(account),
    attributes: buildAttributes(account),
  };
}

const SECTION_ORDER: { kind: AccountKind; title: string }[] = [
  { kind: "signer", title: "Signers" },
  { kind: "watch-only", title: "Watch-only" },
  { kind: "pallet", title: "Pallet Sovereigns" },
  { kind: "parachain", title: "Parachain Sovereigns" },
];

function printAccountSection(
  title: string,
  rows: { name: string; address: string; attributes: AccountAttribute[] }[],
) {
  if (rows.length === 0) return;
  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  printHeading(title);
  for (const row of rows) {
    const namePad = row.name.padEnd(nameWidth);
    console.log(`  ${CYAN}${namePad}${RESET}  ${row.address}`);
    if (row.attributes.length === 0) continue;
    // Tree-style continuation lines, one per attribute. Labels are key-padded
    // (key + colon) to the longest label-width within this account so values
    // align in a column.
    const labelWidth = Math.max(...row.attributes.map((a) => a.label.length)) + 1; // +1 for ':'
    for (let i = 0; i < row.attributes.length; i++) {
      const isLast = i === row.attributes.length - 1;
      const connector = isLast ? "└─" : "├─";
      const labelText = `${row.attributes[i]!.label}:`.padEnd(labelWidth + 1);
      console.log(
        `     ${DIM}${connector}${RESET} ${DIM}${labelText}${RESET}${row.attributes[i]!.value}`,
      );
    }
  }
}

async function accountList(opts: { output?: string; json?: boolean } = {}) {
  const accountsFile = await loadAccounts();

  if (isJsonOutput(opts)) {
    const dev = DEV_NAMES.map((name) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      address: getDevAddress(name),
      kind: "dev" as const,
    }));
    const stored = accountsFile.accounts.map((account) => {
      const kind = classifyAccount(account);
      const entry: Record<string, unknown> = {
        name: account.name,
        address: resolveAddress(account),
        kind,
        watchOnly: isWatchOnly(account),
      };
      if (account.derivationPath) entry.derivationPath = account.derivationPath;
      if (account.secret !== undefined && isEnvSecret(account.secret)) {
        entry.env = account.secret.env;
      }
      if (account.source) {
        if (account.source.kind === "pallet") {
          const bytes = parsePalletId(account.source.palletId);
          entry.source = {
            kind: "pallet",
            palletId: formatPalletId(bytes),
            palletIdHex: account.source.palletId,
          };
        } else {
          entry.source = account.source;
        }
      }
      return entry;
    });
    console.log(formatJson({ dev, stored }));
    return;
  }

  // Dev accounts — always shown first
  const devRows = DEV_NAMES.map((name) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    address: getDevAddress(name),
    attributes: [] as AccountAttribute[],
  }));
  printAccountSection("Dev Accounts", devRows);

  // Stored accounts — bucketed by kind, empty sections omitted
  const buckets = new Map<AccountKind, StoredAccountRow[]>();
  for (const account of accountsFile.accounts) {
    const row = buildRow(account);
    const arr = buckets.get(row.kind) ?? [];
    arr.push(row);
    buckets.set(row.kind, arr);
  }

  for (const { kind, title } of SECTION_ORDER) {
    const rows = buckets.get(kind);
    if (!rows || rows.length === 0) continue;
    printAccountSection(
      title,
      rows.map((r) => ({
        name: r.account.name,
        address: r.address,
        attributes: r.attributes,
      })),
    );
  }

  if (accountsFile.accounts.length === 0) {
    printHeading("Stored Accounts");
    console.log(`  ${DIM}(none)${RESET}`);
  }

  console.log();
}

async function accountRemove(names: string[], opts: { output?: string; json?: boolean } = {}) {
  if (names.length === 0) {
    console.error("At least one account name is required.\n");
    console.error("Usage: dot account remove <name> [name2] ...");
    process.exit(1);
  }

  // Validate all names upfront before deleting anything
  const errors: string[] = [];
  for (const name of names) {
    if (isDevAccount(name)) {
      errors.push(`Cannot remove built-in dev account "${name}".`);
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const accountsFile = await loadAccounts();
  const indicesToRemove = new Set<number>();
  for (const name of names) {
    const idx = accountsFile.accounts.findIndex((a) => a.name.toLowerCase() === name.toLowerCase());
    if (idx === -1) {
      errors.push(`Account "${name}" not found.`);
    } else {
      indicesToRemove.add(idx);
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  // Remove in reverse order to avoid index shifting
  for (const idx of [...indicesToRemove].sort((a, b) => b - a)) {
    accountsFile.accounts.splice(idx, 1);
  }
  await saveAccounts(accountsFile);

  if (isJsonOutput(opts)) {
    console.log(formatJson({ removed: names }));
    return;
  }

  for (const name of names) {
    console.log(`Account "${name}" removed.`);
  }
}

async function accountInspect(
  input: string | undefined,
  opts: {
    parachain?: string;
    parachainType?: string;
    palletId?: string;
    prefix?: string;
    showSecret?: boolean;
    output?: string;
    json?: boolean;
  },
) {
  // Stateless derivation mode: --pallet-id / --parachain compute and display
  // a sovereign address without persisting it. Mutually exclusive with the
  // positional input (which resolves names/ss58/hex from existing state).
  const sovereignSource = resolveSovereignSource({
    parachain: opts.parachain,
    parachainType: opts.parachainType,
    palletId: opts.palletId,
  });

  if (sovereignSource && input) {
    throw new Error(
      "Cannot combine a positional input with --parachain or --pallet-id. Pass either an existing-account input OR a derivation flag, not both.",
    );
  }

  if (!sovereignSource && !input) {
    console.error("Input is required.\n");
    console.error("Usage: dot account inspect <name|ss58-address|0x-public-key> [--prefix <N>]");
    console.error("       dot account inspect --pallet-id <id> [--prefix <N>]");
    console.error(
      "       dot account inspect --parachain <id> --parachain-type <child|sibling> [--prefix <N>]",
    );
    process.exit(1);
  }

  const prefix = opts.prefix != null ? Number(opts.prefix) : 42;
  if (Number.isNaN(prefix) || prefix < 0) {
    console.error(`Invalid prefix "${opts.prefix}". Must be a non-negative integer.`);
    process.exit(1);
  }

  let name: string | undefined;
  let publicKeyHex: string;
  let bandersnatch: Record<string, string> | undefined;
  let hasSecret = false;
  let storedAccount: StoredAccount | undefined;
  let isDev = false;
  let isH160Fallback = false;
  // Synthetic source for the stateless-derivation branch — same shape as
  // StoredAccount.source so the JSON/pretty-print branches downstream don't
  // need a separate code path.
  let virtualSource:
    | { kind: "pallet"; palletIdHex: string }
    | { kind: "parachain"; paraId: number; type: "child" | "sibling" }
    | undefined;

  if (sovereignSource) {
    if (sovereignSource.kind === "pallet") {
      const accountId = derivePalletAccount(sovereignSource.palletId);
      publicKeyHex = publicKeyToHex(accountId);
      virtualSource = {
        kind: "pallet",
        palletIdHex: `0x${Array.from(sovereignSource.palletId, (b) => b.toString(16).padStart(2, "0")).join("")}`,
      };
    } else {
      const accountId = deriveSovereignAccount(sovereignSource.paraId, sovereignSource.type);
      publicKeyHex = publicKeyToHex(accountId);
      virtualSource = {
        kind: "parachain",
        paraId: sovereignSource.paraId,
        type: sovereignSource.type,
      };
    }
  }
  // 1. Dev account name
  else if (isDevAccount(input!)) {
    name = input!.charAt(0).toUpperCase() + input!.slice(1).toLowerCase();
    const devAddr = getDevAddress(input!);
    publicKeyHex = publicKeyToHex(fromSs58(devAddr));
    hasSecret = true;
    isDev = true;
  }
  // 2. Stored account name
  else {
    const accountsFile = await loadAccounts();
    const account = findAccount(accountsFile, input!);
    if (account) {
      name = account.name;
      bandersnatch = account.bandersnatch;
      hasSecret = account.secret !== undefined;
      storedAccount = account;
      if (account.publicKey) {
        publicKeyHex = account.publicKey;
      } else if (account.secret !== undefined && isEnvSecret(account.secret)) {
        const derived = tryDerivePublicKey(account.secret.env, account.derivationPath);
        if (!derived) {
          console.error(
            `Cannot derive public key for "${account.name}": $${account.secret.env} is not set.`,
          );
          process.exit(1);
        }
        publicKeyHex = derived;
      } else {
        // Should not happen for well-formed accounts
        console.error(`Account "${account.name}" has no public key.`);
        process.exit(1);
      }
    }
    // 3. Hex public key
    else if (isHexPublicKey(input!)) {
      publicKeyHex = input!;
    }
    // 4. H160 (20-byte hex) — revive fallback AccountId32 (H160 || 0xEE * 12)
    else if (isH160Hex(input!)) {
      const fallback = h160ToFallbackAccountId(h160FromHex(input!));
      publicKeyHex = publicKeyToHex(fallback);
      isH160Fallback = true;
    }
    // 5. Try SS58 decode
    else {
      try {
        const decoded = fromSs58(input!);
        publicKeyHex = publicKeyToHex(decoded);
      } catch {
        console.error(
          `Cannot identify "${input}" as an account name, SS58 address, hex public key, or H160.`,
        );
        process.exit(1);
      }
    }
  }

  const ss58 = toSs58(publicKeyHex!, prefix);
  const h160Hex = toEip55(accountIdToH160(nobleHexToBytes(publicKeyHex!.slice(2))));

  let privateKeyHex: string | undefined;
  // The original stored secret revealed alongside the expanded private key.
  // Only for stored accounts whose secret is a literal phrase/seed — env-backed
  // secrets stay redacted (shown as `$VAR`), and an expanded secret is already
  // printed as the Private Key, so we don't duplicate it.
  let revealedSecret: { label: string; field: string; value: string } | undefined;
  if (opts.showSecret) {
    if (!name) {
      console.error(
        "--show-secret requires an account name; raw addresses and hex keys have no secret to reveal.",
      );
      process.exit(1);
    }
    if (!hasSecret) {
      console.error(`Account "${name}" is watch-only (no secret). Cannot reveal private key.`);
      process.exit(1);
    }
    try {
      privateKeyHex = bytesToHex(await resolveAccountExpandedSecret(input!));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    if (storedAccount?.secret !== undefined && !isEnvSecret(storedAccount.secret)) {
      const kind = secretKind(storedAccount.secret);
      if (kind === "mnemonic") {
        revealedSecret = { label: "Mnemonic", field: "mnemonic", value: storedAccount.secret };
      } else if (kind === "seed") {
        revealedSecret = { label: "Seed", field: "seed", value: storedAccount.secret };
      }
    }
  }

  // Compute kind label and source description (only meaningful for known accounts)
  let kindLabel: string | undefined;
  let sourceLine: string | undefined;
  let derivationLine: string | undefined;
  let envLine: string | undefined;

  if (virtualSource?.kind === "pallet") {
    kindLabel = "pallet sovereign";
    const bytes = parsePalletId(virtualSource.palletIdHex);
    sourceLine = `PalletId ${formatPalletId(bytes)} (${virtualSource.palletIdHex})`;
  } else if (virtualSource?.kind === "parachain") {
    kindLabel = `parachain sovereign (${virtualSource.type})`;
    sourceLine = `parachain ${virtualSource.paraId}`;
  } else if (isDev) {
    kindLabel = "dev";
  } else if (isH160Fallback) {
    kindLabel = "revive H160 fallback";
  } else if (storedAccount) {
    const k = classifyAccount(storedAccount);
    if (k === "pallet" && storedAccount.source?.kind === "pallet") {
      kindLabel = "pallet sovereign";
      const bytes = parsePalletId(storedAccount.source.palletId);
      sourceLine = `PalletId ${formatPalletId(bytes)} (${storedAccount.source.palletId})`;
    } else if (k === "parachain" && storedAccount.source?.kind === "parachain") {
      kindLabel = `parachain sovereign (${storedAccount.source.type})`;
      sourceLine = `parachain ${storedAccount.source.paraId}`;
    } else if (k === "signer") {
      kindLabel = "signer";
    } else {
      kindLabel = "watch-only";
    }
    if (storedAccount.derivationPath) derivationLine = storedAccount.derivationPath;
    if (storedAccount.secret !== undefined && isEnvSecret(storedAccount.secret)) {
      envLine = `$${storedAccount.secret.env}`;
    }
  }

  if (isJsonOutput(opts)) {
    const result: Record<string, unknown> = {
      publicKey: publicKeyHex!,
      ss58,
      h160: h160Hex,
      prefix,
    };
    if (name) result.name = name;
    if (kindLabel) result.kind = kindLabel;
    if (virtualSource?.kind === "pallet") {
      const bytes = parsePalletId(virtualSource.palletIdHex);
      result.source = {
        kind: "pallet",
        palletId: formatPalletId(bytes),
        palletIdHex: virtualSource.palletIdHex,
      };
    } else if (virtualSource?.kind === "parachain") {
      result.source = {
        kind: "parachain",
        paraId: virtualSource.paraId,
        type: virtualSource.type,
      };
    } else if (storedAccount?.source) {
      if (storedAccount.source.kind === "pallet") {
        const bytes = parsePalletId(storedAccount.source.palletId);
        result.source = {
          kind: "pallet",
          palletId: formatPalletId(bytes),
          palletIdHex: storedAccount.source.palletId,
        };
      } else {
        result.source = storedAccount.source;
      }
    }
    if (derivationLine) result.derivationPath = derivationLine;
    if (envLine) result.env = envLine.replace(/^\$/, "");
    if (bandersnatch && Object.keys(bandersnatch).length > 0) result.bandersnatch = bandersnatch;
    if (revealedSecret) result[revealedSecret.field] = revealedSecret.value;
    if (privateKeyHex) result.privateKey = privateKeyHex;
    console.log(formatJson(result));
  } else {
    printHeading("Account Info");
    if (name) console.log(`  ${BOLD}Name:${RESET}        ${name}`);
    if (kindLabel) console.log(`  ${BOLD}Kind:${RESET}        ${kindLabel}`);
    console.log(`  ${BOLD}Public Key:${RESET}  ${publicKeyHex!}`);
    console.log(`  ${BOLD}SS58:${RESET}        ${ss58}`);
    console.log(`  ${BOLD}H160:${RESET}        ${h160Hex}`);
    if (sourceLine) console.log(`  ${BOLD}Source:${RESET}      ${sourceLine}`);
    if (derivationLine) console.log(`  ${BOLD}Derivation:${RESET}  ${derivationLine}`);
    if (envLine) console.log(`  ${BOLD}Env:${RESET}         ${envLine}`);
    if (bandersnatch && Object.keys(bandersnatch).length > 0) {
      const entries = Object.entries(bandersnatch);
      for (let i = 0; i < entries.length; i++) {
        const [key, hex] = entries[i]!;
        const label = key ? `(${key})` : "";
        if (i === 0) {
          console.log(`  ${BOLD}Bandersnatch:${RESET}${label ? ` ${label}` : ""} ${hex}`);
        } else {
          // Align the hex under the first row's, past the "  Bandersnatch: " label.
          console.log(`                ${label ? `${label} ` : ""}${hex}`);
        }
      }
    }
    console.log(`  ${BOLD}Prefix:${RESET}      ${prefix}`);
    if (revealedSecret) {
      console.log(
        `  ${BOLD}${`${revealedSecret.label}:`.padEnd(13)}${RESET}${revealedSecret.value}`,
      );
      // The revealed phrase/seed alone reproduces the address only when no path
      // was applied. With a derivation path, re-import must re-supply it — bind
      // that warning to the secret so it can't be copied away from the hint.
      if (derivationLine) {
        console.log(
          `               ${YELLOW}(derived with ${derivationLine} — re-import needs --path ${derivationLine})${RESET}`,
        );
      }
    }
    if (privateKeyHex) {
      console.log(`  ${BOLD}Private Key:${RESET} ${privateKeyHex}`);
      console.log(`               ${YELLOW}(sr25519 expanded, 64 bytes — never share)${RESET}`);
    }
    console.log();
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const REDACTED = "<redacted>";

interface ExportedAccount {
  name: string;
  publicKey: string;
  derivationPath: string;
  secret?: string | EnvSecret;
  bandersnatch?: Record<string, string>;
}

interface AccountExportData {
  accounts: ExportedAccount[];
}

async function accountExport(
  names: string[],
  opts: {
    file?: string;
    includeSecrets?: boolean;
    watchOnly?: boolean;
    output?: string;
    json?: boolean;
  },
) {
  const accountsFile = await loadAccounts();

  if (opts.includeSecrets) {
    process.stderr.write(`${YELLOW}Warning: secrets are included in the export.${RESET}\n`);
  }

  let accounts = accountsFile.accounts;

  if (names.length > 0) {
    const filtered: StoredAccount[] = [];
    for (const input of names) {
      const account = findAccount(accountsFile, input);
      if (!account) {
        throw new Error(`Account "${input}" not found.`);
      }
      filtered.push(account);
    }
    accounts = filtered;
  }

  if (opts.watchOnly) {
    accounts = accounts.filter((a) => isWatchOnly(a));
  }

  const exported: ExportedAccount[] = accounts.map((account) => {
    const entry: ExportedAccount = {
      name: account.name,
      publicKey: account.publicKey,
      derivationPath: account.derivationPath,
    };

    if (isWatchOnly(account)) {
      // No secret field for watch-only
    } else if (account.secret !== undefined && isEnvSecret(account.secret)) {
      // Env var name is always safe to export
      entry.secret = account.secret;
    } else if (opts.includeSecrets) {
      entry.secret = account.secret;
    } else {
      entry.secret = REDACTED;
    }

    if (account.bandersnatch && Object.keys(account.bandersnatch).length > 0) {
      entry.bandersnatch = account.bandersnatch;
    }

    return entry;
  });

  const exportData: AccountExportData = { accounts: exported };
  const json = `${JSON.stringify(exportData, null, 2)}\n`;

  if (opts.file) {
    await writeFile(opts.file, json);
    if (isJsonOutput(opts)) {
      console.log(formatJson({ action: "exported", file: opts.file, count: exported.length }));
    } else {
      console.log(`Exported ${exported.length} account(s) to ${opts.file}`);
    }
  } else {
    process.stdout.write(json);
  }
}

async function accountBatchImport(
  filePath: string | undefined,
  opts: {
    file?: string;
    overwrite?: boolean;
    dryRun?: boolean;
    output?: string;
    json?: boolean;
  },
) {
  const inputPath = filePath ?? opts.file;
  let raw: string;
  if (!inputPath || inputPath === "-") {
    if (process.stdin.isTTY) {
      console.log(ACCOUNT_HELP);
      return;
    }
    raw = await readStdin();
  } else {
    raw = await readFile(inputPath, "utf-8");
  }

  let importData: AccountExportData;
  try {
    importData = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON input.");
  }

  if (!Array.isArray(importData.accounts)) {
    throw new Error('Invalid import format: missing "accounts" array.');
  }

  const accountsFile = await loadAccounts();
  const added: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];

  for (const entry of importData.accounts) {
    if (!entry.name) {
      process.stderr.write(`${YELLOW}Skipped entry with missing name.${RESET}\n`);
      continue;
    }

    if (isDevAccount(entry.name)) {
      process.stderr.write(`${YELLOW}Skipped "${entry.name}": built-in dev account.${RESET}\n`);
      skipped.push(entry.name);
      continue;
    }

    const existing = findAccount(accountsFile, entry.name);

    if (existing && !opts.overwrite) {
      skipped.push(entry.name);
      process.stderr.write(
        `${YELLOW}Skipped "${entry.name}": already exists (use --overwrite to replace)${RESET}\n`,
      );
      continue;
    }

    // Build the StoredAccount from the imported entry
    const stored: StoredAccount = {
      name: entry.name,
      publicKey: entry.publicKey || "",
      derivationPath: entry.derivationPath || "",
    };

    if (entry.secret === undefined || entry.secret === REDACTED) {
      // Watch-only: no secret, preserve publicKey
    } else if (typeof entry.secret === "object" && "env" in entry.secret) {
      // Env-backed account
      stored.secret = entry.secret;
      if (!stored.publicKey) {
        stored.publicKey = tryDerivePublicKey(entry.secret.env, stored.derivationPath) ?? "";
      }
    } else if (typeof entry.secret === "string") {
      // Mnemonic or hex seed — validate and derive publicKey
      stored.secret = entry.secret;
      try {
        const { publicKey } = importAccount(entry.secret, stored.derivationPath);
        stored.publicKey = publicKeyToHex(publicKey);
      } catch {
        process.stderr.write(
          `${YELLOW}Warning: "${entry.name}" has an invalid secret, importing as watch-only.${RESET}\n`,
        );
        delete stored.secret;
      }
    }

    if (entry.bandersnatch && Object.keys(entry.bandersnatch).length > 0) {
      stored.bandersnatch = entry.bandersnatch;
    }

    if (existing) {
      // Replace in-place
      const idx = accountsFile.accounts.findIndex(
        (a) => a.name.toLowerCase() === entry.name.toLowerCase(),
      );
      accountsFile.accounts[idx] = stored;
      overwritten.push(entry.name);
    } else {
      accountsFile.accounts.push(stored);
      added.push(entry.name);
    }
  }

  if (!opts.dryRun) {
    await saveAccounts(accountsFile);
  }

  if (isJsonOutput(opts)) {
    console.log(
      formatJson({
        action: opts.dryRun ? "dry-run" : "imported",
        added,
        overwritten,
        skipped,
      }),
    );
    return;
  }

  printImportResults({
    added,
    overwritten,
    skipped,
    dryRun: opts.dryRun ?? false,
    noun: "account",
  });
}
