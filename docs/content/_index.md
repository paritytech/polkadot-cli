# polkadot-cli

A command-line tool for interacting with Polkadot-ecosystem chains. Manage chains and accounts, query storage, look up constants, inspect metadata, submit extrinsics, and compute hashes — all from your terminal. [View on GitHub](https://github.com/peetzweg/polkadot-cli).

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
- ✅ Batteries included — all system parachains and testnets already setup to be used
- ✅ File-based commands — run any command from a YAML/JSON file with variable substitution
- ✅ Sovereign accounts — store a parachain (child / sibling) or pallet (Treasury, Bounties, NominationPools, …) sovereign as a named watch-only account in one command
- ✅ Unsigned/authorized transactions — submit governance-authorized calls without a signer (`--unsigned`)
- ✅ Non-native fee payment — pay tx fees in any asset the chain accepts via `--asset` (asset-hub-style chains)
- ✅ Message signing — sign arbitrary bytes with account keypairs for use as `MultiSignature` arguments
- ✅ Bandersnatch member keys — derive Ring VRF member keys from mnemonics for on-chain member sets
- ✅ Export/import — portable chain and account configuration for backup, sharing, and CI bootstrapping
- ✅ Claude Code skill — `dot-cli` skill installable as a plugin marketplace, teaches agents how to drive the CLI

## Install

Install globally via npm:

```
npm install -g polkadot-cli@latest
```

This installs the `dot` command globally. Ships with Polkadot and all system parachains preconfigured with multiple fallback RPC endpoints. Add any Substrate-based chain by pointing to its RPC endpoint(s).

## Claude Code skill

This repo ships a [Claude Code](https://claude.com/claude-code) skill — a piece of context Claude can load on-demand that teaches it how to drive the `dot` CLI correctly: query patterns, tx encoding, runtime API calls, and the bash scripting gotchas that trip up agents (missing-key `undefined` sentinel, u128 values returned as quoted strings, XCM `Location` JSON shapes, etc.).

### Install

Register this repo as a plugin marketplace in Claude Code, then install the skill:

```
/plugin marketplace add peetzweg/polkadot-cli
/plugin install dot-cli@polkadot-cli
```

The skill auto-triggers when you ask Claude about `dot`, polkadot-cli, Substrate storage queries, extrinsic submission, runtime APIs, or XCM. You can also invoke it directly with `/dot-cli`.

### Update

To pull the latest skill content after the repo publishes a new version:

```
/plugin marketplace update polkadot-cli
```

If auto-update is enabled on this marketplace in Claude Code, the skill refreshes on startup.

### Layout

The skill lives alongside the CLI source so it can be kept in lockstep with the commands it documents:

```
polkadot-cli/
├── .claude-plugin/
│   └── marketplace.json     # single plugin entry pointing at ./dot-cli
└── dot-cli/
    ├── SKILL.md             # entry point — loaded when the skill triggers
    └── references/
        └── scripting-patterns.md
```

The layout mirrors [paritytech/product-skills](https://github.com/paritytech/product-skills), Parity's Polkadot-stack skills marketplace, so the `dot-cli` folder can migrate there as a drop-in later.

## Chains

Manage chain connections. Polkadot and all system parachains for both Polkadot and Paseo networks come preconfigured. Add any Substrate-based chain by pointing to its RPC endpoint(s).

### Preconfigured chains

The following chains are available out of the box — no `dot chain add` needed:

| Network | Chain |
|---------|-------|
| Polkadot | `polkadot` (relay) |
| | `polkadot-asset-hub` |
| | `polkadot-bridge-hub` |
| | `polkadot-collectives` |
| | `polkadot-coretime` |
| | `polkadot-people` |
| Paseo (testnet) | `paseo` (relay) |
| | `paseo-asset-hub` |
| | `paseo-bridge-hub` |
| | `paseo-collectives` |
| | `paseo-coretime` |
| | `paseo-people` |

Each chain ships with multiple RPC endpoints from decentralized infrastructure providers (IBP, Dotters, Dwellir, and others). The CLI automatically falls back to the next endpoint if the primary is unreachable. Use `dot chain info <name>` (or `dot chains -v`) to see all endpoints for a chain.

### Add a chain

Connect to a chain via WebSocket RPC. Use repeated `--rpc` flags to configure multiple endpoints with automatic fallback — if the primary is unreachable, the CLI tries the next one:

```
# Single RPC
dot chain add kusama --rpc wss://kusama-rpc.polkadot.io

# Multiple RPCs with fallback
dot chain add kusama --rpc wss://kusama-rpc.polkadot.io --rpc wss://kusama-rpc.dwellir.com
```

#### Naming convention

Name chains as `{relay}-{parachain}`: the parent relay's name, a hyphen, then the parachain's role. This is the pattern every preconfigured chain already follows — `polkadot-asset-hub`, `polkadot-bridge-hub`, `paseo-coretime`, and so on — and the one to reuse for chains you add.

| Chain kind | Recommended name | Examples |
|------------|------------------|----------|
| Relay chain | `{relay}` | `polkadot`, `kusama`, `paseo` |
| Parachain | `{relay}-{parachain}` | `polkadot-asset-hub`, `kusama-bridge-hub`, `paseo-people` |

Why it matters for the relay/parachain topology:

- **The tree reads cleanly.** `dot chain list` groups parachains under their relay (see [Chain topology](#chain-topology)). When names share the relay prefix, the tree mirrors the names and the whole config is scannable at a glance.
- **Names disambiguate, IDs don't.** Several relays reuse the same parachain ID — Asset Hub is `1000` on both Polkadot and Paseo. The relay prefix is what keeps `polkadot-asset-hub` and `paseo-asset-hub` distinct as chain names (the `relay` + `parachainId` fields carry the topology; the name is how *you* select the chain in `dot polkadot-asset-hub.query…`).
- **It composes.** A consistent prefix makes chains easy to filter, tab-complete, and reason about across a multi-chain setup.

Use lowercase, hyphen-separated names (chain names resolve case-insensitively). For example, a Kusama Asset Hub would be `kusama-asset-hub`:

```
# Recommended — relay-prefixed name
dot chain add kusama-asset-hub --rpc wss://asset-hub-kusama-rpc.polkadot.io --relay kusama --parachain-id 1000
```

#### Adding parachains

Use `--relay` to declare a chain's parent relay chain. The CLI auto-detects the parachain ID from on-chain `ParachainInfo` storage. Use `--parachain-id` to set it explicitly. Name the chain `{relay}-{parachain}` (see [Naming convention](#naming-convention)):

```
# Add a relay chain (e.g. local zombienet)
dot chain add local-relay --rpc ws://localhost:9944

# Add a parachain under it — `{relay}-{parachain}` name, auto-detects parachain ID
dot chain add local-relay-asset-hub --rpc ws://localhost:9945 --relay local-relay

# Explicit parachain ID
dot chain add my-para --rpc wss://rpc.example.com --relay polkadot --parachain-id 2000
```

Validation rules:
- `--relay` must reference an existing chain in the config
- `--parachain-id` without `--relay` is an error
- If `--relay` is given without `--parachain-id`, the CLI queries `ParachainInfo.ParachainId` on-chain and falls back gracefully if the pallet is absent

### List chains

Show all configured chains:

```
dot chains
dot chain list
```

Both forms are equivalent. `dot chains` is a shorthand that skips the `list` subcommand. Running `dot chain` with no action shows help with all available actions.

#### Chain topology

The default `dot chain list` is intentionally compact — names + relay tree + parachain IDs only:

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

Standalone chains (no `relay` field, not referenced as a relay by other chains) are listed at the bottom. `dot chain list --json` includes `relay` and `parachainId` fields for parachain entries.

Pass `-v` / `--verbose` to also print every RPC endpoint inline (à la `git remote -v`):

```
dot chains -v
dot chain list --verbose
```

```
Configured Chains

  polkadot  wss://polkadot.ibp.network
       wss://polkadot-rpc.n.dwellir.com
       wss://rpc.polkadot.io
  ├─ polkadot-asset-hub [1000]  wss://polkadot-asset-hub-rpc.polkadot.io
       ...
```

### Show chain detail

For everything about a single chain — RPC endpoints, parent relay, child parachains, and metadata cache status — use `dot chain info <name>`:

```
dot chain info polkadot
```

```
polkadot

  rpc:
    wss://polkadot.ibp.network
    wss://rpc.polkadot.io
    ...
  parachains:
    polkadot-asset-hub [1000]
    polkadot-bridge-hub [1002]
    polkadot-collectives [1001]
    polkadot-coretime [1005]
    polkadot-people [1004]
  metadata:
    not cached — run `dot chain update polkadot`
```

After `dot chain update <name>` has run, the `metadata:` row reads `<specName> v<specVersion> (cached <fetchedAt>)`. Inspecting a parachain shows its parent relay and parachain id instead of the `parachains:` row:

```
dot chain info polkadot-asset-hub
```

```
polkadot-asset-hub

  rpc:
    wss://polkadot-asset-hub-rpc.polkadot.io
    ...
  relay:        polkadot
  parachain id: 1000
  metadata:
    not cached — run `dot chain update polkadot-asset-hub`
```

`dot chain <name>` is a bare-noun shortcut for `dot chain info <name>`. Known action verbs (`add`, `remove`, `update`, `list`, `export`, `import`, `info`) take precedence over chain names if there's ever a clash. Names resolve case-insensitively. `dot chain info <name> --json` emits the same data as a structured object — `metadata` is `null` when no fingerprint is cached.

### Update metadata

Re-fetch metadata after a runtime upgrade. Either name a specific chain or use `--all`:

```
dot chain update polkadot
dot chain update --all
```

### Remove a chain

Only user-added chains can be removed:

```
dot chain remove kusama
```

### Selecting a chain

Every chain-consuming command must specify a chain explicitly. Prefer the dotpath chain prefix; the `--chain <name>` flag is equivalent. There is no implicit default; running a command without a chain errors out with a message listing the configured chains.

```
# Recommended — dotpath chain prefix
dot polkadot.query.System.Number
# Output:
# 31014744

# Equivalent — --chain flag
dot query.System.Number --chain polkadot
# Output:
# 31014744
```

Providing both a dotpath prefix and `--chain` at once errors with a clear message. Chain names are case-insensitive. See [Chain Prefix](#chain-prefix) below for the full dotpath form.

Removing a chain that other chains reference as their `relay` prints a warning listing orphaned parachains. The removal still proceeds — orphaned chains keep their `relay` field but render as standalone until the relay is re-added.

### Export chain configuration

Export chain configurations to a JSON file or stdout for backup, sharing, or transfer to another machine. By default, only user-added chains and built-ins with modified RPCs are exported. Metadata is not included in the export — `dot chain import` re-fetches it automatically for each imported chain (see [Import chain configuration](#import-chain-configuration) below).

```
# Export custom chains to stdout (pipe-friendly)
dot chain export

# Export all chains including built-ins
dot chain export --all

# Export specific chains
dot chain export my-relay my-para

# Export to a file
dot chain export --file my-chains.json

# Export all to a file
dot chain export --all --file my-chains.json
```

The export format is JSON with a `chains` field:

```json
{
  "chains": {
    "my-local-relay": { "rpc": ["ws://localhost:9944"] },
    "my-para": { "rpc": ["ws://localhost:9945"], "relay": "my-local-relay", "parachainId": 2000 }
  }
}
```

### Import chain configuration

Import chain configurations from a JSON file or stdin. Running `dot chain import` with no file prints this section's help instead of blocking on stdin — there's no way to accidentally hang the CLI.

```
# Import from a file
dot chain import my-chains.json

# Preview without applying changes
dot chain import my-chains.json --dry-run

# Overwrite existing chains
dot chain import my-chains.json --overwrite

# Skip automatic metadata fetch (offline / CI bootstrap)
dot chain import my-chains.json --no-metadata

# Import from stdin (pipe from another machine)
ssh remote-dev "dot chain export" | dot chain import -
```

Import behavior:

- **Existing chains** are skipped with a warning unless `--overwrite` is passed
- **Relay references** are validated — a warning is printed if a chain references a relay that doesn't exist in the import file or current config
- **Metadata is fetched automatically** for every newly added or overwritten chain so tab completion and metadata-dependent commands (`dot <chain>.query.*`, `dot inspect`, …) work immediately. Partial fetch failures print `✗ <chain> — <error>` but do not fail the import. Pass `--no-metadata` to skip the fetch; you can always backfill later with `dot chain update --all`.

Output prints one line per chain with a status glyph (`✓` added, `⟳` overwritten, `-` skipped) and a terse count summary at the end:

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

With `--json` the output is structured — `{ action, added, overwritten, skipped, warnings }` — and the metadata-fetch phase is skipped.

## Accounts

Manage signing accounts. Dev accounts (Alice, Bob, Charlie, Dave, Eve, Ferdie) are always available on testnets — no import needed.

### List accounts

Show all accounts, both dev and stored:

```
dot accounts
dot account list
```

Both forms are equivalent. `dot accounts` is a shorthand that skips the `list` subcommand. Running `dot account` with no action shows help with all available actions.

### Create an account

Generate a new BIP39 mnemonic and store the account:

```
dot account create my-validator
# Output:
# Account Created
#
#   Name:          my-validator
#   Address:       5HQPcHZ2gUKdJM3JbgFvY8t5PfdkpooH2u2LQrAHZ61dZ57M
#   Bandersnatch:  0xe87b6149a3a91519c10f7f017fedcbf507fc3b8ffa011985b1a1e2b33b020115
#     (candidate)  0x20fbeef36a7b48a13cd0089c2c3a200ccf387ceead3b12804dd77a533b9ba2de
#   Mnemonic:      defy ginger general follow use try ...
#
#   Save this mnemonic phrase! It is the only way to recover this account.

dot account new my-validator   # alias
```

`new` is an alias for `create`. Use `--path` to derive from a non-root path:

```
dot account create my-staking --path //staking
```

### Add a watch-only address

Store a named address without a secret — useful for frequently-used recipients, multisig members, or query targets. Accepts SS58 addresses or hex public keys:

```
dot account add treasury 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
dot account add council 0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
```

Watch-only accounts appear in `dot account list` under a dedicated **Watch-only** section. They can be inspected and removed like any other account but cannot be used with `--from` (signing) or as a source for `derive`.

The `add` subcommand is context-sensitive:
- `add <name> <address>` — creates a watch-only entry (no secret)
- `add <name> --secret "..."` — adds a keyed account from a BIP39 mnemonic, 32-byte hex seed, or 64-byte raw private key
- `add <name> --env VAR` — adds an env-backed account

`dot account import` is reserved for file-based batch import only (see [Batch-import accounts](#batch-import-accounts) below).

### Add a keyed account

`--secret` accepts three formats, all usable directly from the command line:

| Format | Example | `--path`? |
|--------|---------|-----------|
| BIP39 mnemonic (12/24 words) | `"abandon abandon ... about"` | Yes |
| Hex seed (`0x` + 64 hex chars = 32 bytes) | `0x1111...1111` | Yes |
| Raw private key (`0x` + 128 hex chars = 64-byte sr25519 expanded secret) | `0x20e0...5568` | No |

```
dot account add treasury --secret "word1 word2 ... word12"
dot account add seeded --secret 0x1111111111111111111111111111111111111111111111111111111111111111
dot account add raw-key --secret 0x<128-hex-char expanded secret>
```

Use `--path` to add with a derivation path (mnemonic and hex seed only — a raw private key cannot be HD-derived):

```
dot account add hot-wallet --secret "word1 word2 ... word12" --path //hot
```

The raw private key is the same value `dot account inspect <name> --show-secret` prints, so a key revealed from one account can be re-imported under a new name — see [Reveal the mnemonic and private key](#reveal-the-mnemonic-and-private-key).

### Add an env-var-backed account

Store a reference to an environment variable instead of the secret itself. The secret never touches disk — ideal for CI/CD pipelines and security-conscious workflows:

```
dot account add ci-signer --env MY_SECRET
```

`--secret` and `--env` are mutually exclusive. Both `--secret` and `--env` can be combined with `--path`:

```
dot account add ci-signer --env MY_SECRET --path //ci
```

At signing time, the CLI reads `$MY_SECRET` and derives the keypair. If the variable is not set, the CLI errors with a clear message.

`account list` annotates env-backed signers with `env $MY_SECRET` in the metadata column and resolves the address live when the variable is available:

```
dot accounts
# Signers
#   ci-signer  5EPCUjPx...   env $MY_SECRET
```

Use the account like any other:

```
MY_SECRET="word1 word2 ..." dot polkadot.tx.System.remark 0xdead --from ci-signer
```

### Derive a child account

Create a new account from an existing one with a different derivation path. The derived account shares the same secret but produces a different keypair:

```
dot account derive treasury treasury-staking --path //staking
```

`derive` requires a source account name, a new account name, and `--path`. Works with env-backed accounts too — the derived account shares the same env var reference.

### Derivation paths

Use `--path` with `create`, `add`, or `derive` to derive child keys from the same secret. Different paths produce different keypairs, enabling key separation (e.g. staking vs. governance) without managing multiple mnemonics.

Derivation paths use the Substrate convention: `//hard` for hard derivation, `/soft` for soft derivation. Paths can have multiple segments:

```
dot account create validator --path //staking
dot account create multi --path //polkadot//0/wallet
dot account add treasury --secret "..." --path //hot
dot account derive treasury treasury-gov --path //governance
```

`account list` groups accounts by kind and shows derivation path / env source in a separate metadata column. Empty sections are omitted:

```
Dev Accounts
  Alice            5GrwvaEFzXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
  ...

Signers
  treasury-staking  5FHneW46...
     └─ path: //staking
  ci-signer         5EPCUjPx...
     ├─ path: //ci
     └─ env:  $MY_SECRET

Watch-only
  treasury          5GrwvaEF...

Pallet Sovereigns
  Treasury          5EYCAe5i...
     └─ pallet-id: py/trsry (0x70792f7472737279)

Parachain Sovereigns
  People            5Ec4AhPa...
     ├─ parachain:      1004
     └─ parachain-type: child
```

Each account renders as a single line — `name  ss58` — with extra attributes on tree-style continuation lines (`├─` / `└─`), one per attribute. Label names mirror the `--flag` that sets them (`--path`, `--env`, `--pallet-id`, `--parachain`, `--parachain-type`) so you can read the listing back into a re-creating command.

### Named address resolution

Named accounts — both watch-only and keyed — resolve automatically everywhere an AccountId32 or MultiAddress is expected. This works in `dot tx` arguments and `dot query` keys:

```
# Use a named account as transfer recipient
dot polkadot.tx.Balances.transfer_keep_alive treasury 1000000000000 --from alice

# Query by account name
dot polkadot.query.System.Account treasury

# Dev accounts also resolve
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000000 --from alice
```

Resolution order:

1. **Dev account name** (`alice`, `bob`, etc.) — resolves to the dev account's SS58 address
2. **Stored account name** — resolves to the account's SS58 address (works for both keyed and watch-only accounts)
3. **SS58 address** — passed through as-is
4. **Hex public key** (`0x` + 64 hex chars) — passed through as-is
5. **Error** — shows a "Did you mean?" suggestion (if a close match exists) and lists all available account names alphabetically, one per line:

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

    The fuzzy matching uses Levenshtein distance — the same algorithm used for pallet and call name suggestions.

This means you can save commonly-used addresses once and reference them by name everywhere, avoiding copy-paste of long SS58 strings.

### Remove accounts

Remove one or more stored accounts in a single command. When multiple names are given, the command validates all of them before deleting any — if one name is invalid, nothing is removed.

```
dot account remove my-validator
dot account delete my-validator stale-key
dot account rm my-validator stale-key
```

`delete` and `rm` are aliases for `remove`.

### Export accounts

Export accounts to a JSON file or stdout for backup, sharing, or transfer to another machine. Secrets are **redacted by default** — the export is safe to share or commit.

```
# Export all accounts (secrets redacted)
dot account export

# Export specific accounts
dot account export treasury my-validator

# Include secrets (explicit opt-in, warning printed to stderr)
dot account export --include-secrets

# Export only watch-only accounts (always safe)
dot account export --watch-only

# Export to a file
dot account export --file team-accounts.json
```

The export format is JSON:

```json
{
  "accounts": [
    {
      "name": "treasury",
      "publicKey": "0xd435...a27d",
      "derivationPath": "",
      "secret": "<redacted>"
    },
    {
      "name": "ci-signer",
      "publicKey": "",
      "derivationPath": "//ci",
      "secret": { "env": "MY_SECRET" }
    },
    {
      "name": "council-member",
      "publicKey": "0x8eaf...6a48",
      "derivationPath": ""
    }
  ]
}
```

Security considerations:

- **Default export redacts secrets**: mnemonic/seed fields are replaced with `"<redacted>"`. Public keys, derivation paths, bandersnatch keys, and env var references are included.
- **`--include-secrets`** is required to export actual secrets. A warning is printed to stderr when used.
- **Env-backed accounts**: the env var *name* is exported (e.g. `{"env": "MY_SECRET"}`), never the env var *value*. This is always safe.
- **Watch-only accounts**: always safe to export (no secret exists).

### Batch-import accounts

Import accounts from a previously exported JSON file. `dot account import` is file-only — analog to `dot chain import`. The path is passed positionally (the legacy `--file` flag is still accepted). For single-account imports from a mnemonic or env variable, use [`dot account add`](#add-a-keyed-account) instead.

```
# Import from a file (positional path)
dot account import team-accounts.json

# Preview without applying changes
dot account import accounts.json --dry-run

# Overwrite existing accounts
dot account import accounts.json --overwrite

# Import from stdin
ssh remote-dev "dot account export --watch-only" | dot account import -
```

Running `dot account import` with no file prints this section's help instead of blocking on stdin.

Import behavior:

- **Existing accounts** are skipped with a warning unless `--overwrite` is passed
- **Redacted accounts** (secret is `"<redacted>"` or missing) are imported as watch-only — public key is preserved, no signing capability
- **Env-backed accounts** are imported with the env reference preserved — secret resolution happens at signing time as usual
- **Accounts with secrets** (mnemonic/seed) are validated and the public key is re-derived
- **Bandersnatch keys** are preserved if present in the export
- **Dev account names** (alice, bob, etc.) are skipped

Output prints one line per account with a status glyph (`✓` added, `⟳` overwritten, `-` skipped) and a terse count summary at the end:

```
  ✓ treasury
  ✓ council-member
  - alice (skipped)

2 added, 1 skipped
```

Migration from the pre-1.x single-account import form:

```
# Before
dot account import treasury --secret "word1 word2 ..."     # removed
dot account import --file accounts.json                     # still works

# After
dot account add treasury --secret "word1 word2 ..."        # canonical single-account
dot account import accounts.json                           # positional batch import
```

### Inspect accounts

Convert between SS58 addresses, hex public keys, and account names. Accepts any of:

- **Dev account name** (`alice`, `bob`, etc.) — resolves to public key and SS58
- **Stored account name** — looks up the public key from the accounts file
- **SS58 address** — decodes to the underlying public key
- **Hex public key** (`0x` + 64 hex chars) — encodes to SS58
- **H160 / EVM address** (`0x` + 40 hex chars) — resolves to the pallet-revive fallback `AccountId32` (`H160 || 0xEE * 12`)
- **`--pallet-id <id>`** — derives a pallet sovereign address without saving it (script-friendly)
- **`--parachain <id> --parachain-type <child|sibling>`** — derives a parachain sovereign address without saving it

```
dot account inspect alice
dot account alice                    # shorthand — unknown subcommands fall through to inspect

dot account inspect 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
dot account inspect 0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
dot account inspect 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D   # H160 / EVM input
```

Use `--prefix` to encode the SS58 address with a specific network prefix (default: 42):

```
dot account inspect alice --prefix 0     # Polkadot mainnet (prefix 0, starts with '1')
dot account inspect alice --prefix 2     # Kusama (prefix 2)
```

Output:

```
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

The `Kind:` line categorises the account: `dev`, `signer`, `watch-only`, `pallet sovereign`, `parachain sovereign (child|sibling)`, or `revive H160 fallback` (when a 20-byte hex input is resolved to its deterministic Substrate AccountId32). For derived sovereigns, an extra `Source:` line shows what the address was derived from (e.g. `PalletId py/trsry (0x70792f7472737279)` or `parachain 1004`). For env-backed signers an `Env:` line shows the variable; for derived child keys, `Derivation:` shows the path. The `H160:` line is shown for every account — it's the pallet-revive 20-byte address, EIP-55 checksummed and prefix-independent.

JSON output:

```
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

#### pallet-revive H160 mapping

Every Substrate account has a corresponding 20-byte H160 under [pallet-revive](https://github.com/paritytech/polkadot-sdk/tree/master/substrate/frame/revive) (the new EVM-compatible smart-contracts pallet on Polkadot Hub / Asset Hub). `dot` computes this offline using the canonical mapping (current `polkadot-sdk` master):

- **AccountId32 → H160:** if the last 12 bytes are `0xEE`, strip them (the account originated from an Eth address); otherwise `keccak256(accountId32)` and take the last 20 bytes.
- **H160 → AccountId32:** deterministic fallback is `H160 || 0xEE * 12`. The full mapping after a successful `pallet_revive.map_account` extrinsic lives in on-chain `AddressSuffix` storage and isn't recoverable offline — that's a chain-state lookup, not an `inspect` concern.

Resolve an H160 back to its fallback Substrate account by passing it as the inspect input:

```
dot account inspect 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
# Output:
# Account Info
#
#   Kind:        revive H160 fallback
#   Public Key:  0x9621dde636de098b43efb0fa9b61facfe328f99deeeeeeeeeeeeeeeeeeeeeeee
#   SS58:        5FTZ6n1wY3GBqEZ2DWEdspbTarvRnp8DM8x2YXbWubu7JN98
#   H160:        0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
#   Prefix:      42
```

Script-friendly extraction:

```
dot account inspect alice --json | jq -r .h160
# 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
```

Caveat: older `stable2412` runtimes used plain `accountId32[..20]` truncation for the forward direction instead of the keccak fallback. `dot` implements the current variant; if you target a legacy runtime, compute manually until a `--revive-truncate` flag lands.

#### Stateless sovereign derivation (script-friendly)

Pass `--pallet-id` or `--parachain` / `--parachain-type` to compute a sovereign address **without persisting** anything to `~/.polkadot/accounts.json`. The output shape matches the stored case (same `Kind:` / `Source:` / SS58 / public key + same `--json` schema), but no `Name:` line and nothing in `dot account list` afterwards. Use this in scripts when you just need the address — no name to come up with, no cleanup later.

```
dot account inspect --pallet-id py/trsry --prefix 0
# Output:
# Account Info
#
#   Kind:        pallet sovereign
#   Public Key:  0x6d6f646c70792f74727372790000000000000000000000000000000000000000
#   SS58:        13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB
#   Source:      PalletId py/trsry (0x70792f7472737279)
#   Prefix:      0
```

Hex form works the same:

```
dot account inspect --pallet-id 0x70792f7472737279 --prefix 0
```

Parachain sovereigns require an explicit `--parachain-type`:

```
dot account inspect --parachain 1004 --parachain-type child
dot account inspect --parachain 1004 --parachain-type sibling
```

Pipeline pattern — extract just the SS58:

```
SS58=$(dot account inspect --pallet-id py/trsry --prefix 0 --json | jq -r .ss58)
```

JSON shape includes a structured `source` field describing the derivation:

```
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

To persist the derived address as a named account in `~/.polkadot/accounts.json` (so you can reuse the name in `--from`, in tx args, in `dot account list`), use `dot account add` with the same flags instead.

### Reveal the mnemonic and private key

Add `--show-secret` to print the **64-byte sr25519 expanded secret** as `0x`-prefixed hex — useful for provisioning another signer (e.g. a server that expects a raw hex private key in an env var). It also reveals the **stored mnemonic** (or hex seed) so you can back it up:

```
dot account inspect my-validator --show-secret
# Mnemonic:    word1 word2 ... word12   (only for accounts stored as a phrase)
# Private Key: 0x<128 hex chars>        (sr25519 expanded, 64 bytes — never share)
```

The revealed line depends on how the account is stored: a phrase shows under `Mnemonic`, a 32-byte hex seed under `Seed`, and a raw private key shows only the `Private Key` (the stored secret already _is_ the expanded key). Works for dev accounts (derived on-the-fly from the standard dev mnemonic) and for any stored account that has a secret. Refuses on watch-only accounts, bare SS58 addresses, or hex public keys. **Env-backed secrets are never resolved to output** — only the `$VAR` reference is shown.

The expanded `Private Key` is the final secret after any derivation path is applied, so it can be fed directly to signers that don't accept a mnemonic+path. It also round-trips: re-import it with `dot account add <name> --secret 0x<128 hex>` to recreate a signing-capable account (see [Add a keyed account](#add-a-keyed-account)). Combine with `--json` to include the values under the `mnemonic`/`seed` and `privateKey` fields.

If the account was stored with a derivation path, the revealed `Mnemonic`/`Seed` reproduces the original address **only when re-imported with the same `--path`** (shown on the `Derivation` line); the text reveal prints a reminder in that case. The `Private Key` bakes in the path, so it round-trips on its own.

## Chain Prefix

Prefix the dot-path with a chain name to target a specific chain instead of using the `--chain` flag. The prefix becomes the first segment of the dot-path:

```
dot polkadot.query.System.Account 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
dot polkadot.const.Balances.ExistentialDeposit
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000 --from alice --dry-run
dot inspect polkadot.System            # for `inspect`, the prefix is the first arg
dot inspect polkadot.System.Account
```

Chain names are case-insensitive — `polkadot.query.System.Account`, `Polkadot.query.System.Account`, and `POLKADOT.query.System.Account` all resolve the same way. The same applies to `--chain Polkadot`.

Every invocation must specify a chain explicitly: either via a dotpath prefix (as above) or via `--chain <name>`. If both are provided, the CLI errors with a clear message.

For `inspect`, a two-segment input like `polkadot.System` is disambiguated by checking configured chain names. Chain names (lowercase, e.g. `polkadot`) and pallet names (PascalCase, e.g. `System`) don't collide in practice. If they did, the chain prefix takes priority and `--chain` serves as an escape hatch. Note: `dot polkadot.inspect.X` is **not** valid — `inspect` is a top-level command rather than a dot-path category. Use either `dot inspect polkadot.X` or `dot inspect X --chain polkadot`.

## Space-Separated Syntax

The `Pallet` and `Item` segments can be passed as separate arguments instead of dot-joined. These pairs are equivalent:

```
# Dot notation vs fully space-separated — these are identical:
dot polkadot.query.System                 # dot notation
dot query System --chain polkadot         # space-separated

dot polkadot.events.Balances.Transfer
dot events Balances Transfer --chain polkadot

dot polkadot.apis.Core
dot apis Core --chain polkadot
```

This works for all categories (`query`, `tx`, `const`, `events`, `errors`, `apis`). When passing positional method arguments, keep `Pallet` and `Item` either fully dot-joined (`query.System.Account 5Grw...`) or fully space-separated (`query System Account 5Grw...`) — mixing the two (`query System.Account 5Grw...`) does not work because the second arg gets parsed as a pallet name.

## Query

Read on-chain storage using dot-path syntax: `dot query.Pallet.Item`. Fetch plain values, look up map entries by key, or enumerate all entries. Use `dot query` to list pallets with storage items, or `dot query.Pallet` to list a pallet's storage items.

```
# Plain storage value
dot polkadot.query.System.Number
# Output:
# 31014744

# Map entry by key — Alice's account on Polkadot
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

# List pallets with storage items
dot polkadot.query

# List storage items in a pallet
dot polkadot.query.System
```

### Partial key queries

For storage maps with multiple keys (NMaps), you can provide fewer keys than expected to retrieve all entries matching that prefix. This uses the chain's prefix-based iteration and does not require `--dump`.

```
# Full key — returns a single value
dot polkadot.query.Staking.ErasStakers 100 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY

# Partial key — returns all entries matching the first key
dot polkadot.query.Staking.ErasStakers 100

# No keys — requires --dump (safety net for large maps)
dot polkadot.query.Staking.ErasStakers --dump
```

### Output formatting

Query results automatically convert on-chain types for readability:

- **BigInt** values (e.g. balances) render as decimal strings
- **Binary** fields (e.g. token `name`, `symbol`) render as text when the value contains only printable characters, or as `0x`-prefixed hex otherwise (values containing control characters, Private Use Area code points, or invalid UTF-8 sequences always fall back to hex)
- **Uint8Array** values render as `0x`-prefixed hex

```
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

### Historical reads — `--at <block>`

Storage queries default to the latest finalized head. Pass `--at` to read
state at a specific block hash, the chain head (`best`), or `finalized`
(explicit). Accepted on both `query.*` and `apis.*` runtime calls.

```
# Read at the current best (non-finalized) head
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

## Constants

Look up runtime constants using dot-path syntax: `dot const.Pallet.Constant`. Use `dot const` to list pallets with constants, or `dot const.Pallet` to list a pallet's constants.

```
dot polkadot.const.Balances.ExistentialDeposit
# Output:
# "10000000000"

dot polkadot.const.System.SS58Prefix
# Output:
# 0

# --chain flag is equivalent
dot const.Balances.ExistentialDeposit --chain polkadot

# List pallets with constants
dot polkadot.const

# List constants in a pallet (offline once metadata is cached)
dot polkadot.const.Balances

# Pipe-safe — stdout is clean JSON, progress messages go to stderr
dot polkadot.const.Balances.ExistentialDeposit --json | jq
```

`consts` and `constants` are aliases for `const`.

## Inspect

Browse chain metadata offline (uses the cached copy after the first fetch). Shows storage items, constants, calls, events, and errors for each pallet. `explore` is an alias for `inspect`.

The chain is required: pass it with `--chain` or as a prefix on the inspect target (e.g. `dot inspect polkadot.System`).

`inspect` is **forgiving** — it accepts the same dot-paths you use to invoke a call and prefers discovery over erroring. A `kind` segment (`tx`/`query`/`const`/`events`/`errors`/…) is tolerated and ignored, so `dot inspect polkadot.tx.System.remark` describes the `System.remark` call exactly as `dot inspect polkadot.System.remark` does. Partial paths list instead of failing: `dot inspect polkadot.query.System` (and the bare `dot inspect System`) list the pallet's items.

Output is **width-aware**: short type signatures stay on a single line, long ones expand across multiple lines with field names aligned by colon. Composite struct fields and call arguments are color-coded (cyan field names, yellow primitives, magenta container keywords like `Vec`/`Option`, green enum variants) when stdout is a TTY; piped output stays plain.

```
# Pallet detail — list storage, constants, calls, events, errors
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

# Storage item detail — Type / Key / Value on separate lines, composite Value expands
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

# Call detail — long signatures expand across lines with names aligned
dot inspect polkadot.Referenda.submit
# Output:
# Referenda.submit (Call)
#
#   Args: (
#     proposal_origin : system | Origins | ParachainsOrigin | XcmPallet,
#     proposal        : Legacy | Inline | Lookup,
#     enactment_moment: At | After,
#   )
#
#   Propose a referendum on a privileged action.

# Event detail
dot inspect polkadot.Balances.Transfer
# Output:
# Balances.Transfer (Event)
#
#   Fields: (from: AccountId32, to: AccountId32, amount: u128)
#
#   Transfer succeeded.

# Error detail
dot inspect polkadot.Balances.InsufficientBalance

# List all pallets — single positional is read as a pallet name, so use --chain here
dot inspect --chain polkadot
dot explore --chain polkadot          # alias
```

### Pallet listing

All listings — pallets, storage items, constants, calls, events, and errors — are sorted alphabetically, making it easy to scan for a specific item.

When inspecting a pallet (e.g. `dot inspect Balances`), each item shows type information inline so you can understand the shape without drilling into the detail view:

**Storage items** show name + optional `[map]` tag with `Key:` and `Value:` on indented lines below. Composite values expand to one field per line when wide:

```
  Storage Items:
    Account [map]
      Key:   AccountId32
      Value: {
        free    : u128,
        reserved: u128,
        frozen  : u128,
        flags   : u128,
      }
        The Balances pallet example of storing the balance of an account.
    TotalIssuance
      Value: u128
        The total units issued in the system.
```

**Constants** show their type:

```
  Constants:
    ExistentialDeposit: u128
        The minimum amount required to keep an account open.
    MaxLocks: u32
        The maximum number of locks that should exist on an account.
```

**Calls** show their full argument signature inline if it fits, otherwise across multiple lines with names aligned:

```
  Calls:
    transfer_allow_death(dest: Id | Index | Raw | Address32 | Address20, value: Compact<u128>)
        Transfer some liquid free balance to another account.
    submit(
      proposal_origin : system | Origins | ParachainsOrigin | XcmPallet,
      proposal        : Legacy | Inline | Lookup,
      enactment_moment: At | After,
    )
        Propose a referendum on a privileged action.
```

Enums up to 24 variants render as `A | B | C | …` (variants visible). Only enums with more than 24 variants are still summarized as `enum(N variants)` for readability.

**Events** show their field signature:

```
  Events:
    Transfer(from: AccountId32, to: AccountId32, amount: u128)
        Transfer succeeded.
    Deposit(who: AccountId32, amount: u128)
        Some amount was deposited (e.g. for transaction fees).
```

**Errors** show their name and documentation:

```
  Errors:
    InsufficientBalance
        Balance too low to send value.
    VestingBalance
        Vesting balance too high to send value.
```

The first sentence of the documentation is shown below each item. Abbreviations like `e.g.`, `i.e.`, and `etc.` are handled correctly and don't cause early truncation. Drill into any item for the full documentation.

### Item detail

Drill into any item for full details. For example, `dot inspect Balances.transfer_allow_death` shows the argument signature and full documentation from the runtime metadata:

```
  Balances.transfer_allow_death (Call)

  Args: (dest: AccountId32, value: Compact<u128>)

  Transfer some liquid free balance to another account.
  ...
```

Event and error detail views follow the same pattern:

```
  Balances.Transfer (Event)

  Fields: (from: AccountId32, to: AccountId32, amount: u128)

  Transfer succeeded.
```

```
  Balances.InsufficientBalance (Error)

  Balance too low to send value.
```

Use call inspection to discover argument names, types, and documentation before constructing `dot tx` commands.

## Focused Listing

Each category supports partial paths for browsing metadata. Category-only invocations list pallets (or APIs); pallet-level invocations list items; item-level invocations show detail. All support `--chain <name>`, `--rpc <url>`, and chain prefix syntax. Singular and plural aliases work: `event` = `events`, `error` = `errors`, `api` = `apis`.

### Calls (tx listing)

```
dot polkadot.tx                                    # list pallets with calls
dot polkadot.tx.Balances                           # list calls with arg signatures
dot polkadot.tx.Balances.transfer_allow_death      # call detail
```

### Events

```
dot polkadot.events                                # list pallets with events
dot polkadot.events.Balances                       # list events with field signatures
dot polkadot.events.Balances.Transfer              # event detail
```

### Errors

```
dot polkadot.errors                                # list pallets with errors
dot polkadot.errors.Balances                       # list errors with docs
dot polkadot.errors.Balances.InsufficientBalance   # error detail
```

### Storage (query listing)

```
dot polkadot.query                                 # list pallets with storage items
dot polkadot.query.System                          # list storage items with types
dot polkadot.query.System.Account                  # storage help (use --dump for all entries)
dot polkadot.query.System.Account --dump           # fetch all map entries
```

### Constants (const listing)

```
dot polkadot.const                                 # list pallets with constants
dot polkadot.const.Balances                        # list constants (offline once metadata is cached)
dot polkadot.const.Balances.ExistentialDeposit     # look up value (connects to chain)
```

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

Browse and call Substrate runtime APIs. Unlike pallets, runtime APIs are top-level named interfaces (e.g. `Core`, `AccountNonceApi`, `TransactionPaymentApi`) that expose methods callable via `dot <chain>.apis.ApiName.method`.

```
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
#   execute_block(block: { ... }) → unknown
#       Execute the given block.
#   initialize_block(header: { ... }) → AllExtrinsics | OnlyInherents
#       Initialize a block with the given header and return the runtime executive mode.
#   version() → { spec_name: str, ... }
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

# Call with arguments
dot polkadot.apis.AccountNonceApi.account_nonce alice
```

Chain prefix and `--help` work the same as other categories:

```
dot polkadot.apis.Core.version                     # chain prefix form
dot apis.Core.version --chain polkadot --help      # --chain flag form (chain still required for --help)
```

`api` is an alias for `apis`. Shell completions work at every level: `apis.<Tab>` shows API names, `apis.Core.<Tab>` shows method names.

Runtime API info requires v15 metadata. If `dot <chain>.apis` shows 0 APIs, the CLI will suggest updating your cached metadata. Run `dot chain update` (or `dot chain update <chain>`, or `dot chain update --all` for all chains) to fetch the latest version.

#### Argument formats

Runtime API arguments use the same shorthand as transaction arguments:

| Type | Pass as | Example |
|------|---------|---------|
| Integers (`u8` … `u32`) | decimal | `0`, `42` |
| Big integers (`u64`, `u128`, `u256`) | decimal | `1000000000000` |
| `bool` | `true` / `false` | `true` |
| `AccountId32` | dev name, stored account, SS58, or `0x` + 64 hex pubkey | `alice`, `5GrwvaEF…` |
| `Vec<u8>` (unsized bytes) | `0x…` hex or text | `0xdeadbeef`, `hello` |
| `[u8; N]` (sized bytes — `H160`, `H256`, raw `AccountId`) | `0x` + exactly `2 * N` hex chars (recommended), or text | `0x970951a12f975e6762482aca81e57d5a2a4e73f4` |
| `Option<T>` | `null` (recommended), `none`, `undefined` — or a `T` value for `Some(value)` | `null` |
| `Vec<T>` (non-byte) | JSON array or comma-separated | `[1,2,3]`, `1,2,3` |
| Structs / nested enums | JSON | `{"type":"X1","value":{…}}` |

Sized byte arrays — `H160` (`[u8; 20]`), `H256` (`[u8; 32]`), raw 32-byte `AccountId32`, etc. — must be passed as a `0x`-prefixed hex string. polkadot-api's runtime-API compatibility check accepts only the string form for sized binary types; `Vec<u8>` (unsized) accepts both strings and bytes.

Example: a contract call via `pallet-revive`'s runtime API on `paseo-asset-hub`. Use `dot <chain>.apis.<Api>.<method> --help` to see the exact argument signature for any method.

```bash
ORIGIN=alice
CONTRACT=0x970951a12f975e6762482aca81e57d5a2a4e73f4         # H160 / [u8; 20]
CALLDATA=$(cast calldata "set(uint256)" 42)

# Args: origin, dest, value, gas_limit (Option), storage_deposit (Option), input_data
dot paseo-asset-hub.apis.ReviveApi.call \
  "$ORIGIN" "$CONTRACT" 0 null null "$CALLDATA"
```

##### Passing `Option<T>`

Absent options (`None`) can be written three ways, all equivalent:

```
# null (recommended), none, and undefined all mean None
dot paseo-asset-hub.apis.ReviveApi.call "$ORIGIN" "$CONTRACT" 0 null       null       "$CALLDATA"
dot paseo-asset-hub.apis.ReviveApi.call "$ORIGIN" "$CONTRACT" 0 none       none       "$CALLDATA"
dot paseo-asset-hub.apis.ReviveApi.call "$ORIGIN" "$CONTRACT" 0 undefined  undefined  "$CALLDATA"
```

`null` is the **recommended** form — it matches JSON / YAML semantics, so args read identically on the CLI and inside file-based command YAML/JSON inputs.

A present option (`Some(value)`) is just the value itself — no wrapping:

```
# gas_limit = Some({ ref_time: 1_000_000, proof_size: 100_000 })
dot paseo-asset-hub.apis.ReviveApi.call "$ORIGIN" "$CONTRACT" 0 \
  '{"ref_time":1000000,"proof_size":100000}' \
  null \
  "$CALLDATA"
```

Notes:

- The `null` / `none` / `undefined` literals are case-sensitive (lowercase only).
- There is no `Some(value)` prefix — bare values are already treated as `Some`.

Run `dot <chain>.apis.<ApiName>.<method> --help` to see the exact argument signature for any method.

### Transaction extensions

Every Substrate transaction carries a list of transaction extensions (also known as signed extensions) that extend the transaction with metadata the runtime validates — nonce, mortality, fee payment, metadata hash, and chain-specific extras. Use `dot <chain>.extensions` to discover which extensions a chain declares, what their value types look like, and which ones you need to fill in yourself when building a transaction.

```
# List every transaction extension on the chain
dot polkadot.extensions
# Output:
# Transaction extensions on polkadot (11)
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

# Detail view for one extension
dot polkadot.extensions.CheckMortality
# Output:
# CheckMortality (Transaction Extension)
#
#   Value type:       enum(256 variants)
#   AdditionalSigned: [u8; 32]
#   Handled by:       polkadot-api (builtin)

# Structured output for scripts / agents
dot polkadot.extensions --json
```

`extension` and `ext` are aliases for `extensions`. Shell completion suggests identifiers after `dot polkadot.extensions.<Tab>`.

Each entry is tagged:

- `[builtin]` — `polkadot-api` handles this extension for you when signing. Examples: `CheckMortality`, `CheckNonce`, `ChargeTransactionPayment`, `CheckMetadataHash`, `StorageWeightReclaim`.
- `[custom]` — you must provide a value via `--ext` when signing. The detail view shows the value type and a ready-to-adapt snippet:

  ```
  dot tx.<Pallet>.<Call> --from <acc> --chain <chain> --ext '{"<Identifier>":{"value":<v>}}'
  ```

The detail view also shows the extension's `additionalSigned` type (included in the signed payload but not in the transaction body). `--json` output emits structured records with `identifier`, `valueType`, `additionalSignedType`, `valueTypeId`, `additionalSignedTypeId`, and `isBuiltin` — handy for agents and scripts that generate `--ext` payloads automatically.

This is the companion discovery surface for [Custom signed extensions](#custom-signed-extensions) below — run `dot <chain>.extensions` first to learn what the chain expects, then pass the right values to `dot tx ... --ext`.

### Raw JSON-RPC

Substrate nodes expose a JSON-RPC surface that lives outside runtime metadata: `system_*` (sync state, peers, version), `chain_*` (blocks, headers, finalized head), `state_*` (raw storage, key iteration, runtime version), `author_*` (mempool, key management), `payment_*` (fee estimation), consensus families (`babe_*`, `grandpa_*`, `mmr_*`, `beefy_*`), and the new spec families (`chainSpec_v1_*`, `archive_v1_*`, `rpc_methods`). The `rpc` category exposes them all.

Methods are discovered per-chain via the standard `rpc_methods` JSON-RPC call and cached at `~/.polkadot/chains/<chain>/rpc-methods.json`. The set of available methods depends on the node, not the chain — an archive node adds `archive_v1_*`, validators may add `babe_epochAuthorship`, dev nodes add `dev_newBlock`, and `--rpc-methods safe` strips writes.

```
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

```
dot polkadot.rpc.chain_subscribeAllHeads
# Error: "chain_subscribeAllHeads" is a subscription method (requires a follow
# session) and is not callable as a one-shot. Use a long-running client for
# streaming RPC.
```

The `rpc` category is **flat** — there's no pallet level. The form is `[chain.]rpc.<method_name>`, where `<method_name>` keeps its underscores in a single segment (e.g. `polkadot.rpc.chain_getBlock`).

## Transactions

Build, sign, and submit extrinsics using dot-path syntax: `dot tx.Pallet.Call`. Pass arguments after the dot-path, or submit a raw SCALE-encoded call hex. Both forms display a decoded human-readable representation of the call.

### Basic usage

Use the chain-prefix dotpath form. Method names are snake_case as defined in the runtime metadata.

```
# Estimate fees without submitting (no broadcast). The Decode block shows the
# call name on the header line and indented JSON for its arguments below.
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

# Transfer (amount in plancks)
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000 --from alice --dry-run

# Submit (omit --dry-run)
dot polkadot.tx.System.remark 0xdeadbeef --from alice

# Force every tx to dry-run via the global DOT_DRY_RUN env var — a safety net
# for scripts and demos. A hint is printed to stderr; the command behaves
# exactly as if --dry-run had been passed.
DOT_DRY_RUN=1 dot polkadot.tx.System.remark 0xdeadbeef --from alice
# stderr: ⚠ DOT_DRY_RUN is set — extrinsics will be simulated, not submitted.
# stdout: (the dry-run output above — no broadcast)
```

The `--chain` flag is equivalent:

```
dot tx.System.remark 0xdeadbeef --from alice --chain polkadot
```

### Dry run

Estimate fees without submitting (see the basic-usage example above).

### Raw call data

Submit a raw SCALE-encoded call hex (e.g. from a multisig proposal or another tool):

```
dot polkadot.tx 0x000010deadbeef --from alice --dry-run
# Output:
#   Chain:  polkadot
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x000010deadbeef
#   Decode: System.remark
#     {
#       "remark": "0xdeadbeef"
#     }
#   Estimated fees: 125598975
```

### Batch calls

Use `Utility.batch_all` to combine multiple calls into one transaction. The easiest way is to encode individual calls first, then pass them comma-separated:

```
# Encode individual calls
A=$(dot polkadot.tx.System.remark 0xdeadbeef --encode)
B=$(dot polkadot.tx.System.remark 0xcafe --encode)

# Batch them (comma-separated encoded calls)
dot polkadot.tx.Utility.batch_all "$A,$B" --from alice --dry-run
# Output (excerpt — each nested call gets its own enum {type, value} envelope):
#   Chain:  polkadot
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x1a0208000010deadbeef000008cafe
#   Decode: Utility.batch_all
#     {
#       "calls": [
#         {
#           "type": "System",
#           "value": { "type": "remark", "value": { "remark": "0xdeadbeef" } }
#         },
#         ...
#       ]
#     }
#   Estimated fees: 133994995
```

Any `Vec<T>` parameter accepts comma-separated elements as an alternative to JSON arrays. This works for all calls, not just batch.

### Enum shorthand

Enum arguments accept a concise `Variant(value)` syntax instead of verbose JSON. This is especially useful for calls like `Utility.dispatch_as` where the origin is an enum:

```
# Before (verbose JSON)
INNER=$(dot polkadot.tx.System.remark 0xcafe --encode)
dot polkadot.tx.Utility.dispatch_as '{"type":"system","value":{"type":"Authorized"}}' "$INNER" --from alice --dry-run

# After (shorthand)
dot polkadot.tx.Utility.dispatch_as 'system(Authorized)' "$INNER" --from alice --dry-run
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
```

The syntax supports:

| Input | Result |
|---|---|
| `Root` | `{ type: "Root" }` (plain variant, already worked) |
| `Root()` | `{ type: "Root" }` (empty parens, same as above) |
| `Parachain(1000)` | `{ type: "Parachain", value: 1000 }` |
| `system(Authorized)` | `{ type: "system", value: { type: "Authorized" } }` |
| `system(Signed(5FHn...))` | nested 3 levels deep |
| `AccountId32({"id":"0x..."})` | JSON inside parens for struct values |

Variant matching is case-insensitive — `system(authorized)` resolves the outer variant to `system` and the inner to `Authorized` using the chain's metadata. All existing formats (JSON objects, hex, SS58 addresses) continue to work unchanged.

### Encode call data

Encode a call to hex without signing or submitting. This is useful for preparing calls to pass to `Sudo.sudo`, multisig proposals, governance preimages, or any workflow that needs raw call bytes. Works offline from cached metadata and does not require `--from`.

```
# Encode a remark
dot polkadot.tx.System.remark 0xdeadbeef --encode
# Output:
# 0x000010deadbeef

# Encode a transfer
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000 --encode
# Output:
# 0x050300d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d02286bee

# Compose: encode a call, then wrap it with Sudo.sudo (Sudo only exists on testnets like Paseo)
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

`--encode` and `--dry-run` are mutually exclusive. `--encode` cannot be used with raw call hex (it is already encoded).

### Decode call data to YAML / JSON

Decode a hex-encoded call into a YAML or JSON file that is compatible with [file-based commands](#file-based-commands). This is useful for inspecting opaque call data, sharing human-readable transaction definitions, or editing parameters before re-submitting. Works offline from cached metadata and does not require `--from`.

```
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

### Transaction output

Both dry-run and submission display the encoded call hex and a decoded human-readable form. The decoded call is rendered as JSON with two-space indentation under the `Decode:` header so even deeply nested calls remain easy to scan:

```
  Call:   0x000010deadbeef
  Decode: System.remark
    {
      "remark": "0xdeadbeef"
    }
  Tx:     0xabc123...
  Status: ok
```

Complex calls (XCM teleports, batched governance proposals, sudo wrappers) keep the same shape — every nested enum becomes a `{ "type": ..., "value": ... }` block, indented one level deeper, so you can read the structure top-down without it ever wrapping past the terminal width:

```
  Decode: PolkadotXcm.limited_teleport_assets
    {
      "dest": {
        "type": "V3",
        "value": { "parents": 1, "interior": { "type": "X1", "value": { "type": "Parachain", "value": 5140 } } }
      },
      ...
    }
```

### Exit codes

The CLI exits with code **1** when a finalized transaction has a dispatch error (e.g. insufficient balance, bad origin). The full transaction output (events, explorer links) is still printed before the error so you can debug the failure. Module errors are formatted as `PalletName.ErrorVariant` (e.g. `Balances.InsufficientBalance`).

```
dot polkadot.tx.Balances.transfer_keep_alive bob 999999999999999999 --from alice
# ... events and explorer links ...
# Error: Transaction dispatch error: Balances.InsufficientBalance
echo $?  # 1
```

This makes it easy to detect on-chain failures in scripts and CI pipelines.

### Stale metadata detection

When a `tx`, `--dry-run`, or `query` fails with an error that smells like stale metadata — a runtime wasm trap, a SCALE codec/decode error, or a fee-estimation panic — the CLI compares your locally cached metadata's runtime fingerprint against the live chain. If it has changed, the CLI appends a one-line suggestion telling you exactly which command to run:

```
Error: The runtime rejected this transaction in the runtime's validate_transaction step.
  Cause: a runtime invariant failed — typically the call's arguments are out of range, …

⚠ Local metadata for "paseo-people-next" is out of date (spec 1018 → 1020).
   Run: dot chain update paseo-people-next
```

The fingerprint includes the runtime code hash, so the check also catches local-node restarts where the wasm changed but `specVersion` was kept the same. No automatic refetch happens — the original error still propagates with a non-zero exit code, you just get an actionable suggestion.

The check only fires on suspected-stale errors, so the happy path pays no extra RPC. Set `DOT_TRUST_CACHED_METADATA=1` to disable the check entirely (e.g. for CI loops where you've just refreshed manually).

### Argument parsing errors

When a call argument is invalid, the CLI shows a contextual error message with the argument name, the expected type, and a hint:

```
dot polkadot.tx.Balances.transfer_keep_alive bob abc --encode
# Error: Invalid value for argument 'value' (expected Compact<u128>): "abc"
#   Hint: Compact<u128>
```

For struct-based calls (most extrinsics), the error identifies the specific field that failed. For tuple-based calls, it shows the argument index. The original parse error is preserved as the `cause` for programmatic access.

### Wait level

By default, `dot tx` waits for finalization (~30s on Polkadot). Use `--wait` / `-w` to return earlier:

```
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

### Custom signed extensions

Chains with non-standard signed extensions are auto-handled:

- `void` → empty bytes
- `Option<T>` → `None`
- enum with `Disabled` variant → `Disabled`

For manual override, use `--ext` with a JSON object:

```
dot polkadot.tx.System.remark 0xdeadbeef --from alice \
  --ext '{"MyExtension":{"value":"..."}}'
```

Not sure which extensions a chain exposes or which ones need a `--ext` override? Run `dot extensions --chain <chain>` (see [Transaction extensions](#transaction-extensions)) to list every extension with its value type and a `[builtin]` / `[custom]` marker.

### Transaction options

Override low-level transaction parameters. Useful for rapid-fire submission (custom nonce), priority fees (tip), or controlling transaction lifetime (mortality).

| Flag | Value | Description |
|------|-------|-------------|
| `--nonce <n>` | non-negative integer | Override the auto-detected nonce |
| `--tip <amount>` | non-negative integer (planck) | Priority tip for the transaction pool |
| `--mortality <spec>` | `immortal` or period (min 4) | Transaction mortality window |
| `--at <block>` | 0x-prefixed block hash, `"best"`, or `"finalized"` | Block to read/validate against (defaults to finalized). Also honored on `query.*` and `apis.*` for historical reads; tx submission rejects `"best"`. |

```
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

### Pay fees in an alternative asset

On asset-hub-style chains (Polkadot Asset Hub, Paseo Asset Hub, etc.) the `ChargeAssetTxPayment` signed extension lets a transaction pay its fees in a non-native asset. Use `--asset <json>` to select the asset — the value is an XCM location (JSON) identifying the asset, which the runtime's asset-conversion pool swaps for native tokens at dispatch time.

```
# Define the USDT location once (asset id 1337, PalletInstance 50)
USDT='{"parents":0,"interior":{"type":"X2","value":[{"type":"PalletInstance","value":50},{"type":"GeneralIndex","value":"1337"}]}}'

# Dry-run to see the native-denominated fee estimate
dot polkadot-asset-hub.tx.Balances.transfer_keep_alive bob 1000000000 \
  --from alice --dry-run --asset "$USDT"
# Output:
#   Chain:  polkadot-asset-hub
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x0a0300d435...02286bee
#   Decode: Balances.transfer_keep_alive
#     {
#       "dest": { "type": "Id", "value": "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty" },
#       "value": 1000000000
#     }
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

### Unsigned/authorized transactions

Submit transactions without a signer using `--unsigned`. This is for calls authorized by on-chain mechanisms (e.g. the `AuthorizeCall` signed extension) rather than cryptographic signatures. Typically used for governance-authorized calls on chains like the People chain.

```
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

The CLI constructs a v5 general transaction (`0x45` format) with all signed extension "extra" values auto-defaulted:

- `VerifySignature` → `Disabled` (no cryptographic signature)
- `Option<T>` extensions (e.g. `AsPerson`) → `None`
- `void` extensions (e.g. `AuthorizeCall`) → empty
- `CheckMortality` → `Immortal`
- `CheckNonce` → `0`
- `ChargeAssetTxPayment` → zero tip, no asset
- `bool` extensions (e.g. `RestrictOrigins`) → `false`

Override individual extensions with `--ext` if needed:

```
dot polkadot-people.tx.People.create_people_collection --unsigned \
  --ext '{"RestrictOrigins":{"value":true}}'
```

`--unsigned` is mutually exclusive with `--from`, `--nonce`, `--tip`, and `--mortality`.

#### File-based unsigned transactions

YAML/JSON command files support an `unsigned: true` field. The CLI `--unsigned` flag overrides the file value:

```yaml
# create-people-collection.yaml
chain: polkadot-people
unsigned: true
tx:
  People:
    create_people_collection: null
```

```
dot ./create-people-collection.yaml
dot ./create-people-collection.yaml --dry-run
```

## File-Based Commands

Run any `dot` command from a YAML or JSON file instead of typing complex arguments inline. This is especially useful for XCM messages and other deeply nested call data.

### File format

Files use a required category wrapper (`tx`, `query`, `const`, or `apis`) with an optional `chain` field:

```yaml
chain: paseo-people          # optional, overridable with --chain
tx:                           # category: tx, query, const, or apis
  PolkadotXcm:               # pallet name
    send:                     # call / storage item / constant / api method
      dest: ...               # arguments (named or positional)
      message: ...
```

### Running from a file

```bash
# Run a transaction from a YAML file
dot ./transfer.xcm.yaml --from alice --dry-run

# Encode only (no signing)
dot ./transfer.xcm.yaml --encode

# Override the chain from the file
dot ./transfer.xcm.yaml --chain paseo --from alice

# JSON files also work
dot ./remark.json --encode
```

All existing flags work: `--from`, `--dry-run`, `--encode`, `--to-yaml`, `--to-json`, `--json`, `--chain`, `--output`, `--wait`, `--ext`, etc.

### Variable substitution

Files support shell-style `${VAR}` placeholders with optional defaults via `${VAR:-default}`.

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

Variables are resolved in this order (first match wins):

1. `--var KEY=VALUE` flags (highest priority)
2. Environment variables
3. `vars:` section in the file (defaults)

```bash
# Uses defaults from vars section
dot ./transfer.yaml --from alice

# Override with --var
dot ./transfer.yaml --var AMOUNT=2000000000000 --from alice

# Override via environment
AMOUNT=5000000000000 dot ./transfer.yaml --from alice
```

Hex values passed via `--var` are preserved as-is, including leading zeros. This is important for encoded call data in XCM `Transact` instructions or similar byte-array fields:

```bash
# Encode a remark, then embed it in an XCM Transact via --var
CALL=$(dot polkadot.tx.System.remark 0xdead --encode)
dot ./xcm-transact.yaml --var CALL=$CALL --encode
```

### Examples for each category

**Transaction (tx):**

```yaml
tx:
  System:
    remark:
      - "0xdeadbeef"
```

**Storage query:**

```yaml
chain: polkadot
query:
  System:
    Account:
      - "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
```

**Constant lookup:**

```yaml
chain: polkadot
const:
  Balances:
    ExistentialDeposit:
```

**Runtime API call:**

```yaml
chain: polkadot
apis:
  Core:
    version:
```

### XCM transfer examples

File-based commands are especially useful for XCM transfers. The following examples use `polkadot-asset-hub` as the source chain.

**Teleport DOT** from Asset Hub to the Polkadot relay chain (1 DOT = 10,000,000,000 planck):

```yaml
# teleport-dot.xcm.yaml — Teleport 1 DOT to relay chain
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

**Reserve transfer USDC** from Asset Hub to Hydration (parachain 2034). USDC is asset ID 1337 on Asset Hub with 6 decimals (10 USDC = 10,000,000):

```yaml
# reserve-transfer-usdc.xcm.yaml — Reserve transfer 10 USDC to Hydration
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

**Remote execution** via `PolkadotXcm.send` — see [`transfer.xcm.yaml`](transfer.xcm.yaml) for a full example that constructs an XCM program with `WithdrawAsset`, `BuyExecution`, `Transact`, `RefundSurplus`, and `DepositAsset`.

```bash
# Teleport DOT
dot ./teleport-dot.xcm.yaml --from alice --dry-run

# Reserve transfer USDC
dot ./reserve-transfer-usdc.xcm.yaml --from alice --dry-run

# Encode without submitting
dot ./teleport-dot.xcm.yaml --encode
```

> **Teleport vs reserve transfer**: Teleports burn assets on the source and mint on the destination — used between chains that trust each other (e.g. Asset Hub and the relay chain). Reserve transfers lock assets on the source (the reserve) and mint derivatives on the destination — used for assets like USDC where Asset Hub holds the real tokens.

### File detection

A first argument is treated as a file when it:

- Ends with `.json`, `.yaml`, or `.yml`
- Starts with `./` or `/`

Otherwise, the normal dot-path syntax is used.

## Hash

Compute cryptographic hashes commonly used in Substrate. Runs offline — no chain connection required.

### Supported algorithms

| Algorithm | Output | Description |
|-----------|--------|-------------|
| `blake2b256` | 32 bytes | BLAKE2b with 256-bit output |
| `blake2b128` | 16 bytes | BLAKE2b with 128-bit output |
| `keccak256` | 32 bytes | Keccak-256 (Ethereum-compatible) |
| `sha256` | 32 bytes | SHA-256 |
| `twox64` | 8 bytes | XXH64 with seed 0 (Substrate twox64) |
| `twox128` | 16 bytes | XXH64 with seeds 0,1 (Substrate pallet/storage prefix) |
| `twox256` | 32 bytes | XXH64 with seeds 0,1,2,3 (Substrate twox256) |

### Hash inline data

Pass hex-encoded bytes (with `0x` prefix) or plain text (UTF-8 encoded):

```
dot hash blake2b256 0xdeadbeef
# Output:
# 0xf3e925002fed7cc0ded46842569eb5c90c910c091d8d04a1bdf96e0db719fd91

dot hash sha256 hello
# Output:
# 0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
```

### Hash a file

Read raw file contents and hash them:

```
dot hash keccak256 --file ./data.bin
```

### Hash from stdin

Pipe data into the hash command:

```
echo -n "hello" | dot hash sha256 --stdin
# Output:
# 0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
```

### JSON output

```
dot hash blake2b256 0xdeadbeef --json
# Output:
# {
#   "algorithm": "blake2b256",
#   "input": "0xdeadbeef",
#   "hash": "0xf3e925002fed7cc0ded46842569eb5c90c910c091d8d04a1bdf96e0db719fd91"
# }
```

### Build a Substrate storage key with twox

Substrate keys for pallet storage are `twox128(palletName) ++ twox128(itemName) [++ hasher(key)]`. Compose them with `dot hash twox128` and read the raw value via the JSON-RPC passthrough:

```
dot hash twox128 System
# Output:
# 0x26aa394eea5630e07c48ae0c9558cef7

PALLET=$(dot hash twox128 System)
ITEM=$(dot hash twox128 Number)
dot polkadot.rpc.state_getStorage "${PALLET}${ITEM:2}"
```

Run `dot hash` with no arguments to see all available algorithms and examples.

## Sign

Sign arbitrary messages with an account keypair. Output is a `Sr25519(0x...)` value directly usable as a `MultiSignature` enum argument in transaction calls. Runs offline — no chain connection required.

### Sign inline data

Pass hex-encoded bytes (with `0x` prefix) or plain text (UTF-8 encoded):

```
dot sign "hello world" --from alice
# Output:
#   Type:       Sr25519
#   Message:    0x68656c6c6f20776f726c64
#   Signature:  0x4283a3bbae463c39264ca193b1bcce61702794e54e482bc2e46202c85ef6a5446750e81db57cd28af4ffd5c69aadcf5b2b3068972e0cdcb68e51db0ff600d786
#   Enum:       Sr25519(0x4283a3bbae463c39264ca193b1bcce61702794e54e482bc2e46202c85ef6a5446750e81db57cd28af4ffd5c69aadcf5b2b3068972e0cdcb68e51db0ff600d786)

dot sign 0xdeadbeef --from alice
```

The `Enum` value is directly pasteable into tx arguments as a `MultiSignature` value.

### Sign a file

Read raw file contents and sign them:

```
dot sign --file ./payload.bin --from alice
```

### Sign from stdin

Pipe data into the sign command:

```
echo -n "hello" | dot sign --stdin --from alice
```

### JSON output

```
dot sign "hello" --from alice --json
# Output:
# {
#   "type": "Sr25519",
#   "message": "0x68656c6c6f",
#   "signature": "0x5a058160b62eeb6c1194116d4613489e9c310075478c544761b9c8198d3fdb38...",
#   "enum": "Sr25519(0x5a058160b62eeb6c1194116d4613489e9c310075478c544761b9c8198d3fdb38...)"
# }
```

Returns a JSON object with `type`, `message`, `signature`, and `enum` fields.

### Signature type

The `--type` flag selects the signature algorithm (default: `sr25519`):

```
dot sign "hello" --from alice --type sr25519
```

Currently only `sr25519` is supported. Additional types (ed25519, ecdsa) may be added in future releases.

### Use with transactions

The `enum` value in the output is directly pasteable as a `MultiSignature` enum argument. For example, to produce the `candidate_signature` for `PeopleLite.attest`:

```
# 1. Construct the message bytes (prefix + encoded candidate + encoded ring_vrf_key)
# 2. Sign with the candidate's account
dot sign 0x<message_hex> --from candidate-account

# 3. Pass the Enum value as the candidate_signature argument
dot polkadot-people.tx.PeopleLite.attest <candidate> Sr25519(0x...) <ring_vrf_key> ... --from <signer>
```

## Sovereign Accounts (Parachain & Pallet)

`dot account add` accepts derivation flags that compute a deterministic sovereign address and store it as a named watch-only account — reusable in `--from` (for `--unsigned` flows), as a tx argument, and in `dot account list`. Runs offline — no chain connection required.

Two kinds of sovereign:

- **Pallet sovereign** — every FRAME pallet that holds funds (Treasury, Bounties, Crowdloan, Society, NominationPools, ChildBounties, …) declares an 8-byte `PalletId`. The 32-byte account ID is `b"modl"` (4 bytes) + `palletId` (8 bytes) + 20 zero bytes. (`AccountIdConversion::into_account_truncating` with `PalletId::TYPE_ID = b"modl"` from `frame_support`.)
- **Parachain sovereign** — every parachain has a `child` account (its account on the relay chain, `b"para"` prefix) and a `sibling` account (its account on another parachain, `b"sibl"` prefix). Both are 32-byte IDs of the form `prefix (4 bytes)` + `paraId as LE u32 (4 bytes)` + 24 zero bytes.

### Pallet sovereign

PalletId input is either 8 ASCII chars (e.g. `py/trsry`, `py/bount`) or 0x-prefixed hex with exactly 16 hex chars (e.g. `0x70792f7472737279`).

```
dot account add Treasury --pallet-id py/trsry
```

Output:

```
Account Added (watch-only)

  Name:    Treasury
  Address: 5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z
  Source:  pallet py/trsry (0x70792f7472737279)
```

Hex form for the same input:

```
dot account add Treasury --pallet-id 0x70792f7472737279
```

### Parachain sovereign

`--parachain-type` is required — `child` for the parachain's address on the relay chain, `sibling` for its address on another parachain (XCM peer side).

```
dot account add People --parachain 1004 --parachain-type child
dot account add People-Sibling --parachain 1004 --parachain-type sibling
```

Output (child):

```
Account Added (watch-only)

  Name:    People
  Address: 5Ec4AhPaYcfBz8fMoPd4EfnAgwbzRS7np3APZUnnFo12qEYk
  Source:  parachain 1004 (child sovereign)
```

### JSON output

The `derivation` field describes how the address was produced:

```
dot account add Bnt --pallet-id py/bount --json
```

```json
{
  "name": "Bnt",
  "address": "5EYCAe5ijiYdYTM8d3VytEARdH7dFp4rdCPpAsPXrfopdm7d",
  "watchOnly": true,
  "derivation": {
    "kind": "pallet",
    "palletId": "py/bount",
    "palletIdHex": "0x70792f626f756e74"
  }
}
```

For parachain sovereigns, the same field has shape `{ "kind": "parachain", "paraId": 1004, "type": "child" }`.

### Discovering a chain's PalletId

Pallets that need a sovereign account expose their `PalletId` as a runtime constant. Read it via the `const` category and feed the hex straight into `--pallet-id`:

```
dot polkadot.const.Treasury.PalletId
```

Output (JSON-quoted hex):

```
"0x70792f7472737279"
```

Pipe into the add command (strip JSON quotes with `tr`):

```
dot account add Treasury --pallet-id "$(dot polkadot.const.Treasury.PalletId | tr -d '"')"
```

Pre-req: metadata cached for the chain (`dot chain update polkadot`). There is no central registry of "well-known" PalletIds — each runtime author picks the 8 bytes when wiring up a pallet's `Config`. The chain's metadata is the authoritative source for that chain's values.

### Constraints

- `--parachain` requires `--parachain-type child|sibling` (no implicit default — picking the wrong one silently produces a different address).
- `--parachain` and `--pallet-id` are mutually exclusive.
- A positional address (`dot account add foo <ss58>`) cannot be combined with derivation flags.
- Derivation flags cannot be combined with `--secret` or `--env` — a derived sovereign has no signing key.

### Legacy `dot parachain` (deprecated)

The earlier standalone `dot parachain <paraId>` command is **preserved for backward compatibility** and prints a deprecation warning to stderr. Stdout is byte-identical to prior releases — pipes such as `dot parachain 2004 --json | jq -r '.child.ss58'` keep working unchanged. Migrate to `dot account inspect --parachain <id> --parachain-type <child|sibling>` at your convenience. Tracked for removal in a future release ([#208](https://github.com/peetzweg/polkadot-cli/issues/208)).

```bash
# Old (deprecated alias — still works, emits stderr warning)
dot parachain 1000 --type child --json

# New
dot account inspect --parachain 1000 --parachain-type child --json
```

## Verifiable (Bandersnatch / Ring-VRF)

`dot verifiable` is a set of composable, unopinionated primitives over the [`verifiablejs`](https://github.com/paritytech/verifiablejs) WASM library (Ring VRF on the Bandersnatch curve): derive member keys, sign, generate and verify ring-VRF proofs, and encode member sets. Every action is **bytes-in, bytes-out** — it takes hex / `--file` / `--stdin` input and supports `--output json`, so it pipes together and composes with any data (for example values you fetched on-chain with `dot` beforehand). It does no automated fetching or selection and assumes nothing about how the bytes were produced or where they go — feed the resulting signature/proof into a `dot` extrinsic or signed extension, or use it elsewhere. Runs offline.

### Two concepts you must not conflate

```
Mnemonic ─BIP39─▶ entropy ─keyed blake2b─▶ member entropy ─▶ member key / secret
                           (key = --entropy-key)                  │
                                       ring proof: one_shot(…, --context, --message)
```

- **`--entropy-key <text|0xhex>`** — the key mixed into the keyed-blake2b that turns your mnemonic into the Bandersnatch member entropy. **Omit** it for a **lite** person (unkeyed); use **`candidate`** for a **full** person. It must match the key used when the member was recognised on-chain, or you derive a different (unrecognised) member key. It is **not** an sr25519 derivation path and **not** the ring `--context`. (The value is the raw UTF-8 — or hex — bytes of the blake2b key.)
- **`--context <text|0xhex>`** — the **32-byte ring/proof namespace** (e.g. `"dotns"`), zero-padded right to 32 bytes like Solidity `bytes32()`. It determines the alias and is the verifiablejs `context` parameter. Used by `alias` / `prove` / `verify`.

> **Migration (breaking):** previously `dot verifiable <account> --context candidate` used `--context` as the entropy-derivation key. That key is now `--entropy-key`, and `--context` means the ring context. For one release the old form still works on the member command (with a deprecation warning); switch to `--entropy-key`.

### Member keys

```
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

### Alias, sign, prove, verify

```
# Alias for a ring context (deterministic in entropy + context)
dot verifiable alias alice --entropy-key candidate --context dotns

# Standalone Bandersnatch signature (64 bytes), and verify it
dot verifiable sign alice --message "hello" --entropy-key candidate
dot verifiable verify-sig --signature 0x… --member 0x… --message "hello"

# SCALE-encode a ring, prove membership bound to a challenge, verify locally
dot verifiable members 0x<key> 0x<key> --output json
dot verifiable prove alice --entropy-key candidate --context dotns \
    --message 0x… --members 0x… --output json
dot verifiable verify --proof 0x… --context dotns --message 0x… --members 0x…
# verify / verify-sig exit non-zero if the proof / signature does not validate
```

`prove` and `verify` accept the ring either as SCALE-encoded `--members` or as a 768-byte `--root` (commitment). `--members`/`--root`/`--proof` also accept a file path instead of inline hex.

### Saved member keys

Member-key derivation saves the result to the account store for stored accounts. They appear in `dot account inspect` output:

```
Account Info

  Name:             my-account
  Public Key:       0x44a9...eb0f
  SS58:             5DfhGyQ...
  Bandersnatch:     0xabc1...
               (candidate) 0xdef2...
  Prefix:           42
```

When creating a new account with `dot account create`, both the unkeyed and `candidate` member keys are derived and saved. For dev accounts (alice, bob, etc.), use `dot verifiable` directly.

### Requirements

- Account must have a BIP39 mnemonic (not a hex seed or watch-only)
- Dev accounts share the same mnemonic and therefore produce the same member keys
- Both 12-word and 24-word mnemonics are supported — blake2b256 normalizes any input to 32 bytes

Run `dot verifiable` with no arguments to see the full action/option list and the derivation diagram.

## Shell Completions

Generate shell completion scripts for tab-completing subcommands, chain names, pallet names, and item names. Completions use cached metadata — no network calls are made.

### Setup

```
# zsh — add to ~/.zshrc
eval "$(dot completions zsh)"

# bash — add to ~/.bashrc
eval "$(dot completions bash)"

# fish — save to completions directory
dot completions fish > ~/.config/fish/completions/dot.fish
```

Then restart your shell or source the config file.

### What completes

Once installed, press Tab to complete at any point:

```
dot qu<Tab>              # → query
dot query.<Tab>          # → query.System, query.Balances, ...
dot query.System.<Tab>   # → query.System.Account, query.System.Number, ...
dot apis.<Tab>           # → apis.Core, apis.Metadata, ...
dot apis.Core.<Tab>      # → apis.Core.version, ...
dot polkadot.<Tab>       # → polkadot.query, polkadot.tx, ..., polkadot.apis
dot polkadot.query.<Tab> # → polkadot.query.System, ...
dot --chain <Tab>        # → polkadot, paseo, ...
dot --from <Tab>         # → alice, bob, ..., stored account names
dot --output <Tab>       # → pretty, json
dot chain <Tab>          # → add, remove, update, list
dot account <Tab>        # → create, import, derive, list, remove, ...
dot hash <Tab>           # → blake2b256, blake2b128, keccak256, sha256, twox64, twox128, twox256
```

Completions are context-aware:

- `query.` shows only pallets with storage items
- `tx.` shows only pallets with calls
- `const.` shows only pallets with constants
- `events.` shows only pallets with events
- `errors.` shows only pallets with errors
- `apis.` shows runtime API names
- `--` after a tx dotpath includes `--from`, `--dry-run`, `--encode`, `--wait`
- `--` after a query dotpath includes `--dump`

Chain prefix paths work at any depth: `polkadot.query.System.Account` completes each segment individually.

### How it works

The shell completion script calls a hidden `dot __complete` command on every Tab press. This command loads config and cached metadata from `~/.polkadot/` (no network), generates candidates, and prints them to stdout. The shell then presents the matches.

If metadata is not cached for a chain, pallet and item completions are skipped — categories, commands, and chain names still complete.

## Getting Help

Every command supports `--help` to show its detailed usage, available actions, and examples:

```
dot --help              # global help with all commands
dot account --help      # same as `dot account` — shows account actions
dot chain --help        # same as `dot chain` — shows chain actions
dot hash --help         # same as `dot hash` — shows algorithms and examples
```

### Item-level help

Use `--help` on any fully-qualified dot-path to see metadata detail (argument types, documentation) and category-specific usage hints. The chain is required (so the CLI knows which metadata to load), but the call itself runs offline from the cache.

```
dot polkadot.tx.System.remark --help
```

```
── System.remark (Call) ──

  Args: (remark: Vec<u8>)

  Make some on-chain remark.

Usage:
  dot tx.System.remark --from <account>
  dot tx.System.remark --encode

Options:
  --from <name>    Account to sign with
  --dry-run        Estimate fees without submitting
  --encode         Encode call to hex without signing
  --ext <json>     Custom signed extension values as JSON
  -w, --wait       Resolve at: broadcast, best-block, finalized (default)
```

Other categories work the same way:

```
dot polkadot.query.System.Account --help                # storage type, key/value info, query options
dot polkadot.const.Balances.ExistentialDeposit --help   # constant type and docs
dot polkadot.events.Balances.Transfer --help            # event fields and docs
dot polkadot.errors.Balances.InsufficientBalance --help # error docs
dot polkadot.apis.Core.version --help                   # runtime API method signature and docs

# The --chain flag is equivalent
dot tx.System.remark --help --chain polkadot
```

For `tx` commands, omitting both `--from` and `--encode` shows this same help output instead of an error — so you can explore calls without remembering the exact flags:

```
dot polkadot.tx.System.remark 0xdead   # shows call help (no error)
```

## Global Options

These flags work with any command:

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

```
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

```
dot polkadot.tx.System.remark 0xdead --encode --json
# Output:
# {
#   "callHex": "0x000008dead"
# }
```

For transaction submission, `--json` emits NDJSON (one JSON object per lifecycle event):

```
dot polkadot.tx.System.remark 0xdead --from alice --json
# {"event":"signed","txHash":"0x..."}
# {"event":"broadcasted","txHash":"0x..."}
# {"event":"finalized","blockNumber":123,"blockHash":"0x...","ok":true,"events":[...]}
```

### Pipe-safe output

All commands follow Unix conventions: **data goes to stdout, progress goes to stderr**. This means you can safely pipe `--json` into `jq` or other tools without progress messages ("Fetching metadata...", spinner output, "Connecting...") corrupting the data stream:

```
dot polkadot.const.System.SS58Prefix --json | jq '.+1'
dot polkadot.query.System.Number --json | jq
dot chain list --json | jq '.chains[].name'
dot account list --json | jq '.stored[].address'
dot inspect polkadot --json | jq '.pallets[] | select(.events > 10) | .name'
```

In an interactive terminal, both streams render together so you see progress and results normally.

## Update Notifications

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

## Environment Compatibility

The CLI works in Node.js (v22+), Bun, and sandboxed runtimes (e.g. LLM tool-use / MCP environments). WebSocket connections use the native `WebSocket` implementation provided by the runtime — no external WebSocket package is required.

## Configuration

Config and metadata caches live in `~/.polkadot/` by default:

```
~/.polkadot/
├── config.json          # configured chains
├── accounts.json        # stored accounts
├── update-check.json    # cached update check result
└── chains/
    └── polkadot/
        ├── metadata.bin              # cached SCALE-encoded metadata
        └── metadata.fingerprint.json # runtime fingerprint (specVersion, codeHash, …) for stale-metadata detection
```

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

For secrets that should never hit disk at all, combine workspaces with `--env` secret sources.

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

Set the `DOT_HOME` environment variable to point at a different directory. When set, the CLI reads and writes **everything** (config, accounts, metadata, update cache) under that path — no `.polkadot` suffix is appended. `DOT_HOME` takes precedence over both local workspace discovery and the global `~/.polkadot`.

```bash
# Scratch directory for experimentation — never touches ~/.polkadot
DOT_HOME=/tmp/dot-scratch dot account create throwaway

# Repo-local state
export DOT_HOME="$PWD/.dot"
dot chain add local --rpc ws://localhost:9944
```

Typical uses: throwaway commands that shouldn't touch real accounts, CI jobs that need isolated state, and switching between profiles (mainnet vs. local-dev) by changing one env var. The project's own test fixture (`runCli`) uses this mechanism.

Empty-string `DOT_HOME=""` is treated as unset and falls back to `$HOME/.polkadot` — a shell-quoting slip can't send writes to `/`.
