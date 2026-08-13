---
"polkadot-cli": patch
---

Fix `--ext` silently ignoring overrides for builtin transaction extensions. The builtin skip ran before the user-override check, so e.g. `--ext '{"CheckMetadataHash":…}'` was parsed and then dropped without warning, making `CheckMetadataHash` unreachable by any route. User overrides now take priority over the builtin skip (polkadot-api itself checks `customSignedExtensions` before its own handling, so the value wins downstream). Passing an extension name the chain's metadata doesn't declare is now a clear error instead of being silently ignored.
