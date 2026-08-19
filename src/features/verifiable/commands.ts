import { readFile } from "node:fs/promises";
import { DEV_PHRASE } from "@polkadot-labs/hdkd-helpers";
import {
  BOLD,
  CliError,
  DEV_NAMES,
  findAccount,
  findClosest,
  formatJson,
  isDevAccount,
  isHexPublicKey,
  isJsonOutput,
  isWatchOnly,
  loadAccounts,
  parseInputData,
  printHeading,
  publicKeyToHex,
  RESET,
  resolveDataInput,
  resolveSecret,
  saveAccounts,
  toHex,
} from "../../platform/index.ts";
import {
  bandersnatchSign,
  DEFAULT_RING_EXPONENT,
  deriveAlias,
  deriveMemberKey,
  derivePersonEntropy,
  encodeContext,
  encodeMembers,
  isPersonKind,
  isRingExponent,
  PERSON_INDEX,
  PERSONHOOD_PRODUCT_ID,
  type PersonKind,
  ringProve,
  verifyBandersnatchSig,
  verifyRingProof,
} from "./lib.ts";
import type { VerifiableOpts } from "./register.ts";

/** Dispatch a `dot verifiable` invocation. Loaded lazily by `./register.ts`. */
export async function runVerifiable(action: string, rest: string[], opts: VerifiableOpts) {
  switch (action) {
    case "member":
      return deriveMember(rest[0], opts);
    case "alias":
      return deriveAliasCmd(rest[0], opts);
    case "sign":
      return signCmd(rest[0], opts);
    case "prove":
      return proveCmd(rest[0], opts);
    case "verify":
      return verifyCmd(opts);
    case "verify-sig":
      return verifySigCmd(opts);
    case "members":
      return membersCmd(rest, opts);
    default:
      // Back-compat: `dot verifiable <account>` derives the member key.
      return deriveMember(action, opts);
  }
}

// --- Shared helpers ---

type AccountsFile = Awaited<ReturnType<typeof loadAccounts>>;
type StoredAccount = NonNullable<ReturnType<typeof findAccount>>;

function mnemonicFromStored(
  stored: StoredAccount | undefined,
  account: string,
  accountsFile: AccountsFile,
): string {
  if (!stored) {
    const available = [...DEV_NAMES, ...accountsFile.accounts.map((a) => a.name)].sort((a, b) =>
      a.localeCompare(b),
    );
    const suggestions = findClosest(account, available);
    const hint = suggestions.length > 0 ? `\n  Did you mean: ${suggestions.join(", ")}?` : "";
    const list = available.map((a) => `\n    - ${a}`).join("");
    throw new Error(`Unknown account "${account}".${hint}\n  Available accounts:${list}`);
  }

  if (isWatchOnly(stored)) {
    throw new Error(
      `Account "${account}" is watch-only (no secret). Cannot derive Bandersnatch key.`,
    );
  }

  const secret = resolveSecret(stored.secret!);

  if (isHexPublicKey(`0x${secret.replace(/^0x/, "")}`)) {
    throw new Error(
      `Account "${account}" uses a hex seed. Bandersnatch derivation requires a BIP39 mnemonic.`,
    );
  }

  return secret;
}

async function resolveMnemonic(account: string): Promise<string> {
  if (isDevAccount(account)) {
    return DEV_PHRASE;
  }
  const accountsFile = await loadAccounts();
  return mnemonicFromStored(findAccount(accountsFile, account), account, accountsFile);
}

/**
 * Resolve `--person` / `--product`. `--entropy-key` was the pre-RFC-0022 flag and
 * is rejected with a pointer rather than ignored: silently deriving a different
 * key than the caller asked for would produce proofs no ring accepts.
 */
function resolvePersonSelector(opts: VerifiableOpts): { person: PersonKind; productId: string } {
  if (opts.entropyKey !== undefined) {
    throw new CliError(
      `"--entropy-key" was removed: member keys now follow RFC-0022 ` +
        `(//${PERSONHOOD_PRODUCT_ID}//index). Use "--person full" (was ` +
        `"--entropy-key candidate") or "--person lite" (was unkeyed).`,
    );
  }
  const value = opts.person ?? "full";
  if (!isPersonKind(value)) {
    throw new CliError(`Invalid --person "${value}". Supported: full, lite.`);
  }
  return { person: value, productId: opts.product ?? PERSONHOOD_PRODUCT_ID };
}

async function resolveEntropy(account: string, opts: VerifiableOpts): Promise<Uint8Array> {
  const { person, productId } = resolvePersonSelector(opts);
  const mnemonic = await resolveMnemonic(account);
  return derivePersonEntropy(mnemonic, person, productId);
}

function requireAccount(account: string | undefined, action: string): string {
  if (!account) {
    throw new CliError(`dot verifiable ${action} requires an account. See "dot verifiable".`);
  }
  return account;
}

