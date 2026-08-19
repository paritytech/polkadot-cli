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
  deriveLegacyMemberEntropy,
  deriveMemberKey,
  deriveRingVrfEntropy,
  encodeContext,
  encodeMembers,
  isPersonKind,
  isRingExponent,
  PERSON_INDEX,
  PERSONHOOD_PRODUCT_ID,
  type PersonKind,
  parseRawEntropy,
  resolveEntropyKey,
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
 * How the member secret is obtained. Four tiers, from most opinionated to least:
 * the RFC-0022 well-known personhood paths, an arbitrary RFC-0022 tree path, the
 * pre-RFC-0022 single keyed hash, and raw caller-supplied bytes.
 */
type KeySource =
  | { kind: "tree"; productId: string; index: number; person?: PersonKind }
  | { kind: "legacy"; entropyKey?: string }
  | { kind: "raw"; entropy: Uint8Array };

function parseIndex(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new CliError(`Invalid --index "${value}". Expected a u32 (0 … 4294967295).`);
  }
  return n;
}

/**
 * Resolve the selector flags to a {@link KeySource}, rejecting combinations that
 * would silently pick one scheme while the caller meant another. Getting this
 * wrong yields a valid-looking key that no ring holds, so every conflict is an
 * error rather than a precedence rule.
 */
function resolveKeySource(opts: VerifiableOpts): KeySource {
  const treeFlags = [
    opts.person !== undefined && "--person",
    opts.product !== undefined && "--product",
    opts.index !== undefined && "--index",
  ].filter(Boolean) as string[];

  if (opts.entropy !== undefined) {
    const conflicts = [...treeFlags, opts.entropyKey !== undefined && "--entropy-key"].filter(
      Boolean,
    );
    if (conflicts.length > 0) {
      throw new CliError(
        `--entropy is the member secret itself, so it cannot be combined with ${conflicts.join(", ")}.`,
      );
    }
    return { kind: "raw", entropy: parseRawEntropy(opts.entropy) };
  }

  if (opts.entropyKey !== undefined) {
    if (treeFlags.length > 0) {
      throw new CliError(
        `--entropy-key selects the legacy pre-RFC-0022 scheme, so it cannot be ` +
          `combined with ${treeFlags.join(", ")}.`,
      );
    }
    return { kind: "legacy", entropyKey: opts.entropyKey };
  }

  if (opts.person !== undefined && opts.index !== undefined) {
    throw new CliError(
      `--person already fixes the index (full=0, lite=1). Use --index on its own, ` +
        `or with --product, to pick an arbitrary one.`,
    );
  }

  const productId = opts.product ?? PERSONHOOD_PRODUCT_ID;

  if (opts.index !== undefined) {
    return { kind: "tree", productId, index: parseIndex(opts.index) };
  }

  const person = opts.person ?? "full";
  if (!isPersonKind(person)) {
    throw new CliError(`Invalid --person "${person}". Supported: full, lite.`);
  }
  return { kind: "tree", productId, index: PERSON_INDEX[person], person };
}

/** Whether this source needs an account at all — raw entropy stands alone. */
function sourceNeedsAccount(source: KeySource): boolean {
  return source.kind !== "raw";
}

async function entropyForSource(
  source: KeySource,
  account: string | undefined,
): Promise<Uint8Array> {
  if (source.kind === "raw") return source.entropy;
  const mnemonic = await resolveMnemonic(account!);
  if (source.kind === "legacy") {
    return deriveLegacyMemberEntropy(mnemonic, resolveEntropyKey(source.entropyKey));
  }
  return deriveRingVrfEntropy(mnemonic, source.productId, source.index);
}

/** Human-readable description of what produced the key, for output and JSON. */
interface SourceDescription {
  scheme: string;
  product?: string;
  path?: string;
  person?: string;
  entropyKey?: string;
}

function describeSource(source: KeySource): SourceDescription {
  switch (source.kind) {
    case "raw":
      return { scheme: "raw (caller-supplied entropy)" };
    case "legacy":
      return {
        scheme: "legacy keyed-hash (pre-RFC-0022)",
        // An empty --entropy-key is the unkeyed (lite) variant, not a key of "".
        entropyKey: source.entropyKey ? source.entropyKey : "(unkeyed)",
      };
    default:
      return {
        scheme: "RFC-0022 ring-VRF",
        product: source.productId,
        path: `//${source.productId}//${source.index}`,
        ...(source.person ? { person: source.person } : {}),
      };
  }
}

