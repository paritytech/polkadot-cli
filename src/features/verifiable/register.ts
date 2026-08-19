import type { CAC } from "cac";
import { BOLD, RESET, readRawOptionValue, withHelp } from "../../platform/index.ts";

/**
 * Command registration for `dot verifiable`, kept free of heavy imports: the
 * handlers in `./commands.ts` (and through them `./lib.ts` → the verifiablejs
 * WASM, ~7 MB instantiated at import time) are loaded lazily inside the action,
 * so every other `dot` command starts without paying for the crypto stack.
 */

const VERIFIABLE_HELP = `
${BOLD}Usage:${RESET}
  $ dot verifiable [account] [--person full|lite]        Derive the member key (default action)
  $ dot verifiable <action> [account] [options]

${BOLD}Actions:${RESET}
  member <account>      Derive the Bandersnatch member key (default if omitted)
  alias  <account>      Derive the alias for a 32-byte ring context
  sign   <account>      Standalone Bandersnatch signature (64 bytes)
  prove  <account>      Ring-VRF proof (one_shot) over a members set
  verify                Locally verify a ring-VRF proof against members/root
  verify-sig            Verify a standalone Bandersnatch signature
  members <key…>        SCALE-encode member keys as Vec<[u8;32]>

  verify / verify-sig exit non-zero on failure (the verdict is the exit code);
  on success they print the recovered alias / {"valid":true}.

${BOLD}Key concepts (do not conflate these):${RESET}
  --person full|lite
        Which personhood key to derive (RFC-0022). ${BOLD}full${RESET} (default) is
        //peopl.dot//0, the "PoP" key in ring pop:polkadot.network/people;
        ${BOLD}lite${RESET} is //peopl.dot//1, ring pop:polkadot.network/people-lite.
        Two keys held at once, not a rotation. Must match the one registered
        on-chain, or you derive a different (unrecognised) member key.
  --context <text|0xhex>
        The 32-byte ring/proof namespace (e.g. "dotns"), zero-padded right to 32
        bytes like Solidity bytes32(). Determines the alias. Used by alias/prove/verify.
        It is NOT part of key derivation.

${BOLD}Options:${RESET}
  --person <full|lite>  Which personhood key to derive (default: full)
  --product <id>        Override the reserved product id (default: peopl.dot).
                        Escape hatch only — the reference apps pin peopl.dot on
                        every network, so a different id derives a key no ring has.
  --context <value>     32-byte ring context (alias/prove/verify)
  --message <data>      Message to sign / bind / verify (text or 0x hex)
  --file <path>         Read the message from a file (raw bytes)
  --stdin               Read the message from stdin
  --members <hex|file>  SCALE-encoded Vec<[u8;32]> ring (prove/verify)
  --root <hex>          768-byte ring root / commitment (verify)
  --proof <hex>         Ring-VRF proof bytes (verify)
  --signature <hex>     Bandersnatch signature (verify-sig)
  --member <hex>        32-byte member public key (verify-sig)
  --ring-exponent <n>   Ring exponent: 9 (default), 10, or 14
  --output json         Output as JSON

${BOLD}Examples:${RESET}
  $ dot verifiable alice                                 Full member key
  $ dot verifiable alice --person lite                   Lite member key
  $ dot verifiable alias alice --context dotns
  $ dot verifiable sign alice --message "hello"
  $ dot verifiable prove alice --context dotns --message 0x… --members 0x…
  $ dot verifiable verify --proof 0x… --context dotns --message 0x… --members 0x…
  $ dot verifiable members 0x… 0x…

${BOLD}Derivation flow (RFC-0022, hard junctions only):${RESET}

  Mnemonic ─BIP39─▶ entropy ─┬─ blake2b(key "ring-vrf")        tree root
                             ├─ blake2b(key cc("//peopl.dot")) product node   (--product)
                             └─ blake2b(key index_bytes(0|1))  member entropy (--person)
                                                     │
                                    ring proof: one_shot(…, --context, --message)
`.trimStart();

export interface VerifiableOpts {
  output?: string;
  json?: boolean;
  entropyKey?: string; // removed flag: retained so the handler can reject it with a pointer
  person?: string;
  product?: string;
  context?: string;
  message?: string;
  file?: string;
  stdin?: boolean;
  members?: string;
  root?: string;
  proof?: string;
  signature?: string;
  member?: string;
  ringExponent?: string;
}

/** Flags whose values may be 0x-hex and must survive mri's numeric coercion. */
const RAW_STRING_FLAGS: Array<[string, keyof VerifiableOpts]> = [
  ["entropy-key", "entropyKey"],
  ["person", "person"],
  ["product", "product"],
  ["context", "context"],
  ["message", "message"],
  ["members", "members"],
  ["root", "root"],
  ["proof", "proof"],
  ["signature", "signature"],
  ["member", "member"],
];

export function registerVerifiableCommands(cli: CAC) {
  const command = cli
    .command(
      "verifiable [action] [...rest]",
      "Bandersnatch member keys, ring-VRF proofs, signing and verification",
    )
    .option("--person <kind>", "Personhood key to derive: full (default) or lite")
    .option("--product <id>", "Override the reserved product id (default: peopl.dot)")
    .option("--entropy-key <key>", "Removed — use --person full|lite")
    .option("--context <value>", "32-byte ring/proof context (alias/prove/verify)")
    .option("--message <data>", "Message to sign/bind/verify (text or 0x hex)")
    .option("--file <path>", "Read message from a file (raw bytes)")
    .option("--stdin", "Read message from stdin")
    .option("--members <hex|file>", "SCALE-encoded Vec<[u8;32]> ring (prove/verify)")
    .option("--root <hex>", "768-byte ring root/commitment (verify)")
    .option("--proof <hex>", "Ring-VRF proof bytes (verify)")
    .option("--signature <hex>", "Bandersnatch signature (verify-sig)")
    .option("--member <hex>", "32-byte member public key (verify-sig)")
    .option("--ring-exponent <n>", "Ring exponent: 9 (default), 10, or 14")
    .action(async (action: string | undefined, rest: string[], opts: VerifiableOpts) => {
      if (!action) {
        console.log(VERIFIABLE_HELP);
        return;
      }

      // CAC delegates to mri, which silently coerces 0x-hex option values to JS
      // Numbers (losing the bytes). Re-read every hex/string-bearing flag from
      // raw argv so values reach the handlers intact.
      for (const [flag, key] of RAW_STRING_FLAGS) {
        const raw = readRawOptionValue(flag);
        if (raw !== undefined) (opts as Record<string, unknown>)[key] = raw;
      }

      const { runVerifiable } = await import("./commands.ts");
      return runVerifiable(action, rest, opts);
    });
  withHelp(command, () => console.log(VERIFIABLE_HELP));
}
