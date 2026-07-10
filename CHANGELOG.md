# polkadot-cli

## 1.23.0

### Minor Changes

- 516c08d: Make `dot inspect` (and its `explore` alias) forgiving about dot-paths. Previously `dot inspect polkadot.tx.System.remark` threw `Invalid target ... Expected format: Pallet, Pallet.Item, or Chain.Pallet.Item` even though that exact path is valid for _invoking_ a call — `inspect` had no notion of a `kind` segment. Now `parseTarget` (under `allowPalletOnly`) tolerates and ignores a `kind` segment (`tx`/`query`/`const`/`events`/`errors` and their aliases) appearing right after an optional chain prefix, so `dot inspect polkadot.tx.System.remark` describes the `System.remark` call just like `dot inspect polkadot.System.remark`. Partial paths continue to degrade to discovery rather than erroring (`dot inspect polkadot.query.System` lists the pallet's items). Genuinely-malformed input still errors with a helpful message. Closes #255.
- d6f6c9e: Add git/cargo-style external subcommand dispatch (plugins). When the first CLI token is not a built-in command, category, or dot-path, `dot <name> …` looks for an executable named `dot-<name>` on PATH and runs it with the remaining arguments forwarded verbatim, stdio inherited, and the plugin's exit code passed through. Plugins receive `DOT_BIN` pointing at the dispatching `dot` entry script (cargo's `CARGO` convention) so they can call back into the same installation. Dotted tokens (`foo.bar`) and file paths are never dispatched, so dot-path syntax and file input are unaffected; built-in commands always win over a same-named plugin. Unknown-command errors now mention the `dot-<name>` convention when the token could have been a plugin.

## 1.22.0

### Minor Changes

- 09ef0ad: Add a global `DOT_DRY_RUN` environment variable. When set to a truthy value (`1`, `true`, `yes`, or `on`), every extrinsic-submitting command behaves as if `--dry-run` had been passed — the transaction is simulated and never broadcast. A one-line hint is printed to stderr (keeping `--json`/piped stdout clean). An explicit `--dry-run` / `--no-dry-run` flag always wins, and decode-only paths (`--encode`, `--to-yaml`, `--to-json`) are unaffected.

### Patch Changes

- b388a70: Upgrade `cac` from `6.7.14` to `7.0.0` (major version bump of an internal dependency). cac v7 is ESM-only (the CLI is already ESM) and its auto-generated help/version output now writes via `console.info` instead of `console.log`. No user-visible CLI behavior changes: the same commands, flags, help text, version string, and exit codes are preserved.
- 09de89a: Fix nested `--help` being dropped in the published bundle. The per-command help registry from the previous fix relied on a module-level `Map`, which `bun build` duplicated (the module is imported both directly and via the `platform/index.ts` barrel) — `withHelp` populated one copy while `printMatchedCommandHelp` read an empty other copy, so `dot account add --help` still ran the action and errored in `dist/cli.mjs` even though the source and tests were green. The help printer is now stored on the `cac` command instance under a `Symbol.for` key, which is immune to module duplication. A post-build smoke test (`src/cli.smoke.test.ts`) now exercises the built bundle under `node` so this class of bundler-only regression is caught.
- a7890ea: Fix `--help` being dropped for nested subcommands. Previously `dot account add --help` (and other nested commands like `dot chain add --help`, `dot account inspect --help`, `dot hash <algo> --help`, `dot verifiable <action> --help`) ran the command's action and exited with an error about the missing positional argument instead of printing usage. Now `--help` reliably prints the command's usage block and exits 0 at every nested command level. Commands with a required positional (`dot metadata --help`, `dot completions --help`) also print help instead of erroring.
- 742e65d: Upgrade `polkadot-api` from `2.1.4` to `2.1.7`.
- 7ad4bd1: Document the recommended `{relay}-{parachain}` chain-naming convention for `dot chain add` and the relay/parachain topology feature. The docs site, README, and `dot-cli` skill now explain why relay-prefixed names (`polkadot-asset-hub`, `kusama-bridge-hub`, …) keep the `dot chain list` tree readable and disambiguate parachains whose IDs collide across relays. Docs-only — no behavior change.
- b2593ea: Add `rm` as an alias for `dot account delete`/`dot account remove`. `dot account rm <name> [name2] ...` behaves identically to `delete`/`remove`, removing one or more stored accounts.
- 4d34a83: Upgrade `verifiablejs` from `1.3.0` to `1.4.0`.

## 1.21.0

### Minor Changes

- 5ac2b5e: Add directory-local workspaces: `dot init` creates a `.polkadot/` workspace in the current directory, discovered git-style (cwd and parents, stopping at `$HOME`) and fully isolating accounts, custom chains, and metadata cache from the global `~/.polkadot`. New `dot which` shows the active config root and how it was chosen. Precedence: `DOT_HOME` → local workspace → global. Account and chain resolution errors now name the config root that was searched.
- a33128e: feat(verifiable): ring-VRF proof, signing, verification and members primitives

  Adds composable `dot verifiable` subcommands over `verifiablejs`:

  - `verifiable sign` / `verify-sig` — standalone Bandersnatch signatures.
  - `verifiable alias` — derive the alias for a 32-byte ring context.
  - `verifiable prove` / `verify` — ring-VRF proofs (`one_shot`) and local
    verification against a members set or a 768-byte ring root.
  - `verifiable members` — SCALE-encode member keys as `Vec<[u8;32]>`.

  The command is scoped to raw verifiable crypto only — bytes in, bytes out, with
  no chain/pallet knowledge and no automated fetching or selection (the same way
  `dot sign` is just sr25519). Supply the members/context/message yourself (e.g.
  read from chain with `dot` first) and use the resulting signature/proof however
  you need — in a `dot` extrinsic or signed extension, or elsewhere.

  All actions accept hex / `--file` / `--stdin` input and `--output json`, and a
  new `src/features/verifiable/lib.ts` exposes the underlying primitives for reuse.

  **Breaking:** the entropy-derivation key is now `--entropy-key` (was `--context`
  on `dot verifiable`), and `--context` now means the 32-byte ring/proof namespace
  — aligning with the runtime (`type Context = [u8;32]`) and the iOS/Android
  clients. The old `--context <key>` form still works on the member command for one
  release with a deprecation warning; switch to `--entropy-key`.

### Patch Changes

- 09aab3e: fix(tx): show stale-metadata hint on `BadProof` / `AncientBirthBlock`

  `withStalenessSuggestion` already wraps every `signSubmitAndWatch` call
  and, on error, compares cached `(specVersion, transactionVersion,
codeHash)` against the live runtime — if they diverge it appends the
  `⚠ Local metadata for "<chain>" is out of date … Run: dot chain update
<chain>` hint. But the gating regex only matched wasm-trap / codec /
  decode symptoms, not `Invalid::BadProof` or `Invalid::AncientBirthBlock`.

  After a chain runtime upgrade the signer used the cached spec/tx
  version, the runtime reconstructed a different payload, the signature
  didn't verify and the tx was rejected with a bare `BadProof` — leaving
  the user guessing. The fingerprint mismatch was right there but the
  regex skipped over it.

  `CheckSpecVersion` / `CheckTxVersion` / `CheckGenesis` /
  `CheckMortality` are all in the signed payload, so `BadProof` and
  `AncientBirthBlock` are exactly the variants that smell like stale
  metadata. Adding them to the pattern list lets the existing fingerprint
  gate run; if cached matches live (genuine bad key / wrong chain) the
  raw error still passes through unchanged.

  Nonce-mismatch variants (`Future`, `Stale`) are deliberately excluded —
  those are account-state issues, not metadata.

- c1ed560: fix(completions): only print setup instructions when stdout is a TTY

  `dot completions <shell>` wrote its setup hint to stderr on every invocation.
  Inside `eval "$(dot completions zsh)"` in `~/.zshrc`, stderr bypasses the
  command substitution and reaches the terminal, so every new shell printed the
  `# Add this to your ~/.zshrc` block. The hint is now only printed when stdout
  is a TTY — i.e. when a human runs the command to look at the script — and
  stays silent when the output is captured by `eval` or redirected to a file.

- d9a27d7: fix(test): make polkadot-api module mocks ordering-safe across test files

  No runtime behavior change — this fixes the flaky CI failures where
  `createChainClient` tests failed depending on test-file scheduling order.
  bun's `mock.module()` is global to the test process and not restored between
  files, so `client.test.ts` and `load-meta.test.ts` clobbered each other's
  mocks. Both now share a fixture that spreads the real module exports into
  the mocks and captures the real `createChainClient` before any file can stub
  the `client.ts` module.

## 1.20.0

### Minor Changes

- 5920098: feat(account): reveal mnemonic with `--show-secret` and import raw private keys

  `dot account inspect <name> --show-secret` now also reveals the **stored
  mnemonic** (or 32-byte hex seed) alongside the 64-byte sr25519 expanded private
  key, in both text and `--json` output. Env-backed secrets stay redacted — only
  the `$VAR` reference is shown.

  `dot account add <name> --secret 0x<128 hex>` now imports an account directly
  from a 64-byte sr25519 **expanded secret** — the exact value `--show-secret`
  prints — making it round-trippable. Imported expanded-secret accounts sign and
  resolve addresses like any other signer. A derivation path cannot be applied to
  an expanded secret, so `--path` is rejected for this format.

  Fixes a related bug: `--secret 0x...` was previously corrupted by `cac`'s
  numeric coercion, so **32-byte hex seed import never worked from the command
  line**. The raw argv value is now read directly, so both hex seeds and raw
  private keys import correctly. The misleading "hex seed not supported" help text
  has been corrected.

### Patch Changes

- 0dd979c: chore(deps): upgrade `polkadot-api` to `2.1.4` and sibling `@polkadot-api/*` packages

  Bumps `polkadot-api` (2.0.1 → 2.1.4), `@polkadot-api/metadata-builders`
  (0.14.1 → 0.14.3), `@polkadot-api/substrate-bindings` (0.20.1 → 0.20.3),
  `@polkadot-api/view-builder` (0.5.1 → 0.5.3), and
  `@polkadot-api/metadata-compatibility` (0.6.1 → 0.6.3, dev).
  Minor/patch bumps with no API surface change in the parts consumed by the CLI.

- 6535199: chore(deps): upgrade `verifiablejs` to `1.3.0`

  Bumps `verifiablejs` from `1.3.0-beta.2` to the stable `1.3.0` release. The JS
  API consumed by the CLI (`member_from_entropy`) is unchanged, but the release
  bumps the underlying `verifiable` crate to v0.5.0 (ThinVRF, new ring proofs),
  so derived Bandersnatch member keys are **wire-incompatible** with `beta.2` —
  this is the intended alignment with the `verifiable` crate used on-chain by
  `individuality`. Updated the documented example keys (README, docs) and added a
  regression test pinning alice's derived member keys to the 1.3.0 wire format.

