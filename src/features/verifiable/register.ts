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

${BOLD}Where the member secret comes from (four tiers, pick one):${RESET}
  1. --person full|lite     ${BOLD}Well-known${RESET} RFC-0022 personhood keys (default: full).
                            full = //peopl.dot//0, ring pop:polkadot.network/people;
                            lite = //peopl.dot//1, ring …/people-lite. Two keys held
                            at once, not a rotation.
  2. --product <id> --index <n>
                            ${BOLD}Any${RESET} RFC-0022 tree path: //<id>//index_bytes(n).
                            For other products (dim2.dot, uid.dot, …) or indices.
                            --index defaults to 0; --person cannot be combined.
  3. --entropy-key <k>      ${BOLD}Legacy${RESET} pre-RFC-0022 scheme: one keyed blake2b over
                            the BIP39 entropy ("candidate" = full, omitted = lite).
                            For identities registered before the cutover, which
                            still hold these keys on-chain.
  4. --entropy 0x<64hex>    ${BOLD}Raw${RESET} — use these 32 bytes as the secret, no derivation
                            and no account needed. For keys from any other tool.

  Combining tiers is an error, never a precedence rule: a key from the wrong tier
  looks identical and simply fails to validate. The output always names the scheme.

${BOLD}Not a key input — do not conflate:${RESET}
  --context <text|0xhex>
        The 32-byte ring/proof namespace (e.g. "dotns"), zero-padded right to 32
        bytes like Solidity bytes32(). Determines the alias. Used by alias/prove/verify.
        It plays NO part in key derivation — on member it is an error (it once
        selected the legacy entropy key there; that is --entropy-key now).

${BOLD}Options:${RESET}
  --person <full|lite>  Personhood key to derive (default: full)
  --product <id>        RFC-0022 product id (default: peopl.dot). The reference
                        apps pin peopl.dot on every network, so a different id
                        derives a key no personhood ring has.
  --index <n>           RFC-0022 derivation index (u32); alternative to --person
  --entropy-key <key>   Legacy pre-RFC-0022 keyed-hash scheme
  --entropy <hex>       32 raw bytes to use as the member secret directly
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
  $ dot verifiable alice --product dim2.dot --index 1    Any RFC-0022 path
  $ dot verifiable alice --entropy-key candidate         Legacy (pre-RFC-0022) key
  $ dot verifiable --entropy 0x…                         Raw secret, no account
  $ dot verifiable alias alice --context dotns
  $ dot verifiable sign alice --message "hello"
  $ dot verifiable prove alice --context dotns --message 0x… --members 0x…
  $ dot verifiable verify --proof 0x… --context dotns --message 0x… --members 0x…
  $ dot verifiable members 0x… 0x…

${BOLD}Derivation flow (RFC-0022, hard junctions only):${RESET}

  Mnemonic ─BIP39─▶ entropy ─┬─ blake2b(key "ring-vrf")        tree root
                             ├─ blake2b(key cc("//peopl.dot")) product node   (--product)
                             └─ blake2b(key index_bytes(0|1))  member entropy (--person/--index)
                                                     │
                                    ring proof: one_shot(…, --context, --message)

  Legacy (--entropy-key) is a single hash of the BIP39 entropy, one level only:
  blake2b(entropy, key). It can reproduce the tree root (key "ring-vrf") but never
  a member entropy, since the tree hashes each level's output as the next's data.
`.trimStart();

export interface VerifiableOpts {
  output?: string;
  json?: boolean;
  entropyKey?: string;
  entropy?: string;
  person?: string;
  product?: string;
  index?: string;
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
  ["entropy", "entropy"],
  ["person", "person"],
  ["product", "product"],
  ["index", "index"],
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
    .option("--product <id>", "RFC-0022 product id (default: peopl.dot)")
    .option("--index <n>", "RFC-0022 derivation index (u32); alternative to --person")
    .option("--entropy-key <key>", "Legacy pre-RFC-0022 keyed-hash scheme")
    .option("--entropy <hex>", "Use these 32 raw bytes as the member secret (no derivation)")
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
      // CAC delegates to mri, which silently coerces 0x-hex option values to JS
      // Numbers (losing the bytes). Re-read every hex/string-bearing flag from
      // raw argv so values reach the handlers intact. This runs before the help
      // check so `--entropy` is visible below.
      for (const [flag, key] of RAW_STRING_FLAGS) {
        const raw = readRawOptionValue(flag);
        if (raw !== undefined) (opts as Record<string, unknown>)[key] = raw;
      }

      const { runVerifiable } = await import("./commands.ts");

      if (!action) {
        // A raw member secret needs no account, so a bare `--entropy` invocation
        // is a member derivation rather than a request for help.
        if (opts.entropy === undefined) {
          console.log(VERIFIABLE_HELP);
          return;
        }
        return runVerifiable("member", [], opts);
      }

      return runVerifiable(action, rest, opts);
    });
  withHelp(command, () => console.log(VERIFIABLE_HELP));
}
