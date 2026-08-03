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
  $ dot verifiable [account] [--entropy-key <key>]       Derive the member key (default action)
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
  --entropy-key <text|0xhex>
        Key mixed into the keyed-blake2b that turns your mnemonic into the
        Bandersnatch member entropy. Omit for a ${BOLD}lite${RESET} person (unkeyed);
        use "candidate" for a ${BOLD}full${RESET} person. Must match the key used when the
        member was recognised on-chain, or you derive a different (unrecognised)
        member key. It is NOT a derivation path and NOT the ring --context.
  --context <text|0xhex>
        The 32-byte ring/proof namespace (e.g. "dotns"), zero-padded right to 32
        bytes like Solidity bytes32(). Determines the alias. Used by alias/prove/verify.

${BOLD}Options:${RESET}
  --entropy-key <key>   Entropy-derivation key (see above)
  --context <value>     32-byte ring context (alias/prove/verify)
  --message <data>      Message to sign / bind / verify (text or 0x hex)
  --file <path>         Read the message from a file (raw bytes)
  --stdin               Read the message from stdin
  --members <keys|file> Ring members (prove/verify). Loose 32-byte keys
                        (concatenated hex or comma-separated hex), a file, or
                        the SCALE-encoded Vec<[u8;32]> from 'members' — any form.
  --root <hex>          768-byte ring root / commitment (verify)
  --proof <hex>         Ring-VRF proof bytes (verify)
  --signature <hex>     Bandersnatch signature (verify-sig)
  --member <hex>        32-byte member public key (verify-sig)
  --ring-exponent <n>   Ring exponent: 9 (default), 10, or 14
  --output json         Output as JSON

${BOLD}Examples:${RESET}
  $ dot verifiable alice                                 Lite member key
  $ dot verifiable alice --entropy-key candidate         Full member key
  $ dot verifiable alias alice --entropy-key candidate --context dotns
  $ dot verifiable sign alice --message "hello" --entropy-key candidate
  $ dot verifiable prove alice --entropy-key candidate --context dotns \\
      --message 0x… --members 0x…
  $ dot verifiable verify --proof 0x… --context dotns --message 0x… --members 0x…
  $ dot verifiable members 0x… 0x…

${BOLD}Derivation flow:${RESET}

  Mnemonic ─BIP39─▶ entropy ─keyed blake2b─▶ member entropy ─▶ member key / secret
                              (key = --entropy-key)                  │
                                                  ring proof: one_shot(…, --context, --message)
`.trimStart();

export interface VerifiableOpts {
  output?: string;
  json?: boolean;
  entropyKey?: string;
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
    .option("--entropy-key <key>", "Entropy-derivation key (omit = lite, 'candidate' = full)")
    .option("--context <value>", "32-byte ring/proof context (alias/prove/verify)")
    .option("--message <data>", "Message to sign/bind/verify (text or 0x hex)")
    .option("--file <path>", "Read message from a file (raw bytes)")
    .option("--stdin", "Read message from stdin")
    .option(
      "--members <keys|file>",
      "Ring members (prove/verify): loose/comma-separated 32-byte hex keys, a file, or the SCALE-encoded Vec<[u8;32]> from `members`",
    )
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
