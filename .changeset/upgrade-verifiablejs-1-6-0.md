---
"polkadot-cli": patch
---

Upgrade `verifiablejs` from `1.4.0` to `1.6.0`, which pulls in the `verifiable` crate `0.3.0` bump.

The one wire-format consequence is the ring root: `members_root` (behind `dot verifiable prove`/`verify --root`) now returns a **288-byte** `MembersCommitment` instead of 768 bytes. Member keys, aliases, signatures and the 785-byte ring proof are all byte-identical to 1.4.0 — the pinned Alice vectors in `src/features/verifiable/lib.test.ts` and `commands.test.ts` still hold — so only a `--root` value matters here. A root captured from a chain running the older `verifiable` revision will no longer validate; re-read it from the chain (or recompute it from the members set) rather than reusing a stored 768-byte blob.

Help text, docs and the bundled `dot-cli` skill are updated to quote the new size.

1.6.0 also adds an `encode_members` helper, so `encodeMembers` in `src/features/verifiable/lib.ts` now delegates to it instead of hand-rolling the SCALE `Vec<[u8; 32]>` layout. Output is byte-identical for every input (verified against the old implementation, including the empty ring and non-curve-point keys); the local `compactEncode` helper and the `@polkadot-api/substrate-bindings` `compact` import it existed for are gone.
