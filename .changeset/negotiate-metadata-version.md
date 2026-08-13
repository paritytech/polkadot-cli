---
"polkadot-cli": minor
---

Negotiate the highest supported metadata version instead of pinning v15. The CLI now asks the runtime via `Metadata_metadata_versions` and fetches the best version both sides support (currently up to v16; runtimes without that API fall back to v14 via `state_getMetadata`).

This also fixes a live cache inconsistency: read commands pinned v15 while `dot tx` let polkadot-api write its own v16 fetch into the same `metadata.bin` with no fingerprint, so which version the CLI operated on depended on command history. The CLI is now the only cache writer, the fingerprint sidecar records the metadata version and the chain's supported versions, and a cache that is below the negotiated target (including every pre-existing install, whose sidecar has no version info) is refreshed automatically on the next connected command — no extra RPC in the steady state.
