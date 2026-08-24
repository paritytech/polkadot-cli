---
"polkadot-cli": minor
---

Upgrade `polkadot-api` 2.2.2 → 3.0.0 (with `@polkadot-api/metadata-builders` 0.15.0, `substrate-bindings` 0.21.0, `view-builder` 0.6.0, `metadata-compatibility` 0.7.0). Unlike previous dependency batches this moves the manifest across a major, so the semver contract changes: papi v3 replaces `PolkadotSigner` with composable `TxCreator`s (`polkadot-api/signer` → `polkadot-api/tx-creator`, `sign*` tx methods → `create*`), renames the tx events (`signed` → `created`, `txBestBlocksState` → `inBestBlock`/`notInBestBlock`), and unified metadata exposes `extrinsic.extensionsByVersion` instead of `signedExtensions`.

CLI behaviour is intended to be unchanged. Two spots needed more than renames:

- `--asset` no longer needs the `customSignedExtensions` workaround: the v2 `isAssetCompat` check that rejected XCM Location JSON on the unsafe API is gone, and v3 SCALE-encodes the `asset` tx option directly via the dynamic builder — exactly what the workaround did by hand. The option is now passed through natively.
- v3 inverts extension-override precedence: builtin enhancers run before `customSignedExtensions` and the first payload entry per identifier wins, so `--ext` overrides of builtin extensions (the contract fixed in "fix-ext-builtin-overrides") would be silently dropped. A `withExtensionOverrides` wrapper pre-seeds the user's encoded overrides into the creator payload — every v3 builtin enhancer (nonce included) skips identifiers already present — keeping user overrides authoritative.

Fee estimation now runs the full creator chain with a mocked signature (`getEstimatedFees(txCreator)` instead of a public key), so estimates reflect the actual extension encoding. Verified against Paseo: dry-run fees, an `--ext ChargeTransactionPayment` override (fee shifted by exactly the one-byte compact-length difference, proving the override encodes), and unsigned v5 general-tx encoding.
