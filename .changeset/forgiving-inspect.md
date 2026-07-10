---
"polkadot-cli": minor
---

Make `dot inspect` (and its `explore` alias) forgiving about dot-paths. Previously `dot inspect polkadot.tx.System.remark` threw `Invalid target ... Expected format: Pallet, Pallet.Item, or Chain.Pallet.Item` even though that exact path is valid for *invoking* a call — `inspect` had no notion of a `kind` segment. Now `parseTarget` (under `allowPalletOnly`) tolerates and ignores a `kind` segment (`tx`/`query`/`const`/`events`/`errors` and their aliases) appearing right after an optional chain prefix, so `dot inspect polkadot.tx.System.remark` describes the `System.remark` call just like `dot inspect polkadot.System.remark`. Partial paths continue to degrade to discovery rather than erroring (`dot inspect polkadot.query.System` lists the pallet's items). Genuinely-malformed input still errors with a helpful message. Closes #255.