/**
 * Resolve an account + selector flags to the member secret. Raw entropy needs no
 * account; every other tier does.
 */
async function resolveEntropy(
  account: string | undefined,
  opts: VerifiableOpts,
  action: string,
): Promise<Uint8Array> {
  const source = resolveKeySource(opts);
  if (sourceNeedsAccount(source)) requireAccount(account, action);
  return entropyForSource(source, account);
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
 * store as `full` / `lite`; anything else stores under a namespaced key so it can
 * never be mistaken for one of them (and so `--entropy-key full` cannot collide).
 * Raw entropy is never persisted — it belongs to no account.
 */
function bandersnatchEntryKey(source: KeySource): string | undefined {
  switch (source.kind) {
    case "raw":
      return undefined;
    case "legacy":
      return `legacy:${source.entropyKey ?? ""}`;
    default:
      return source.productId === PERSONHOOD_PRODUCT_ID && source.person
        ? source.person
        : `${source.productId}/${source.index}`;
  }
}

async function deriveMember(accountArg: string | undefined, opts: VerifiableOpts) {
  const source = resolveKeySource(opts);
  const needsAccount = sourceNeedsAccount(source);
  const account = needsAccount ? requireAccount(accountArg, "member") : accountArg;

  let entropy: Uint8Array;
  let accountsFile: AccountsFile | undefined;
  let stored: StoredAccount | undefined;

  if (source.kind === "raw") {
    entropy = source.entropy;
  } else if (isDevAccount(account!)) {
    entropy = await entropyForSource(source, account);
  } else {
    // Load through the accounts file rather than resolveMnemonic, so the derived
    // key can be written back to the stored account below.
    accountsFile = await loadAccounts();
    stored = findAccount(accountsFile, account!);
    const mnemonic = mnemonicFromStored(stored, account!, accountsFile);
    entropy =
      source.kind === "legacy"
        ? deriveLegacyMemberEntropy(mnemonic, resolveEntropyKey(source.entropyKey))
        : deriveRingVrfEntropy(mnemonic, source.productId, source.index);
  }

  const memberKeyHex = publicKeyToHex(deriveMemberKey(entropy));
  const described = describeSource(source);

  const entryKey = bandersnatchEntryKey(source);
  if (stored && accountsFile && entryKey !== undefined) {
    if (!stored.bandersnatch) stored.bandersnatch = {};
    if (stored.bandersnatch[entryKey] !== memberKeyHex) {
      stored.bandersnatch[entryKey] = memberKeyHex;
      await saveAccounts(accountsFile);
    }
  }

  if (isJsonOutput(opts)) {
    console.log(
      formatJson({ ...(account ? { account } : {}), ...described, memberKey: memberKeyHex }),
    );
  } else {
    // Pad past the longest label ("Entropy Key:", 12) so every value lines up
    // with at least one separating space.
    const row = (label: string, value: string) =>
      console.log(`  ${BOLD}${`${label}:`.padEnd(13)}${RESET}${value}`);

    printHeading("Bandersnatch Member Key");
    if (account) row("Account", account);
    // Always state the scheme: a key from the wrong tier looks identical, and the
    // only signal that it will not validate against a ring is this line.
    row("Scheme", described.scheme);
    if (described.person) row("Person", described.person);
    if (described.path) row("Path", described.path);
    if (described.entropyKey) row("Entropy Key", described.entropyKey);
    row("Member Key", memberKeyHex);
    console.log();
  }
}

async function deriveAliasCmd(accountArg: string | undefined, opts: VerifiableOpts) {
  const contextStr = requireOption(opts.context, "--context", "alias");
  const entropy = await resolveEntropy(accountArg, opts, "alias");
  const account = accountArg;
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
  const message = await resolveMessage(opts);
  const entropy = await resolveEntropy(accountArg, opts, "sign");
  const account = accountArg;
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
  const contextStr = requireOption(opts.context, "--context", "prove");
  const membersArg = requireOption(opts.members, "--members", "prove");
  const message = await resolveMessage(opts);
  const ringExponent = resolveRingExponent(opts);
  const entropy = await resolveEntropy(accountArg, opts, "prove");
  const account = accountArg;
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
