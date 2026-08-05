# dot CLI — Bash Scripting Patterns

## Table of Contents

- [Idempotent Check-Then-Act](#idempotent-check-then-act)
- [Multi-Environment Config](#multi-environment-config)
- [XCM Locations (JSON Arguments)](#xcm-locations-json-arguments)
- [Encoding Calls for Sudo](#encoding-calls-for-sudo)
- [Big Number Arithmetic](#big-number-arithmetic)
- [FixedU128 Rate Calculation](#fixedu128-rate-calculation)
- [Checking Runtime Capabilities](#checking-runtime-capabilities)
- [Contract Calls as an Ethereum Identity](#contract-calls-as-an-ethereum-identity)
- [Common Gotchas](#common-gotchas)

---

## Idempotent Check-Then-Act

Query on-chain state before acting. The `undefined` check is the core pattern:

```bash
#!/usr/bin/env bash
set -euo pipefail

ASSET_ID=999999999  # an asset id we want to ensure exists

# Check if the asset already exists on Paseo Asset Hub
ASSET=$(dot paseo-asset-hub.query.Assets.Asset "$ASSET_ID")
if [ "$ASSET" == "undefined" ]; then
  echo "Asset not found, creating"
  CALL=$(dot paseo-asset-hub.tx.Assets.force_create "$ASSET_ID" alice true 10 --encode)
  dot paseo-asset-hub.tx.Sudo.sudo "$CALL" --from alice
else
  echo "Asset already exists"
fi
# Output (first run):
# Asset not found, creating
#
# Output (second run):
# Asset already exists
```

For values that need comparison (not just existence), strip quotes off u128 strings:

```bash
ASSET_ID=1984
EXPECTED_RATE="250000000000000000000000"

CURRENT_RATE=$(dot paseo-asset-hub.query.AssetRate.ConversionRateToNative "$ASSET_ID" | tr -d '"')
if [ "$CURRENT_RATE" == "undefined" ]; then
  echo "Rate missing — create it"
elif [ "$CURRENT_RATE" != "$EXPECTED_RATE" ]; then
  echo "Rate is $CURRENT_RATE, want $EXPECTED_RATE — update"
else
  echo "Already correct"
fi
```

## Multi-Environment Config

Pattern: base config + environment-specific overrides loaded by a shared loader.

```bash
# config-base.env
PARACHAIN_ID_ASSET_HUB=1000
PUSD_DECIMALS=6
NATIVE_TOKEN='{"parents":1,"interior":{"type":"Here"}}'

# config-preview.env
RPC_PEOPLE=wss://previewnet.substrate.dev/people
NATIVE_DECIMALS=12
PUSD_ASSET_ID=3
SIGNER_SUDO="alice"

# config-next.env
RPC_PEOPLE=wss://paseo-people-next-rpc.polkadot.io
NATIVE_DECIMALS=10
PUSD_ASSET_ID=50000413
SIGNER_SUDO="people-paseo-sudo"
```

Loader registers chain aliases so scripts use generic names:

```bash
# load-config.sh
source config-base.env
source "config-${ENV}.env"
dot chain add people --rpc "$RPC_PEOPLE" 2>/dev/null || true
# Output (first run):
# ✓ Added people
# Updating metadata for people...
# ✓ people
#
# Output (subsequent runs): empty (already exists, error suppressed)
```

Scripts then use `dot people.query...` regardless of environment.

## XCM Locations (JSON Arguments)

Many pallets use XCM `Location` types as keys. These are JSON objects passed as a single arg:

```bash
# Native token (relay chain asset, from a parachain's perspective)
NATIVE='{"parents":1,"interior":{"type":"Here"}}'

# Local asset on Asset Hub: PalletInstance 50 = Assets pallet, GeneralIndex = asset id
ASSET_ID=1984
LOCAL_ASSET='{
  "parents": 0,
  "interior": {
    "type": "X2",
    "value": [
      {"type": "PalletInstance", "value": 50},
      {"type": "GeneralIndex", "value": "'"$ASSET_ID"'"}
    ]
  }
}'

# Foreign asset on a sibling parachain: Parachain 1000 = Asset Hub
FOREIGN_ASSET='{
  "parents": 1,
  "interior": {
    "type": "X3",
    "value": [
      {"type": "Parachain", "value": 1000},
      {"type": "PalletInstance", "value": 50},
      {"type": "GeneralIndex", "value": "'"$ASSET_ID"'"}
    ]
  }
}'
```

Note the bash string escaping: `'"$VAR"'` breaks out of single-quoted JSON to interpolate `$VAR`, then re-enters the single-quoted region. Without it, single quotes would suppress variable expansion.

Use the result with a runtime API:

```bash
dot polkadot-asset-hub.apis.AssetConversionApi.get_reserves "$NATIVE" "$LOCAL_ASSET" --json
# Output (live; reserves change with each swap):
# [
#   "801299477230750",
#   "99382392973"
# ]
```

## Encoding Calls for Sudo

Privileged calls (`force_create`, `AssetRate.create`, etc.) need root origin. Wrap in Sudo:

```bash
ASSET_ID=1984
RATE=250000000000000000000000

INNER_CALL=$(dot paseo-asset-hub.tx.AssetRate.create "$ASSET_ID" "$RATE" --encode)
echo "$INNER_CALL"
# Output:
# 0x3500...

dot paseo-asset-hub.tx.Sudo.sudo "$INNER_CALL" --from alice --dry-run
# Output:
#   Chain:  paseo-asset-hub
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0xfb35...
#   Decode: Sudo.sudo { call: AssetRate(create(...)) }
#   Estimated fees: ...
```

For batch operations, comma-join the encoded calls:

```bash
A=$(dot paseo-asset-hub.tx.System.remark 0xdeadbeef --encode)
B=$(dot paseo-asset-hub.tx.System.remark 0xcafe --encode)
dot paseo-asset-hub.tx.Utility.batch_all "$A,$B" --from alice --dry-run
# Output:
#   Chain:  paseo-asset-hub
#   From:   alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
#   Call:   0x...
#   Decode: Utility.batch_all { calls: [System(remark(...)), System(remark(...))] }
#   Estimated fees: ...
```

## Big Number Arithmetic

Substrate uses u128 for balances. Bash handles up to 2^63 (~9.2 * 10^18). For amounts within this range, bash arithmetic works:

```bash
NATIVE_DECIMALS=12

# 1000 tokens with 12 decimals = 10^15 (fits in bash)
amount=$(( 1000 * 10**$NATIVE_DECIMALS ))
echo "$amount"
# Output:
# 1000000000000000
```

For values exceeding 10^18 (e.g., FixedU128 rates, total supplies), use python3:

```bash
NATIVE_DECIMALS=12
PUSD_DECIMALS=6

BIG_VALUE=$(python3 -c "print(10**18 * 10**$NATIVE_DECIMALS // (4 * 10**$PUSD_DECIMALS))")
echo "$BIG_VALUE"
# Output:
# 250000000000000000000000
```

## FixedU128 Rate Calculation

`AssetRate.ConversionRateToNative` stores a `FixedU128` with 18 fractional digits. The stored integer represents `rate * 10^18`.

For a conversion rate of "1 token_A = R token_native" in smallest units:

```
stored_value = (smallest_unit_of_asset_in_native) * 10^18
```

Example — pUSD to DOT at 1:4 (1 DOT = 4 pUSD, so 1 pUSD = 0.25 DOT):

```bash
NATIVE_DECIMALS=12
PUSD_DECIMALS=6

# Formula: rate = 10^18 * 10^NATIVE_DEC / (RATIO * 10^PUSD_DEC)
# where RATIO = 4 (how many pUSD per 1 native)
RATE=$(python3 -c "print(10**18 * 10**$NATIVE_DECIMALS // (4 * 10**$PUSD_DECIMALS))")
echo "$RATE"
# Output (preview, native=12, pusd=6):
# 250000000000000000000000      (2.5 * 10^23)
#
# Same formula with native=10, pusd=18:
# 2500000000                    (2.5 * 10^9)
```

## Checking Runtime Capabilities

The CLI emits structured JSON with `--json`, so `jq` covers most introspection needs without dropping into Python.

### List pallets

```bash
dot polkadot.query --json | jq -r '.pallets[].name'
# Output:
# AssetRate
# Auctions
# AuthorityDiscovery
# Authorship
# Babe
# ...
```

### Check if a pallet exists

```bash
dot paseo-asset-hub.query --json | jq '.pallets | map(.name) | contains(["AssetConversion"])'
# Output:
# true

dot polkadot.query --json | jq '.pallets | map(.name) | contains(["AssetConversion"])'
# Output:
# false
```

### List runtime APIs

```bash
dot polkadot.apis --json | jq -r '.apis[].name'
# Output:
# AccountNonceApi
# AssetHubMigrationApi
# AuthorityDiscoveryApi
# BabeApi
# ...
```

### Check which assets are accepted for fee payment

```bash
dot polkadot-asset-hub.apis.XcmPaymentApi.query_acceptable_payment_assets 5 --json
# Output:
# {
#   "success": true,
#   "value": [
#     { "type": "V5", "value": { "parents": 1, "interior": { "type": "Here" } } },
#     ...
#   ]
# }
```

This is a runtime API — the accepted assets are derived by the runtime (e.g., from existing AMM pools on Asset Hub), not set manually.

### Node-level checks via raw RPC

`dot polkadot.rpc.<method>` covers things that aren't in runtime metadata — sync state, block hashes, mempool, fee estimation, key management.

```bash
# Wait for the node to finish syncing before scripting against it
until [ "$(dot polkadot.rpc.system_health --json | jq -r '.isSyncing')" = "false" ]; do
  sleep 5
done

# Block hash for a specific height
HASH=$(dot polkadot.rpc.chain_getBlockHash 1000 --json | tr -d '"')

# Number of pending txs in the mempool
dot polkadot.rpc.author_pendingExtrinsics --json | jq length

# Pre-submission fee estimate for an encoded extrinsic
ENCODED=$(dot polkadot.tx.System.remark 0xdead --from alice --encode)
dot polkadot.rpc.payment_queryInfo "$ENCODED" --json | jq -r '.partialFee'

# List every method this node exposes (useful for capability detection)
dot polkadot.rpc --json | jq -r '.methods[] | select(.family=="archive") | .method'
```

The `rpc` category is flat — `[chain.]rpc.<method_name>`, no pallet level. Methods discovered per-chain via `rpc_methods` and cached; refresh with `dot polkadot.rpc --refresh` after a node upgrade. Subscription methods (`*_subscribe*`, `chainHead_v1_*`, `transaction_v1_*`) are not callable as one-shots.

### Build raw storage keys with twox

Pallet storage in Substrate is keyed by `twox128(palletName) ++ twox128(itemName) [++ hasher(key)]`. Compose the prefix with `dot hash twox128` and read the raw SCALE value via `rpc.state_getStorage` — useful for items that aren't in metadata, or for poking around without loading metadata.

```bash
# Plain storage value (System.Number — current block number)
PALLET=$(dot hash twox128 System)
ITEM=$(dot hash twox128 Number)
dot polkadot.rpc.state_getStorage "${PALLET}${ITEM:2}" --json

# Well-known keys live outside the twox128++twox128 scheme — pass them directly
dot polkadot.rpc.state_getStorageHash 0x3a636f6465  # `:code` — runtime WASM blake2 hash
dot polkadot.rpc.state_getStorageSize 0x3a636f6465  # size of the runtime WASM in bytes

# List the first 5 storage keys under a pallet prefix
PREFIX=$(dot hash twox128 System)
dot polkadot.rpc.state_getKeysPaged "$PREFIX" 5 --json
```

`twox64` and `twox256` are also available; `Twox64Concat` map-hasher keys are `twox64(encodedKey) ++ encodedKey` (compose with `dot hash twox64` and shell concatenation).

### Check pool reserves

```bash
NATIVE='{"parents":1,"interior":{"type":"Here"}}'
ASSET='{"parents":0,"interior":{"type":"X2","value":[{"type":"PalletInstance","value":50},{"type":"GeneralIndex","value":"1984"}]}}'

dot polkadot-asset-hub.apis.AssetConversionApi.get_reserves "$NATIVE" "$ASSET" --json
# Output (live; or `null`/`undefined` if no pool exists):
# [
#   "801299477230750",
#   "99382392973"
# ]
```

## Contract Calls as an Ethereum Identity

Revive contracts often gate admin functions on eth-key owners/roles. The read side is a free `ReviveApi.call` dry-run from any account; the write side needs an ethereum-scheme account (`--scheme ethereum`). Idempotent check-then-act for a whitelist entry:

```bash
CTRL=0xf209507ab5e6Cf1245aeC020E94c7E213020899B   # DotnsRegistrarController (previewnet)
WHO=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
CHAIN=preview-asset-hub

# READ — encode isWhiteListed(address) and dry-run via the runtime API (no signer).
# Selector = first 4 bytes of keccak256 of the bare signature; args are ABI-encoded.
SEL=$(dot hash keccak256 "isWhiteListed(address)" | cut -c1-10)
CALLDATA="${SEL}000000000000000000000000${WHO#0x}"
ORIGIN=$(dot account inspect alice --json | jq -r .ss58)
RESULT=$(dot $CHAIN.apis.ReviveApi.call "$ORIGIN" "$CTRL" 0 null null "$CALLDATA" --json \
  | jq -r .result.value.data)

if [ "${RESULT: -1}" != "1" ]; then
  # WRITE — executes as the eth account's address (msg.sender), which is what
  # the contract's onlyOwner/role check requires. Calldata is built from the
  # signature cast-style; gas/nonce/chain-id are handled automatically.
  dot $CHAIN.tx.Revive.call "$CTRL" 'whiteListAddress(address,bool)' "$WHO" true \
    --from dotns-admin --wait best
fi
```

Notes:

- `--from` accepts a stored `--scheme ethereum` account or a **derived identity**: `--from alice-eth` signs with the BIP44 key (m/44'/60'/0'/0/0) of alice's mnemonic — for dev accounts this reproduces Alith/Baltathar/….
- Fund the eth identity's **fallback SS58** (`dot account inspect <name>-eth --json | jq -r .ss58`) — fees come from there.
- `--dry-run` on the write prints gas, storage deposit, max fee, and the decoded revert if the contract would reject the call — nothing is submitted.
- `--value <wei>` sends value with the call (18 EVM decimals; on a 10-decimals chain the wei→planck ratio is 10^8).
- The nonce for rapid-fire sequencing is the fallback account's `System.Account` nonce (`--nonce` overrides).

## Common Gotchas

1. **`undefined` is not JSON.** Always check before piping to `jq`.

2. **`--rpc` uses wrong metadata.** Always register chains with `dot chain add`, never rely on `--rpc` alone. Metadata cache is keyed by chain name, not RPC URL, so `--rpc` can pick up stale metadata from a previous chain with the same alias.

3. **Every command needs an explicit chain.** No default chain — prefer the chain-prefix dotpath form (`dot polkadot.query.System.Number`). `--chain <name>` is supported as an alternative. Commands without either error out. Note `inspect` is a top-level command that takes the chain on its target (`dot inspect polkadot.System`) or via `--chain`.

4. **u128 returned as quoted strings.** `"1000000000000"` not `1000000000000`. Strip quotes for comparison: `tr -d '"'`

5. **`--json` doesn't guarantee JSON.** Errors and `undefined` are not valid JSON even with `--json`.

6. **`--dump` required for keyless map queries.** `dot polkadot.query.System.Account` without a key or `--dump` shows usage help, not results.

7. **Method names are snake_case.** Calls like `Balances.transfer_keep_alive` use the runtime's `snake_case` identifiers. CamelCase variants don't resolve — the fuzzy matcher will suggest the right name.

8. **JSON-RPC method names use underscores, not dots.** `chain_getBlock`, not `chain.getBlock`. The form is `[chain.]rpc.<method_name>` — the underscored token is one segment.
