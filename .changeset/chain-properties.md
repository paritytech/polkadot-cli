---
"polkadot-cli": minor
---

Add `dot chain properties <name>` command that returns a chain's `tokenDecimals`, `tokenSymbol`, and `ss58Format`. It tries `system_properties` (universally implemented) and falls back to the modern `chainSpec_v1_properties`, preserves array-typed responses from multi-token chains as-is, and handles empty `{}` properties gracefully as nulls. Lets scripts replace hardcoded `NATIVE_DECIMALS=12` with `NATIVE_DECIMALS=$(dot chain properties polkadot --json | jq .tokenDecimals)`.
