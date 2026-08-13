[![npm version](https://img.shields.io/npm/v/polkadot-cli)](https://www.npmjs.com/package/polkadot-cli)
[![codecov](https://codecov.io/gh/paritytech/polkadot-cli/branch/main/graph/badge.svg)](https://codecov.io/gh/paritytech/polkadot-cli)

# polkadot-cli

A command-line tool for interacting with Polkadot-ecosystem chains. Manage chains and accounts, query storage, look up constants, inspect metadata, submit extrinsics, and compute hashes — all from your terminal.

Ships with Polkadot and all system parachains preconfigured with multiple fallback RPC endpoints. Add any Substrate-based chain by pointing to its RPC endpoint(s).

## Features

- ✅ Same syntax as [polkadot-api](https://papi.how) (PAPI)
- ✅ Chain name prefix — `dot polkadot.query.System.Number`
- ✅ zsh, bash, and fish autocompletion
- ✅ Exposes all on-chain metadata documentation
- ✅ Encode, dry-run, and submit extrinsics
- ✅ Support for custom signed extensions — and a `dot <chain>.extensions` inspector to discover them
- ✅ Built with agent use in mind — structured JSON output on every command (`--json`)
- ✅ Fuzzy matching with typo suggestions
- ✅ Account management — BIP39 mnemonics, derivation paths, env-backed secrets, watch-only, dev accounts
- ✅ Local workspaces — `dot init` creates a `.polkadot/` in any directory, auto-discovered git-style and fully isolated from your global `~/.polkadot`
- ✅ Named address resolution across all commands
- ✅ Runtime API calls — `dot polkadot.apis.Core.version`
- ✅ Raw JSON-RPC calls — `dot polkadot.rpc.system_health`, with discovery via `rpc_methods` and tab-completion
- ✅ Full-metadata dump — `dot metadata <chain>` emits one JSON blob with pallets, runtime APIs, and transaction extensions (or raw SCALE bytes via `--raw`)
- ✅ Stale-metadata detection — when a tx or query fails because the runtime upgraded, the CLI tells you exactly which `dot chain update` to run
- ✅ Chain topology — relay/parachain hierarchy with tree display and auto-detection
- ✅ Batteries included — all system parachains and testnets already setup to be used
- ✅ File-based commands — run any command from a YAML/JSON file with variable substitution
- ✅ Sovereign accounts — store a parachain (child / sibling) or pallet (Treasury, Bounties, NominationPools, …) sovereign as a named watch-only account in one command
- ✅ Message signing — sign arbitrary bytes with account keypairs for use as `MultiSignature` arguments
- ✅ Unsigned/authorized transactions — submit governance-authorized calls without a signer (`--unsigned`)
- ✅ Non-native fee payment — pay tx fees in any asset the chain accepts via `--asset` (asset-hub-style chains)
- ✅ Bandersnatch member keys — derive Ring VRF member keys from mnemonics for on-chain member sets
- ✅ Export/import — portable chain and account configuration for backup, sharing, and CI bootstrapping
- ✅ Agent skill — bundled `dot-cli` skill teaches coding agents (Claude Code, Codex) how to drive the CLI; install with `dot skill install --codex`/`--claude`

### Preconfigured chains

| Network | Chain |
|---------|-------|
| Polkadot | `polkadot` (relay) |
| | `polkadot-asset-hub` |
| | `polkadot-bridge-hub` |
| | `polkadot-collectives` |
| | `polkadot-coretime` |
| | `polkadot-people` |
| | `polkadot-bulletin` |
| Paseo (testnet) | `paseo` (relay) |
| | `paseo-asset-hub` |
| | `paseo-people` |
| | `paseo-bulletin` |

Each chain ships with multiple RPC endpoints from decentralized infrastructure providers (Parity, Dwellir, Gatotech, LuckyFriday, Stakeworld, and others). The CLI automatically falls back to the next endpoint if the primary is unreachable.

## Install

```bash
npm install -g polkadot-cli@latest
```

This installs the `dot` command globally.

## Agent skill (Claude Code & Codex)

`dot` ships a skill that teaches coding agents how to drive the CLI — query patterns, tx encoding, runtime API calls, and bash scripting gotchas. The skill auto-triggers when you ask about `dot`, Substrate storage queries, extrinsic submission, runtime APIs, or XCM.

The skill is bundled into the `dot` binary, so it's always version-matched to your install. Print it anywhere with:

```bash
dot skill show                # SKILL.md to stdout
dot skill show --references   # plus the bundled reference docs
```

### Codex CLI

```bash
dot skill install --codex
```

This writes the skill to `~/.agents/skills/dot-cli`, where Codex auto-discovers it (use `--local` to install into `./.agents/skills` for the current repo instead). Restart Codex if it doesn't pick the skill up immediately.

### Claude Code

```bash
dot skill install --claude    # -> ~/.claude/skills/dot-cli
```

This registers the skill under the short name `dot-cli`, invokable with `/dot-cli`.

Alternatively, install via the plugin marketplace (registers as the more verbose `dot-cli:dot-cli`):

```
/plugin marketplace add paritytech/polkadot-cli
/plugin install dot-cli@polkadot-cli
```

Pick one method — installing both ways leaves Claude Code with two copies of the same skill. Marketplace installs update with `/plugin marketplace update polkadot-cli`.

After upgrading `dot` (`npm install -g polkadot-cli@latest`), re-run `dot skill install --codex`/`--claude` to refresh the installed skill. Run `dot skill path` to see where each agent's copy lives. Installed copies carry the CLI version in their frontmatter (`version:`), so an agent can spot a stale skill by comparing it against `dot --version`.

## Plugins

`dot` supports git/cargo-style external subcommands: any executable named `dot-<name>` on your PATH runs as `dot <name>`, with the remaining arguments forwarded verbatim, stdio inherited, and the plugin's exit code passed through.

```bash
npm install -g dot-example     # ships a `dot-example` binary
dot example status --json      # runs: dot-example status --json
```

This is how domain-specific tooling extends `dot` without the CLI loading third-party code into its own process. Plugins are ordinary child processes — the intended pattern is that a plugin invokes `dot` itself for anything chain- or signing-related (e.g. `dot tx.… --from <account>`), so key handling stays inside `dot`.

Plugins receive a `DOT_BIN` environment variable pointing at the entry script of the `dot` that dispatched them (the same convention as cargo's `CARGO`), so they can invoke the exact same installation rather than whatever `dot` is first on PATH.

Notes:

- Only a bare first token dispatches: `dot foo.bar` is always dot-path syntax, `./file.yaml` is always file input — neither will hit the plugin lookup.
- Built-in commands and categories always win over a plugin of the same name.

## Usage

### Manage chains

```bash
# Show chain help
dot chain               # shows available actions
dot chains              # shorthand, same as above

# Add a chain (single RPC)
dot chain add kusama --rpc wss://kusama-rpc.polkadot.io

# Add a chain with fallback RPCs (repeat --rpc for each endpoint)
dot chain add kusama --rpc wss://kusama-rpc.polkadot.io --rpc wss://kusama-rpc.dwellir.com

# Add a parachain under a relay (auto-detects parachain ID)
# Name parachains `{relay}-{parachain}` — see "Naming convention" below
dot chain add local-relay-asset-hub --rpc ws://localhost:9945 --relay local-relay

# Add a parachain with explicit parachain ID
dot chain add my-para --rpc wss://rpc.example.com --relay polkadot --parachain-id 2000

# List configured chains (shows relay/parachain hierarchy)
dot chain list
dot chains                  # shorthand
dot chains -v               # include RPC endpoints in the list

# Inspect a single chain (rpc, parachains, metadata cache status)
dot chain info polkadot
dot chain polkadot          # bare-noun shortcut, same as `chain info polkadot`

# Re-fetch metadata after a runtime upgrade
dot chain update polkadot   # updates a specific chain
dot chain update --all      # updates all configured chains in parallel

# Remove a chain (only user-added chains can be removed)
dot chain remove kusama
```

#### Naming convention

Name chains `{relay}-{parachain}`: the parent relay's name, a hyphen, then the parachain's role. Every preconfigured chain already follows this pattern (`polkadot-asset-hub`, `polkadot-bridge-hub`, `paseo-people`, …), and reusing it for chains you add keeps the relay/parachain topology readable.

| Chain kind | Recommended name | Examples |
|------------|------------------|----------|
| Relay chain | `{relay}` | `polkadot`, `kusama`, `paseo` |
| Parachain | `{relay}-{parachain}` | `polkadot-asset-hub`, `kusama-bridge-hub`, `paseo-people` |

The relay prefix is what keeps chains distinct: parachain IDs collide across relays (Asset Hub is `1000` on both Polkadot and Paseo), so the name — not the ID — is how you select a chain (`dot polkadot-asset-hub.query…`). A relay-prefixed name also mirrors the `dot chain list` tree, which groups parachains under their relay.

```bash
# Recommended — relay-prefixed name
dot chain add kusama-asset-hub --rpc wss://asset-hub-kusama-rpc.polkadot.io --relay kusama --parachain-id 1000
```

Use lowercase, hyphen-separated names (chain names resolve case-insensitively).

#### Chain topology

`dot chain list` displays chains as a tree, grouping parachains under their parent relay:

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

  my-solo-chain
```

The default list is intentionally compact — names + relay tree + parachain IDs. Pass `-v` / `--verbose` to also print every RPC endpoint inline (à la `git remote -v`):

```
Configured Chains

  polkadot  wss://polkadot-rpc.n.dwellir.com
       wss://polkadot.gatotech.network
       wss://rpc.polkadot.io
  ├─ polkadot-asset-hub [1000]  wss://polkadot-asset-hub-rpc.polkadot.io
       ...
```

For the full set of fields for one chain (RPCs, parent relay, child parachains, metadata cache status), use `dot chain info <name>`:

```
dot chain info polkadot

# polkadot
#
#   rpc:
#     wss://polkadot-rpc.n.dwellir.com
#     wss://rpc.polkadot.io
#     ...
#   parachains:
#     polkadot-asset-hub [1000]
#     polkadot-bridge-hub [1002]
#     ...
#   metadata:
#     not cached — run `dot chain update polkadot`
```

After a successful `dot chain update <name>`, the `metadata:` row shows the cached `specName`, `specVersion`, and `fetchedAt` timestamp instead of the `not cached` hint. `dot chain info <name> --json` emits the same data as a structured object (with `metadata: null` when no fingerprint is cached). Names resolve case-insensitively. The bare-noun form `dot chain <name>` is a shortcut for `dot chain info <name>` — known action verbs (`add`, `remove`, `update`, `list`, `export`, `import`, `info`) take precedence over chain names if there's ever a clash.

All built-in system parachains are preconfigured with their relay chain and parachain ID. When adding a custom parachain with `--relay`, the CLI auto-detects the parachain ID from on-chain `ParachainInfo` storage. Use `--parachain-id` to set it explicitly if auto-detection is not available.

Removing a relay chain that has parachains prints a warning listing the orphaned chains. The parachains remain in the config and can be re-associated later.

#### Selecting a chain

Every chain-consuming command must specify a chain explicitly. Prefer the dotpath chain prefix; the `--chain <name>` flag is equivalent. There is no hidden default; running a command without a chain errors out with a message listing the configured chains.

```bash
# Recommended — dotpath chain prefix
dot polkadot.query.System.Number
# Output:
# 31014744

# Equivalent — --chain flag
dot query.System.Number --chain polkadot
# Output:
# 31014744

# Both at once errors
dot polkadot.query.System.Number --chain polkadot  # ✗ errors
```

Chain names are case-insensitive (`Polkadot.query.System.Number` works the same).

#### Export/import chain configuration

Export and import chain configurations for backup, sharing across machines, or team collaboration.

```bash
# Export custom chains to stdout (pipe-friendly JSON)
dot chain export

# Export all chains including built-ins
dot chain export --all

# Export specific chains
dot chain export my-relay my-para

# Export to a file
dot chain export --all --file my-chains.json

# Import from a file
dot chain import my-chains.json

# Preview without applying
dot chain import my-chains.json --dry-run

# Overwrite existing chains
dot chain import my-chains.json --overwrite

# Skip automatic metadata fetch (faster for offline/CI bootstrap)
dot chain import my-chains.json --no-metadata

# Pipe between machines
ssh remote-dev "dot chain export" | dot chain import -
```

By default, `export` only includes user-added chains and built-ins with modified RPCs. Use `--all` to include everything. Import skips existing chains unless `--overwrite` is passed, and validates relay references with warnings for missing relays.

After a non-dry-run import, metadata is fetched automatically for each newly added or overwritten chain so tab completion and metadata-dependent commands work immediately. Pass `--no-metadata` to skip the fetch — you can always backfill later with `dot chain update --all`.

Output shows one line per chain with a status glyph and a terse summary:

```
  ✓ preview
  ✓ preview-people
  ⟳ polkadot (overwritten)
  - paseo (skipped)

2 added, 1 overwritten, 1 skipped

Updating metadata for 3 chain(s)...

  ✓ preview
  ✓ preview-people
  ✓ polkadot
```

Running `dot chain import` with no file path prints the subcommand help instead of blocking on stdin.

### Manage accounts

Dev accounts (Alice, Bob, Charlie, Dave, Eve, Ferdie) are always available for testnets. Create or import your own accounts for any chain.

> **Security warning:** Account secrets (mnemonics and seeds) are currently stored **unencrypted** in `~/.polkadot/accounts.json`. Do not use this for high-value accounts on mainnet. Encrypted storage is planned for a future release. Use `--env` to keep secrets off disk entirely.

```bash
# Show account help
dot account             # shows available actions
dot accounts            # shorthand, same as above

# List all accounts (dev + stored)
dot account list

# Add a watch-only address (no secret — for use as tx recipient or query target)
dot account add treasury 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
dot account add council 0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d

# Create a new account (generates a mnemonic)
dot account create my-validator

# Create with a derivation path
dot account create my-staking --path //staking

# Add a keyed account from a BIP39 mnemonic
dot account add treasury --secret "word1 word2 ... word12"

# Add from a 32-byte hex seed or a 64-byte raw sr25519 private key
dot account add seeded --secret 0x1111111111111111111111111111111111111111111111111111111111111111
dot account add raw-key --secret 0x<128-hex-char expanded secret>   # no --path

# Add with a derivation path
dot account add hot-wallet --secret "word1 word2 ... word12" --path //hot

# Add an env-var-backed account (secret stays off disk)
dot account add ci-signer --env MY_SECRET

# Derive a child account from an existing one
dot account derive treasury treasury-staking --path //staking

# Use it — the env var is read at signing time
MY_SECRET="word1 word2 ..." dot polkadot.tx.System.remark 0xdead --from ci-signer

# Remove one or more accounts (delete and rm are aliases for remove)
dot account remove my-validator
dot account delete my-validator stale-key
dot account rm my-validator stale-key

# Export accounts (secrets redacted by default)
dot account export
dot account export --include-secrets --file backup.json
dot account export --watch-only

# Batch-import accounts from a file
dot account import team-accounts.json
dot account import accounts.json --dry-run
dot account import accounts.json --overwrite

# Inspect an account — show public key and SS58 address
dot account inspect alice
dot account alice                    # shorthand (same as inspect)
dot account inspect 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
dot account inspect 0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
dot account inspect alice --prefix 0         # Polkadot mainnet prefix
dot account inspect alice --json             # JSON output
dot account inspect dave --show-secret       # reveal mnemonic + sr25519 private key
```

#### Watch-only accounts

Add named addresses without secrets — useful for saving frequently-used recipients, multisig members, or query targets:

```bash
dot account add treasury 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
dot account add council 0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
```

Watch-only accounts appear in `dot account list` under a dedicated **Watch-only** section and can be inspected and removed like any other account. They cannot be used with `--from` (signing) or as a source for `derive`.

The `add` subcommand is context-sensitive: bare `add <name> <address>` creates a watch-only entry, while `add --secret` or `add --env` imports a keyed account. `dot account import` is reserved for file-based batch import.

#### Named address resolution

Named accounts (both watch-only and keyed) resolve automatically everywhere an AccountId32 or MultiAddress is expected — in `dot tx` arguments and `dot query` keys:

```bash
# Use a named account as transfer recipient
dot polkadot.tx.Balances.transfer_keep_alive treasury 1000000000000 --from alice

# Query by account name
dot polkadot.query.System.Account treasury

# Dev accounts also resolve
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000000 --from alice
```

Resolution order: dev account name > stored account name > SS58 address > hex public key. If the input doesn't match any, the CLI shows an error listing all available account names alphabetically, one per line. When the input is close to an existing name, a "Did you mean?" suggestion is included:

```
Error: Unknown account or address "people-sudo-signer".
  Did you mean: people-paseo-sudo?
  Available accounts:
    - alice
    - bob
    - charlie
    - people-paseo-sudo
    - ...
```

#### Inspect accounts

Convert between SS58 addresses, hex public keys, and account names. Accepts any of:

- **Dev account name** (`alice`, `bob`, etc.) — resolves to public key and SS58
- **Stored account name** — looks up the public key from the accounts file
- **SS58 address** — decodes to the underlying public key
- **Hex public key** (`0x` + 64 hex chars) — encodes to SS58
- **`--pallet-id <id>`** — derives a pallet sovereign address without saving it (script-friendly; nothing persists)
- **`--parachain <id> --parachain-type <child|sibling>`** — derives a parachain sovereign address without saving it

```bash
dot account inspect alice
dot account alice                    # shorthand — unknown subcommands fall through to inspect

dot account inspect 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
dot account inspect 0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d

# pallet-revive H160 — the 20-byte address shape from EVM tooling. Same
# input slot as SS58 / hex pubkey; resolved to the deterministic fallback
# AccountId32 (`H160 || 0xEE * 12`).
dot account inspect 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
```

Use `--prefix` to encode the SS58 address with a specific network prefix (default: 42):

```bash
dot account inspect alice --prefix 0     # Polkadot mainnet (prefix 0, starts with '1')
dot account inspect alice --prefix 2     # Kusama (prefix 2)
```

JSON output:

```bash
dot account inspect alice --json
# Output:
# {
#   "publicKey": "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
#   "ss58": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
#   "h160": "0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D",
#   "prefix": 42,
#   "name": "Alice",
#   "kind": "dev"
# }
```

Plain text output:

```bash
dot account inspect alice
# Output:
# Account Info
#
#   Name:        Alice
#   Kind:        dev
#   Public Key:  0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
#   SS58:        5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
#   H160:        0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
#   Prefix:      42
```

The `Kind:` line categorises the account: `dev` (built-in), `signer` (has a secret/env), `watch-only` (raw external address), `pallet sovereign` (derived from a `PalletId`), `parachain sovereign (child|sibling)` (derived from a parachain ID), or `revive H160 fallback` (a 20-byte input resolved to its deterministic Substrate AccountId32). For derived sovereigns, an extra `Source:` line shows what the address was derived from. For env-backed signers, an `Env:` line shows the variable; for derived child keys, `Derivation:` shows the path.

##### pallet-revive H160 address

Every Substrate account has a corresponding 20-byte H160 address under [pallet-revive](https://github.com/paritytech/polkadot-sdk/tree/master/substrate/frame/revive) (the new EVM-compatible smart-contracts pallet on Polkadot Hub / Asset Hub). `dot account inspect` always shows it, EIP-55 checksummed, on the `H160:` line. The mapping is offline and prefix-independent:

- **AccountId32 → H160:** if the last 12 bytes are `0xEE`, strip them (the account originated from an Eth address); otherwise `keccak256(accountId32)` and take the last 20 bytes.
- **H160 → AccountId32:** deterministic fallback is `H160 || 0xEE * 12`. (The full mapping after a successful `pallet_revive.map_account` extrinsic lives in on-chain `AddressSuffix` storage and isn't recoverable offline — that's a chain-state lookup.)

Pass a 20-byte hex value as the inspect input to resolve it back to its fallback Substrate account:

```bash
dot account inspect 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
# Output:
# Account Info
#
#   Kind:        revive H160 fallback
#   Public Key:  0x9621dde636de098b43efb0fa9b61facfe328f99deeeeeeeeeeeeeeeeeeeeeeee
#   SS58:        5FTZ6n1wY3GBqEZ2DWEdspbTarvRnp8DM8x2YXbWubu7JN98
#   H160:        0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
#   Prefix:      42

# Script-friendly: just the H160 for a given account
dot account inspect alice --json | jq -r .h160
# 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
```

Note: `dot` implements the current `pallet-revive` master variant (keccak fallback). Older `stable2412` runtimes used plain `accountId32[..20]` truncation; if you target one, compute it manually until a `--revive-truncate` flag lands.

##### Stateless sovereign derivation (script-friendly)

Pass `--pallet-id` or `--parachain` / `--parachain-type` to compute a sovereign address **without persisting** anything to `~/.polkadot/accounts.json`. The output shape matches the stored case (same `Kind:` / `Source:` / SS58 / public key + same `--json` schema), but no `Name:` line and nothing in `dot account list` afterwards. Use this in scripts when you just need the address:

```bash
# Polkadot Treasury — pallet sovereign on prefix 0
dot account inspect --pallet-id py/trsry --prefix 0
# Output:
# Account Info
#
#   Kind:        pallet sovereign
#   Public Key:  0x6d6f646c70792f74727372790000000000000000000000000000000000000000
#   SS58:        13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB
#   Source:      PalletId py/trsry (0x70792f7472737279)
#   Prefix:      0

# Hex form works the same
dot account inspect --pallet-id 0x70792f7472737279 --prefix 0

# Parachain sovereigns (type is required — child = on relay, sibling = on another parachain)
dot account inspect --parachain 1004 --parachain-type child

# Pipeline: just the SS58
SS58=$(dot account inspect --pallet-id py/trsry --prefix 0 --json | jq -r .ss58)

# JSON shape includes a `source` object describing the derivation
dot account inspect --pallet-id py/trsry --json
# {
#   "publicKey": "0x6d6f646c70792f74727372790000000000000000000000000000000000000000",
#   "ss58":      "5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z",
#   "prefix":    42,
#   "kind":      "pallet sovereign",
#   "source":    { "kind": "pallet", "palletId": "py/trsry", "palletIdHex": "0x70792f7472737279" }
# }
```

Constraints (will error): cannot combine a positional input with derivation flags; `--pallet-id` and `--parachain` are mutually exclusive; `--parachain` requires `--parachain-type child|sibling`; `--show-secret` doesn't apply (derived sovereigns have no key).

#### Reveal the mnemonic and sr25519 private key

For provisioning another signer (e.g. a server that expects a raw hex private key in an env var), add `--show-secret` to print the **64-byte sr25519 expanded secret** as `0x`-prefixed hex. It also reveals the **stored mnemonic** (or hex seed) so you can back it up:

```bash
dot account inspect my-validator --show-secret
# Mnemonic:    word1 word2 ... word12   (only for accounts stored as a phrase)
# Private Key: 0x<128 hex chars>        (sr25519 expanded, 64 bytes — never share)
```

Works for dev accounts (derived on-the-fly from the standard dev mnemonic) and for stored accounts that have a secret. Refuses on watch-only accounts, bare SS58 addresses, or hex public keys. The revealed line depends on how the account was stored: a phrase shows under `Mnemonic`, a 32-byte hex seed under `Seed`, and a raw private key shows only the `Private Key` (the stored secret already _is_ the expanded key). **Env-backed secrets are never resolved to disk output** — only the `$VAR` reference is shown. The expanded `Private Key` is the final secret after any derivation path is applied, so it can be fed directly to signers that don't accept a mnemonic+path (e.g. `@scure/sr25519`'s `sign`, or services like identity-backend that read a `PROXY_PRIVATE_KEY`). Combine with `--json` to include the values under the `mnemonic`/`seed` and `privateKey` fields.

The revealed `Private Key` round-trips: you can re-import it as a usable account (see [Import a raw private key](#import-a-raw-private-key) below).

> **Note:** if the account was stored with a derivation path, the revealed `Mnemonic`/`Seed` reproduces the original address **only when re-imported with the same `--path`** (shown on the `Derivation` line). The `Private Key` already bakes in the path, so it round-trips on its own.

#### Env-var-backed accounts

For CI/CD and security-conscious workflows, store a reference to an environment variable instead of the secret itself:

```bash
dot account add ci-signer --env MY_SECRET
```

`--secret` and `--env` are mutually exclusive. Use `dot account add` for single-account imports; `dot account import` is reserved for file-based batch import.

The secret is never written to disk. At signing time, the CLI reads `$MY_SECRET` and derives the keypair. If the variable is not set, the CLI errors with a clear message. `account list` annotates env-backed signers with `env $MY_SECRET` in the metadata column and resolves the address live when the variable is available.

#### Derivation paths

Use `--path` with `create`, `add`, or the `derive` action to derive child keys from the same secret. Different paths produce different keypairs, enabling key separation (e.g. staking vs. governance) without managing multiple mnemonics.

```bash
# Create with a derivation path
dot account create my-staking --path //staking

# Multi-segment path (hard + soft junctions)
dot account create multi --path //polkadot//0/wallet

# Add with a path
dot account add hot --secret "word1 word2 ..." --path //hot

# Derive a child from an existing account
dot account derive treasury treasury-staking --path //staking
```

`derive` copies the source account's secret and applies the given path. It requires both a source name, a new name, and `--path`. Works with env-backed accounts too — the derived account shares the same env var reference.

`account list` shows derivation paths and env sources on tree-style continuation lines (label names mirror the `--flag` that sets them):

```
Signers
  treasury-staking  5FHneW46...
     └─ path: //staking
  ci-signer         5EPCUjPx...
     ├─ path: //ci
     └─ env:  $MY_SECRET
```

**Supported secret formats for import:**

| Format | Example | `--path`? |
|--------|---------|-----------|
| BIP39 mnemonic (12/24 words) | `"abandon abandon ... about"` | Yes |
| Hex seed (`0x` + 64 hex chars = 32 bytes) | `0x1111...1111` | Yes |
| Raw private key (`0x` + 128 hex chars = 64-byte sr25519 expanded secret) | `0x20e0...5568` | No (cannot be HD-derived) |

All three formats work directly from the command line via `--secret` or via `--env`.

#### Import a raw private key

The 64-byte expanded secret that `--show-secret` prints can be re-imported as a fully usable, signing-capable account. This is the round-trip companion to `--show-secret` — handy when a key only exists in expanded form (e.g. exported from another tool or read from a `PROXY_PRIVATE_KEY` env var):

```bash
# Round-trip: reveal dave's expanded secret, then import it under a new name
SECRET=$(dot account inspect dave --show-secret --json | jq -r .privateKey)
dot account add raw-dave --secret "$SECRET"
# raw-dave now has the same address as dave and can sign

# Or from an environment variable (secret stays off disk)
dot account add server-signer --env PROXY_PRIVATE_KEY
```

A raw private key cannot be HD-derived, so `--path` is rejected for this format. Imported expanded-secret accounts sign exactly like mnemonic-backed ones.

#### Export/import accounts

Export and import accounts for backup, sharing, or bootstrapping CI environments. Secrets are **redacted by default** — safe to share or commit.

```bash
# Export accounts (secrets redacted by default)
dot account export

# Export specific accounts
dot account export treasury my-validator

# Include secrets (explicit opt-in, prints warning)
dot account export --include-secrets --file backup.json

# Export only watch-only accounts (always safe)
dot account export --watch-only

# Batch-import accounts from a file (positional path, like `dot chain import`)
dot account import team-accounts.json

# Preview without applying
dot account import accounts.json --dry-run

# Overwrite existing accounts
dot account import accounts.json --overwrite

# Pipe from another machine
ssh remote-dev "dot account export --watch-only" | dot account import -
```

Output mirrors `dot chain import` — one line per account with a status glyph (`✓` added, `⟳` overwritten, `-` skipped) and a terse count summary at the end. Running `dot account import` with no file path prints the subcommand help instead of blocking on stdin.

`dot account import` is file-only. For a single-account import from a mnemonic or env variable, use `dot account add <name> --secret "..."` or `dot account add <name> --env VAR`.

Security: default export replaces mnemonic/seed with `"<redacted>"`. `--include-secrets` is required for actual secrets. Env-backed accounts export the variable *name* (e.g. `{"env": "MY_SECRET"}`), never the value. Redacted accounts import as watch-only (public key preserved, no signing capability).

### Chain prefix

Instead of the `--chain` flag, you can prefix the dot-path with the chain name. The prefix becomes the first segment of the dot-path:

```bash
dot polkadot.query.System.Account 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
dot polkadot.const.Balances.ExistentialDeposit
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000 --from alice --dry-run
dot inspect polkadot.System            # for `inspect`, the prefix is the first arg
dot inspect polkadot.System.Account
```

Chain names are case-insensitive — `Polkadot.query.System.Account`, `POLKADOT.query.System.Account`, and `polkadot.query.System.Account` all resolve the same way. The same applies to `--chain Polkadot`.

Every invocation must specify a chain explicitly: either via a dotpath prefix (as above) or via `--chain <name>`. If both are provided, the CLI errors.

### Space-separated syntax

The `Pallet` and `Item` segments can be passed as separate arguments instead of dot-joined. These pairs are equivalent:

```bash
# Dot notation vs fully space-separated — these are identical:
dot polkadot.query.System                 # dot notation
dot query System --chain polkadot         # space-separated

dot polkadot.events.Balances.Transfer
dot events Balances Transfer --chain polkadot

dot polkadot.apis.Core
dot apis Core --chain polkadot
```

This works for all categories (`query`, `tx`, `const`, `events`, `errors`, `apis`, `extensions`, `rpc`). When passing positional method arguments, keep `Pallet` and `Item` either fully dot-joined (`query.System.Account 5Grw...`) or fully space-separated (`query System Account 5Grw...`) — mixing the two (`query System.Account 5Grw...`) does not work because the second arg gets parsed as a pallet name.

### Query storage

```bash
# Plain storage value
dot polkadot.query.System.Number
# Output:
# 31014744

# Map entry by key — Alice's account on Polkadot (free balance is u128 as a quoted string)
dot polkadot.query.System.Account 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
# Output:
# {
#   "nonce": 0,
#   "consumers": 0,
#   "providers": 0,
#   "sufficients": 0,
#   "data": {
#     "free": "0",
#     "reserved": "0",
#     "frozen": "0",
#     "flags": "170141183460469231731687303715884105728"
#   }
# }

# Map without key — shows help/usage (use --dump to fetch all entries)
dot polkadot.query.System.Account

# Dump all map entries (requires --dump)
dot polkadot.query.System.Account --dump

# Pipe-safe — stdout is clean data, progress messages go to stderr
dot polkadot.query.System.Account --dump | jq '.[0].value.data.free'
dot polkadot.query.System.Number --json | jq '.+1'

# --chain flag is equivalent to the dotpath prefix
dot query.System.Account 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY --chain polkadot
```

#### Partial key queries

For storage maps with multiple keys (NMaps), you can provide fewer keys than
expected to retrieve all entries matching that prefix. This uses the chain's
prefix-based iteration and does not require `--dump`.

```bash
# Full key — returns a single value
dot polkadot.query.Staking.ErasStakers 100 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY

# Partial key — returns all entries matching the first key
dot polkadot.query.Staking.ErasStakers 100

# No keys — requires --dump (safety net for large maps)
dot polkadot.query.Staking.ErasStakers --dump
```

#### Output formatting

Query results automatically convert on-chain types for readability:

- **BigInt** values (e.g. balances) render as decimal strings
- **Binary** fields (e.g. token `name`, `symbol`) render as text when the value contains only printable characters, or as `0x`-prefixed hex otherwise (values containing control characters, Private Use Area code points, or invalid UTF-8 sequences always fall back to hex)
- **Uint8Array** values render as `0x`-prefixed hex

```bash
# Token metadata — symbol and name display as text, not {}
dot polkadot-asset-hub.query.Assets.Metadata 1984
# Output:
# {
#   "deposit": "2008200000",
#   "name": "Tether USD",
#   "symbol": "USDt",
#   "decimals": 6,
#   "is_frozen": false
# }
```

#### Historical reads — `--at <block>`

Storage queries default to the latest finalized head. Pass `--at` to read
state at a specific block hash, the chain head (`best`), or `finalized`
(explicit). Accepted on both `query.*` and `apis.*` runtime calls.

```bash
# Read at the current best (non-finalized) head — useful for low-latency reads
dot polkadot.query.System.Number --at best

# Read at the last finalized block — same as the default, but explicit
dot polkadot.query.System.Number --at finalized

# Pin a finalized hash and read multiple items at that exact block
HASH=$(dot polkadot.rpc.chain_getFinalizedHead | tr -d '"')
dot polkadot.query.System.Number --at "$HASH"
dot polkadot.apis.Core.version --at "$HASH" --json | jq .spec_version
```

`--at` accepts a 32-byte `0x…` block hash, `"best"`, or `"finalized"`.
Anything else errors before any network call. Tx submission rejects `"best"`.

> **Archive-only blocks**: papi v2 talks to the `chainHead_v1_*` JSON-RPC API,
> which only serves *pinned* (recent) blocks. Querying a hash older than a
> few minutes against a non-archive node fails with a clean error that
> includes a copy-pasteable `--rpc wss://<archive-endpoint>` hint:
>
> ```
> ⚠ 0x… is not available on the current RPC endpoint.
>    Public nodes serve only recent (pinned) blocks via chainHead_v1_*.
>    For deep historical reads, point --rpc at an archive endpoint, e.g.:
>      dot ... --at 0x… --rpc wss://<archive-endpoint>
> ```

### Look up constants

```bash
dot polkadot.const.Balances.ExistentialDeposit
# Output:
# "10000000000"

dot polkadot.const.System.SS58Prefix
# Output:
# 0

# --chain flag is equivalent
dot const.Balances.ExistentialDeposit --chain polkadot

# Pipe-safe — stdout is clean JSON, progress messages go to stderr
dot polkadot.const.Balances.ExistentialDeposit --json | jq
```

### Inspect metadata

Works offline from cached metadata after the first fetch. The chain is required. Prefer the chain-prefix-on-target form (`dot inspect polkadot.System`); `--chain` is equivalent. Note that `dot polkadot.inspect.X` does **not** parse — `inspect` is a top-level command, not a dotpath category.

`inspect` is **forgiving**: it accepts the same dot-paths you use to invoke a call and degrades to discovery rather than erroring. A `kind` segment (`tx`/`query`/`const`/`events`/`errors`/…) is tolerated and ignored — so `dot inspect polkadot.tx.System.remark` describes the `System.remark` call just like `dot inspect polkadot.System.remark` does. Partial paths list rather than fail: `dot inspect polkadot.query.System` (and the bare `dot inspect System`) list the pallet's items.

Output is **width-aware**: short type signatures stay on a single line, longer ones expand across multiple lines with field names aligned. Composite struct fields, enum variants, and call arguments are color-coded (cyan field names, yellow primitives, magenta container keywords like `Vec`/`Option`, green enum variants) when stdout is a TTY; piped output stays plain.

```bash
# Pallet detail — list storage, constants, calls, events, and errors
dot inspect polkadot.System
# Output:
# System Pallet
#
#   Storage Items:
#     Account [map]
#       Key:   AccountId32
#       Value: {
#         nonce      : u32,
#         consumers  : u32,
#         providers  : u32,
#         sufficients: u32,
#         data       : { free: u128, reserved: u128, frozen: u128, flags: u128 },
#       }
#         The full account information for a particular account ID.
#     ...

# Storage item detail — full type and docs (each part on its own line)
dot inspect polkadot.System.Account
# Output:
# System.Account (Storage)
#
#   Type:  map
#   Key:   AccountId32
#   Value: {
#     nonce      : u32,
#     consumers  : u32,
#     providers  : u32,
#     sufficients: u32,
#     data       : { free: u128, reserved: u128, frozen: u128, flags: u128 },
#   }
#
#   The full account information for a particular account ID.

# Event detail — shows field signature and docs
dot inspect polkadot.Balances.Transfer
# Output:
# Balances.Transfer (Event)
#
#   Fields: (from: AccountId32, to: AccountId32, amount: u128)
#
#   Transfer succeeded.

# Error detail — shows docs
dot inspect polkadot.Balances.InsufficientBalance
# Output:
# Balances.InsufficientBalance (Error)
#
#   Balance too low to send value.

# List all pallets — single positional is read as a pallet name, so use --chain here
dot inspect --chain polkadot
```

All listings — pallets, storage items, constants, calls, events, and errors — are sorted alphabetically, making it easy to find a specific item at a glance.

The pallet listing view shows type information inline so you can understand item shapes at a glance:

- **Storage**: name with optional `[map]` tag, followed by indented `Key:` / `Value:` lines (composite values expand to one field per line when wide)
- **Constants**: the constant's type (e.g. `ExistentialDeposit: u128`)
- **Calls**: argument signature inline if it fits, otherwise one argument per line with names aligned by colon
- **Events**: field signature inline if it fits, otherwise one field per line
- **Errors**: name and documentation (e.g. `InsufficientBalance`)

Long call signatures expand automatically:

```bash
dot inspect polkadot.Referenda
# Output (excerpt):
#   cancel(index: u32)
#       Cancel an ongoing referendum.
#   ...
#   submit(
#     proposal_origin : system | Origins | ParachainsOrigin | XcmPallet,
#     proposal        : Legacy | Inline | Lookup,
#     enactment_moment: At | After,
#   )
#       Propose a referendum on a privileged action.
```

Enums up to 24 variants now render as `A | B | C | …` (previously variants were collapsed to `enum(N variants)` for >4); only enums with more than 24 variants are still summarized for readability. So a transaction extension's value type like `Option<AsPersonalAliasWithAccount | AsPersonalAliasWithProof | …>` now spells out the variants you actually need to construct.

Documentation from the runtime metadata is shown on an indented line below each item. The detail view (`dot inspect Balances.transfer_allow_death`) shows the full argument signature and complete documentation text. Use call inspection to discover argument names, types, and docs before constructing `dot tx` commands.

### Dump full metadata

`dot metadata <chain>` fetches the chain's runtime metadata and prints **everything** as one JSON blob — pallets (with calls, events, errors, storage, constants), runtime APIs, and transaction extensions, headed by a runtime fingerprint (`specVersion`, `transactionVersion`, `codeHash`, etc.). Useful for feeding LLM agents or pipelines that want a single source of truth instead of walking `dot inspect` piecemeal.

```bash
# Decoded JSON — fetches fresh from the chain (top-level command; no chain prefix)
dot metadata polkadot

# SCALE-encoded metadata bytes as a single 0x… hex line (for tools that re-parse)
dot metadata polkadot --raw

# Skip the network round-trip and use cached metadata
dot metadata polkadot --cached

# Override the RPC endpoint
dot metadata polkadot --rpc wss://rpc.example.com

# Slice with jq — list call names in Balances
dot metadata polkadot | jq -r '.pallets[] | select(.name=="Balances") | .calls[].name'
# Output:
# burn
# force_adjust_total_issuance
# force_set_balance
# force_transfer
# force_unreserve
# transfer_all
# transfer_allow_death
# transfer_keep_alive
# upgrade_accounts

# All transaction extension identifiers
dot metadata polkadot | jq -r '.transactionExtensions[].identifier'
# Output:
# AuthorizeCall
# CheckNonZeroSender
# CheckSpecVersion
# CheckTxVersion
# CheckGenesis
# CheckMortality
# CheckNonce
# CheckWeight
# ChargeTransactionPayment
# PrevalidateAttests
# CheckMetadataHash
```

The decoded JSON is structured-only (no colorization), so it's safe to redirect to a file or pipe into other tools. The default fetches fresh from the RPC and atomically updates the local metadata cache and runtime-fingerprint sidecar — so subsequent commands benefit from the freshest possible metadata.

### Runtime APIs

Browse and call Substrate runtime APIs. These are top-level APIs exposed by the runtime (e.g. `Core`, `AccountNonceApi`, `TransactionPaymentApi`), accessed as `dot <chain>.apis.ApiName.method`.

```bash
# List all runtime APIs with method counts
dot polkadot.apis
# Output:
# Runtime APIs on polkadot (24)
#
#   AccountNonceApi  1 methods
#   AssetHubMigrationApi  2 methods
#   AuthorityDiscoveryApi  1 methods
#   BabeApi  6 methods
#   ...

# List methods in a specific API (with signatures)
dot polkadot.apis.Core
# Output:
# Core Methods
#
#   execute_block(block: { header: { ... }, extrinsics: Vec<Vec<u8>> }) → unknown
#       Execute the given block.
#   initialize_block(header: { ... }) → AllExtrinsics | OnlyInherents
#       Initialize a block with the given header and return the runtime executive mode.
#   version() → { spec_name: str, impl_name: str, ... }
#       Returns the version of the runtime.

# Call a runtime API method
dot polkadot.apis.Core.version --json
# Output:
# {
#   "spec_name": "polkadot",
#   "impl_name": "parity-polkadot",
#   "spec_version": 2002001,
#   "transaction_version": 26,
#   ...
# }

# --chain flag is equivalent
dot apis.Core.version --chain polkadot

# Show method signature and docs (chain still required to load metadata)
dot polkadot.apis.Core.version --help
```

`api` is an alias for `apis`.

Runtime API info requires v15+ metadata (the CLI negotiates the highest version the chain supports, currently up to v16). If `dot <chain>.apis` shows 0 APIs, update the cached metadata:

```bash
dot chain update polkadot   # specific chain
dot chain update --all      # all configured chains
```

#### Argument formats

Runtime API arguments accept the same shorthand as `dot tx` arguments:

| Type | Pass as | Example |
|------|---------|---------|
| Integers (`u8` … `u32`, `i8` … `i32`) | decimal | `0`, `42` |
| Big integers (`u64`, `u128`, `u256`, `i64` …) | decimal | `1000000000000` |
| `bool` | `true` / `false` | `true` |
| `AccountId32` | dev name, stored account, SS58, or `0x` + 64 hex pubkey | `alice`, `5GrwvaEF…` |
| `Vec<u8>` (unsized bytes) | `0x…` hex or text | `0xdeadbeef`, `hello` |
| `[u8; N]` (sized bytes, e.g. `H160`/`H256`/raw `AccountId`) | `0x` + exactly `2 * N` hex chars (recommended), or text | `0x970951a12f975e6762482aca81e57d5a2a4e73f4` |
| `Option<T>` | `null` (recommended), `none`, `undefined` — or a `T` value for `Some(value)` | `null` |
| `Vec<T>` (non-byte) | JSON array or comma-separated | `[1,2,3]`, `1,2,3` |
| Structs / nested enums | JSON | `{"type":"X1","value":{…}}` |

For sized byte arrays (`[u8; N]`) — common for Ethereum-style addresses (`H160`, `[u8; 20]`), 32-byte hashes (`H256`), and raw `AccountId32` bytes — pass a `0x`-prefixed hex string. Example: a contract call against the `pallet-revive` runtime API. Use `dot <chain>.apis.<ApiName>.<method> --help` to see the exact argument signature for any method.

```bash
ORIGIN=alice
CONTRACT=0x970951a12f975e6762482aca81e57d5a2a4e73f4         # H160, [u8; 20]
CALLDATA=$(cast calldata "set(uint256)" 42)

# Args: origin, dest, value, gas_limit (Option), storage_deposit (Option), input_data
dot paseo-asset-hub.apis.ReviveApi.call \
  "$ORIGIN" "$CONTRACT" 0 null null "$CALLDATA"
```

##### Passing `Option<T>`

Absent options (`None`) can be written three ways, all equivalent:

```bash
# null (recommended), none, and undefined all mean None
dot paseo-asset-hub.apis.ReviveApi.call "$ORIGIN" "$CONTRACT" 0 null       null       "$CALLDATA"
dot paseo-asset-hub.apis.ReviveApi.call "$ORIGIN" "$CONTRACT" 0 none       none       "$CALLDATA"
dot paseo-asset-hub.apis.ReviveApi.call "$ORIGIN" "$CONTRACT" 0 undefined  undefined  "$CALLDATA"
```

`null` is the **recommended** form — it matches JSON / YAML semantics, so args read identically on the CLI and inside [file-based command](#file-based-commands) YAML/JSON inputs.

A present option (`Some(value)`) is just the value itself — no wrapping:

```bash
# gas_limit = Some({ ref_time: 1_000_000, proof_size: 100_000 })
dot paseo-asset-hub.apis.ReviveApi.call "$ORIGIN" "$CONTRACT" 0 \
  '{"ref_time":1000000,"proof_size":100000}' \
  null \
  "$CALLDATA"
```

Notes:
- The `null` / `none` / `undefined` literals are case-sensitive (lowercase only).
- There is no `Some(value)` prefix — bare values are already treated as `Some`.

### Focused metadata listings

Each category supports partial dot-paths for browsing metadata. Category-only invocations list pallets (or APIs); pallet-level invocations list items; item-level invocations show detail. Singular and plural aliases work: `event` = `events`, `error` = `errors`, `api` = `apis`, `consts` = `constants` = `const`.

```bash
# List pallets with calls (and the calls themselves)
dot polkadot.tx                                 # pallets with calls
dot polkadot.tx.Balances                        # calls with arg signatures
dot polkadot.tx.Balances.transfer_allow_death   # call detail (or use --help)

# Events
dot polkadot.events                             # pallets with events
dot polkadot.events.Balances                    # events with field signatures
dot polkadot.events.Balances.Transfer           # event detail

# Errors
dot polkadot.errors                             # pallets with errors
dot polkadot.errors.Balances                    # errors with docs
dot polkadot.errors.Balances.InsufficientBalance

# Storage (via the query category)
dot polkadot.query                              # pallets with storage items
dot polkadot.query.System                       # storage items with types
dot polkadot.query.System.Account               # storage help (use --dump for all entries)

# Constants
dot polkadot.const                              # pallets with constants
dot polkadot.const.Balances                     # list constants (offline)
dot polkadot.const.Balances.ExistentialDeposit  # look up value (connects to chain)

# Runtime APIs
dot polkadot.apis                               # all runtime APIs
dot polkadot.apis.Core                          # methods in Core

# Transaction extensions (flat — no pallet sub-level)
dot polkadot.extensions                         # all transaction extensions
dot polkadot.extensions.CheckMortality          # extension detail
```

`--chain <name>` works as an alternative to the prefix in every form (e.g. `dot tx.Balances --chain polkadot`). To browse pallets across all categories at once, use `dot inspect` (see [Inspect metadata](#inspect-metadata)).

### Transaction extensions

List the transaction extensions (also known as signed extensions) a chain declares in its runtime, with types and a marker indicating whether `polkadot-api` handles the extension automatically or whether you need to provide a value via `--ext` when building a transaction (see [Submit extrinsics](#submit-extrinsics)).

```bash
# List all transaction extensions on a chain
dot polkadot.extensions
# Output:
# Transaction extensions on polkadot (11, extension version 0)
#
#   AuthorizeCall              unknown               [custom]
#   ChargeTransactionPayment   Compact<u128>         [builtin]
#   CheckGenesis               unknown               [builtin]
#   CheckMetadataHash          Disabled | Enabled    [builtin]
#   CheckMortality             enum(256 variants)    [builtin]
#   CheckNonce                 Compact<u64>          [builtin]
#   CheckNonZeroSender         unknown               [builtin]
#   CheckSpecVersion           unknown               [builtin]
#   CheckTxVersion             unknown               [builtin]
#   CheckWeight                unknown               [builtin]
#   PrevalidateAttests         unknown               [builtin]

# Detail view for a single extension
dot polkadot.extensions.CheckMortality
# Output:
# CheckMortality (Transaction Extension)
#
#   Value type:       enum(256 variants)
#   AdditionalSigned: [u8; 32]
#   Handled by:       polkadot-api (builtin)

# Structured output for scripts
dot polkadot.extensions --json
```

`extension` and `ext` are aliases for `extensions`. Shell completion suggests identifiers after `dot polkadot.extensions.<Tab>`.

The list view tags each entry:

- `[builtin]` — `polkadot-api` fills this in for you (e.g. `CheckMortality`, `CheckNonce`, `ChargeTransactionPayment`, `CheckMetadataHash`)
- `[custom]` — you must provide a value with `--ext` when signing, for example `--ext '{"<Identifier>":{"value":<v>}}'`

The detail view shows the extension's value type, its `additionalSigned` type, and a ready-to-adapt `--ext` snippet for custom extensions. Use this to discover what `--ext` payload a chain expects before submitting a `dot tx` command.

### Raw JSON-RPC

Substrate nodes expose a JSON-RPC surface that lives outside runtime metadata: `system_*` (sync state, peers, version), `chain_*` (blocks, headers, finalized head), `state_*` (raw storage, key iteration, runtime version), `author_*` (mempool, key management), `payment_*` (fee estimation), consensus families (`babe_*`, `grandpa_*`, `mmr_*`, `beefy_*`), and the new spec families (`chainSpec_v1_*`, `archive_v1_*`, `rpc_methods`). The `rpc` category exposes them all.

Methods are discovered per-chain via the standard `rpc_methods` JSON-RPC call and cached at `~/.polkadot/chains/<chain>/rpc-methods.json`. The set of available methods depends on the node, not the chain — an archive node adds `archive_v1_*`, validators may add `babe_epochAuthorship`, dev nodes add `dev_newBlock`, and `--rpc-methods safe` strips writes.

```bash
# List all methods the node exposes, grouped by family
dot polkadot.rpc
# Output:
# RPC methods on polkadot (129)
#
# system (20)
#   system_health  Node sync state (peers, isSyncing, shouldHavePeers).
#   system_version  Node software version string.
#   system_chain  Chain name as reported by the node.
#   ...
# chain (19)
#   chain_getBlock  Full block (header + extrinsics) by hash.
#   chain_getFinalizedHead  Hash of the latest finalized head.
#   ...

# Call a method
dot polkadot.rpc.system_health
# Output:
# {
#   "peers": 131,
#   "isSyncing": false,
#   "shouldHavePeers": true
# }

# Positional args (parsed by the same heuristic as tx args)
dot polkadot.rpc.chain_getBlockHash 1000
# Output:
# "0xcf36a1e4a16fc579136137b8388f35490f09c5bdd7b9133835eba907a8b76c30"

# Show curated info for a known method
dot polkadot.rpc.author_insertKey --help
# Output:
# author_insertKey
#   ⚠️  WRITE / state-changing
#   Insert a key into the node keystore.
#
#   Family: author
#   Args:   <keyType: string> <suri: string> <publicKey: hex>

# Refresh the cached method list (after a node upgrade)
dot polkadot.rpc --refresh

# JSON output works on any method
dot polkadot.rpc.system_health --json
```

`dot chain add` and `dot chain update` automatically populate the method cache, and `dot chain info <name>` shows a per-family breakdown. Tab completion sources from the cache, so methods on a custom chain start completing the moment you've added or updated it.

About 50 well-known methods carry curated metadata (description, named args, `⚠️ WRITE` tag for state-changing calls). Any other method the node reports is callable via raw passthrough — args are forwarded as-is to the JSON-RPC `params` array.

Subscription methods (`*_subscribe*`, `chainHead_v1_follow`, `transaction_v1_*`) appear in tab-completion but error out as one-shots — they need a long-running follow session that doesn't fit a single CLI invocation:

```bash
dot polkadot.rpc.chain_subscribeAllHeads
# Error: "chain_subscribeAllHeads" is a subscription method (requires a follow
# session) and is not callable as a one-shot. Use a long-running client for
# streaming RPC.
```

The `rpc` category is **flat** — there's no pallet level. The form is `[chain.]rpc.<method_name>`, where `<method_name>` keeps its underscores in a single segment (e.g. `polkadot.rpc.chain_getBlock`).

### Submit extrinsics

Build, sign, and submit transactions. Pass a `Pallet.Call` with arguments, or a raw SCALE-encoded call hex (e.g. from a multisig proposal or governance). Both forms display a decoded human-readable representation of the call.

```bash
# Estimate fees without submitting (no broadcast). The Decode block shows
# the call name on the header line and indented JSON below it.
dot polkadot.tx.System.remark 0xdeadbeef --from alice --dry-run
# Output:
#   Chain:  polkadot
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x000010deadbeef
#   Decode: System.remark
#     {
#       "remark": "0xdeadbeef"
#     }
#   Estimated fees: 125598975

# Transfer (amount in plancks). Method names are snake_case.
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000000 --from alice --dry-run

# Submit (omit --dry-run)
dot polkadot.tx.System.remark 0xdeadbeef --from alice

# Force every tx to dry-run via the global DOT_DRY_RUN env var — a safety net
# for scripts and demos. A hint is printed to stderr; the command behaves
# exactly as if --dry-run had been passed.
DOT_DRY_RUN=1 dot polkadot.tx.System.remark 0xdeadbeef --from alice
# stderr: ⚠ DOT_DRY_RUN is set — extrinsics will be simulated, not submitted.
# stdout: (the dry-run output above — no broadcast)

# Submit a raw SCALE-encoded call (e.g. from a multisig proposal or another tool)
dot polkadot.tx 0x000010deadbeef --from alice --dry-run

# Batch multiple remarks with Utility.batch_all (comma-separated encoded calls).
# Complex decoded calls remain readable because each level is indented.
A=$(dot polkadot.tx.System.remark 0xdeadbeef --encode)
B=$(dot polkadot.tx.System.remark 0xcafe --encode)
dot polkadot.tx.Utility.batch_all "$A,$B" --from alice --dry-run
# Output (excerpt — nested calls each get their own enum {type, value} envelope):
#   Chain:  polkadot
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x1a0208000010deadbeef000008cafe
#   Decode: Utility.batch_all
#     {
#       "calls": [
#         {
#           "type": "System",
#           "value": {
#             "type": "remark",
#             "value": { "remark": "0xdeadbeef" }
#           }
#         },
#         ...
#       ]
#     }
#   Estimated fees: 133994995
```

The `--chain` flag is equivalent to the chain prefix:

```bash
dot polkadot.tx.System.remark 0xdeadbeef --from alice
dot tx.System.remark 0xdeadbeef --from alice --chain polkadot
```

#### Enum shorthand

Enum arguments accept a concise `Variant(value)` syntax instead of verbose JSON:

```bash
# Instead of: '{"type":"system","value":{"type":"Authorized"}}'
dot polkadot.tx.Utility.dispatch_as 'system(Authorized)' $(dot polkadot.tx.System.remark 0xcafe --encode) --from alice --dry-run
# Output:
#   Chain:  polkadot
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x1a030003000008cafe
#   Decode: Utility.dispatch_as
#     {
#       "as_origin": { "type": "system", "value": { "type": "Authorized" } },
#       "call":      { "type": "System", "value": { "type": "remark", "value": { "remark": "0xcafe" } } }
#     }
#   Estimated fees: 127644270

# Nested enums work too — Signed origin with an account
dot polkadot.tx.Utility.dispatch_as 'system(Signed(bob))' "$INNER_CALL" --from alice --dry-run

# Void variants — empty parens or just the name
dot polkadot.tx.Pallet.call 'Root()' ... --from alice
dot polkadot.tx.Pallet.call 'Root' ... --from alice

# JSON inside parens for struct values
dot polkadot.tx.Pallet.call 'AccountId32({"id":"0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"})' ... --from alice
```

Variant matching is case-insensitive (`system` resolves to `system`, `authorized` to `Authorized`). All existing formats (JSON objects, hex, SS58 addresses) continue to work unchanged.

#### Encode call data

Encode a call to hex without signing or submitting. Useful for preparing calls to pass to `Sudo.sudo`, multisig proposals, or governance. Works offline from cached metadata and does not require `--from`.

```bash
# Encode a remark call
dot polkadot.tx.System.remark 0xdeadbeef --encode
# Output:
# 0x000010deadbeef

# Encode a transfer (use the hex output in a batch or sudo call)
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000 --encode
# Output:
# 0x050300...02286bee

# Use encoded output with Sudo.sudo (Sudo only exists on testnets like Paseo)
dot paseo-asset-hub.tx.Sudo.sudo $(dot paseo-asset-hub.tx.System.remark 0xcafe --encode) --from alice --dry-run
# Output:
#   Chain:  paseo-asset-hub
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0xfb00000008cafe
#   Decode: Sudo.sudo
#     {
#       "call": { "type": "System", "value": { "type": "remark", "value": { "remark": "0xcafe" } } }
#     }
#   Estimated fees: ...
```

#### Decode call data to YAML / JSON

Decode a hex-encoded call into a YAML or JSON file that is compatible with [file-based commands](#file-based-commands). This is useful for inspecting opaque call data, sharing human-readable transaction definitions, or editing parameters before re-submitting. Works offline from cached metadata and does not require `--from`.

```bash
# Decode a raw hex call to YAML
dot polkadot.tx.0x000010deadbeef --to-yaml
# Output:
# chain: polkadot
# tx:
#   System:
#     remark:
#       remark: "0xdeadbeef"

# Decode a raw hex call to JSON
dot polkadot.tx.0x000010deadbeef --to-json
# Output:
# {
#   "chain": "polkadot",
#   "tx": {
#     "System": {
#       "remark": {
#         "remark": "0xdeadbeef"
#       }
#     }
#   }
# }

# Encode a named call and output as YAML
dot polkadot.tx.System.remark 0xdeadbeef --to-yaml

# Round-trip: encode to hex, decode to YAML, re-encode from file
dot polkadot.tx.System.remark 0xdeadbeef --encode      # 0x000010deadbeef
dot polkadot.tx.0x000010deadbeef --to-yaml > remark.yaml
dot ./remark.yaml --encode                              # chain comes from the file
```

`--to-yaml` / `--to-json` are mutually exclusive with each other and with `--encode` and `--dry-run`.

Both dry-run and submission display the encoded call hex and a decoded human-readable form. The decoded call is rendered as JSON with two-space indentation under the `Decode:` header so even deeply nested calls (XCM, sudo, batch, dispatch_as) remain easy to scan:

```
  Call:   0x000010deadbeef
  Decode: System.remark
    {
      "remark": "0xdeadbeef"
    }
  Tx:     0xabc123...
  Status: ok
```

Complex calls (XCM teleports, batched governance proposals) keep the same shape — every nested enum becomes a `{ "type": ..., "value": ... }` block, indented one level deeper, so you can read the structure top-down without it ever wrapping past the terminal width.

#### Exit codes

The CLI exits with code **1** when a finalized transaction has a dispatch error (e.g. insufficient balance, bad origin). The full transaction output (events, explorer links) is still printed before the error so you can debug the failure. Module errors are formatted as `PalletName.ErrorVariant` (e.g. `Balances.InsufficientBalance`).

```bash
dot polkadot.tx.Balances.transfer_keep_alive bob 999999999999999999 --from alice
# ... events and explorer links ...
# Error: Transaction dispatch error: Balances.InsufficientBalance
echo $?  # 1
```

#### Stale metadata detection

When a `tx`, `--dry-run`, or `query` fails with an error that smells like stale metadata — a runtime wasm trap, a SCALE codec/decode error, or a fee-estimation panic — the CLI compares your locally cached metadata's runtime fingerprint against the live chain. If it has changed, the CLI appends a one-line suggestion telling you exactly which command to run:

```
Error: The runtime rejected this transaction in the runtime's validate_transaction step.
  Cause: a runtime invariant failed — typically the call's arguments are out of range, …

⚠ Local metadata for "paseo-people-next" is out of date (spec 1018 → 1020).
   Run: dot chain update paseo-people-next
```

The fingerprint includes the runtime code hash, so the check also catches local-node restarts where the wasm changed but `specVersion` was kept the same. No automatic refetch happens — the original error still propagates with a non-zero exit code, you just get an actionable suggestion.

The check only fires on suspected-stale errors, so the happy path pays no extra RPC. Set `DOT_TRUST_CACHED_METADATA=1` to disable the check entirely (e.g. for CI loops where you've just refreshed manually).

#### Argument parsing errors

When a call argument is invalid, the CLI shows a contextual error message with the argument name, the expected type, and a hint:

```bash
dot polkadot.tx.Balances.transfer_keep_alive bob abc --encode
# Error: Invalid value for argument 'value' (expected Compact<u128>): "abc"
#   Hint: Compact<u128>
```

For struct-based calls, the error identifies the specific field that failed. For tuple-based calls, it shows the argument index. The original parse error is preserved as the `cause` for programmatic access.

#### Wait level

By default, `dot tx` waits for finalization (~30s on Polkadot). Use `--wait` / `-w` to return earlier:

```bash
# Return as soon as the tx is broadcast (fastest)
dot polkadot.tx.System.remark 0xdead --from alice --wait broadcast

# Return when included in a best block
dot polkadot.tx.System.remark 0xdead --from alice -w best-block
dot polkadot.tx.System.remark 0xdead --from alice -w best    # alias

# Wait for finalization (default, unchanged)
dot polkadot.tx.System.remark 0xdead --from alice --wait finalized
dot polkadot.tx.System.remark 0xdead --from alice            # same
```

| Level | Resolves when | Events shown | Explorer links |
|-------|---------------|:---:|:---:|
| `broadcast` | Tx is broadcast to the network | — | — |
| `best-block` / `best` | Tx is included in a best block | yes | yes |
| `finalized` (default) | Tx is finalized | yes | yes |

The `--wait` flag is silently ignored when combined with `--dry-run` or `--encode` (both return before submission).

#### Custom signed extensions

Chains with non-standard signed extensions are auto-handled:

- `void` → empty bytes
- `Option<T>` → `None`
- enum with `Disabled` variant → `Disabled`

For manual override, use `--ext` with a JSON object:

```bash
dot polkadot.tx.System.remark 0xdeadbeef --from alice --ext '{"MyExtension":{"value":"..."}}'
```

`--ext` overrides work for `[builtin]` extensions too — for example `--ext '{"CheckMetadataHash":{"value":{"type":"Enabled"}}}'` replaces the value `polkadot-api` would fill in itself. Passing an extension name the chain doesn't declare is an error.

Not sure which extensions a chain exposes? Run `dot <chain>.extensions` (see [Transaction extensions](#transaction-extensions)) to list them all with value types and a `[builtin]` / `[custom]` marker.

#### Transaction options

Override low-level transaction parameters. Useful for rapid-fire submission (custom nonce), priority fees (tip), or controlling transaction lifetime (mortality).

| Flag | Value | Description |
|------|-------|-------------|
| `--nonce <n>` | non-negative integer | Override the auto-detected nonce |
| `--tip <amount>` | non-negative integer (planck) | Priority tip for the transaction pool |
| `--mortality <spec>` | `immortal` or period (min 4) | Transaction mortality window |
| `--at <block>` | 0x-prefixed block hash, `"best"`, or `"finalized"` | Block to read/validate against (defaults to finalized). Also honored on `query.*` and `apis.*` for historical reads; tx submission rejects `"best"`. |

```bash
# Fire-and-forget: submit two txs in rapid succession with manual nonces
dot polkadot.tx.System.remark 0xdead --from alice --nonce 0 --wait broadcast
dot polkadot.tx.System.remark 0xbeef --from alice --nonce 1 --wait broadcast

# Add a priority tip (in planck)
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000 --from alice --tip 1000000

# Submit an immortal transaction (no expiry)
dot polkadot.tx.System.remark 0xdead --from alice --mortality immortal

# Set a custom mortality period (rounds up to nearest power of two)
dot polkadot.tx.System.remark 0xdead --from alice --mortality 128

# Validate against a specific block hash
dot polkadot.tx.System.remark 0xdead --from alice --at 0x1234...abcd

# Combine: rapid-fire with tip and broadcast-only
dot polkadot.tx.System.remark 0xdead --from alice --nonce 5 --tip 500000 --wait broadcast
```

When set, nonce / tip / mortality / at are shown in both `--dry-run` and submission output. These flags are silently ignored with `--encode`, `--to-yaml`, and `--to-json` (which return before signing).

#### Pay fees in an alternative asset

On asset-hub-style chains (Polkadot Asset Hub, Paseo Asset Hub, etc.) the `ChargeAssetTxPayment` signed extension lets a transaction pay its fees in a non-native asset. Use `--asset <json>` to select the asset — the value is an XCM location (JSON) identifying the asset, which the runtime's asset-conversion pool swaps for native tokens at dispatch time.

```bash
# Define the USDT location once (asset id 1337, PalletInstance 50)
USDT='{"parents":0,"interior":{"type":"X2","value":[{"type":"PalletInstance","value":50},{"type":"GeneralIndex","value":"1337"}]}}'

# Dry-run to see the native-denominated fee estimate
dot polkadot-asset-hub.tx.Balances.transfer_keep_alive bob 1000000000 \
  --from alice --dry-run --asset "$USDT"
# Output:
#   Chain:  polkadot-asset-hub
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x0a0300d435...02286bee
#   Decode: Balances.transfer_keep_alive { dest: Id(...), value: 1000000000 }
#   Asset:  {"parents":0,"interior":{"type":"X2","value":[{"type":"PalletInstance","value":50},{"type":"GeneralIndex","value":"1337"}]}}
#   Estimated fees: 9249754

# Submit (omit --dry-run)
dot polkadot-asset-hub.tx.Balances.transfer_keep_alive bob 1000000000 \
  --from alice --asset "$USDT"
```

The `--asset` echo is included in dry-run and submission output (and `--json`). A few things to know:

- The target chain must expose `ChargeAssetTxPayment` in its signed extensions — asset-hub-style chains do; plain relay chains don't, and `--asset` is silently ignored on those.
- The estimated fee shown is **native-denominated**. The on-chain asset-conversion pool determines the actual asset amount charged at execution time.
- `--asset` is unnecessary (and not compatible) with `--unsigned`: unsigned transactions default `ChargeAssetTxPayment` to zero tip / no asset.
- Combine freely with `--tip`, `--nonce`, `--mortality`, and `--at`. `--tip` is encoded inside the asset-payment extension alongside the asset id.

Under the hood, the CLI routes the asset through its custom signed-extension pipeline rather than polkadot-api's native `asset` option — this works around a papi compatibility check that rejects XCM Location JSON on the unsafe API path.

#### Unsigned/authorized transactions

Submit transactions without a signer using `--unsigned`. This is for calls authorized by on-chain mechanisms (e.g. the `AuthorizeCall` extension) rather than cryptographic signatures — typically governance-authorized calls on chains like the People chain.

```bash
# Submit an authorized call on the People chain
dot polkadot-people.tx.People.create_people_collection --unsigned

# Dry-run to inspect before submitting
dot polkadot-people.tx.People.create_people_collection --unsigned --dry-run

# Encode the full general transaction bytes
dot polkadot-people.tx.People.create_people_collection --unsigned --encode

# With raw hex call data
dot polkadot-people.tx 0x3306 --unsigned

# JSON output for scripting
dot polkadot-people.tx.People.create_people_collection --unsigned --json
```

The CLI constructs a v5 general transaction with all extension values auto-defaulted (`VerifySignature::Disabled`, `Era::Immortal`, nonce `0`, tip `0`, etc.). Override individual extensions with `--ext` if needed.

`--unsigned` is mutually exclusive with `--from`, `--nonce`, `--tip`, and `--mortality`. File-based input supports `unsigned: true`:

```yaml
chain: polkadot-people
unsigned: true
tx:
  People:
    create_people_collection: null
```

### File-based commands

Run any `dot` command from a YAML or JSON file. Especially useful for complex calls like XCM messages that are hard to construct inline.

**Teleport DOT** from Asset Hub to the relay chain:

```yaml
# teleport-dot.xcm.yaml
chain: polkadot-asset-hub
tx:
  PolkadotXcm:
    limited_teleport_assets:
      dest:
        type: V4
        value:
          parents: 1
          interior:
            type: Here
      beneficiary:
        type: V4
        value:
          parents: 0
          interior:
            type: X1
            value:
              - type: AccountId32
                value:
                  network: null
                  id: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"
      assets:
        type: V4
        value:
          - id:
              parents: 1
              interior:
                type: Here
            fun:
              type: Fungible
              value: 10000000000
      fee_asset_item: 0
      weight_limit:
        type: Unlimited
```

**Reserve transfer USDC** (asset 1337, 6 decimals) from Asset Hub to Hydration:

```yaml
# reserve-transfer-usdc.xcm.yaml
chain: polkadot-asset-hub
tx:
  PolkadotXcm:
    limited_reserve_transfer_assets:
      dest:
        type: V4
        value:
          parents: 1
          interior:
            type: X1
            value:
              - type: Parachain
                value: 2034
      beneficiary:
        type: V4
        value:
          parents: 0
          interior:
            type: X1
            value:
              - type: AccountId32
                value:
                  network: null
                  id: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"
      assets:
        type: V4
        value:
          - id:
              parents: 0
              interior:
                type: X2
                value:
                  - type: PalletInstance
                    value: 50
                  - type: GeneralIndex
                    value: 1337
            fun:
              type: Fungible
              value: 10000000
      fee_asset_item: 0
      weight_limit:
        type: Unlimited
```

The same teleport in JSON:

```json
{
  "chain": "polkadot-asset-hub",
  "tx": {
    "PolkadotXcm": {
      "limited_teleport_assets": {
        "dest": { "type": "V4", "value": { "parents": 1, "interior": { "type": "Here" } } },
        "beneficiary": {
          "type": "V4",
          "value": {
            "parents": 0,
            "interior": {
              "type": "X1",
              "value": [{ "type": "AccountId32", "value": { "network": null, "id": "0xd435...a27d" } }]
            }
          }
        },
        "assets": {
          "type": "V4",
          "value": [{
            "id": { "parents": 1, "interior": { "type": "Here" } },
            "fun": { "type": "Fungible", "value": 10000000000 }
          }]
        },
        "fee_asset_item": 0,
        "weight_limit": { "type": "Unlimited" }
      }
    }
  }
}
```

```bash
# Run from file (the `chain:` field comes from the YAML)
dot ./teleport-dot.xcm.yaml --from alice --dry-run
# Output:
#   Chain:  polkadot-asset-hub
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x1f0904...
#   Decode: PolkadotXcm.limited_teleport_assets { dest: V4 { parents: 1, interior: Here }, ... }
#   Estimated fees: ...

# Encode only
dot ./reserve-transfer-usdc.xcm.yaml --encode

# Override variables
dot ./transfer.xcm.yaml --var AMOUNT=2000000000000 --from alice
```

The file format uses a required category wrapper (`tx`, `query`, `const`, or `apis`) with the structure `category > Pallet > Item > args`:

```yaml
# Simple transaction
tx:
  System:
    remark:
      - "0xdeadbeef"
```

```yaml
# Storage query
chain: polkadot
query:
  System:
    Account:
      - "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
```

```yaml
# Constant lookup
chain: polkadot
const:
  Balances:
    ExistentialDeposit:
```

**Variable substitution** uses shell-style `${VAR}` with optional defaults `${VAR:-default}`. Variables are resolved in order: `--var` flags > environment variables > `vars:` section defaults.

```yaml
chain: ${CHAIN:-polkadot}
vars:
  AMOUNT: "1000000000000"
tx:
  Balances:
    transfer_keep_alive:
      dest: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
      value: ${AMOUNT}
```

Hex values passed via `--var` are preserved as-is, including leading zeros. This is important for encoded call data in XCM `Transact` instructions or similar byte-array fields:

```bash
# Encode a remark, then embed it in an XCM Transact via --var
CALL=$(dot polkadot.tx.System.remark 0xdead --encode)
dot ./xcm-transact.yaml --var CALL=$CALL --encode
```

All existing flags work with file input — `--chain` overrides the file's `chain:` field, `--from`, `--dry-run`, `--encode`, `--to-yaml`, `--to-json`, `--json`, `--output`, etc. behave identically to inline commands.

### Compute hashes

Compute cryptographic hashes commonly used in Substrate. Supports BLAKE2b-256, BLAKE2b-128, Keccak-256, SHA-256, and the XXH64-based `twox64` / `twox128` / `twox256` family used to build Substrate storage keys.

```bash
# Hash hex-encoded data
dot hash blake2b256 0xdeadbeef
# Output:
# 0xf3e925002fed7cc0ded46842569eb5c90c910c091d8d04a1bdf96e0db719fd91

# Hash plain text (UTF-8 encoded)
dot hash sha256 hello
# Output:
# 0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824

# Hash file contents
dot hash keccak256 --file ./data.bin

# Read from stdin
echo -n "hello" | dot hash sha256 --stdin
# Output:
# 0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824

# JSON output
dot hash blake2b256 0xdeadbeef --json
# Output:
# {
#   "algorithm": "blake2b256",
#   "input": "0xdeadbeef",
#   "hash": "0xf3e925002fed7cc0ded46842569eb5c90c910c091d8d04a1bdf96e0db719fd91"
# }

# Substrate twox128 — pallet/storage prefix used everywhere in Substrate state
dot hash twox128 System
# Output:
# 0x26aa394eea5630e07c48ae0c9558cef7

# Build a full storage key for `System.Number` and read it raw via JSON-RPC
PALLET=$(dot hash twox128 System)
ITEM=$(dot hash twox128 Number)
dot polkadot.rpc.state_getStorage "${PALLET}${ITEM:2}"
```

Run `dot hash` with no arguments to see all available algorithms.

### Sign messages

Sign arbitrary messages with an account keypair. Output is a `Sr25519(0x...)` value directly usable as a `MultiSignature` enum argument in transaction calls.

```bash
# Sign a text message
dot sign "hello world" --from alice
# Output:
#   Type:       Sr25519
#   Message:    0x68656c6c6f20776f726c64
#   Signature:  0x4283a3bbae463c39264ca193b1bcce61702794e54e482bc2e46202c85ef6a5446750e81db57cd28af4ffd5c69aadcf5b2b3068972e0cdcb68e51db0ff600d786
#   Enum:       Sr25519(0x4283a3bbae463c39264ca193b1bcce61702794e54e482bc2e46202c85ef6a5446750e81db57cd28af4ffd5c69aadcf5b2b3068972e0cdcb68e51db0ff600d786)

# Sign hex-encoded bytes
dot sign 0xdeadbeef --from alice

# Sign file contents
dot sign --file ./payload.bin --from alice

# Read from stdin
echo -n "hello" | dot sign --stdin --from alice

# JSON output (for scripting)
dot sign "hello" --from alice --json
# Output:
# {
#   "type": "Sr25519",
#   "message": "0x68656c6c6f",
#   "signature": "0x5a058160b62eeb6c1194116d4613489e9c310075478c544761b9c8198d3fdb38...",
#   "enum": "Sr25519(0x5a058160b62eeb6c1194116d4613489e9c310075478c544761b9c8198d3fdb38...)"
# }
```

Output shows the crypto type, message bytes in hex, raw signature, and an `Enum` value directly pasteable into tx arguments (e.g. `Sr25519(0x...)`).

Use `--type` to select the signature algorithm (default: `sr25519`). Run `dot sign` with no arguments to see usage and examples.

### Sovereign accounts (parachain & pallet)

`dot account add` accepts derivation flags that compute a deterministic sovereign address and store it as a named watch-only account — reusable in `--from` (for `--unsigned` flows), as a tx argument, and in `dot account list`. Runs offline; no chain connection required.

Two kinds of sovereign:

- **Pallet sovereign** — every FRAME pallet that holds funds (Treasury, Bounties, Crowdloan, Society, NominationPools, ChildBounties, …) declares an 8-byte `PalletId`. The 32-byte account ID is `b"modl"` (4 bytes) + `palletId` (8 bytes) + 20 zero bytes. (`AccountIdConversion::into_account_truncating` with `PalletId::TYPE_ID = b"modl"` from `frame_support`.)
- **Parachain sovereign** — every parachain has a `child` account (its account on the relay chain, `b"para"` prefix) and a `sibling` account (its account on another parachain, `b"sibl"` prefix). Both are 32-byte IDs of the form `prefix (4 bytes)` + `paraId as LE u32 (4 bytes)` + 24 zero bytes.

```bash
# Pallet sovereign — ASCII PalletId
dot account add Treasury --pallet-id py/trsry
# Output:
# Account Added (watch-only)
#
#   Name:    Treasury
#   Address: 5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z
#   Source:  pallet py/trsry (0x70792f7472737279)

# Pallet sovereign — 0x-prefixed hex (16 hex chars)
dot account add Bounties --pallet-id 0x70792f626f756e74

# Parachain sovereign — child (relay-chain side) — type is required
dot account add People --parachain 1004 --parachain-type child
# Output:
# Account Added (watch-only)
#
#   Name:    People
#   Address: 5Ec4AhPaYcfBz8fMoPd4EfnAgwbzRS7np3APZUnnFo12qEYk
#   Source:  parachain 1004 (child sovereign)

# Parachain sovereign — sibling (XCM peer side)
dot account add People-Sibling --parachain 1004 --parachain-type sibling

# JSON output includes a `derivation` object describing the source
dot account add Bnt --pallet-id py/bount --json
# {
#   "name": "Bnt",
#   "address": "5EYCAe5ijiYdYTM8d3VytEARdH7dFp4rdCPpAsPXrfopdm7d",
#   "watchOnly": true,
#   "derivation": {
#     "kind": "pallet",
#     "palletId": "py/bount",
#     "palletIdHex": "0x70792f626f756e74"
#   }
# }

# Stored sovereigns appear alongside other accounts
dot account list
```

#### Discovering a chain's PalletId

Pallets that need a sovereign account expose their `PalletId` as a runtime constant. Read it via the `const` category and feed the hex straight into `--pallet-id`:

```bash
# Pre-req: metadata cached for the chain (e.g. `dot chain update polkadot`)
dot polkadot.const.Treasury.PalletId
# Output (JSON-quoted hex):
# "0x70792f7472737279"

# Pipe into the add command (strip JSON quotes with tr)
dot account add Treasury --pallet-id "$(dot polkadot.const.Treasury.PalletId | tr -d '"')"
```

There is no central registry of "well-known" PalletIds — each runtime author picks the 8 bytes when wiring up a pallet's `Config`. The chain's metadata is the authoritative source for that chain's values.

#### Constraints

- `--parachain` requires `--parachain-type child|sibling` (no implicit default — picking the wrong one silently produces a different address).
- `--parachain` and `--pallet-id` are mutually exclusive.
- A positional address (`dot account add foo <ss58>`) cannot be combined with derivation flags.
- Derivation flags cannot be combined with `--secret` or `--env` — a derived sovereign has no signing key.

#### Legacy `dot parachain` command (deprecated)

The standalone `dot parachain <paraId>` command from earlier releases is **still available for backward compatibility** and now prints a deprecation warning to stderr. Stdout output is unchanged, so existing pipes (e.g. `dot parachain 1000 --json | jq`) keep working. Migrate to `dot account inspect --parachain <id> --parachain-type <child|sibling>` at your convenience — it will be removed in a future release ([#208](https://github.com/paritytech/polkadot-cli/issues/208)).

```bash
# Old (deprecated, still works — emits stderr warning)
dot parachain 1000 --type child --json

# New
dot account inspect --parachain 1000 --parachain-type child --json
```

### Bandersnatch / verifiable (member keys, ring-VRF proofs, signing)

`dot verifiable` is a set of composable, unopinionated primitives over the
[`verifiablejs`](https://github.com/paritytech/verifiablejs) WASM library: derive
member keys, sign, generate and verify ring-VRF proofs, and encode member sets.
Every action is bytes-in, bytes-out — it takes hex / `--file` / `--stdin` input
and supports `--output json`, so it pipes together and composes with any data
(for example values you fetched on-chain with `dot` beforehand). It makes no
assumptions and does no fetching or selection of its own.

#### Two concepts you must not conflate

```
Mnemonic ─BIP39─▶ entropy ─keyed blake2b─▶ member entropy ─▶ member key / secret
                           (key = --entropy-key)                  │
                                       ring proof: one_shot(…, --context, --message)
```

- **`--entropy-key <text|0xhex>`** — the key mixed into the keyed-blake2b that
  turns your mnemonic into the Bandersnatch member entropy. **Omit** it for a
  **lite** person (unkeyed); use **`candidate`** for a **full** person. It must
  match the key used when the member was recognised on-chain, or you derive a
  different (unrecognised) member key. It is **not** an sr25519 derivation path
  and **not** the ring `--context`. (The value is the raw UTF-8 — or hex — bytes
  of the blake2b key; this matches the iOS/Android clients, which key the
  "full person" deriver with `"candidate"`.)
- **`--context <text|0xhex>`** — the **32-byte ring/proof namespace** (e.g.
  `"dotns"`), zero-padded right to 32 bytes like Solidity `bytes32()`. It
  determines the alias and is named `context` across the runtime
  (`type Context = [u8;32]`), the iOS client, and verifiablejs. Used by
  `alias` / `prove` / `verify`.

> **Migration (breaking):** previously `dot verifiable <account> --context
> candidate` used `--context` as the entropy-derivation key. That key is now
> `--entropy-key`, and `--context` means the ring context. For one release the
> old form still works on the member command (with a deprecation warning); use
> `--entropy-key` going forward.

#### Member keys

```bash
# Lite person (unkeyed)
dot verifiable alice
#   Account:    alice
#   Member Key: 0xbb6ee099b568f1844d62fc00e6305c2e83aa8da30ce59e664ef39e089204d43c

# Full person (candidate-keyed)
dot verifiable alice --entropy-key candidate
#   Account:     alice
#   Entropy Key: candidate
#   Member Key:  0x5f915576987547d3e55bb4129ac8cae1d338f8933073dc74272b4c825f738592
```

Derived keys are saved to the account store and shown in `dot account inspect`.

#### Alias, sign, prove, verify

```bash
# Alias for a ring context (deterministic in entropy + context)
dot verifiable alias alice --entropy-key candidate --context dotns

# Standalone Bandersnatch signature (64 bytes)
dot verifiable sign alice --message "hello" --entropy-key candidate
dot verifiable verify-sig --signature 0x… --member 0x… --message "hello"

# Ring-VRF proof over a members set, then verify it locally
dot verifiable members 0x<key> 0x<key> --output json        # SCALE-encode the ring
dot verifiable prove alice --entropy-key candidate --context dotns \
    --message 0x… --members 0x… --output json
dot verifiable verify --proof 0x… --context dotns --message 0x… --members 0x…
# verify exits non-zero if the proof does not validate
```

`dot verifiable` is deliberately scoped to **raw verifiable crypto** — bytes in,
bytes out, with no knowledge of Polkadot chains, pallets, or collections (the
same way `dot sign` is just sr25519). It does no automated fetching or selection
and assumes nothing about how the bytes were produced or where they go: supply
the members/context/message yourself (e.g. read from chain with `dot` first), and
use the resulting signature or proof however you need — as a value in a `dot`
extrinsic or signed extension, or anywhere else.

Run `dot verifiable` with no arguments for the full action/option list and the
derivation diagram. Both 12- and 24-word mnemonics are supported.

### Getting help

Every command supports `--help` to show its detailed usage, available actions, and examples:

```bash
dot --help              # global help with all commands
dot account --help      # same as `dot account` — shows account actions
dot chain --help        # same as `dot chain` — shows chain actions
dot hash --help         # same as `dot hash` — shows algorithms and examples
```

#### Item-level help

Use `--help` on any fully-qualified dot-path to see metadata detail and category-specific usage hints. The chain is required (so the CLI knows which metadata to load), but the call itself runs offline from the cache:

```bash
dot polkadot.tx.System.remark --help                    # call args, docs, and tx options
dot polkadot.query.System.Account --help                # storage type, key/value info, and query options
dot polkadot.const.Balances.ExistentialDeposit --help   # constant type and docs
dot polkadot.events.Balances.Transfer --help            # event fields and docs
dot polkadot.errors.Balances.InsufficientBalance --help # error docs
dot polkadot.apis.Core.version --help                   # runtime API method signature and docs

# The --chain flag is equivalent to the chain prefix
dot tx.System.remark --help --chain polkadot
```

For `tx` commands, omitting both `--from` and `--encode` shows this same help output instead of an error:

```bash
dot polkadot.tx.System.remark 0xdead   # shows call help (no error)
```

### Global options

| Flag | Description |
|------|-------------|
| `--help` | Show help (global or command-specific) |
| `--chain <name>` | Target chain (required unless a dotpath chain prefix is used) |
| `--rpc <url>` | Override RPC endpoint(s) for this call (repeat for fallback). Always fetches fresh metadata, bypassing the cache |

| `--json` | Structured JSON output (shorthand for `--output json`) |
| `--output json` | Structured JSON output |
| `--dump` | Dump all entries of a storage map (required for keyless map queries) |
| `-w, --wait <level>` | Tx wait level: `broadcast`, `best-block` / `best`, `finalized` (default) |

### Structured JSON output

Every command supports `--json` for machine-readable output. This works on data queries, metadata inspection, account management, chain configuration, and transaction submission:

```bash
dot inspect polkadot --json                           # All pallets as JSON
dot inspect polkadot.Balances --json                  # Pallet detail with storage, constants, calls, events, errors
dot chain list --json                                 # Configured chains
dot chain info polkadot --json                        # Full detail for one chain (rpc, parachains, metadata status)
dot account list --json                               # Dev and stored accounts
dot account create my-key --json                      # New account details (mnemonic warning on stderr)
dot polkadot.tx.System.remark 0xdead --encode --json  # Encoded call hex wrapped in JSON
dot polkadot.events.Balances --json                   # Event listing with field signatures
dot polkadot.const.System --json                      # Constant listing with types
```

For `--encode` with `--json`, the call hex is wrapped in an object:

```bash
dot polkadot.tx.System.remark 0xdead --encode --json
# Output:
# {
#   "callHex": "0x000008dead"
# }
```

For transaction submission, `--json` emits NDJSON (one JSON object per lifecycle event):

```bash
dot polkadot.tx.System.remark 0xdead --from alice --json
# {"event":"signed","txHash":"0x..."}
# {"event":"broadcasted","txHash":"0x..."}
# {"event":"finalized","blockNumber":123,"blockHash":"0x...","ok":true,"events":[...]}
```

### Pipe-safe output

All commands follow Unix conventions: **data goes to stdout, progress goes to stderr**. This means you can safely pipe `--json` into `jq` or other tools without progress messages ("Fetching metadata...", spinner output, "Connecting...") corrupting the data stream:

```bash
dot polkadot.const.System.SS58Prefix --json | jq '.+1'
dot polkadot.query.System.Number --json | jq
dot chain list --json | jq '.chains[].name'
dot account list --json | jq '.stored[].address'
dot inspect polkadot --json | jq '.pallets[] | select(.events > 10) | .name'
```

In an interactive terminal, both streams render together so you see progress and results normally.

### Shell completions

Generate shell completion scripts for tab-completing subcommands, chain names, pallet names, and item names. Completions use cached metadata — no network calls are made.

```bash
# zsh — add to ~/.zshrc
eval "$(dot completions zsh)"

# bash — add to ~/.bashrc
eval "$(dot completions bash)"

# fish — save to completions directory
dot completions fish > ~/.config/fish/completions/dot.fish
```

Once installed, press Tab to complete:

```bash
dot qu<Tab>              # → query
dot query.<Tab>          # → query.System, query.Balances, ...
dot query.System.<Tab>   # → query.System.Account, query.System.Number, ...
dot apis.<Tab>           # → apis.Core, apis.Metadata, ...
dot apis.Core.<Tab>      # → apis.Core.version, ...
dot polkadot.<Tab>       # → polkadot.query, polkadot.tx, ..., polkadot.apis
dot --chain <Tab>        # → polkadot, paseo, ...
dot --from <Tab>         # → alice, bob, ..., stored account names
dot chain <Tab>          # → add, remove, update, list
```

Completions are context-aware: `query.` shows pallets with storage items, `tx.` shows pallets with calls, `events.` and `errors.` filter accordingly, `apis.` shows runtime API names. Chain prefix paths like `polkadot.query.System.` work at any depth.

## How it compares

| | polkadot-cli | @polkadot/api-cli | subxt-cli | Pop CLI |
|---|---|---|---|---|
| **Query storage** | SS58 keys, map iteration | yes (full `--ws` URL required) | yes (keys as SCALE tuples, no SS58) | — |
| **Read constants** | yes | yes | yes | — |
| **Submit extrinsics** | yes, with dry-run | yes (via `--seed`) | — | ink! contract calls only |
| **Inspect metadata** | yes | — | yes (excellent browser) | — |
| **Chain presets** | built-in aliases (`--chain polkadot`) | — (manual `--ws` every call) | — | parachain templates |
| **Tx tracking + explorer links** | spinner progress, block + explorer link | basic events | — | — |

polkadot-cli aims to be the single tool for day-to-day chain interaction: storage reads, constant lookups, transaction submission, and metadata browsing with a polished terminal UX. @polkadot/api-cli covers similar ground but is in maintenance mode and requires verbose flags. subxt-cli has an excellent metadata explorer but cannot sign or submit transactions. Pop CLI targets a different workflow — scaffolding parachains and deploying ink! contracts rather than end-user chain queries.

Outside Polkadot, the closest comparable in terms of interactive UX is [near-cli-rs](https://github.com/near/near-cli-rs) (NEAR).

## Update notifications

After each command, the CLI checks whether a newer version is available on npm and displays a notification:

```
╭───────────────────────────────────────────────╮
│                                               │
│   Update available! 0.6.2 → 0.7.0            │
│   Run npm i -g polkadot-cli to update         │
│                                               │
╰───────────────────────────────────────────────╯
```

The version check runs in the background on startup and caches the result for 24 hours in `~/.polkadot/update-check.json`. Before exiting, the CLI waits up to 500ms for the check to finish so the cache file is written — even for fast commands like `--help` and `--version`. Long-running commands (queries, transactions) are unaffected since the check completes well before they finish.

If the network is unreachable, the failed check is cached for 1 hour so subsequent runs don't incur the 500ms wait repeatedly.

The notification is automatically suppressed when:

- `DOT_NO_UPDATE_CHECK=1` is set
- `CI` environment variable is set (any value)
- stderr is not a TTY (e.g. piped output)

## Configuration

Config and metadata caches live in `~/.polkadot/` by default:

```
~/.polkadot/
├── config.json          # configured chains
├── accounts.json        # stored accounts (⚠️ secrets are NOT encrypted — see below)
├── update-check.json    # cached update check result
└── chains/
    └── polkadot/
        ├── metadata.bin              # cached SCALE-encoded metadata
        └── metadata.fingerprint.json # runtime fingerprint (specVersion, codeHash, …) for stale-metadata detection
```

Metadata is fetched at the highest version both the chain and the CLI support (negotiated via `Metadata_metadata_versions`, currently up to v16; chains without that runtime API fall back to v14). The fingerprint records which version the cache holds — a cache below the negotiated version, or one written by an older CLI without version info, is refreshed automatically on the next connected command.

> **Warning:** `accounts.json` stores secrets (mnemonics and seeds) in **plain text**. Encrypted-at-rest storage is planned but not yet implemented. Keep appropriate file permissions (`chmod 600 ~/.polkadot/accounts.json`) and do not use this for high-value mainnet accounts.

### Local workspaces — `dot init`

Create a self-contained, per-directory setup for chains and accounts. A workspace is just a `.polkadot/` directory that `dot` discovers automatically:

```bash
mkdir -p ~/dot/paseo && cd ~/dot/paseo
dot init
# Initialized empty dot workspace at /Users/you/dot/paseo/.polkadot
# Check which workspace is active with: dot which
```

From this directory (and any subdirectory), every `dot` command reads and writes **all** state — accounts, custom chains, metadata cache — under `./.polkadot/` instead of `~/.polkadot/`:

```bash
dot account create sudo                          # stored in ./.polkadot/accounts.json
dot chain add mytestnet --rpc ws://localhost:9944
dot which
# /Users/you/dot/paseo/.polkadot
# Source: local workspace (discovered from current directory)
```

**Discovery** is git-style: `dot` looks for a `.polkadot/` directory in the current directory, then in each parent, stopping at `$HOME` or the filesystem root. The nearest workspace wins. The global `~/.polkadot` is never treated as a workspace — it is only ever the fallback.

**Precedence:** `DOT_HOME` env var → discovered local workspace → global `~/.polkadot`.

**Full isolation:** while a workspace is active, the global config is invisible. An account named `sudo` in `~/dot/paseo` and one in `~/dot/mytestnet` are unrelated identities — lookups never fall back to the global config, and resolution errors name the config root that was searched, so running in the wrong directory self-diagnoses. Built-in chains (Polkadot, Paseo, and the system parachains) still work everywhere; they ship with the binary.

`dot init` is deliberately minimal: it creates an empty `.polkadot/` directory and nothing else. It refuses to run in `$HOME`, errors if the directory already has a workspace, and warns when the new workspace shadows a parent workspace or when a set `DOT_HOME` masks discovery. Nothing is copied from the global config, and no `.gitignore` is written — whether to commit or ignore a workspace (remember: `accounts.json` holds plain-text secrets) is your decision to make.

**Throwaway sessions** are just disposable workspaces:

```bash
tmp=$(mktemp -d) && cd "$tmp" && dot init
# ... add throwaway accounts and chains, run txs ...
cd - && rm -rf "$tmp"        # nothing ever touched ~/.polkadot
```

For secrets that should never hit disk at all, combine workspaces with `--env` secret sources (see [Manage accounts](#manage-accounts)).

### `DOT_DRY_RUN` — force every extrinsic to dry-run

Set `DOT_DRY_RUN` to a truthy value (`1`, `true`, `yes`, or `on`, case-insensitive) to make **every** extrinsic-submitting command behave as if `--dry-run` had been passed: the transaction is simulated (call decoded, fees estimated) and **never broadcast**. This is a global safety net for scripts, demos, and CI dry-runs where you want to be sure nothing lands on-chain.

When active, the CLI prints a one-line hint to **stderr** (so it never corrupts `--json` or piped stdout):

```bash
DOT_DRY_RUN=1 dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000000 --from alice
# stderr: ⚠ DOT_DRY_RUN is set — extrinsics will be simulated, not submitted.
# stdout: the usual dry-run report (Chain / From / Call / Decode / Estimated fees)

# Set it for a whole shell session as a safety net:
export DOT_DRY_RUN=1
dot polkadot.tx.System.remark 0xdeadbeef --from alice   # simulated, not submitted
```

**Precedence:** an explicit per-command flag always wins. `--dry-run` forces a dry-run; `--no-dry-run` forces a real submission even when `DOT_DRY_RUN` is set. The env var only supplies the default when no flag is given. Decode-only paths (`--encode`, `--to-yaml`, `--to-json`) never submit anything, so `DOT_DRY_RUN` leaves them untouched.

### `DOT_TRUST_CACHED_METADATA` — skip the staleness check

Set `DOT_TRUST_CACHED_METADATA=1` to disable the post-failure stale-metadata check on `dot tx`, `dot tx --dry-run`, and `dot query`. When set, errors propagate exactly as the runtime / RPC reported them, with no extra `state_getRuntimeVersion` / `state_getStorageHash` round-trip. Useful in CI loops where you've just refreshed metadata manually and don't want the overhead.

### `DOT_HOME` — redirect the config directory

Set the `DOT_HOME` environment variable to point at a different directory. When set, the CLI reads and writes **everything** (config, accounts, metadata, update cache) under that path — no `.polkadot` suffix is appended. `DOT_HOME` takes precedence over both [local workspace discovery](#local-workspaces--dot-init) and the global `~/.polkadot`.

```bash
# Use a scratch directory for experimentation
DOT_HOME=/tmp/dot-scratch dot account create throwaway

# Isolated per-project state (e.g. in a repo-local shell)
export DOT_HOME="$PWD/.dot"
dot chain add local --rpc ws://localhost:9944

# Unset or empty DOT_HOME falls back to $HOME/.polkadot
```

Typical uses:

- **Run throwaway commands without touching your real accounts.** Point `DOT_HOME` at a tmpdir so `dot account create`, `dot chain add`, and similar never modify `~/.polkadot/`.
- **CI and test harnesses.** Give each job its own `DOT_HOME` so parallel runs don't share state. The project's own test fixture (`runCli`) uses this mechanism.
- **Multiple profiles on one machine.** Switch between environments (e.g. a mainnet profile and a local-dev profile) by changing `DOT_HOME`.

Empty-string `DOT_HOME=""` is treated as unset and falls back to `$HOME/.polkadot` — so a shell-quoting slip can't accidentally send writes to `/`.

## Environment compatibility

The CLI works in Node.js (v22+), Bun, and sandboxed runtimes (e.g. LLM tool-use / MCP environments). WebSocket connections use the native `WebSocket` implementation provided by the runtime — no external WebSocket package is required.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev -- polkadot.query.System.Number
bun run build
bun test
```

## License

MIT