## 1.19.0

### Minor Changes

- 64bc0b5: fix(query, apis): honor `--at <block>` for historical reads

  `--at` was declared on the global command but only ever wired into `tx`
  submission. `query.*` and `apis.*` accepted the flag silently and read
  current head anyway, making historical state reads and per-block runtime
  API replays impossible from the high-level wrappers.

  papi v2 supports historical reads natively via the trailing `PullOptions`
  argument on storage and runtime calls (`{ at: "best" | "finalized" |
<hash> }`). The fix threads the flag through.

  - `dot polkadot.query.System.Number --at best`
  - `dot polkadot.query.System.Number --at finalized`
  - `dot polkadot.query.System.Number --at 0x<hash>`
  - `dot polkadot.apis.Core.version --at 0x<hash>`

  Behavior matrix:

  | Command   | `--at best`                   | `--at finalized` | `--at 0x<hash>` |
  | --------- | ----------------------------- | ---------------- | --------------- |
  | `query.*` | ✓                             | ✓                | ✓               |
  | `apis.*`  | ✓                             | ✓                | ✓               |
  | `tx.*`    | rejected (papi v2 constraint) | ✓                | ✓               |

  Also fixes a pre-existing CAC/mri argv-parsing bug where 0x-hex block
  hashes passed to `--at` were silently coerced to JS Numbers, losing
  precision. `--at` is now read from raw argv to keep the original string
  intact.

  papi v2's `chainHead_v1_*` JSON-RPC only serves pinned (recent) blocks.
  For deep historical reads, point `--rpc` at an archive endpoint.

- debed0d: feat(account): show pallet-revive H160 in `dot account inspect`

  Every Substrate account now also shows its pallet-revive 20-byte H160
  address (EIP-55 checksummed) on the `H160:` line, so developers working
  across SS58 and EVM tooling on Polkadot Hub / Asset Hub can see both
  representations side by side. The same H160 appears under the `h160`
  field of `--output json`.

  The mapping is offline and matches current `polkadot-sdk` master:

  - **AccountId32 → H160:** if the last 12 bytes are `0xEE`, strip them
    (the account originated from an Eth address); otherwise
    `keccak256(accountId32)` and take the last 20 bytes.
  - **H160 → AccountId32:** deterministic fallback `H160 || 0xEE * 12`.
    The full mapping after `pallet_revive.map_account` lives in on-chain
    `AddressSuffix` storage and is not recoverable offline.

  `dot account inspect` accepts a 20-byte H160 hex value as a new input
  form. It resolves to the fallback AccountId32 and reports
  `Kind: revive H160 fallback`.

  ```bash
  dot account inspect alice
  #   H160:        0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D

  dot account inspect 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
  #   Kind:        revive H160 fallback
  #   Public Key:  0x9621dde636de098b43efb0fa9b61facfe328f99deeeeeeeeeeeeeeeeeeeeeeee

  dot account inspect alice --json | jq -r .h160
  # 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
  ```

  Older `stable2412` runtimes used plain `accountId32[..20]` truncation
  instead of the keccak fallback for the forward direction. A
  `--revive-truncate` flag for those is not implemented; this release
  ships only the canonical current-master mapping.

- ecd453b: feat(hash): add `twox64`, `twox128`, `twox256` algorithms

  Substrate uses XXH64-based `twox*` hashes throughout — pallet/storage prefixes
  are `twox128(palletName) ++ twox128(itemName)`, and `Twox64Concat` is a common
  storage-map hasher. Previously `dot hash` only supported the BLAKE2b, Keccak,
  and SHA-2 families, so constructing a raw storage key required an external
  tool.

  The three new algorithms are pure-TypeScript (no wasm, no native deps) and
  verified against canonical XXH64 vectors and Substrate prefixes:

  - `dot hash twox128 System` → `0x26aa394eea5630e07c48ae0c9558cef7`
  - `dot hash twox128 Balances` → `0xc2261276cc9d1f8598ea4b6a74b15c2f`
  - `dot hash twox64 <key>` / `dot hash twox256 <key>` for the other variants

  Combined with `dot [chain.]rpc.state_getStorage 0x<key>`, this is enough to
  read any raw storage value, including the well-known keys (`:code`,
  `:heappages`) that live outside metadata.

### Patch Changes

- 47992bf: fix(errors): friendlier message when `--at <block>` is not available

  When `--at` points at a block the connected RPC can't serve — most often
  an old hash against a non-archive node — papi raises
  `BlockHashNotFoundError` / `StorageError: UnknownBlock` / "is not pinned"
  rejections. These now get caught at the `query.*` / `apis.*` / `tx.*`
  call sites and re-surfaced as a clean `CliError` with a copy-pasteable
  hint:

  ```
  Error: Block 0x… is not pinned (storage)

  ⚠ 0x… is not available on the current RPC endpoint.
     Public nodes serve only recent (pinned) blocks via chainHead_v1_*.
     For deep historical reads, point --rpc at an archive endpoint, e.g.:
       dot ... --at 0x… --rpc wss://<archive-endpoint>
  ```

  Note: papi's substrate-client may still emit its own internal stack
  trace ahead of the clean message; suppressing that is a separate
  follow-up.

- a801337: chore(deps): upgrade `verifiablejs` to `1.3.0-beta.2`

  Tracks the upstream beta. The CLI only consumes `member_from_entropy`,
  whose signature is unchanged, so `dot verifiable` output is byte-identical.

## 1.18.0

### Minor Changes

- 0a4c5f3: feat(rpc): add `dot [chain.]rpc.<method>` for raw JSON-RPC calls

  Closes #196.

  Substrate nodes expose a JSON-RPC surface (`system_*`, `chain_*`, `state_*`,
  `author_*`, `payment_*`, consensus and dev families, plus the new spec
  `chainSpec_v1_*` / `archive_v1_*` / `rpc_methods`) that is separate from
  runtime metadata and was previously unreachable from this CLI.

  The new `rpc` category mirrors the other dotpath commands: methods are
  discovered per-chain via `rpc_methods`, cached at
  `~/.polkadot/chains/<chain>/rpc-methods.json`, and tab-completed.

  - `dot polkadot.rpc` — list methods grouped by family
  - `dot polkadot.rpc.system_health` — call a method
  - `dot polkadot.rpc.chain_getBlock 0x<hash>` — positional args
  - `dot polkadot.rpc.<method> --help` — curated description and arg names
    for ~50 well-known methods; raw passthrough for the rest
  - `dot polkadot.rpc --refresh` — re-discover methods on a node upgrade

  Subscription methods (`*_subscribe*`, `chainHead_v1_follow`, `transaction_v1_*`)
  appear in completion but error out as one-shots with a helpful message.

  `dot chain add` and `dot chain update` now also fetch and cache the method
  list, and `dot chain info` shows a per-family breakdown.