function resolveMessage(opts: VerifiableOpts): Promise<Uint8Array> {
  return resolveDataInput(opts.message, opts, {
    conflict: "Provide only one of: --message, --file, or --stdin",
    missing: "No message provided. Use --message, --file, or --stdin",
  });
}

/** Resolve a bytes argument that is either 0x-hex or (when allowFile) a file path. */
async function resolveBytesArg(
  value: string,
  name: string,
  allowFile = false,
): Promise<Uint8Array> {
  if (value.startsWith("0x")) {
    return parseInputData(value);
  }
  if (allowFile) {
    const buf = await readFile(value);
    const text = buf.toString("utf8").trim();
    return text.startsWith("0x") ? parseInputData(text) : new Uint8Array(buf);
  }
  throw new CliError(`${name} must be 0x-prefixed hex`);
}

function resolveRingExponent(opts: VerifiableOpts) {
  if (opts.ringExponent === undefined) return DEFAULT_RING_EXPONENT;
  const n = Number(opts.ringExponent);
  if (!isRingExponent(n)) {
    throw new CliError(`Invalid --ring-exponent "${opts.ringExponent}". Supported: 9, 10, 14.`);
  }
  return n;
}

function requireOption(value: string | undefined, flag: string, action: string): string {
  if (value === undefined) {
    throw new CliError(`dot verifiable ${action} requires ${flag}.`);
  }
  return value;
}

// --- Actions ---

/**
 * Accounts-file key for a derived member key. The two reserved personhood keys
 * store as `full` / `lite`; a `--product` override stores under its full path so
 * it can never be mistaken for one of them.
 */
export function bandersnatchEntryKey(person: PersonKind, productId: string): string {
  return productId === PERSONHOOD_PRODUCT_ID ? person : `${productId}/${PERSON_INDEX[person]}`;
}

async function deriveMember(accountArg: string | undefined, opts: VerifiableOpts) {
  const account = requireAccount(accountArg, "member");
  const { person, productId } = resolvePersonSelector(opts);

  let mnemonic: string;
  let accountsFile: AccountsFile | undefined;
  let stored: StoredAccount | undefined;
  if (isDevAccount(account)) {
    mnemonic = DEV_PHRASE;
  } else {
    accountsFile = await loadAccounts();
    stored = findAccount(accountsFile, account);
    mnemonic = mnemonicFromStored(stored, account, accountsFile);
  }

  const memberKeyHex = publicKeyToHex(
    deriveMemberKey(derivePersonEntropy(mnemonic, person, productId)),
  );
  const path = `//${productId}//${PERSON_INDEX[person]}`;

  if (stored && accountsFile) {
    if (!stored.bandersnatch) stored.bandersnatch = {};
    const entryKey = bandersnatchEntryKey(person, productId);
    if (stored.bandersnatch[entryKey] !== memberKeyHex) {
      stored.bandersnatch[entryKey] = memberKeyHex;
      await saveAccounts(accountsFile);
    }
  }

  if (isJsonOutput(opts)) {
    console.log(formatJson({ account, person, product: productId, path, memberKey: memberKeyHex }));
  } else {
    printHeading("Bandersnatch Member Key");
    console.log(`  ${BOLD}Account:${RESET}    ${account}`);
    console.log(`  ${BOLD}Person:${RESET}     ${person}`);
    console.log(`  ${BOLD}Path:${RESET}       ${path}`);
    console.log(`  ${BOLD}Member Key:${RESET} ${memberKeyHex}`);
    console.log();
  }
}

async function deriveAliasCmd(accountArg: string | undefined, opts: VerifiableOpts) {
  const account = requireAccount(accountArg, "alias");
  const contextStr = requireOption(opts.context, "--context", "alias");
  const entropy = await resolveEntropy(account, opts);
  const context = encodeContext(contextStr);
  const aliasHex = toHex(deriveAlias(entropy, context));

  if (isJsonOutput(opts)) {
    console.log(formatJson({ account, context: contextStr, alias: aliasHex }));
  } else {
    printHeading("Verifiable Alias");
    console.log(`  ${BOLD}Account:${RESET} ${account}`);
    console.log(`  ${BOLD}Context:${RESET} ${contextStr}`);
    console.log(`  ${BOLD}Alias:${RESET}   ${aliasHex}`);
    console.log();
  }
}

async function signCmd(accountArg: string | undefined, opts: VerifiableOpts) {
  const account = requireAccount(accountArg, "sign");
  const message = await resolveMessage(opts);
  const entropy = await resolveEntropy(account, opts);
  const signature = bandersnatchSign(entropy, message);
  const member = deriveMemberKey(entropy);
  const sigHex = toHex(signature);
  const result = {
    type: "Bandersnatch",
    account,
    message: toHex(message),
    signature: sigHex,
    member: toHex(member),
    enum: `Bandersnatch(${sigHex})`,
  };

  if (isJsonOutput(opts)) {
    console.log(formatJson(result));
  } else {
    console.log(`  ${BOLD}Type:${RESET}       ${result.type}`);
    console.log(`  ${BOLD}Message:${RESET}    ${result.message}`);
    console.log(`  ${BOLD}Signature:${RESET}  ${result.signature}`);
    console.log(`  ${BOLD}Member:${RESET}     ${result.member}`);
    console.log(`  ${BOLD}Enum:${RESET}       ${result.enum}`);
  }
}

