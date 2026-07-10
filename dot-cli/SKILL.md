---
name: dot-cli
description: >
  Guide for using the `dot` CLI (polkadot-cli) to interact with Polkadot/Substrate chains.
  Use when the user works with Substrate-based blockchains — querying storage, submitting
  transactions, calling runtime APIs, raw JSON-RPC calls, managing chain connections, or
  scripting multi-chain setups. Triggers: user mentions `dot` CLI, polkadot-cli,
  Substrate chain queries, extrinsic submission, runtime APIs, JSON-RPC, `system_health`
  / `chain_getBlock` / `rpc_methods`, XCM, asset pools, chain setup scripts using `dot`,
  or isolated per-directory `dot` workspaces (`dot init`, `dot which`, `.polkadot/`).
---

# dot CLI (polkadot-cli)

Unified CLI for Polkadot/Substrate chains. Install: `npm install -g polkadot-cli@latest`

## Core Pattern

```
dot [chain.]<category>[.Pallet[.Item]] [args] [options]
```

Categories: `query`, `tx`, `apis`, `const`, `events`, `errors`, `extensions`, `rpc`

Top-level commands: `dot inspect`, `dot metadata`, `dot chain`, `dot account`, `dot sign`, `dot hash`, `dot verifiable`, `dot init`, `dot which`.

