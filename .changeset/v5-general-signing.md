---
"polkadot-cli": minor
---

Add opt-in Extrinsic V5 "General" signing via `--v5`. A v5 transaction carries its signature inside the `VerifyMultiSignature` transaction extension instead of a signature field, so the capability is gated: the CLI signs v5 only when the runtime advertises extrinsic version 5 AND carries a `VerifyMultiSignature` extension of the expected shape, and errors clearly otherwise (on Polkadot, Kusama, and all asset hubs, v4 remains the only way to sign). Implemented as a custom papi v3 `TxCreator` wrapped in papi's own extension-filling enhancers, with a pure, papi-free byte assembly (`src/core/extrinsic-v5.ts`); the signing payload is always `blake2_256` of the inherited implication (extension-version byte ++ call ++ extras-then-implicits after the `VerifyMultiSignature` cut). The creator honors mocked signatures, so fee estimation works through papi's standard `getEstimatedFees` on the v5 path too.
