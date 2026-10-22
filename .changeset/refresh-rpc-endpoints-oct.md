---
"polkadot-cli": patch
---

Refresh the built-in RPC endpoints. Every shipped endpoint was re-checked for the expected genesis hash, a synced head and `chainHead_v1` support.

Removed: `wss://polkadot.rotko.net` (Polkadot relay), whose hostname no longer resolves. Rotko's system-chain endpoints still work and stay.

Added: Spectrum (Simply Staking) for the Polkadot relay, bridge hub and bulletin chain, matching polkadot-js/apps. Bulletin goes from three endpoints to four.
