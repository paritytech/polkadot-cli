---
"polkadot-cli": minor
---

Remove the deprecated standalone `dot parachain <paraId>` command (breaking for scripts still pinning it). It had been preserved as a deprecation-warning alias; equivalent functionality lives on `dot account`:

```bash
# Before
dot parachain 1000                    # → dot account inspect --parachain 1000 --parachain-type child
dot parachain 1000 --type sibling     # → dot account inspect --parachain 1000 --parachain-type sibling
dot parachain 2004 --prefix 0         # → dot account inspect --parachain 2004 --parachain-type child --prefix 0
dot parachain 1000 --json             # → dot account inspect --parachain 1000 --parachain-type child --json
```

The new path requires `--parachain-type` explicitly (no implicit child+sibling pair). Scripts that consumed both halves of the old default output should issue two `inspect` calls. The shared derivation helpers in `src/core/parachain.ts` are unchanged and continue to back `dot account add` / `dot account inspect`.
