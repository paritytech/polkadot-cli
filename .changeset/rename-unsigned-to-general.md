---
"polkadot-cli": minor
---

Rename `--unsigned` to `--general`. The flag builds an extrinsic v5 *general* transaction (`0x45`), which is not "unsigned" — it has no signature field of its own, and authorization (a signature or another mechanism) lives in the transaction extensions instead. `--unsigned` (and the `unsigned: true` file key) keeps working as a deprecated alias that prints a warning to stderr. Human-readable output now labels these transactions `general (v5)`, and the `--json` output field for general dry-runs/submissions is renamed from `unsigned: true` to `general: true`. Closes #306.
