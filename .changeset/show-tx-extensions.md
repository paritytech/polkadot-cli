---
"polkadot-cli": minor
---

Show the transaction extensions applied to an extrinsic in both the `dot tx ... --dry-run` and submit output (human-readable and `--json`). A new `Extensions:` section lists every signed extension the chain declares in its metadata — so it is correct per-chain — with the effective value for the ones the CLI controls (`CheckNonce`, `ChargeTransactionPayment`, `CheckMortality`, `ChargeAssetTxPayment`), including their defaults, clearly marked. Values you set via `--nonce`/`--tip`/`--mortality`/`--asset`/`--ext` are shown as user-set; the rest are marked as filled in by polkadot-api. This makes it transparent which extensions run and what values they carry, even when left at their defaults. Visibility only — signing behaviour is unchanged.