async function proveCmd(accountArg: string | undefined, opts: VerifiableOpts) {
  const account = requireAccount(accountArg, "prove");
  const contextStr = requireOption(opts.context, "--context", "prove");
  const membersArg = requireOption(opts.members, "--members", "prove");
  const message = await resolveMessage(opts);
  const ringExponent = resolveRingExponent(opts);
  const entropy = await resolveEntropy(account, opts);
  const context = encodeContext(contextStr);
  const members = await resolveBytesArg(membersArg, "--members", true);

  const { proof, alias } = ringProve(ringExponent, entropy, members, context, message);
  const result = {
    account,
    context: contextStr,
    ringExponent,
    alias: toHex(alias),
    proof: toHex(proof),
  };

  if (isJsonOutput(opts)) {
    console.log(formatJson(result));
  } else {
    printHeading("Ring-VRF Proof");
    console.log(`  ${BOLD}Account:${RESET}       ${account}`);
    console.log(`  ${BOLD}Context:${RESET}       ${contextStr}`);
    console.log(`  ${BOLD}Ring exponent:${RESET} ${ringExponent}`);
    console.log(`  ${BOLD}Alias:${RESET}         ${result.alias}`);
    console.log(`  ${BOLD}Proof:${RESET}         ${result.proof}`);
    console.log();
  }
}

async function verifyCmd(opts: VerifiableOpts) {
  const proofArg = requireOption(opts.proof, "--proof", "verify");
  const contextStr = requireOption(opts.context, "--context", "verify");
  if (!opts.members && !opts.root) {
    throw new CliError("dot verifiable verify requires --members or --root.");
  }
  if (opts.members && opts.root) {
    throw new CliError("Provide either --members or --root, not both.");
  }
  const message = await resolveMessage(opts);
  const ringExponent = resolveRingExponent(opts);
  const proof = await resolveBytesArg(proofArg, "--proof", true);
  const context = encodeContext(contextStr);
  const source = opts.root
    ? { commitment: await resolveBytesArg(opts.root, "--root", true) }
    : { members: await resolveBytesArg(opts.members!, "--members", true) };

  let aliasHex: string;
  try {
    aliasHex = toHex(verifyRingProof(ringExponent, proof, source, context, message));
  } catch (err) {
    const exponentHint =
      opts.ringExponent === undefined
        ? ` (assumed ring exponent ${ringExponent} — pass --ring-exponent if the ring uses 10 or 14)`
        : "";
    throw new CliError(
      `Ring-VRF proof is invalid: ${err instanceof Error ? err.message : String(err)}${exponentHint}`,
    );
  }

  if (isJsonOutput(opts)) {
    console.log(formatJson({ valid: true, alias: aliasHex, ringExponent }));
  } else {
    printHeading("Ring-VRF Verification");
    console.log(`  ${BOLD}Valid:${RESET} yes`);
    console.log(`  ${BOLD}Alias:${RESET} ${aliasHex}`);
    console.log();
  }
}

async function verifySigCmd(opts: VerifiableOpts) {
  const sigArg = requireOption(opts.signature, "--signature", "verify-sig");
  const memberArg = requireOption(opts.member, "--member", "verify-sig");
  const message = await resolveMessage(opts);
  const signature = await resolveBytesArg(sigArg, "--signature", true);
  const member = await resolveBytesArg(memberArg, "--member");

  const valid = verifyBandersnatchSig(signature, message, member);
  if (!valid) {
    throw new CliError("Bandersnatch signature is invalid.");
  }

  if (isJsonOutput(opts)) {
    console.log(formatJson({ valid: true }));
  } else {
    printHeading("Bandersnatch Signature Verification");
    console.log(`  ${BOLD}Valid:${RESET} yes`);
    console.log();
  }
}

async function membersCmd(rest: string[], opts: VerifiableOpts) {
  if (rest.length === 0) {
    throw new CliError("dot verifiable members requires one or more 0x-hex member keys.");
  }
  const memberBytes = rest.map((k) => {
    const bytes = parseInputData(k);
    if (bytes.length !== 32) {
      throw new CliError(`member key must be 32 bytes (got ${bytes.length}): ${k}`);
    }
    return bytes;
  });
  const encoded = toHex(encodeMembers(memberBytes));

  if (isJsonOutput(opts)) {
    console.log(formatJson({ count: rest.length, members: encoded }));
  } else {
    printHeading("Encoded Members");
    console.log(`  ${BOLD}Count:${RESET}   ${rest.length}`);
    console.log(`  ${BOLD}Members:${RESET} ${encoded}`);
    console.log();
  }
}
