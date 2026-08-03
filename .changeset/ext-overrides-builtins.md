---
"polkadot-cli": minor
---

Make `--ext` a generic override for every signed extension, including polkadot-api builtins. Naming a builtin (e.g. `CheckMortality`, `ChargeTransactionPayment`) in `--ext` now overrides the value polkadot-api would otherwise fill in automatically — previously such entries were silently ignored. `--asset` is now implemented as sugar over an `--ext` override of `ChargeAssetTxPayment`, so the two paths stay consistent. `dot <chain>.extensions.<Ext>` advertises the `--ext` override for builtins too.
