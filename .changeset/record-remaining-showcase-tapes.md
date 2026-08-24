---
"polkadot-cli": patch
---

Record the five remaining showcase tapes — `chains`, `dry-run`, `sovereign`, `xcm-file` and `did-you-mean` — and embed them in the README and on the docs site next to the features they demonstrate.

Fixes the `transfer.xcm.yaml` example the file-based docs link to: it named `people-paseo`, a chain key that no longer exists, so the documented invocation failed with `Unknown chain`.
