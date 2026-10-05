export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * A CLI error caused by missing or invalid input, carrying the usage hint to
 * show alongside it. Kept separate from the message so `--json` can emit the
 * usage as its own field instead of baking it into `error`.
 */
export class UsageError extends CliError {
  constructor(
    message: string,
    readonly usage: string,
  ) {
    super(message);
    this.name = "UsageError";
  }
}

export class ConnectionError extends CliError {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

export class MetadataError extends CliError {
  constructor(message: string) {
    super(message);
    this.name = "MetadataError";
  }
}

// papi internal teardown races we deliberately ignore at the process boundary.
// These come from @polkadot-api/observable-client follow-stream timers firing
// after client.destroy() has already cleared the underlying connection.
const PAPI_CLEANUP_PATTERNS: RegExp[] = [
  /^Not connected$/,
  /DisjointError/,
  /ChainHead.*(aborted|stopped)/i,
];

export function isPapiCleanupError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return PAPI_CLEANUP_PATTERNS.some((re) => re.test(err.message));
}

// Errors that smell like the runtime saw a SCALE-encoded extrinsic / storage
// key produced from out-of-date type tables, or signed-extension fields that
// disagree with the live runtime. These are the symptoms of stale local
// metadata. User-typo errors ("pallet not found", "call not found") are
// deliberately NOT in this set — they propagate immediately. BadProof /
// AncientBirthBlock come from TransactionValidityError after a runtime
// upgrade: CheckSpecVersion / CheckTxVersion / CheckGenesis / CheckMortality
// fields are part of the signed payload, so a signer using stale values
// produces a payload the runtime won't reconstruct identically. The
// withStalenessSuggestion fingerprint check is the safety net for the
// false-positive cases (wrong key, wrong chain) — if cached fingerprint
// matches live, the raw error passes through unchanged.
const STALE_METADATA_PATTERNS: RegExp[] = [
  /wasm trap/i,
  /wasm `?unreachable`? instruction/i,
  /Execution aborted due to trap/i,
  /codec/i,
  /decod(e|ing)/i,
  /Lookup failed/i,
  /metadata.*mismatch/i,
  /BadProof/,
  /AncientBirthBlock/,
];

export function isLikelyStaleMetadataError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!msg) return false;
  return STALE_METADATA_PATTERNS.some((re) => re.test(msg));
}

// Errors papi raises when the requested block is not available on the
// connected node — typically a hash older than the chainHead_v1_* pinned
// window, or a hash that never existed. The user fix is to point --rpc at
// an archive endpoint, which lives in `withBlockAvailabilityHint`.
const BLOCK_UNAVAILABLE_PATTERNS: RegExp[] = [
  /is not pinned/i,
  /Invalid BlockHash/i,
  /UnknownBlock.*Header was not found/i,
];

export function isBlockUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!msg) return false;
  return BLOCK_UNAVAILABLE_PATTERNS.some((re) => re.test(msg));
}

export function formatRuntimeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (/wasm trap|wasm `?unreachable`? instruction|Execution aborted due to trap/i.test(msg)) {
    // wasm backtrace lists innermost frames first (rust_begin_unwind, panic_fmt,
    // …) and the runtime entrypoint last. Skip the panic plumbing and pick the
    // last informative frame.
    const frames = Array.from(msg.matchAll(/\.wasm!([A-Za-z_]\w+)/g)).map((m) => m[1] as string);
    const fn = [...frames]
      .reverse()
      .find((name) => !/^(?:__rustc|core::panicking|rust_begin_unwind|panic_fmt)/.test(name));
    const where = fn?.includes("validate_transaction")
      ? "the runtime's validate_transaction step"
      : fn
        ? `runtime function ${fn}`
        : "the runtime";
    return [
      `The runtime rejected this transaction in ${where}.`,
      "  Cause: a runtime invariant failed — typically the call's arguments are out of range, reference an unknown id, or violate a precondition.",
      "  Tip:   re-check the arguments and the signing account's permissions; --dry-run will surface the same error before signing.",
    ].join("\n");
  }

  if (/Invalid Transaction/i.test(msg)) {
    return `Transaction rejected as invalid by the runtime: ${msg}`;
  }

  return msg;
}
