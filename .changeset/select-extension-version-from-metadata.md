---
"polkadot-cli": patch
---

Select the transaction-extension version from metadata instead of taking the first key. `getSignedExtensions` now uses the highest version in `transaction_extensions_by_version` (matching subxt), `buildGeneralTx` derives the v5 preamble's extension-version byte from that same key instead of hardcoding `0x00`, and `dot <chain>.extensions` surfaces which extension version it is displaying (`extensionVersion` / `availableVersions` in `--json`). Also fixes the `--unsigned` output label, which claimed `unsigned (bare)` while actually emitting a v5 General extrinsic. No behavior change on any live chain today — they all expose exactly version `{0}` — but wrong the moment one doesn't.
