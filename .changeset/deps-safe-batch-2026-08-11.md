---
"polkadot-cli": patch
---

Update dependencies that are safe to move without behaviour changes, and clear the one security advisory that sat on the shipped runtime path.

`polkadot-api` goes 2.1.7 → 2.2.2, `@noble/hashes` 2.0.1 → 2.3.0 and `yaml` 2.8.3 → 2.9.0; on the dev side `@biomejs/biome` 2.4.5 → 2.5.8, `@changesets/cli` 2.29.8 → 2.31.1 and `@types/bun` 1.3.9 → 1.3.14. All six are in-range minor/patch bumps, so the semver contract the manifest already committed to is unchanged — the ranges are just pulled forward to the versions actually installed.

The `ws` advisories ([GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p), high, memory-exhaustion DoS; [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx), moderate, uninitialized memory disclosure) reach the CLI through `polkadot-api › @polkadot-api/sm-provider › @polkadot-api/smoldot › smoldot › ws`, which is the smoldot light-client path in a shipped build rather than dev-only tooling. `smoldot` asks for `ws@^8.8.1` and resolved 8.19.0, inside the vulnerable `>=8.0.0 <8.20.1` window; an `overrides` entry pins it to `^8.21.3`, still within smoldot's own range, so nothing upstream is being forced across a major.

Two advisories deliberately remain, both confined to dev/build tooling and neither reachable from the published CLI. `picomatch <2.3.2` is pinned by `micromatch@4.0.8` under `@changesets/git`, and `unplugin-utils` in the papi build chain requires `picomatch@^4`, so a blanket override would have to break one to fix the other. `js-yaml@3.14.2` arrives via `@manypkg/get-packages › read-yaml-file`, which uses the v3 API; the fix only exists in 4.x. Both need upstream releases, not an override here.

Also held back: `@polkadot-labs/hdkd`, `@polkadot-labs/hdkd-helpers` and `@scure/sr25519`. These are one coupled cluster, not three independent bumps — `hdkd@0.0.29` requires `hdkd-helpers@~0.0.31`, which in turn requires `@scure/sr25519@^2.2.0`, a v1 → v2 major on the library that performs sr25519 key derivation and signing. That belongs in its own change where signature and address compatibility can be verified against known keys, so it is left alone here.

The biome bump surfaced one new `useOptionalChain` warning in `src/skill-marketplace.test.ts` and a stale `$schema` pin in `biome.json`; both are fixed so `bun run lint` stays clean.
