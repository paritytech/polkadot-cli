---
"polkadot-cli": patch
---

Security dependency batch: force `ws` to a patched version (`>=8.21.0`) via overrides to address GHSA-96hv-2xvq-fx4p (DoS) and GHSA-58qx-3vcg-4xpx, and apply safe in-range minor/patch bumps:
`@noble/hashes` 2.0.1 → 2.2.0, `yaml` 2.8.3 → 2.9.0, `@polkadot-labs/hdkd-helpers` 0.0.29 → 0.0.30, plus dev tooling `@biomejs/biome` 2.4.5 → 2.5.1, `@changesets/cli` 2.29.8 → 2.31.0, `@types/bun` 1.3.9 → 1.3.14.