- 3180e75: Add derivation flags to `dot account add` that store sovereign addresses as named watch-only accounts. One command lets you turn a parachain ID or a pallet `PalletId` into a stored account that's reusable in `--from`, in tx args, and in `dot account list`.

  ```bash
  # Pallet sovereign (Treasury / Bounties / Crowdloan / NominationPools / …)
  dot account add Treasury --pallet-id py/trsry
  dot account add Bounties --pallet-id 0x70792f626f756e74

  # Parachain sovereign — type is required (child = address on the relay,
  # sibling = address from another parachain's POV)
  dot account add People --parachain 1004 --parachain-type child
  dot account add People-Sibling --parachain 1004 --parachain-type sibling
  ```

  **Derivation** (matches Substrate's `AccountIdConversion::into_account_truncating`):

  - Pallet: `b"modl"` (4 bytes) + `palletId` (8 bytes) + 20 zero bytes
  - Parachain: `b"para"` (child) or `b"sibl"` (sibling) + paraId LE u32 (4 bytes) + 24 zero bytes

  PalletId input is either 8 ASCII chars (`py/trsry`) or 0x-prefixed hex with exactly 16 hex chars (`0x70792f7472737279`). Per-chain PalletIds can be discovered via the existing `const` category:

  ```bash
  dot account add Treasury --pallet-id "$(dot polkadot.const.Treasury.PalletId | tr -d '"')"
  ```

  **Constraints:** `--parachain` requires `--parachain-type child|sibling` (no implicit default); `--parachain` and `--pallet-id` are mutually exclusive; derivation flags cannot be combined with a positional address or with `--secret`/`--env`.

  JSON output (`--json`) includes a `derivation` object describing the source — `{ "kind": "pallet", "palletId": "py/trsry", "palletIdHex": "0x..." }` or `{ "kind": "parachain", "paraId": 1004, "type": "child" }` — for round-trippable record-keeping.

  **`dot account list` is restructured** to make kinds obvious and SS58s easier to copy-paste. Stored accounts are now bucketed into **Signers**, **Watch-only**, **Pallet Sovereigns**, and **Parachain Sovereigns** sections (empty sections omitted). The first line of each entry is just `name  ss58`; extra attributes render on tree-style continuation lines (`├─` / `└─`, mirroring `dot chains`). Attribute labels are aligned with the `--flag` that sets each value (`path:`, `env:`, `pallet-id:`, `parachain:`, `parachain-type:`) so the listing reads back as a recipe. Multiple attributes per account (e.g. `--path` + `--env`) each get their own branch:

  ```
  Signers
    ci-signer  5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy
       ├─ path: //ci
       └─ env:  $CI_SECRET

  Pallet Sovereigns
    Treasury   5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z
       └─ pallet-id: py/trsry (0x70792f7472737279)

  Parachain Sovereigns
    People     5Ec4AhPaYcfBz8fMoPd4EfnAgwbzRS7np3APZUnnFo12qEYk
       ├─ parachain:      1004
       └─ parachain-type: child
  ```

  `--json` adds a `kind` discriminator on every entry plus a `source` object on derived sovereigns.

  **`dot account inspect` now surfaces the derivation source.** The output gains a `Kind:` line (`dev` / `signer` / `watch-only` / `pallet sovereign` / `parachain sovereign (child|sibling)`) and, for derived sovereigns, a `Source:` line (`PalletId py/trsry (0x70792f7472737279)` or `parachain 1004`). For env-backed signers there's an `Env:` line; derived child keys show their `Derivation:` path.

  **Storage-format change:** `StoredAccount` gains an optional `source` field that records how a watch-only account was derived. Existing accounts without this field continue to work — they're classified as plain `signer` or `watch-only` based on the presence of a secret.

  **`dot account inspect` accepts the same derivation flags for stateless lookup.** When you just need the SS58 in a script and don't want a stored entry, run `dot account inspect --pallet-id <id>` or `dot account inspect --parachain <id> --parachain-type <child|sibling>` — same output shape (Kind / Source / SS58 / public key, plus a structured `source` object on `--json`), no name, nothing written to `~/.polkadot/accounts.json`.

  ```bash
  SS58=$(dot account inspect --pallet-id py/trsry --prefix 0 --json | jq -r .ss58)
  ```

  Use `account add` to persist (named, reusable as `--from` / tx arg / in `account list`); use `account inspect` to derive ad-hoc.

### Patch Changes

- 34044e8: Preserve the standalone `dot parachain <paraId>` command as a deprecated alias.

  The same release that introduced sovereign-account derivation flags on `dot account` (`--parachain` / `--parachain-type` / `--pallet-id`) had also deleted the older standalone `dot parachain` command. To avoid breaking production scripts that pin the prior CLI surface, the command is restored verbatim — same arguments, same exit codes, same byte-identical stdout for `--json` and pretty output. It now prints a one-line deprecation warning to **stderr only**, so pipes into `jq` / `awk` / file redirects keep working unchanged.

  Migrate at your convenience:

  ```bash
  # Before
  dot parachain 1000 --type child --json

  # After (same SS58 / public key, structured `source` field on JSON output)
  dot account inspect --parachain 1000 --parachain-type child --json
  ```

  Tracked for removal in a future release: [#208](https://github.com/peetzweg/polkadot-cli/issues/208).

## 1.17.0

### Minor Changes

- fd6cf14: Clean up `dot chains` output and add `dot chain info <name>` for per-chain detail.

  **`dot chains` is now scannable**

  The default `dot chains` (and `dot chain list`) output no longer prints RPC URLs inline. The list view becomes a compact tree of names + relay structure + parachain IDs:

  ```
  Configured Chains

    polkadot
    ├─ polkadot-asset-hub [1000]
    ├─ polkadot-bridge-hub [1002]
    ├─ polkadot-collectives [1001]
    ├─ polkadot-coretime [1005]
    └─ polkadot-people [1004]

    paseo
    ├─ paseo-asset-hub [1000]
    └─ paseo-people [1004]
  ```

  Pass `-v` / `--verbose` (à la `git remote -v`) to keep the previous behavior with RPC endpoints inline:

  ```bash
  dot chains -v
  dot chain list --verbose
  ```

  **`dot chain info <name>`**

  A new `info` action prints full per-chain detail in one block — RPC endpoints, relay/parachain id, child parachains (when the target is a relay), and metadata cache status:

  ```bash
  dot chain info polkadot

  # polkadot
  #
  #   rpc:
  #     wss://polkadot.ibp.network
  #     wss://rpc.polkadot.io
  #     ...
  #   parachains:
  #     polkadot-asset-hub [1000]
  #     polkadot-bridge-hub [1002]
  #     ...
  #   metadata:
  #     polkadot v1003000 (cached 2026-04-29T12:34:56.000Z)
  ```

  `dot chain <name>` is a bare-noun shortcut that falls through to `chain info <name>` — like `gh repo view`. The dispatcher still pattern-matches known action verbs first (`add`, `remove`, `update`, `list`, `export`, `import`), so existing usage is unchanged.

  `--json` emits a structured object with `name`, `rpc[]`, optional `relay` / `parachainId`, optional `parachains[]`, and a `metadata` block (or `null` when no fingerprint is cached). Names resolve case-insensitively, matching `findChainName` semantics used elsewhere.

  When metadata has never been fetched for the chain, the metadata row prints `not cached — run \`dot chain update <name>\`` so it's clear how to populate it.

- ede4b8c: Width-aware multi-line pretty-printing for type signatures, call arguments, and decoded calls.

  `dot inspect`, the focused listings (`dot <chain>.tx.<Pallet>`, `.query.<Pallet>`, `.events.<Pallet>`, `.extensions`), and `--dry-run` output now render structured types across multiple lines when they don't fit, with syntactic ANSI coloring (field names cyan, primitives yellow, container keywords magenta, enum variants green). Short signatures stay compact.

  **Before**

  ```
    Args: (proposal_origin: system | Origins | ParachainsOrigin | XcmPallet, proposal: Legacy | Inline | Lookup, enactment_moment: At | After)
  ```

  **After**

  ```
    Args: (
      proposal_origin : system | Origins | ParachainsOrigin | XcmPallet,
      proposal        : Legacy | Inline | Lookup,
      enactment_moment: At | After,
    )
  ```

  **Storage detail** now shows `Type:`, `Key:`, and `Value:` on separate lines (no `→` arrow), with composite values expanded:

  ```
  Assets.Metadata (Storage)

    Type:  map
    Key:   u32
    Value: {
      deposit  : u128,
      name     : Vec<u8>,
      symbol   : Vec<u8>,
      decimals : u8,
      is_frozen: bool,
    }
  ```

  **Dry-run `Decode:`** is now JSON-styled, suitable for very complex calls:

  ```
    Decode: System.remark
      {
        "remark": "0x68656c6c6f20776f726c64"
      }
  ```

  **Enum variant visibility** — the `enum(N variants)` summary threshold was raised from 4 to 24, so most enums (e.g. `Option<AsPersonalAliasWithAccount | AsPersonalAliasWithProof | ...>`) now show variant names instead of being collapsed.

  **Width detection** uses `process.stdout.columns` (falls back to 80). Output is automatically uncolored when stdout isn't a TTY, so piped `--json` and shell-redirected output stay clean.

  JSON output (`--json`) is unchanged — type strings continue to be emitted as compact single-line values for scripting.

### Patch Changes

- 3a12d97: Fix `dot query <Pallet.Item> --dump --json | jq` failing with
  `jq: parse error: Unfinished JSON term at EOF` on populated storage maps
  (reported against `polkadot-asset-hub query.Revive.AccountInfoOf`).

  ```bash
  # Now works (previously truncated past ~64 KiB of output):
  dot --chain polkadot-asset-hub query.Revive.AccountInfoOf --dump --json | jq
  ```

  Bun's `console.log` writes to `process.stdout` are async, and the CLI returns
  before the userspace stdout buffer drains into the OS pipe; on Linux
  (~64 KiB pipe buffer) anything past that threshold gets dropped. PR #194
  fixed this for `dot metadata` with a local awaitable-write helper. This
  extracts that helper into `src/core/output.ts` as a shared `writeStdout`
  primitive and routes `dot query`'s five output sites through it (the
  `--dump` map-entries path that triggers the user's bug, the single-value
  fetch, and the three pallet/storage listing paths). `dot metadata` now
  imports the shared helper instead of carrying its own copy.

  Issue #198 stays open as the forward-looking sweep — `inspect`, `const`,
  `apis`, etc. still emit via `console.log`, but their payloads don't
  realistically cross the pipe-buffer threshold today, so they're left for
  when (or if) one of them grows.

## 1.16.0

### Minor Changes

- e4ee0dc: Add `dot metadata <chain>` command and detect stale local metadata after a failed call.

  **`dot metadata <chain>`**

  A new top-level command that fetches a chain's runtime metadata and prints it as a single JSON blob with everything needed to drive the chain — pallets (with calls, events, errors, storage, constants), runtime APIs, transaction extensions, and a runtime fingerprint header (`specVersion`, `transactionVersion`, `codeHash`, etc.). Closes [#170](https://github.com/peetzweg/polkadot-cli/issues/170).

  ```bash
  dot metadata polkadot                  # decoded JSON, fetched fresh from the chain
  dot metadata polkadot --raw            # SCALE-encoded metadata bytes as a single 0x… hex line
  dot metadata polkadot --cached         # use locally cached metadata, skip the network round-trip
  dot metadata polkadot --rpc wss://…    # override the RPC endpoint
  ```

  **Stale-metadata suggestion**

  When `dot tx`, `--dry-run`, or `dot query` fails with an error that smells like stale metadata (a runtime wasm trap, codec/decode failure, or fee-estimation panic), the CLI now compares your local metadata's runtime fingerprint against the live chain. If it has changed, the original error is wrapped with a one-line suggestion telling you exactly which command to run:

  ```
  Error: The runtime rejected this transaction in the runtime's validate_transaction step.
    Cause: a runtime invariant failed — typically the call's arguments are out of range, …

  ⚠ Local metadata for "paseo-people-next" is out of date (spec 1018 → 1020).
     Run: dot chain update paseo-people-next
  ```

  The fingerprint includes the runtime **code hash** (from `state_getStorageHash(":code:")`) — so the check also catches local-node restarts where the runtime wasm changed but `specVersion` was kept the same. No automatic refetch happens; the suggestion is shown once and the original error still propagates with the non-zero exit code.

  The check only fires on suspected-stale errors, so the happy path pays no extra RPC. Set `DOT_TRUST_CACHED_METADATA=1` to skip the check entirely (e.g. for CI or scripted loops where you've just refreshed manually).

  **Companion improvements**

  - `formatRuntimeError` now translates raw polkadot-api wasm-trap stack traces into a friendly "the runtime rejected this transaction" message with a hint pointing at `--dry-run`.
  - `dot tx --dry-run` now surfaces the underlying reason when fee estimation fails (previously the error message was silently dropped, leaving only "unable to estimate").
  - A global `unhandledRejection` filter swallows benign late-timer rejections from `@polkadot-api/observable-client` (`Not connected`, `DisjointError`) that previously crashed `dot chain update --all` after the actual work had completed.

### Patch Changes

- e4ee0dc: Friendlier error output when the runtime panics or papi cleanup races leak.

  **Runtime wasm traps**

  Errors from inside `validate_transaction` (wasm `unreachable` instruction / `Execution aborted due to trap`) used to be printed as a verbatim wasm backtrace from polkadot-api. They now render as a one-paragraph "the runtime rejected this transaction" message that names the failing entrypoint where possible (e.g. `the runtime's validate_transaction step`) and points at `--dry-run` for the next step.

  **`--dry-run` no longer hides the reason fee estimation failed**

  Previously `dot tx … --dry-run` swallowed any exception from `getEstimatedFees` and printed only `Estimated fees: unable to estimate`. The error reason is now captured and displayed alongside the estimate (and included in the JSON output as `estimationError`), so users see _why_ estimation failed before deciding to submit.

  **`dot chain update --all` no longer crashes on cleanup races**

  `@polkadot-api/observable-client` schedules timers inside its chain-head follow stream that can fire after `client.destroy()` has cleared the connection, rejecting with `Error: Not connected` or `DisjointError`. Previously these unhandled rejections killed the process _after_ the actual update work had completed. A `process.on('unhandledRejection')` filter at the CLI entry point now swallows that specific class of teardown noise (matched by name) and lets unrelated rejections through with the new friendlier formatting.

## 1.15.1

### Patch Changes

- c643300: Polish the `dot-cli` Claude Code skill based on first-contact evaluation feedback. No CLI behavior changes.

  **SKILL.md**

  - Fix the `Inspect / Explore` section: the old `dot <chain>.inspect` dotpath form does not parse; show the two valid forms (`dot inspect <Pallet> --chain <name>` and chain-prefixed target `dot inspect <chain>.<Pallet>`), and call out that a bare `dot inspect <chain>` is parsed as a pallet name.
  - Add a `Complex Arguments` subsection under `Runtime APIs` with a worked `Location` example showing the `{type, value}` enum shape, so first-time users don't have to reverse-engineer XCM location JSON from `--dump` output.
  - Document that `--at <block>` is a tx flag only; queries always read the latest finalized head. Add `--at` to the Key Flags table.
  - Add a short `Common Errors` appendix (`Incompatible runtime entry`, unknown account, `undefined` piped into `jq`, metadata decode drift after runtime upgrades).
  - Replace the one-line pointer to `references/scripting-patterns.md` with three inline highlights so users know whether to click through.

  **Tests**

  - Extend `src/skill-marketplace.test.ts` with a regression test that asserts SKILL.md no longer contains the stale `<chain>.inspect` dotpath form, plus positive checks for the new content areas.

- 60ec180: Close the remaining gap in the sized `[u8; N]` runtime-API fix from
  `1.14.1`: byte arrays **nested inside JSON / YAML struct, enum, or tuple
  args** now also pass through as `0x…` hex strings, matching the top-level
  positional-arg behaviour.

  Previously, only top-level `[u8; N]` args were fixed in `parseTypedArg`. A
  call like:

  ```bash
  # File-based command with a nested [u8; 32] field
  dot ./authorize.yaml
  ```

  ```yaml
  chain: polkadot
  tx:
    System:
      authorize_upgrade:
        code_hash: "0xabcdef…32bytes" # nested [u8; 32]
  ```

  …would hit the same `Incompatible runtime entry Tx(System.authorize_upgrade)`
  error, because the nested byte array went through `normalizeValue` (the JSON
  branch) which still decoded it to `Uint8Array`. That path is now aligned with
  the top-level rule.

  **Regression suite.** To prevent this class of bug from returning, the test
  suite now imports papi's own `@polkadot-api/metadata-compatibility` and
  asserts that every representative byte-array typedef parsed by the CLI is
  accepted by papi's `isCompatible` guard. Any future drift between our
  argument parsing and papi's compatibility check fails tests before release.

  Affects any runtime API / tx call / storage key with a `[u8; N]` field — in
  particular `System.authorize_upgrade`, `ReviveApi.call`, anything touching
  `H160` / `H256` / raw `AccountId32` inside a nested payload.

## 1.15.0

### Minor Changes

- ba2c356: Ship a Claude Code skill for the `dot` CLI, installable as a plugin marketplace directly from this repo.

  **New: `dot-cli` Claude Code skill**

  The repo now ships a Claude Code skill that teaches agents how to drive the `dot` CLI — query patterns, tx encoding, runtime API calls, XCM locations, and bash scripting gotchas (like the `undefined` sentinel for missing storage keys and u128 quoted-string handling). The skill auto-triggers when Claude is asked about `dot`, polkadot-cli, Substrate storage, extrinsic submission, runtime APIs, or XCM.

  Install:

  ```
  /plugin marketplace add peetzweg/polkadot-cli
  /plugin install dot-cli@polkadot-cli
  ```

  Update later:

  ```
  /plugin marketplace update polkadot-cli
  ```

  Layout mirrors the [paritytech/product-skills](https://github.com/paritytech/product-skills) marketplace — `.claude-plugin/marketplace.json` with a single `strict: false` plugin entry pointing at `./dot-cli`. The skill folder itself is drop-in compatible with `product-skills`, so later consolidation is a straight copy.

- d363ae8: Add `DOT_HOME` environment variable to redirect the CLI's config directory.

  When `DOT_HOME` is set, the CLI reads and writes all state — `config.json`,
  `accounts.json`, `update-check.json`, and `chains/*/metadata.bin` — under that
  directory instead of the default `$HOME/.polkadot`. No `.polkadot` suffix is
  appended to the override.

  This lets you run experiments, CI jobs, or secondary profiles without touching
  your real config directory:

  ```bash
  DOT_HOME=/tmp/dot-scratch dot account create throwaway
  ```

  Empty-string `DOT_HOME=""` is treated as unset and falls back to
  `$HOME/.polkadot`, so a shell-quoting slip cannot accidentally target `/`.

  The project's own `runCli` test fixture now sets `DOT_HOME` to an isolated
  tmpdir for every subprocess it spawns.

- 57ca4a0: Improve `dot chain import` and `dot account import` UX.

  **Readable output.** Both commands now print one line per chain/account with
  status glyphs — `✓` added, `⟳` overwritten, `-` skipped — followed by a terse
  count summary. The old single-line comma-joined `Added: a, b, c, …` summary
  could span hundreds of characters for realistic imports; per-item lines are
  much easier to scan.

  ```
    ✓ preview
    ✓ preview-people
    ⟳ polkadot (overwritten)
    - paseo (skipped)

  2 added, 1 overwritten, 1 skipped
  ```

  **No more hangs on bare invocation.** `dot chain import` and
  `dot account import` with no file argument used to block forever reading
  from stdin. They now print the subcommand help when invoked in a terminal,
  while piped stdin (`cat file | dot chain import` or `dot chain import -`)
  still works.

  **Auto-metadata after chain import.** `dot chain import` now fetches metadata
  for newly imported or overwritten chains automatically, so tab completion,
  `dot chain.query.*`, and other metadata-dependent features start working
  immediately — no manual `dot chain update --all` step required. Pass
  `--no-metadata` to skip the fetch (useful for offline/CI bootstrapping).

  **`dot account import` is now file-only.** The single-account import form
  `dot account import <name> --secret "..."` / `--env VAR` has been removed to
  make the command a clean analog to `dot chain import`. The canonical
  single-account path is and remains `dot account add <name> --secret "..."`
  (`add --secret` / `add --env` have always been supported). Batch file import
  no longer requires the `--file` flag — just pass the path:

  ```bash
  # Before
  dot account import treasury --secret "word1 word2 ..."    # no longer works
  dot account import --file accounts.json                    # still works

  # After
  dot account add treasury --secret "word1 word2 ..."        # canonical single
  dot account import accounts.json                           # positional file
  dot account import accounts.json --overwrite --dry-run
  dot account import -                                       # stdin
  ```

- a1433f0: Add `dot extensions` to inspect a chain's transaction (signed) extensions.

  **New: `extensions` category**

  Users can now discover which transaction extensions a chain exposes, which ones
  polkadot-api fills in automatically, and which ones must be provided via
  `--ext` when building a transaction. This closes issue #169.

  ```bash
  # List every transaction extension on a chain
  dot extensions --chain polkadot

  # Detail view for a single extension — shows value type, additionalSigned type,
  # and a usage hint for non-builtin extensions
  dot extensions.CheckMortality --chain polkadot

  # Chain-prefix form
  dot polkadot.extensions.ChargeTransactionPayment

  # Structured output for scripts and agents
  dot extensions --chain polkadot --json
  ```

  Aliases: `extension`, `ext`. Typos produce suggestion-style errors. Shell
  completion proposes identifiers after `dot extensions.`.

  Each entry is tagged `[builtin]` (handled internally by polkadot-api) or
  `[custom]` (requires `--ext '{"<Identifier>":{"value":...}}'` when signing).

- 4854b23: Add `--show-secret` to `dot account inspect`.

  Prints the **64-byte sr25519 expanded secret key** as `0x`-prefixed hex
  alongside the public key and SS58 address. Works for dev accounts
  (Alice/Bob/Charlie/Dave/Eve/Ferdie, derived on-the-fly) and for stored
  accounts that have a resolvable secret (mnemonic or hex seed). Refuses on
  watch-only accounts, bare SS58 addresses, or hex public keys.

  The emitted hex is the final secret after any derivation path is applied, so
  it can be pasted directly into signers that don't accept a mnemonic+path
  combination (e.g. services that expect a raw `PRIVATE_KEY` env var). In
  `--json` mode the value is surfaced under the `privateKey` field.

### Patch Changes

- 2dbdb4d: Fix `extensions` help and docs that assumed the removed default chain.

  After the default-chain removal every chain-consuming command requires
  `--chain <name>` or a `<chain>.` dotpath prefix. A few surfaces introduced
  alongside `dot extensions` were still suggesting commands without either:

  - The custom-extension detail view's `--ext` Usage hint now includes the
    resolved chain (`dot <chain>.tx.<Pallet>.<Call> --from <acc> --ext ...`).
  - The "transaction extensions have no sub-items" error now preserves the
    chain the user supplied — prefix form when they used a `<chain>.` prefix,
    `--chain <name>` when they used the flag, and a `<chain>` placeholder
    when neither was set.
  - The top-of-file feature bullet in `README.md` and `docs/content/_index.md`
    reads `dot <chain>.extensions` instead of `dot extensions`.

## 1.14.2

### Patch Changes

- b9f2227: Audit and fix every CLI example in `README.md` and `docs/content/_index.md`.
  Many examples no longer worked after the no-default-chain change; this
  sweep rewrites them so each one runs as written against the current CLI.

  What was broken:

  - **Missing chain.** `dot apis.ReviveApi.call ...`, `dot query.System.Number`,
    `dot const.Balances.ExistentialDeposit`, etc. — every chain-requiring
    example in the docs lacked an explicit chain. They now use either the
    dotpath chain prefix (`dot polkadot.query.System.Number`) for read-only
    commands or the `--chain` flag for `tx` commands.
  - **Invalid chain names.** Examples referenced `kusama`, `assethub-paseo`,
    `people`, `people-paseo`, `people-preview`, and `westend` — none of which
    ship preconfigured. Replaced with valid built-in names (`polkadot`,
    `paseo`, `paseo-asset-hub`, `polkadot-people`); `kusama` is kept only in
    the `dot chain add kusama …` / `dot chain remove kusama` teaching
    examples.
  - **Removed-from-CLI commands.** The `dot pallets`, `dot calls`, `dot
storage` "Focused commands" section documented top-level commands that
    no longer exist. Replaced with the working partial-path forms
    (`dot polkadot.tx`, `dot polkadot.events`, `dot polkadot.query`, etc.).
  - **False space-separated claim.** The docs claimed
    `dot query polkadot.System.Account 5Grw…` worked. It doesn't — the
    parser absorbs `polkadot.System.Account` as a pallet name. Replaced
    with the actually-working forms and an explicit warning about the
    broken mixed dotted/space form.
  - **Inspect chain prefix.** Clarified that `dot polkadot.inspect.X` is
    not valid (because `inspect` is a top-level command, not a dot-path
    category) and only `dot inspect polkadot.X` or
    `dot inspect X --chain polkadot` work.
  - **Item-level help.** `dot tx.System.remark --help` style examples now
    include `--chain` — help still needs the chain to load metadata from
    the cache.

  No code changes. Verified by running 22 representative examples against
  the local CLI and `bun test` (1284 tests, all pass).

- 98ff391: Fix broken example commands printed by `dot --help` and the per-item
  `--help` views.

  The same no-default-chain regression that hit the README also hit the
  CLI's own help output:

  - **`dot --help`** advertised 9 example commands without a chain
    (`dot query.System.Account <addr>`, `dot tx.System.remark 0xdead --from
alice`, `dot apis.Core.version`, etc.) — every one errored on a fresh
    install with `No chain specified`. Examples now use the dotpath chain
    prefix (`dot polkadot.query.System.Account <addr>`) for read-only
    commands, the `--chain` flag for `tx`, and demonstrate both forms so
    readers learn the equivalence. The unsigned-tx example also picks a
    preconfigured chain (`polkadot-people`) instead of a placeholder.
  - **Item-level help** (`dot tx.System.remark --help --chain polkadot`,
    `dot query.System.Account --help …`, etc.) printed `Usage:` lines
    without a chain. These are now generated using the resolved chain name
    the user just supplied — so the suggested forms always work for the
    chain they were just inspected against. For `tx`, both the dotpath and
    flag forms are shown; for read-only commands, the dotpath form
    (already containing the chain) is used.
  - **Raw-call usage hint** (`Extra arguments are not allowed when
submitting a raw call hex.`) now mentions `--chain <chain>`.

## 1.14.1

### Patch Changes

- 1f18c0d: Fix `Incompatible runtime entry RuntimeCall(...)` when calling runtime APIs that
  take a fixed-size byte array argument (e.g. `ReviveApi.call` with its
  `dest: [u8; 20]` H160 contract address).

  Previously, every `0x…`-hex argument typed as `[u8; N]` was decoded into a
  `Uint8Array` via `Binary.fromHex(...)`. polkadot-api's `isCompatible`
  maps `[u8; N]` to a _sized_ binary typedef and only accepts a
  `0x`-prefixed string for that shape — a `Uint8Array` is rejected, surfacing as
  `Error: Incompatible runtime entry RuntimeCall(<Api>_<method>)` before any RPC
  round-trip. `Vec<u8>` (unsized binary) was unaffected and continues to use
  `Uint8Array`.

  ```bash
  # Now works (previously failed with "Incompatible runtime entry"):
  ALICE=5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
  CONTRACT=0x970951a12f975e6762482aca81e57d5a2a4e73f4
  CALLDATA=$(cast calldata "set(uint256)" 42)

  dot --chain paseo-asset-hub apis.ReviveApi.call \
    "$ALICE" "$CONTRACT" 0 null null "$CALLDATA"
  ```

  The argument-parsing rule is now:

  - `Vec<u8>` (sequence of `u8`) → `Uint8Array` via `Binary.fromHex` / `Binary.fromText`
  - `[u8; N]` (sized array of `u8`) with a `0x…` input → passed through as a
    `0x`-hex string (papi's dynamic builder encodes both forms; the compatibility
    guard only accepts the string form for sized binary)
  - `[u8; N]` with a non-hex input → still falls back to `Binary.fromText`

  Non-byte sized arrays (`[u32; N]`, etc.) are unaffected.

  Documentation also clarifies how to pass `Option<T>` arguments. `null` is the
  recommended `None` literal (JSON/YAML-compatible); `none` and `undefined` are
  accepted aliases. A bare value is treated as `Some(value)` — there is no
  explicit `Some(...)` prefix. The literals are lowercase-only.

## 1.14.0

### Minor Changes

- f57e12c: Add `--asset <json>` flag for paying transaction fees in a non-native asset.

  **New: `--asset` flag on `dot tx`**

  Accepts an XCM location (JSON) and routes it through the `ChargeAssetTxPayment`
  signed extension so the transaction is paid in the specified asset instead of the
  chain's native token. Typically used on asset-hub-style chains (Polkadot, Paseo,
  etc.) where an asset-conversion pool swaps the native fee into the chosen asset at
  dispatch time.

  ```bash
  # Pay fees in USDT (asset id 1337) on Polkadot Asset Hub
  dot tx Balances.transfer_keep_alive 5FHneW46... 1000000000000 \
    --from alice --chain polkadot-asset-hub \
    --asset '{"parents":0,"interior":{"type":"X2","value":[{"type":"PalletInstance","value":50},{"type":"GeneralIndex","value":"1337"}]}}'

  # Dry-run to estimate fees before submitting
  dot tx Balances.transfer_keep_alive 5FHneW46... 1000000000000 \
    --from alice --chain polkadot-asset-hub --dry-run \
    --asset '{…location…}'
  ```

  **How it works**

  When `--asset` is supplied, the CLI takes over `ChargeAssetTxPayment` handling
  from polkadot-api: it removes the extension from papi's builtin set, injects a
  user override of `{ tip, asset_id }`, and lets the existing custom-signed-extension
  pipeline SCALE-encode the value via metadata. This bypasses papi's
  `isAssetCompat` check, which otherwise rejects XCM Location payloads on the
  unsafe API path.

  **Requirements**

  - The target chain must expose the `ChargeAssetTxPayment` signed extension
    (asset-hub-style chains); on chains without it, `--asset` is silently ignored.
  - The estimated fee shown in `--dry-run` output is native-denominated; the
    on-chain asset-conversion pool determines the actual asset amount charged.

  **Not combinable with `--unsigned`** — unsigned/general transactions already
  default `ChargeAssetTxPayment` to zero tip / no asset.

- c82f94f: Add export/import commands for chain configurations and accounts, enabling portable backup, restore, and team sharing of setups.

  **Chain export/import (`dot chain export` / `dot chain import`)**

  Export chain configurations to JSON and import them on another machine or share with teammates. Metadata is excluded from exports (re-fetch with `dot chain update --all` after importing).

  ```bash
  # Export custom chains to stdout
  dot chain export

  # Export all chains (including built-ins) to a file
  dot chain export --all --file my-chains.json

  # Export specific chains
  dot chain export my-relay my-para

  # Import from a file
  dot chain import my-chains.json

  # Preview without applying
  dot chain import my-chains.json --dry-run

  # Overwrite existing chains
  dot chain import my-chains.json --overwrite

  # Pipe between machines
  ssh remote "dot chain export" | dot chain import -
  ```

  **Account export/import (`dot account export` / `dot account import --file`)**

  Export accounts with secrets redacted by default. Redacted accounts import as watch-only, preserving public keys for address resolution without exposing secrets.

  ```bash
  # Export accounts (secrets redacted by default)
  dot account export

  # Include secrets (explicit opt-in, warning printed)
  dot account export --include-secrets --file backup.json

  # Export only watch-only accounts (always safe)
  dot account export --watch-only

  # Batch import from a file
  dot account import --file team-accounts.json

  # Preview without applying
  dot account import --file accounts.json --dry-run

  # Overwrite existing accounts
  dot account import --file accounts.json --overwrite
  ```

  **Security**: Secrets are redacted (`<redacted>`) by default in exports. `--include-secrets` is required to include actual mnemonics/seeds. Env-backed accounts export the variable _name_ (e.g. `{"env": "MY_SECRET"}`), never the value. The existing single-account `import` command (`--secret`/`--env`) is unchanged.

- efd2e56: Remove the default chain feature. Every command that targets a chain must now specify one explicitly — either via the `--chain <name>` flag or a dotpath chain prefix (e.g. `dot polkadot.query.System.Number`). When neither is provided, the CLI fails with a clear error listing the available chains instead of silently falling back to a saved default.

  **Why:** the implicit fallback made commands non-transparent — especially in scripts or when switching contexts, users could not tell which chain was actually being hit (see #158).

  **Breaking changes:**

  - `dot chain default <name>` subcommand removed.
  - `dot chain update` now requires a chain name or `--all`; it no longer implicitly targets a default chain.
  - `dot chain list` no longer prints a `(default)` marker, and `dot chain list --json` no longer includes a `default` field per chain.
  - The `--chain` global-option help text changed from "Target chain (default from config)" to "Target chain (required)".

  **Config migration:** any pre-existing `defaultChain` field in `~/.polkadot/config.json` is silently ignored on read and dropped on the next save — no manual migration needed.

  **Before:**

  ```bash
  dot chain default kusama
  dot query.System.Number     # implicitly targeted kusama
  ```

  **After:**

  ```bash
  dot query.System.Number --chain kusama
  # or, equivalently:
  dot kusama.query.System.Number
  ```

- 4007947: Add `--unsigned` flag for submitting unsigned/authorized transactions (v5 general transactions).

  **New: `--unsigned` flag on `dot tx`**

  Submit transactions without a signer. Used for governance-authorized calls like `People.create_people_collection` on the People chain, where authorization comes from on-chain mechanisms (e.g. `AuthorizeCall` extension) rather than cryptographic signatures.

  ```bash
  # Submit an authorized transaction on the People chain
  dot tx People.create_people_collection --unsigned --chain people

  # Dry-run to inspect before submitting
  dot tx People.create_people_collection --unsigned --chain people --dry-run

  # Encode the full general transaction bytes
  dot tx People.create_people_collection --unsigned --chain people --encode

  # JSON output for scripting
  dot tx People.create_people_collection --unsigned --chain people --json
  ```

  **How it works**

  The CLI constructs a v5 general transaction (`0x45` format) with all signed extension "extra" values auto-defaulted:

  - `VerifySignature` → `Disabled`
  - `Option<T>` extensions → `None`
  - `void` extensions → empty
  - `CheckMortality` → `Immortal`
  - `CheckNonce` → `0`
  - `ChargeAssetTxPayment` → zero tip, no asset

  User overrides via `--ext` are supported for chains with non-standard extension requirements.

  **File-based input**

  YAML/JSON files now support an `unsigned: true` field:

  ```yaml
  chain: people
  unsigned: true
  tx:
    People:
      create_people_collection: null
  ```

  **Mutually exclusive flags**

  `--unsigned` cannot be combined with `--from`, `--nonce`, `--tip`, or `--mortality`.

### Patch Changes

- 6b67f55: Fix `--rpc` override being silently ignored when cached metadata exists for a chain.

  Previously, when using `--rpc <url>` to connect to a different endpoint, the CLI would return metadata from a previously cached chain instead of fetching fresh metadata from the specified endpoint. The metadata cache was keyed only by chain name, so `--rpc` pointing to a different chain (e.g. an asset hub parachain cached under the relay chain name) would silently return wrong metadata.

  Now, when `--rpc` is explicitly provided, the CLI always fetches fresh metadata from the specified endpoint, bypassing the name-based cache. The freshly fetched metadata is still saved to the cache so subsequent runs without `--rpc` use the updated data.

## 1.13.0

### Minor Changes

- e89cede: Add chain topology management with relay/parachain hierarchy awareness.

  **New: `relay` and `parachainId` fields in chain config**

  Chains now understand their position in the relay/parachain hierarchy. All built-in system parachains are preconfigured with their relay chain and parachain ID.

  **New: `--relay` and `--parachain-id` flags for `dot chain add`**

  When adding a custom chain, specify its parent relay chain. The parachain ID is auto-detected from on-chain `ParachainInfo.ParachainId` storage when omitted:

  ```bash
  # Add a relay chain
  dot chain add local-relay --rpc ws://localhost:9944

  # Add a parachain (auto-detects parachain ID)
  dot chain add local-asset-hub --rpc ws://localhost:9945 --relay local-relay

  # Explicit parachain ID
  dot chain add my-para --rpc wss://rpc.example.com --relay polkadot --parachain-id 2000
  ```

  **New: hierarchical `dot chain list` display**

  `dot chain list` now renders chains as a tree, grouping parachains under their relay:

  ```
  Configured Chains

    polkadot (default)  wss://polkadot.ibp.network
    ├─ polkadot-asset-hub [1000]  wss://...
    ├─ polkadot-bridge-hub [1002]  wss://...
    ├─ polkadot-collectives [1001]  wss://...
    ├─ polkadot-coretime [1005]  wss://...
    └─ polkadot-people [1004]  wss://...

    paseo  wss://paseo.ibp.network
    ├─ paseo-asset-hub [1000]  wss://...
    └─ paseo-people [1004]  wss://...

    my-solo-chain  wss://...
  ```

  **JSON output updated**

  `dot chain list --json` now includes `relay` and `parachainId` fields for parachain entries.

  **Orphan warning on relay removal**

  Removing a chain that other chains reference as their relay prints a warning listing orphaned parachains.

  **Config backward compatible**

  Existing saved configs are automatically migrated — built-in chains gain topology fields from defaults while preserving user RPC overrides.

- 135bd75: Remove Smoldot light client support. The `--light-client` global flag, `dot chain add <name> --light-client` command, and all underlying light client connection logic have been removed. Chains now always connect via WebSocket RPC. Existing user configs with `lightClient: true` are gracefully ignored and fall through to the configured RPC endpoints. Light client support will be reintroduced properly in a future release (see #142).
- a7e56dd: Add global `--json` flag for structured JSON output on every command. This is the single highest-impact change for agent and scripting usability.

  **New: `--json` flag**

  Every command now supports `--json` to output machine-readable JSON instead of colored human-readable text. This works as a shorthand for `--output json` (which continues to work).

  ```bash
  dot inspect --json                          # List pallets as JSON
  dot inspect Balances --json                 # Pallet detail as JSON
  dot chain list --json                       # Configured chains as JSON
  dot account list --json                     # All accounts as JSON
  dot account create my-key --json            # New account details as JSON
  dot tx.System.remark 0xdead --encode --json # Encoded call as JSON
  dot query.System --json                     # Storage items as JSON
  dot events.Balances --json                  # Events listing as JSON
  dot errors.Balances --json                  # Errors listing as JSON
  dot const.System --json                     # Constants listing as JSON
  ```

  For transaction submission, `--json` emits NDJSON (one JSON object per lifecycle event):

  ```bash
  dot tx.System.remark 0xdead --from alice --json
  # {"event":"signed","txHash":"0x..."}
  # {"event":"broadcasted","txHash":"0x..."}
  # {"event":"finalized","blockNumber":123,...}
  ```

  **Breaking: renamed tx decode flags**

  The `--json` and `--yaml` flags on the `tx` command (used to decode a raw call hex into a re-importable file format) have been renamed to `--to-json` and `--to-yaml` to avoid conflict with the new global `--json` flag.

  ```bash
  # Before
  dot tx 0x1f00... --yaml
  dot tx.System.remark 0xdead --json

  # After
  dot tx 0x1f00... --to-yaml
  dot tx.System.remark 0xdead --to-json
  ```

- 0cc6ede: Upgrade to polkadot-api (PAPI) v2. This brings performance improvements, a simplified provider stack, and aligns with the latest Polkadot ecosystem tooling.

  **Dependency changes**

  - `polkadot-api` upgraded from v1 to v2
  - `@polkadot-api/metadata-builders`, `@polkadot-api/substrate-bindings`, and `@polkadot-api/view-builder` upgraded to v2-compatible versions
  - Removed `ws` dependency — PAPI v2 auto-detects the native WebSocket implementation (Node 22+, Bun)
  - Removed `withPolkadotSdkCompat` wrapper — no longer needed in v2

  **Breaking: `--at best` removed**

  The `--at best` transaction option is no longer supported. PAPI v2 only accepts specific block hashes for the `--at` flag. Use `--at <0x...block-hash>` or omit `--at` entirely (defaults to the finalized block).

  ```bash
  # Before
  dot tx System.remark 0xdead --from alice --at best

  # After — omit --at for finalized (default), or pass a specific block hash
  dot tx System.remark 0xdead --from alice
  dot tx System.remark 0xdead --from alice --at 0xabc...
  ```

  `--at finalized` is still accepted for clarity but is equivalent to omitting the flag.

  **Internal changes**

  - Binary values from the runtime are now `Uint8Array` (previously `Binary` class instances). Display behavior is unchanged — text-like bytes render as text, others as hex.
  - Constants are now accessed via `getStaticApis()` instead of the removed `runtimeToken`.
  - WebSocket provider imported from `polkadot-api/ws` (previously `polkadot-api/ws-provider`).

### Patch Changes

- 489069e: Improve unknown account error messages with readable multi-line listing and fuzzy match suggestions.

  **Before:**

  ```
  Error: Unknown account or address "people-sudo-signer".
    Available accounts: alice, bob, charlie, dave, eve, ferdie, people-paseo-sudo, pusd-faucet, ...
  ```

  **After:**

  ```
  Error: Unknown account or address "people-sudo-signer".
    Did you mean: people-paseo-sudo?
    Available accounts:
      - alice
      - bob
      - charlie
      - dave
      - eve
      - ferdie
      - people-paseo-sudo
      - pusd-faucet
      - ...
  ```

  When the input is close to an existing account name, a "Did you mean?" hint is shown using Levenshtein distance matching (same fuzzy matching already used for pallets and calls). Available accounts are sorted alphabetically and listed one per line for easy scanning.

- 9334ab8: Bump polkadot-api to 2.0.1 and all related dependencies to their latest patch versions.

## 1.12.0

### Minor Changes

- 1ff250b: Add `dot sign` command for signing arbitrary messages with account keypairs. Accepts inline text, hex bytes (`0x`-prefixed), file contents (`--file`), or stdin (`--stdin`). Output shows the crypto type, message bytes in hex, raw signature, and a `Sr25519(0x...)` enum value directly usable as a `MultiSignature` argument in transaction calls. Supports `--output json` for structured output. Supports dev accounts, stored accounts, and env-backed accounts via `--from`. Signature type is configurable with `--type` (default: sr25519).
- cb7c058: Add `dot verifiable` command to derive Bandersnatch member keys from account mnemonics using the `verifiablejs` WASM library. Supports unkeyed (lite person) and keyed derivation via `--context` flag (e.g. `--context candidate` for full person). Derived keys are saved to the account store and displayed in `account inspect` and `account create` output.
- 9240771: Remove `--limit` option from map queries.

  The `--limit` flag only truncated displayed results after all entries were already fetched from the chain, providing no performance benefit. The default limit of 100 silently hid results, which could confuse users who didn't realize their output was truncated.

  All map query results are now returned in full. Users who want to limit output can pipe through standard Unix tools (e.g. `| head -n 10` or `| jq '.[0:5]'`).

## 1.11.0

### Minor Changes

- 130d737: Add comma-separated syntax for `Vec<T>` parameters.

  Array arguments (like `Utility.batchAll` calls) can now be passed as comma-separated values instead of requiring a JSON array string. This makes composing batch calls from individually encoded calls much more ergonomic:

  ```bash
  A=$(dot tx Balances.transfer_keep_alive 5FHn... 1DOT --encode)
  B=$(dot tx System.remark 0xdead --encode)
  dot tx Utility.batchAll $A,$B --from alice
  ```

  - Works for any `Vec<T>` parameter (not just batch calls)
  - `Vec<u8>` byte arrays are unaffected (still treated as binary)
  - JSON array syntax `'[...]'` and file-based input continue to work as before

## 1.10.0

### Minor Changes

- 2f6aad6: Add transaction options: `--nonce`, `--tip`, `--mortality`, and `--at` flags for `dot tx`.

  - `--nonce <n>` overrides the auto-detected nonce, enabling rapid-fire submission of multiple extrinsics without waiting for each to finalize
  - `--tip <amount>` adds a priority tip (in planck) to the transaction pool
  - `--mortality <spec>` controls transaction lifetime: `immortal` for no expiry, or a period number (minimum 4) for a custom mortality window
  - `--at <block>` specifies which block state to validate against (`best`, `finalized`, or a block hash)
  - All options are passed through to polkadot-api's `TxOptions` and work with `--dry-run`, file-based commands, and all wait levels

## 1.9.0

### Minor Changes

- dfd359d: Support partial key queries for multi-key storage maps (NMaps). You can now pass fewer key arguments than expected to retrieve all entries matching that prefix via `getEntries()`, without requiring `--dump`. For example, querying a 2-key map with only the first key returns all entries under that prefix.

### Patch Changes

- 115b751: Improve best-effort hex-to-text conversion for Binary values.

  Binary fields that contain control characters (C0/C1), DEL, or Private Use Area code points now correctly fall back to hex display instead of rendering as garbled text. This fixes storage keys and other identifiers that start with a text-based prefix but contain binary hash data after it.

- f0516ef: Add npm version badge to README

## 1.8.1

### Patch Changes

- 65d540b: Fix file-based command invocation when running under Node.js and preserve hex variable values.

  - Replace Bun-specific APIs (`Bun.file`, `Bun.stdin`) with Node.js-compatible equivalents (`node:fs/promises`, `process.stdin`) so `dot ./file.yaml` works when installed from npm
  - Preserve hex `--var` values (e.g. `--var CALL=0xdeadbeef`) as strings in YAML files — previously YAML's core schema silently converted `0x…` to integers, dropping leading zeros and breaking encoded call data
  - Improve the "undefined variable" error message with a structured, multiline format listing all resolution options

## 1.8.0

### Minor Changes

- 55cff47: Add `dot parachain` command to derive sovereign account addresses for parachains.

  - `dot parachain 1000` shows both child and sibling sovereign accounts for a given parachain ID
  - Child accounts (`"para"` prefix) represent a parachain on the relay chain
  - Sibling accounts (`"sibl"` prefix) represent a parachain on another parachain
  - `--type child` or `--type sibling` to show only one type
  - `--prefix <N>` to control the SS58 address encoding (default: 42)
  - `--output json` for pipe-safe structured output
  - Runs offline — no chain connection required
  - No new dependencies — uses existing SS58 encoding utilities

- f637890: Add `--yaml` and `--json` flags to decode transaction call data into file-compatible formats.

  - `dot tx.0x1f0003... --yaml` decodes a raw hex call to YAML
  - `dot tx.System.remark 0xdead --json` encodes then outputs as JSON
  - Output matches the file input format, enabling a round-trip workflow: encode a call, decode to YAML/JSON, tweak parameters, re-execute via file input
  - Works offline from cached metadata, does not require `--from`
  - Mutually exclusive with `--encode` and `--dry-run`

## 1.7.0

### Minor Changes

- 49f8f16: Add file-based command input: run any `dot` command from a YAML or JSON file.

  - `dot ./transfer.yaml --from alice --dry-run` reads a structured file and routes to the appropriate handler
  - Supports all categories: `tx`, `query`, `const`, `apis`
  - Shell-style variable substitution with `${VAR}` and `${VAR:-default}` syntax
  - Variables resolved from `--var KEY=VALUE` flags, environment variables, or a `vars:` section in the file
  - Both `.yaml`/`.yml` and `.json` file formats supported
  - All existing CLI flags (`--from`, `--dry-run`, `--encode`, `--chain`, etc.) work with file input

### Patch Changes

- 93c13e2: Add XCM transfer examples to documentation: teleport DOT and reserve transfer USDC from polkadot-asset-hub.

  - Teleport DOT example: Asset Hub to relay chain via `PolkadotXcm.limited_teleport_assets`
  - Reserve transfer USDC (asset 1337) example: Asset Hub to Hydration (parachain 2034) via `PolkadotXcm.limited_reserve_transfer_assets`
  - Both YAML and JSON formats shown
  - Examples verified via integration tests against relay chain metadata

## 1.6.1

### Patch Changes

- 8300ca7: Fix space-separated arguments not being recognized as pallet/item segments when used with `--chain` flag or category-only dot-paths.

  - `dot --chain polkadot api Core` now correctly lists Core methods (previously showed global API list)
  - `dot query System` now lists System storage items (equivalent to `dot query.System`)
  - `dot events Balances Transfer` now shows Transfer event detail (equivalent to `dot events.Balances.Transfer`)
  - Applies to all categories: query, tx, const, events, errors, apis

## 1.6.0

### Minor Changes

- cae50f3: Add `--all` flag to `dot chain update` to re-fetch metadata for all configured chains in parallel.

  - `dot chain update --all` updates all chains concurrently
  - Shows a summary with check/cross marks for each chain
  - Failures don't block other chains (uses `Promise.allSettled`)
  - Exits with non-zero if any chain fails

- 7064511: Add runtime API calls as new `apis` category. Browse and call Substrate runtime APIs (e.g. `Core.version`, `AccountNonceApi.account_nonce`) directly from the CLI.

  - `dot apis` lists all runtime APIs with method counts
  - `dot apis.Core` lists methods in a specific API with signatures
  - `dot apis.Core.version` calls a runtime API method
  - Chain prefix support: `dot polkadot.apis.Core.version`
  - `--help` support: `dot apis.Core.version --help`
  - Shell completions for API names and method names
  - Aliases: `api` and `apis` both work
  - Metadata fetching now requests v15 metadata first (required for runtime API info), falling back to v14
  - Shows a helpful hint when cached metadata is v14 and does not include runtime APIs

### Patch Changes

- 4c7dbaa: Add feature list to README and docs landing page

## 1.5.0

### Minor Changes

- 142329f: Add `--wait` / `-w` flag to control how long `tx` commands wait before returning.

  By default, `dot tx` waits for finalization (~30s on Polkadot). The new `--wait` flag lets you choose an earlier resolution point:

  ```
  # Return as soon as the tx is broadcast (fastest)
  dot tx.System.remark 0xdead --from alice --wait broadcast

  # Return when included in a best block (medium)
  dot tx.System.remark 0xdead --from alice -w best-block
  dot tx.System.remark 0xdead --from alice -w best   # alias

  # Wait for finalization (default, unchanged behavior)
  dot tx.System.remark 0xdead --from alice --wait finalized
  dot tx.System.remark 0xdead --from alice            # same
  ```

  The output adapts to the wait level:

  - **broadcast**: shows tx hash and broadcast status, no events or explorer links
  - **best-block**: shows events and explorer links with a "(best block, not yet finalized)" hint
  - **finalized**: unchanged behavior with full events and explorer links

  Shell completions for `--wait` / `-w` values are included.

- 0df428d: Sort all CLI output alphabetically. Pallets, storage items, constants, calls, events, and errors are now listed in alphabetical order across all commands (inspect, query, tx, const, events, errors) and shell completions, making it easier to find specific items.

## 1.4.0

### Minor Changes

- 080d2d0: Require `--dump` flag for keyless map queries to prevent accidentally fetching all entries.

  Running `dot query.System.Account` (a map query without a key) now shows help and usage info instead of fetching every entry via `getEntries()`. This protects users from accidentally triggering slow, expensive full-map dumps on live chains with millions of entries.

  To explicitly fetch all entries, pass `--dump`:

  ```
  dot query.System.Account --dump
  dot query.System.Account --dump --limit 10
  ```

  Querying a specific key still works as before:

  ```
  dot query.System.Account 5GrwvaEF...
  ```

### Patch Changes

- 000ab29: Fix enum variant names not recognized as storage query keys.

  Enum variants whose metadata type is wrapped in `lookupEntry` indirection (e.g. `{ type: "lookupEntry", value: { type: "void" } }`) were not resolved before checking for void, causing them to fall through as raw strings. This produced a cryptic "Incompatible runtime entry" error when querying storage maps keyed by such enums (e.g. `ChunksManager.Chunks R2e9 1`). The same variants already worked in `--encode` via the shorthand path, which correctly resolved `lookupEntry` first.

- e798641: Add `emulate -L zsh` to zsh completion function to prevent user shell options from interfering with completion logic.

## 1.3.0

### Minor Changes

- a155161: Add shell completion support for zsh, bash, and fish.

  Run `dot completions zsh`, `dot completions bash`, or `dot completions fish` to generate a shell completion script. Tab-complete subcommands, chain names, pallet names, and item names from cached metadata — all offline with no network calls.

  Completions are context-aware: `query.` completes pallets with storage items, `tx.` completes pallets with calls, `events.` and `errors.` filter accordingly. Chain prefix paths (`polkadot.query.System.`) and option values (`--chain`, `--from`, `--output`) are also supported.

## 1.2.0

### Minor Changes

- 4acef22: Add watch-only accounts and named address resolution.

  Accounts can now be added without secrets using `dot account add <name> <address>`, storing just the public key as a watch-only entry. Named accounts (both watch-only and keyed) resolve everywhere an AccountId32 is expected — in `dot tx` arguments, `dot query` keys, and MultiAddress auto-wrapping. For example: `dot tx Balances.transferKeepAlive treasury 1000 --from alice` or `dot query System.Account treasury`.

  Watch-only accounts show a `(watch-only)` badge in `dot account list`, cannot be used with `--from` (signing), and cannot be used as `derive` sources. The `add` subcommand is now context-sensitive: bare `add <name> <address>` creates a watch-only entry, while `add --secret` or `add --env` imports a keyed account as before.

### Patch Changes

- d2f64eb: Fix release workflow timeout by parallelizing sequential `runCli` calls in account import test.

## 1.1.1

### Patch Changes

- f14bef7: Fix "Missing WebSocket class" error when running in sandboxed environments (e.g. LLM/MCP runtimes, plain Node.js without native WebSocket). The WS provider now explicitly uses the `ws` package instead of relying on `globalThis.WebSocket`.

## 1.1.0

### Minor Changes

- b81413f: Add item-level `--help` for fully-qualified dot-path commands. Running `dot tx.System.remark --help`, `dot query.System.Account --help`, `dot const.Balances.ExistentialDeposit --help`, etc. now shows metadata detail (args, types, docs) and category-specific usage hints — all offline without connecting to the chain. For `tx` commands, omitting `--from` and `--encode` now shows this same help output instead of a terse error.

## 1.0.0

### Major Changes

- 6bc0964: Restructure CLI to use dot-path syntax. Categories (`query`, `tx`, `const`, `events`, `errors`) are now part of the dot-separated path instead of separate top-level commands.

  **Before:** `dot query System.Account <addr>`, `dot tx Balances.transfer_keep_alive <dest> <amount>`
  **After:** `dot query.System.Account <addr>`, `dot tx.Balances.transfer_keep_alive <dest> <amount>`

  New features:

  - Chain prefix is now a 4-segment path: `dot polkadot.query.System.Account`
  - Category-only invocation lists pallets: `dot query` lists pallets with storage items
  - Pallet-only invocation lists items: `dot query.System` lists storage items, `dot tx.Balances` lists calls
  - `explore` alias for `inspect`: `dot explore` and `dot explore System` work like `dot inspect`
  - Category aliases work in dot-paths: `consts`, `constants`, `event`, `error`

  Removed top-level commands: `call`/`calls`, `event`/`events`, `error`/`errors`, `storage`, `pallet`/`pallets`, standalone `query`, `tx`, `const`/`consts`/`constants`. Use the new dot-path syntax instead.

  Kept commands: `inspect` (+ `explore` alias), `chain`, `account`, `hash`.

## 0.14.0

### Minor Changes

- b52f508: Add events and errors to `dot inspect`. Add focused listing commands: `dot calls`, `dot events`, `dot errors`, `dot storage`, and `dot pallets` for browsing specific metadata categories. Make `dot const` dual-purpose — `dot const Balances` now lists constants while `dot const Balances.ExistentialDeposit` still looks up the value. All focused commands support chain prefix syntax and detail views.

### Patch Changes

- 6ada67a: Fix stdout pollution when piping `--output json` to tools like `jq`. Progress messages ("Fetching metadata...", "Connecting...", spinner output) now go to stderr instead of stdout, following Unix conventions. Commands like `dot const System.SS58Prefix --output json | jq .` now work correctly without JSON parse errors from interleaved progress text.
- bc94695: Show first complete sentence in listing views instead of raw metadata lines. Documentation strings were previously cut at metadata line boundaries, losing information mid-sentence. Listing summaries now join all doc lines and extract the first complete sentence, correctly handling abbreviations like `e.g.`, `i.e.`, and `etc.` so they don't cause early truncation. Type descriptions are no longer truncated either — the terminal handles line wrapping.

## 0.13.0

### Minor Changes

- 90d6915: Add `dot account inspect` to convert between SS58 addresses, hex public keys, and account names. Accepts dev account names, stored account names, SS58 addresses, or `0x`-prefixed 32-byte public keys. Use `--prefix <N>` to encode with a specific SS58 prefix (default: 42). Supports `--output json` for machine-readable output. Unknown subcommands fall through to inspect, so `dot account alice` works as a shorthand for `dot account inspect alice`.
- 092e81c: Add calls/extrinsics to `dot inspect`. Pallet overviews now show a "Calls:" section listing all available extrinsics alongside storage items and constants. Use `dot inspect Balances.transfer_allow_death` to see a call's argument signature and documentation. Call names are also included in typo suggestions.

### Patch Changes

- 533aa76: Improve argument parsing error messages with contextual information. When `parseTypedArg` fails (e.g. passing `"abc"` where a `Compact<u128>` is expected), the error now includes the argument name (for struct fields) or index (for tuples), the expected type, the invalid value, and a hint describing what the type expects. Previously, errors surfaced as raw JS exceptions (e.g. `Failed to parse String to BigInt`) with no context about which argument failed.
- 9b9a04e: Add fallback call decoder for XCM and complex types. When the primary view-builder decoder crashes (e.g. on `PolkadotXcm.limited_teleport_assets`), the CLI now falls back to `DynamicBuilder.buildDefinition()` which correctly handles these calls. Previously, complex XCM calls would show "(unable to decode)" in dry-run and transaction output.

## 0.12.0

### Minor Changes

- e811262: Add `--path` option to `account create`, `account import`, and a new `account derive` action for derivation path support. Accounts created or imported with a path derive a different keypair from the same secret. `account list` shows the derivation path alongside the account name.
- ab8919b: Support deleting multiple accounts in one command: `dot account delete wallet1 wallet2 wallet3`. All names are validated upfront — if any name is invalid or not found, no accounts are removed (atomic semantics).
- 13ecf03: Support multiple RPC endpoints per chain with automatic fallback. Built-in chains now ship with fallback providers. Use repeated `--rpc` flags to configure multiple endpoints: `dot chain add kusama --rpc wss://a --rpc wss://b`. If the primary endpoint is unreachable, the CLI automatically tries the next one. Existing single-RPC configs continue to work unchanged.
- 7e576b3: Add all system parachains as preconfigured chains with full RPC endpoint lists. Polkadot and Paseo now ship with Asset Hub, Bridge Hub, Collectives, Coretime, and People parachains out of the box. Existing chains (polkadot, paseo, polkadot-asset-hub, paseo-asset-hub, polkadot-people) have been updated with additional RPC providers. IBP endpoints are listed first as primary, with community providers as fallbacks. Light client chain specs are included for all chains where available.

### Patch Changes

- 3c5a2cc: Fix `--help` flag on subcommands (`dot account --help`, `dot chain --help`, `dot hash --help`) to show the same detailed custom help as running the bare command instead of CAC's generic auto-generated help.

## 0.11.0

### Minor Changes

- 77299c1: Merge `account add --env` into `account import` so that `import` accepts both `--secret` and `--env`. `add` is now an alias for `import` (like `new` for `create` and `delete` for `remove`).

### Patch Changes

- 3100e88: Add `new` as an alias for `account create` and `delete` as an alias for `account remove` for more natural command naming.
- 6ed0d38: Fix case-insensitive chain name resolution. Chain names like `Polkadot`, `POLKADOT`, or `Kusama` now resolve correctly in `--chain` flags, chain prefixes (e.g. `Polkadot.System.Number`), `chain default`, and `chain remove`.
- 112d7c9: Fix update notification never showing due to a race condition. The background version check now stores its promise and `process.exit()` waits up to 500ms for it to complete, ensuring the cache file is written before exit. Failed checks are cached for 1 hour to avoid repeated delays when the network is down.
- d859287: Show help text instead of listing items when running `dot account` or `dot chain` with no action. This is consistent with typical CLI behavior where bare subcommands show usage help. Use `dot account list` or `dot chain list` to list items explicitly.

## 0.10.0

### Minor Changes

- 5c46afa: Add environment-variable-backed accounts with `dot account add <name> --env <VAR>`. Instead of storing secrets on disk, the CLI stores a reference to an environment variable and reads the secret at signing time. Ideal for CI/CD pipelines and security-conscious workflows. The `account list` command shows an `(env: VAR)` badge for these accounts and resolves addresses live when the variable is set.

## 0.9.0

### Minor Changes

- 7b5eec7: Add ergonomic enum shorthand syntax for `dot tx` arguments. Instead of verbose JSON like `'{"type":"system","value":{"type":"Authorized"}}'`, you can now write `'system(Authorized)'`. Supports nested enums, case-insensitive variant matching, JSON inside parens for structs, and empty parens for void variants. All existing formats (JSON, hex, SS58 addresses) continue to work unchanged.

### Patch Changes

- 8e4fcf8: Fix Binary values (e.g. token `symbol` and `name` fields) displaying as `{}` in query and transaction output. Binary instances now render as human-readable text when valid UTF-8, or as hex strings otherwise.

## 0.8.1

### Patch Changes

- 84761a3: Remove `chain: <name>` output from `query` and `const` commands. Previously, both commands printed the chain name to stdout (in pretty mode) or stderr (in JSON mode) before the result. This broke piping to `jq` and other tools that expect clean, parseable output. Stdout now contains only the query/constant result, making `dot query ... | jq` and `dot const ... | jq` work out of the box.

## 0.8.0

### Minor Changes

- f045a20: Add chain-prefix syntax for `query`, `const`, `tx`, and `inspect` commands. Instead of using `--chain`, you can now prefix the target with the chain name: `dot query kusama.System.Account <addr>`, `dot const kusama.Balances.ExistentialDeposit`, `dot inspect kusama.System`. The `--chain` flag and default chain remain as fallbacks. If both a chain prefix and `--chain` flag are provided, the CLI errors with a clear message.

## 0.7.0

### Minor Changes

- d97f5e3: Add `dot chains` and `dot accounts` shorthands that list all chains and accounts without the explicit `list` subcommand. Running `dot chain` or `dot account` with no action now also defaults to listing instead of showing help text. `dot chain list` and `dot account list` continue to work as before.
- ba05ba0: Add update notifier that shows a boxed notification when a new version of polkadot-cli is available on npm. The check runs in the background on startup, caches results for 24 hours in `~/.polkadot/update-check.json`, and never blocks the CLI. Disable with `DOT_NO_UPDATE_CHECK=1`; automatically suppressed in CI environments and non-TTY output.

### Patch Changes

- 0a68bd1: Fix `dot query` for storage maps with composite keys (e.g. `Hrmp.HrmpChannels`). Positional CLI args are now composed into structs using metadata field names, so `dot query Hrmp.HrmpChannels 1000 5140` correctly passes `{ sender: 1000, recipient: 5140 }` instead of two separate arguments. Also adds metadata-aware parsing for NMap (multi-hasher) keys and descriptive error messages for wrong argument counts.

## 0.6.2

### Patch Changes

- a95d1eb: Exit with non-zero code when a transaction has a dispatch error (e.g. `Balances.InsufficientBalance`). Module errors are now formatted as `PalletName.ErrorVariant` instead of raw JSON. The full transaction output (events, explorer links) is still printed before the error.
- 254e693: Show finalized block number as a checkmark in the transaction progress spinner instead of a separate Block line in the summary output

## 0.6.1

### Patch Changes

- 4f47747: Add integration tests for all CLI commands (chain, account, inspect, hash, const, query, global) and document that account secrets are stored unencrypted. Also document that hex seed import via `--secret 0x...` is not supported due to a CLI parser limitation.
- 63f8b52: Fix `value.asBytes is not a function` error when encoding complex JSON arguments (e.g. XCM calls) that contain nested byte arrays, large numbers, or null option values. The `normalizeValue` function now converts hex strings to `Binary` for `[u8; N]`/`Vec<u8>` fields, coerces string primitives from JSON to proper types (`BigInt` for u128, `parseInt` for u32), and maps JSON `null` to `undefined` for `Option::None`.

## 0.6.0

### Minor Changes

- a21f8b9: Add `--encode` flag to `dot tx` for encoding calls to hex without signing or submitting. Useful for preparing calls to be used with `Sudo.sudo`, multisig proposals, or governance. Works offline from cached metadata and does not require `--from`.
- 805ae11: Add `dot hash` command for computing cryptographic hashes (BLAKE2b-256, BLAKE2b-128, Keccak-256, SHA-256). Supports hex input, plain text, file contents, and stdin.

### Patch Changes

- 2d53556: Fix `inner[tag] is not a function` error when passing XCM types (like `Junctions::X1`) to `dot tx`. polkadot-api unwraps `[T; 1]` fixed arrays in metadata, but users naturally pass single-element arrays per the XCM spec. The CLI now auto-detects this mismatch and unwraps accordingly.

## 0.5.0

### Minor Changes

- 927068d: Show PolkadotJS Apps and PAPI Explorer links in the transaction summary after finalization
- f89ed8b: Show progressive transaction status with an animated spinner (signed → broadcasted → in best block → finalized) instead of a static "Signing and submitting..." message

### Patch Changes

- 04c86b1: Centralize process.exit(0) in cli.ts so commands exit immediately after completion instead of hanging on polkadot-api timers
- f555e58: Reorder README sections, document --ext flag and output display, add CI and release GitHub Actions workflows
- f555e58: Read CLI version from package.json instead of a hardcoded string to prevent version drift

## 0.4.0

### Minor Changes

- d963874: feat: support raw SCALE-encoded call hex in `dot tx`

  Users can now submit pre-encoded calls directly:

  ```bash
  dot tx 0x0503008eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48070010a5d4e8 --from alice
  ```

  Both raw hex and `Pallet.Call` forms now display a decoded human-readable representation of the call.

## 0.3.0

### Minor Changes

- e64ae85: feat: auto-handle custom signed extensions and display encoded call hex

  - Auto-detect non-standard signed extensions from chain metadata and provide sensible defaults (void → empty bytes, Option → None, enum with Disabled variant → Disabled). This fixes `dot tx` on chains like people-preview that have extensions such as `VerifyMultiSignature` and `PeopleLiteAuth`.
  - Add `--ext <json>` flag to manually override or provide custom signed extension values for complex cases.
  - Display SCALE-encoded call data hex in both dry-run and submission output, useful for pasting into call decoders.

## 0.2.1

### Patch Changes

- Fix `Vec<u8>` args (e.g. `System.remark`) to use `Binary` as polkadot-api expects
- Auto-wrap SS58 addresses into `MultiAddress.Id` for transfer calls

## 0.2.0

### Minor Changes

- 6b54658: Add account management and extrinsic submission

  - `dot account create|import|list|remove` — manage named accounts with BIP39 mnemonics or hex seeds
  - `dot tx Pallet.Call [...args] --from <name>` — build, sign, and submit extrinsics with metadata-aware arg parsing
  - `--dry-run` flag to estimate fees without submitting
  - Built-in dev accounts (Alice..Ferdie) always available for testnets
