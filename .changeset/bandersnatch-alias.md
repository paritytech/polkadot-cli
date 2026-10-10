---
"polkadot-cli": minor
---

Add `bandersnatch` as an alias for the `verifiable` command. `dot bandersnatch <action>` now resolves to the same handler as `dot verifiable <action>`, so users who think in terms of the underlying Bandersnatch/ring-VRF primitive find it. Every existing form and option works identically under either name.
