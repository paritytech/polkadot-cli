---
"polkadot-cli": minor
---

Sign with the highest extrinsic version the chain can authorize by default: v5 General on chains carrying `VerifyMultiSignature` (people chains on test networks today), v4 everywhere else. Every signed transaction's output now states the version used (`Type: signed (v4)` / `signed (v5 general)`; `extrinsicVersion` in `--json`), and new `--v4`/`--v5` flags force a version — a forced `--v5` on an incapable chain errors up front. This is deliberately more aggressive than subxt (which defaults to v4 whenever v4 is advertised): the capability gate checks actual authorization support, so the polkadot-js-style failure mode of building unsignable v5 transactions cannot occur.