State (accounts, custom chains, metadata cache) lives in a config root resolved per run: `DOT_HOME` env var → a local `.polkadot/` workspace discovered from cwd → global `~/.polkadot`. Run `dot which` to see which one is active, and see [Local Workspaces](#local-workspaces) for isolated per-directory setups. Set `DOT_DRY_RUN=1` to force every extrinsic to dry-run instead of submitting (see [Submitting Transactions](#submitting-transactions)).

Omit deeper levels to discover what's available. Always include the chain prefix:

```bash
dot polkadot.query                # list pallets with storage
dot polkadot.query.Balances       # list storage items in Balances
dot polkadot.apis                 # list runtime APIs
dot polkadot.apis.Core            # list methods in an API
```

## Chain Management

Polkadot, Paseo, and all system parachains ship preconfigured. Add custom chains by RPC:

```bash
dot chain add kusama --rpc wss://kusama-rpc.polkadot.io
# Output:
# ✓ Added kusama
# Updating metadata for kusama...
# ✓ kusama
```

**Naming convention:** name relay chains `{relay}` and parachains `{relay}-{parachain}` (e.g. `kusama-asset-hub`, `polkadot-bridge-hub`) — the same pattern the preconfigured chains use. Use `--relay` to attach a parachain to its relay; the parachain ID is auto-detected from `ParachainInfo` (override with `--parachain-id`). The relay prefix keeps chains distinct (parachain IDs collide across relays — Asset Hub is `1000` on both Polkadot and Paseo) and makes the `dot chain list` tree match the names. Use lowercase, hyphen-separated names (they resolve case-insensitively):

```bash
dot chain add kusama-asset-hub --rpc wss://asset-hub-kusama-rpc.polkadot.io --relay kusama --parachain-id 1000
# Then select it by name:
dot kusama-asset-hub.query.System.Number
```

List configured chains; the default output is a compact tree with relay/parachain structure only. Pass `-v` to also print RPC endpoints, or use `dot chain info <name>` for full per-chain detail:

```bash
dot chains                        # compact tree of names + parachain IDs
dot chains -v                     # same tree + RPC endpoints inline
dot chain info polkadot           # rpc, parachains, metadata cache status
dot chain polkadot                # bare-noun shortcut for `chain info polkadot`
dot chain info polkadot --json    # structured object; metadata: null when not cached
```

`dot chain <name>` falls through to `chain info` when `<name>` isn't a known action verb (`add`/`remove`/`update`/`list`/`export`/`import`/`info`). Use this to check whether metadata is cached before scripted queries:

```bash
dot chain info polkadot --json | jq -r '.metadata.specVersion // "uncached"'
# Output (after `dot chain update polkadot`):
# 1003000
```

Every chain-consuming command needs an explicit chain — prefer the dotpath prefix:

```bash
# Recommended — chain prefix
dot polkadot.query.System.Number
# Output:
# 31014744

# Equivalent — --chain flag
dot query.System.Number --chain polkadot
# Output:
# 31014744
```

**Critical gotcha:** Don't combine `--chain <name>` with `--rpc <url>` pointing at a different chain. The metadata cache is keyed by chain name, not RPC URL, so the CLI will decode against stale metadata and silently produce wrong results. Register a fresh alias instead:

```bash
# WRONG — polkadot metadata decoded against a Kusama RPC
dot inspect --chain polkadot --rpc wss://kusama-rpc.polkadot.io

# CORRECT — register, then use the prefix
dot chain add my-ah --rpc wss://example.com/asset-hub
dot inspect my-ah
```

## Querying Storage

```bash
# Plain storage value
dot polkadot.query.System.Number
# Output:
# 31014744

# Map lookup — Alice's balance on Polkadot
dot polkadot.query.System.Account 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
# Output:
# {
#   "nonce": 0,
#   "consumers": 0,
#   "providers": 0,
#   "sufficients": 0,
#   "data": { "free": "0", "reserved": "0", "frozen": "0", "flags": "..." }
# }

# Asset metadata — numeric key on Asset Hub
dot polkadot-asset-hub.query.Assets.Metadata 1984
# Output:
# {
#   "deposit": "2008200000",
#   "name": "Tether USD",
#   "symbol": "USDt",
#   "decimals": 6,
#   "is_frozen": false
# }

# Dump all entries of a map
dot paseo-asset-hub.query.AssetConversion.Pools --dump

# JSON output (pipe-safe)
dot polkadot.query.System.Number --json
# Output:
# 31014744
```

Queries default to the latest finalized head. Pass `--at <block-hash|best|finalized>` for historical or non-finalized state reads. Also applies to `apis.*` runtime calls. Tx submission accepts only a block hash or `finalized` — not `best`.

```bash
# Read at the chain head (best, non-finalized) or pin to the latest finalized block
dot polkadot.query.System.Number --at best
HASH=$(dot polkadot.rpc.chain_getFinalizedHead | tr -d '"')
dot polkadot.query.System.Number --at "$HASH"
# Same flag on runtime APIs
dot polkadot.apis.Core.version --at "$HASH" --json | jq .spec_version
```

papi v2's `chainHead_v1_*` JSON-RPC only serves *pinned* (recent) blocks. For
deep historical reads, point `--rpc` at an archive node. If `--at <hash>` hits
an unavailable block, the CLI surfaces a clean error with a copy-pasteable
`--rpc wss://<archive>` example — exit code 1.

### Handling `undefined` — Critical for Scripting

Queries return the literal string `undefined` (not valid JSON) when a key doesn't exist. Always guard before piping to `jq`:

```bash
ID=999999999  # an asset id we know doesn't exist
RESULT=$(dot polkadot-asset-hub.query.Assets.Asset "$ID")
if [ "$RESULT" == "undefined" ]; then
  echo "not found"
fi
# Output:
# not found
```

Three-way semantics:

| Substrate state | dot output | Meaning |
|---|---|---|
| Key has value | `{...}` / `"..."` / number | Normal result |
| Key exists, value is None | `null` | Option::None |
| Key doesn't exist | `undefined` | Storage key absent |

**u128 / big numbers** are returned as quoted strings (`"1000000000000000000"`) due to JS precision limits. Strip quotes for bash comparison: `VALUE=$(... | tr -d '"')`

## Submitting Transactions

```bash
# Dry-run a transfer — no broadcast, just estimate fees. The Decode block
# renders the call as indented JSON under the `Pallet.call` header, so even
# deeply nested calls (Sudo, batch, XCM) stay readable.
dot polkadot.tx.Balances.transfer_keep_alive 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty 1000000000 --from alice --dry-run
# Output:
#   Chain:  polkadot
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x050300...02286bee
#   Decode: Balances.transfer_keep_alive
#     {
#       "dest": { "type": "Id", "value": "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty" },
#       "value": 1000000000
#     }
#   Estimated fees: 158403157

# Submit (omit --dry-run). Method names are snake_case as defined in the runtime.
dot polkadot.tx.Balances.transfer_keep_alive bob 1000000000 --from alice
```

**Global dry-run safety net.** Set the `DOT_DRY_RUN` env var (truthy: `1`/`true`/`yes`/`on`) to force EVERY tx to dry-run instead of submitting — handy when scripting or demoing so nothing accidentally lands on-chain. A hint is printed to stderr (stdout stays clean for `--json`):

```bash
DOT_DRY_RUN=1 dot polkadot.tx.System.remark 0xdeadbeef --from alice
# stderr: ⚠ DOT_DRY_RUN is set — extrinsics will be simulated, not submitted.
# stdout: the dry-run report (no broadcast)
```

Precedence: an explicit flag wins — `--dry-run` forces dry-run, `--no-dry-run` forces a real submission even with `DOT_DRY_RUN=1`. Decode-only paths (`--encode`, `--to-yaml`, `--to-json`) are unaffected.

### Encoding Calls (for Sudo, XCM, Batch)

`--encode` returns raw call hex without signing — use for wrapping:

```bash
# Encode an inner call, then wrap with Sudo
CALL=$(dot paseo-asset-hub.tx.System.remark 0xdeadbeef --encode)
echo "$CALL"
# Output:
# 0x000010deadbeef

dot paseo-asset-hub.tx.Sudo.sudo "$CALL" --from alice --dry-run
# Output:
#   Chain:  paseo-asset-hub
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0xfb00000010deadbeef
#   Decode: Sudo.sudo
#     {
#       "call": { "type": "System", "value": { "type": "remark", "value": { "remark": "0xdeadbeef" } } }
#     }
#   Estimated fees: 7424769
```

### Tipping and Other Transaction Options

Use `--tip` to set a priority tip in plancks. `--nonce`, `--mortality`, and `--at` are also available; see the README's "Transaction options" section.

```bash
dot polkadot.tx.System.remark 0xdead --from alice --tip 1000000 --dry-run
```

For non-standard signed extensions, override with `--ext '{"<Identifier>":{"value":<v>}}'`. List the chain's extensions with `dot <chain>.extensions`.

## Runtime APIs

First-class access to runtime APIs — most Substrate CLIs don't expose these:

```bash
# Runtime version on Polkadot
dot polkadot.apis.Core.version --json
# Output:
# {
#   "spec_name": "polkadot",
#   "impl_name": "parity-polkadot",
#   "spec_version": 2002001,
#   "transaction_version": 26,
#   ...
# }

# Pool reserves on Asset Hub: native (DOT) ↔ USDt (asset id 1984)
dot polkadot-asset-hub.apis.AssetConversionApi.get_reserves \
  '{"parents":1,"interior":{"type":"Here"}}' \
  '{"parents":0,"interior":{"type":"X2","value":[{"type":"PalletInstance","value":50},{"type":"GeneralIndex","value":"1984"}]}}' \
  --json
# Output (live; reserves change with each swap):
# [
#   "801299477230750",
#   "99382392973"
# ]
```

Call a method without args to see its signature, or use `--help`.

## Raw JSON-RPC

Runtime APIs and storage cover everything the runtime exposes; the `rpc` category covers what the **node** exposes outside the runtime — `system_*` (sync state, peers, version), `chain_*` (blocks/headers/finalized head), `state_*` (raw storage, key iteration, runtime version), `author_*` (mempool, key management), `payment_*` (fee estimation), consensus families (`babe_*`, `grandpa_*`, `mmr_*`, `beefy_*`), and the new spec families (`chainSpec_v1_*`, `archive_v1_*`, `rpc_methods`).

Methods are discovered per-chain via the `rpc_methods` JSON-RPC call and cached. Use it when the user asks for things like "is the node synced?", "what block hash is at height N?", "what's in the mempool?", or "fee estimate for this encoded tx?":

```bash
# List the methods this node exposes, grouped by family
dot polkadot.rpc

# Sync / health
dot polkadot.rpc.system_health --json
# Output:
# {
#   "peers": 131,
#   "isSyncing": false,
#   "shouldHavePeers": true
# }

# Block hash by height (returns latest if no arg)
dot polkadot.rpc.chain_getBlockHash 1000
# Output:
# "0xcf36a1e4a16fc579136137b8388f35490f09c5bdd7b9133835eba907a8b76c30"

# Mempool snapshot — list pending extrinsics
dot polkadot.rpc.author_pendingExtrinsics --json | jq length

# Fee estimate for an already-encoded extrinsic
ENCODED=$(dot polkadot.tx.System.remark 0xdead --from alice --encode)
dot polkadot.rpc.payment_queryInfo "$ENCODED" --json

# Curated --help shows the arg signature and a ⚠️ WRITE tag for state-changing methods
dot polkadot.rpc.author_insertKey --help
```

The `rpc` category is **flat** — there's no pallet level. Form: `[chain.]rpc.<method_name>` (underscores stay in the single segment, e.g. `polkadot.rpc.chain_getBlock`).

Subscription methods (`*_subscribe*`, `chainHead_v1_follow`, `transaction_v1_*`) appear in tab-completion but error out as one-shots — they need a follow session. About 50 well-known methods carry curated descriptions and arg names; any other method the node reports is callable via raw passthrough. Use `dot polkadot.rpc --refresh` to re-discover after a node upgrade.

### Complex Arguments (Location, enums)

Enum-shaped args — including XCM `Location` / `VersionedLocation` and most pallet enums — are passed as JSON with `{type, value}` shape. `type` names the variant; `value` is the inner data (may be another `{type, value}`, an array, or a primitive). See [references/scripting-patterns.md](references/scripting-patterns.md) for the bash-quoting pattern when interpolating variables into Location JSON.

Tips for discovering the exact shape a runtime expects:

- Run `--dump` on a related storage map that uses the same type and read back an existing entry.
- `dot inspect <chain>.<Pallet>.<Item>` prints the full type for a storage item.

## Full Metadata Dump

`dot metadata <chain>` prints the chain's runtime metadata as one structured JSON blob — pallets (with calls, events, errors, storage, constants), runtime APIs, transaction extensions, and a runtime fingerprint header. Use this when you (or an agent) want a single source of truth for what's available on a chain instead of walking `dot inspect` piecemeal.

`metadata` is a top-level command — there is no chain-prefix form. Pass the chain name as a positional argument.

```bash
# Slice with jq — list all Balances call names
dot metadata polkadot | jq -r '.pallets[] | select(.name=="Balances") | .calls[].name'
# Output:
# burn
# force_adjust_total_issuance
# force_set_balance
# ...
# transfer_keep_alive
# upgrade_accounts

# Other useful flags
dot metadata polkadot --raw      # SCALE-encoded bytes as 0x… hex
dot metadata polkadot --cached   # use cached metadata, no network round-trip
```

The default fetch always hits the chain and updates the local fingerprint sidecar. Pair with `--raw` if you want the canonical SCALE bytes; the JSON form is decoded and includes docs.

## Inspect / Explore

`inspect` is a top-level command, **not** a dotpath category. `dot <chain>.inspect...` does not parse. The recommended form puts the chain on the *target*:

Output is **width-aware**: short signatures stay on one line, long ones expand across multiple lines with field names aligned by colon. Composite values are color-coded when stdout is a TTY; piped output stays plain.

```bash
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

# Storage item detail — Type/Key/Value on separate lines, composite values expand
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

# Long call signatures expand across lines
dot inspect polkadot.Referenda.submit
# Output:
# Referenda.submit (Call)
#
#   Args: (
#     proposal_origin : system | Origins | ParachainsOrigin | XcmPallet,
#     proposal        : Legacy | Inline | Lookup,
#     enactment_moment: At | After,
#   )
#   ...

# To list all pallets on a chain, use --chain (a single positional is read as a pallet name)
dot inspect --chain polkadot
```

A single positional arg is always treated as a pallet name, so `dot inspect polkadot` does **not** list pallets on the `polkadot` chain — use `--chain polkadot` for that.

Enum-variant visibility: enums up to **24 variants** now show variant names inline (e.g. `system | Origins | ParachainsOrigin | XcmPallet`). Only enums with more than 24 variants collapse to `enum(N variants)`. When that summary appears, drill into a storage item that uses the same type with `dot inspect <Pallet>.<Item> --chain <name>` (it'll expand the inner type), or `--dump` a real entry to read back the shape.

## Account Management

```bash
# List dev + stored accounts. Stored accounts are bucketed by kind
# (Signers / Watch-only / Pallet Sovereigns / Parachain Sovereigns); empty
# sections are omitted. Each account: first line is `name  ss58` (clean
# columns for copy-paste). Extra attributes (path, env, pallet-id,
# parachain, parachain-type) render on tree-style continuation lines —
# the labels mirror the `--flag` that sets each value.
dot account list
# Output:
# Dev Accounts
#
#   Alice    5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
#   Bob      5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
#   ...
#
# Signers
#
#   ci-signer    5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy
#      ├─ path: //ci
#      └─ env:  $CI_SECRET
#
# Pallet Sovereigns
#
#   Treasury     5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z
#      └─ pallet-id: py/trsry (0x70792f7472737279)
#
# Parachain Sovereigns
#
#   People       5Ec4AhPaYcfBz8fMoPd4EfnAgwbzRS7np3APZUnnFo12qEYk
#      ├─ parachain:      1004
#      └─ parachain-type: child

# Watch-only — no secret, just a named address
dot account add treasury 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY

# Keyed account from a BIP39 mnemonic (use --secret, or --env to keep it off disk)
dot account add signer --secret "word1 word2 ... word12"
dot account add ci --env SECRET_VAR

# --secret also accepts a 0x 32-byte hex seed or a 0x 64-byte raw sr25519 private
# key (the value `--show-secret` prints). Raw private keys reject --path.
dot account add seeded --secret 0x1111111111111111111111111111111111111111111111111111111111111111
dot account add raw-key --secret 0x<128-hex-char expanded secret>

# Generate a new account
dot account create new-key
# Output:
# Account Created
#
#   Name:          new-key
#   Address:       5HQPcHZ2gUKdJM3JbgFvY8t5PfdkpooH2u2LQrAHZ61dZ57M
#   Mnemonic:      defy ginger general follow use try ...
#
#   Save this mnemonic phrase! It is the only way to recover this account.

# Remove one or more stored accounts (delete and rm are aliases for remove)
dot account remove new-key
dot account delete stale-key-1 stale-key-2
dot account rm stale-key-1 stale-key-2
# Output:
# Account "stale-key-1" removed.
# Account "stale-key-2" removed.
```

Built-in dev accounts: `alice`, `bob`, `charlie`, `dave`, `eve`, `ferdie`

### Inspecting accounts (and the pallet-revive H160)

`dot account inspect <input>` resolves a name, SS58, hex public key, **or 20-byte H160** and prints the canonical attributes. Every account now also shows its pallet-revive H160 (EIP-55, prefix-independent) — useful when working across SS58 and EVM tooling on Polkadot Hub / Asset Hub:

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

# Reverse — a 20-byte H160 resolves to the deterministic fallback AccountId32 (H160 || 0xEE * 12)
dot account inspect 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D
# Output:
#   Kind:        revive H160 fallback
#   Public Key:  0x9621dde636de098b43efb0fa9b61facfe328f99deeeeeeeeeeeeeeeeeeeeeeee
#   SS58:        5FTZ6n1wY3GBqEZ2DWEdspbTarvRnp8DM8x2YXbWubu7JN98
#   H160:        0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D

# Script: extract just the H160 for a given account
dot account inspect alice --json | jq -r .h160
# 0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D

# --show-secret reveals the 64-byte sr25519 private key, plus the stored
# mnemonic/seed for accounts backed by a phrase or hex seed. Dev accounts and
# raw-key imports show only the Private Key; env-backed secrets stay redacted
# (only the $VAR reference is shown).
dot account inspect my-validator --show-secret
#   Mnemonic:    word1 word2 ... word12   (only for phrase-backed accounts)
#   Private Key: 0x<128 hex chars>        (sr25519 expanded, 64 bytes — never share)

# Round-trip: the printed Private Key re-imports as a usable signer
SECRET=$(dot account inspect dave --show-secret --json | jq -r .privateKey)
dot account add raw-dave --secret "$SECRET"   # same address as dave, can sign
```

Mapping rule (offline, matches current `polkadot-sdk` master): if the last 12 bytes of the AccountId32 are `0xEE` the H160 is the first 20 bytes (eth-derived); otherwise `keccak256(accountId32)` and take the last 20. The reverse direction always returns the `H160 || 0xEE * 12` fallback — the full mapping after `pallet_revive.map_account` lives in on-chain `AddressSuffix` storage and isn't recoverable offline. Older `stable2412` runtimes used plain `accountId32[..20]` truncation; if you target one, compute manually.

### Sovereign Accounts (Parachain & Pallet)

`dot account add` accepts derivation flags that compute a deterministic 32-byte address and store it as a named watch-only account — reusable in `--from`, as tx args, and in `dot account list`. Offline; no chain connection required.

```bash
# Pallet sovereign — Treasury (PalletId b"py/trsry")
dot account add Treasury --pallet-id py/trsry
# Output:
# Account Added (watch-only)
#
#   Name:    Treasury
#   Address: 5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z
#   Source:  pallet py/trsry (0x70792f7472737279)

# Pallet sovereign — hex PalletId form
dot account add Bounties --pallet-id 0x70792f626f756e74

# Parachain sovereign — `--parachain-type` is REQUIRED (no default)
dot account add People --parachain 1004 --parachain-type child
dot account add People-Sibling --parachain 1004 --parachain-type sibling

# JSON output records the derivation
dot account add Bnt --pallet-id py/bount --json
# {
#   "name": "Bnt",
#   "address": "5EYCAe5ijiYdYTM8d3VytEARdH7dFp4rdCPpAsPXrfopdm7d",
#   "watchOnly": true,
#   "derivation": { "kind": "pallet", "palletId": "py/bount",
#                   "palletIdHex": "0x70792f626f756e74" }
# }
```

**How it derives:**

- **Pallet:** 32-byte AccountId is `b"modl"` (4 bytes) + `palletId` (8 bytes) + 20 zero bytes. PalletId comes from each pallet's `#[pallet::constant] type PalletId` (read with `dot <chain>.const.<Pallet>.PalletId`).
- **Parachain:** 32-byte AccountId is `b"para"` (child) or `b"sibl"` (sibling) + paraId as LE u32 (4 bytes) + 24 zero bytes.

**Discovering a chain's PalletId from metadata:**

```bash
# Pre-req: metadata cached (dot chain update polkadot).
# Output is JSON-quoted hex — strip quotes with tr.
dot account add Treasury --pallet-id "$(dot polkadot.const.Treasury.PalletId | tr -d '"')"
```

**Stateless derivation for scripts (no save):** the same `--pallet-id` /
`--parachain` / `--parachain-type` flags work on `dot account inspect` to
compute and print the address **without** writing to accounts.json. Use this
when you just need the SS58 in a script — no name to invent, no cleanup later.

```bash
# Pretty output
dot account inspect --pallet-id py/trsry --prefix 0
# Account Info
#
#   Kind:        pallet sovereign
#   Public Key:  0x6d6f646c70792f74727372790000000000000000000000000000000000000000
#   SS58:        13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB
#   Source:      PalletId py/trsry (0x70792f7472737279)
#   Prefix:      0

# Just the SS58 (script-friendly)
SS58=$(dot account inspect --pallet-id py/trsry --prefix 0 --json | jq -r .ss58)

# Parachain sovereign
dot account inspect --parachain 1004 --parachain-type child --json | jq -r .ss58
```

Use `account add` to persist (named, reusable in `--from`/tx args, appears in
`dot account list`); use `account inspect` to derive ad-hoc.

**Constraints (will error):** `--parachain` requires `--parachain-type child|sibling`; `--parachain` and `--pallet-id` are mutually exclusive; on `account add`, derivation flags can't combine with a positional address or with `--secret` / `--env`; on `account inspect`, derivation flags can't combine with a positional input.

## Local Workspaces

A `.polkadot/` directory in the cwd (or any parent, git-style walk-up stopping at `$HOME`) becomes the config root for ALL state — accounts, custom chains, metadata cache. Full isolation: the global `~/.polkadot` is invisible while a workspace is active, so the same account name can mean different identities in different directories. Precedence: `DOT_HOME` env var → discovered workspace → global `~/.polkadot`.

```bash
# Orient FIRST: which config root is active here?
dot which
# Output:
# /Users/you/dot/paseo/.polkadot
# Source: local workspace (discovered from current directory)
dot which --json          # {"path":"...","source":"workspace"} — source: workspace | env | global

# Create an isolated per-network setup
mkdir -p ~/dot/mytestnet && cd ~/dot/mytestnet
dot init
# Output:
# Initialized empty dot workspace at /Users/you/dot/mytestnet/.polkadot
# Check which workspace is active with: dot which
dot chain add mytestnet --rpc ws://localhost:9944
dot account create sudo   # this "sudo" exists ONLY in this workspace

# Throwaway session that can never touch ~/.polkadot
tmp=$(mktemp -d) && cd "$tmp" && dot init
# ... scratch accounts, txs ...
rm -rf "$tmp"
```

Gotchas:

- An "Unknown account/chain" error names the config root it searched (`in workspace /path/.polkadot`) — if unexpected, you're in the wrong directory; check `dot which`.
- `dot init` errors on re-init and refuses to run in `$HOME`; it warns when a parent workspace gets shadowed or when a set `DOT_HOME` masks discovery.
- The workspace starts empty (built-in chains still work — they ship with the binary). Nothing is copied from the global config, and no `.gitignore` is written — `accounts.json` holds plain-text secrets, so decide deliberately whether to ignore it.

## Other Commands

```bash
# Sign arbitrary bytes with an account keypair (output is a MultiSignature value)
dot sign "hello world" --from alice
# Output:
#   Type:       Sr25519
#   Message:    0x68656c6c6f20776f726c64
#   Signature:  0x4283a3bbae463c39264ca193b1bcce61702794e54e482bc2e46202c85ef6a544...
#   Enum:       Sr25519(0x4283a3bbae463c39264ca193b1bcce61702794e54e482bc2e46202c8...)

# Compute a hash (algorithms: blake2b256, blake2b128, keccak256, sha256, twox64, twox128, twox256)
dot hash blake2b256 0xdeadbeef
# Output:
# 0xf3e925002fed7cc0ded46842569eb5c90c910c091d8d04a1bdf96e0db719fd91

# Substrate twox128 — pallet/storage prefix (use with `rpc.state_getStorage` to read raw keys)
dot hash twox128 System
# Output:
# 0x26aa394eea5630e07c48ae0c9558cef7

# Execute from a YAML/JSON file
dot ./transfer.yaml --from alice

# Encode a call to YAML (compatible with file-based input)
dot polkadot.tx.System.remark 0xdeadbeef --to-yaml
# Output:
# chain: polkadot
# tx:
#   System:
#     remark:
#       remark: "0xdeadbeef"
```

## Verifiable (Bandersnatch / Ring-VRF)

`dot verifiable` is raw, unopinionated Bandersnatch/Ring-VRF crypto — bytes in, bytes out, no chain knowledge (like `dot sign` is just sr25519). It does no fetching: you supply the members/context/message (e.g. read from chain with `dot` first), and use the resulting signature/proof however you need — e.g. as a value in a `dot` extrinsic or signed extension. All actions take `--output json` and hex / `--file` / `--stdin` input, so they compose.

Two distinct inputs — do not conflate:
- `--entropy-key <text|0xhex>`: keyed-blake2b key turning the mnemonic into member entropy. Omit = lite person; `candidate` = full person. NOT a derivation path, NOT the ring context.
- `--context <text|0xhex>`: the 32-byte ring/proof namespace (zero-padded right, like `bytes32()`). Determines the alias. Used by `alias`/`prove`/`verify`.

```bash
# Member key (who you are in a ring). Omit --entropy-key for a lite person.
dot verifiable alice --entropy-key candidate --json   # { account, memberKey, entropyKey }

# Alias = stable pseudonym for a context (deterministic in entropy + context)
dot verifiable alias alice --entropy-key candidate --context dotns --json

# Sign / verify a plain Bandersnatch signature (64 bytes)
dot verifiable sign alice --message "gm" --entropy-key candidate --json   # { signature, member, ... }
dot verifiable verify-sig --signature 0x… --member 0x… --message "gm"     # exit 0 = valid, 1 = invalid

# Ring proof: encode a ring, prove membership bound to a challenge, verify locally
dot verifiable members 0x<key> 0x<key> --json                             # { members } (SCALE Vec<[u8;32]>)
dot verifiable prove alice --entropy-key candidate --context dotns \
    --message 0x<challenge> --members 0x<members> --json                  # { alias, proof }
dot verifiable verify --proof 0x<proof> --context dotns \
    --message 0x<challenge> --members 0x<members>                         # exit 1 if invalid
# prove/verify accept --root <768-byte commitment> instead of --members; all hex args also accept a file path.
```

## Key Flags

| Flag | Scope | Purpose |
|------|-------|---------|
| `--json` | all | JSON output (but `undefined` and errors may not be JSON) |
| `--from <name>` | tx | Account to sign with |
| `--encode` | tx | Encode to hex, don't sign or submit |
| `--dry-run` / `--no-dry-run` | tx | Force / forbid dry-run (overrides `DOT_DRY_RUN`) |
| `--dump` | query | Dump all entries of a storage map |
| `--ext <json>` | tx | Custom signed extension values |
| `--at <block>` | tx, query, apis | Block hash, `"best"`, or `"finalized"` to read/validate against. Defaults to finalized. Tx submission rejects `"best"`. |

## Common Errors

- **`Incompatible runtime entry RuntimeCall(...)`** — usually a runtime API arg shape mismatch: wrong enum `{type, value}`, or a sized-binary `[u8; N]` passed as something other than `0x`-hex. Re-check the signature by calling `dot <chain>.apis.<Api>.<method>` with no args.
- **`Unknown account or address "X"`** / account has no public key resolved yet — the `--from` name isn't registered. Check `dot account list`, or add it with `dot account add <name> --secret "..."` / `dot account add <name> --env VAR`.
- **`undefined` piped into `jq`** — the literal string `undefined` is not JSON. Guard with `[ "$X" == "undefined" ]` before piping.
- **Decode errors after a runtime upgrade** — metadata cache is keyed by chain name; register a fresh `dot chain add` alias for the upgraded chain rather than reusing the old one.
- **Wasm trap / "validate_transaction" panic on submit** — almost always stale local metadata. The CLI now prints a `⚠ Local metadata for "<chain>" is out of date … Run: dot chain update <chain>` line right after such errors. Run that command and retry. The check uses both `specVersion` and the runtime code hash, so it also catches local-node restarts where the wasm changed but `specVersion` was kept the same. Set `DOT_TRUST_CACHED_METADATA=1` to suppress the check entirely.

## Scripting Patterns

Highlights from [references/scripting-patterns.md](references/scripting-patterns.md):

- `undefined`-guarded check-then-act for idempotent scripts.
- XCM `Location` JSON shape and the bash escaping gotcha (`'"$VAR"'` breaks out of single-quoted JSON to interpolate).
- FixedU128 rate math and u128 arithmetic via `python3` when bash overflows past 2^63.

See the full reference for multi-environment config loaders and batch/sudo composition patterns.
