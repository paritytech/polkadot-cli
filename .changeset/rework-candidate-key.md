---
"polkadot-cli": minor
---

Derive Bandersnatch member keys per RFC-0022, and make every derivation scheme reachable.

Member keys now default to the ring-VRF keyed-hash tree the reference apps use: the BIP39 entropy is hashed with key `"ring-vrf"` to get a tree root, then folded through the hard junctions `//peopl.dot` and `//index_bytes(n)`. Index 0 is the **full** person (ring `pop:polkadot.network/people`), index 1 the **lite** person (`…/people-lite`) — two keys held at once, not a rotation. `dot account create` derives and stores both as `full` / `lite`.

`dot verifiable` now exposes four tiers for the member secret, and rejects any combination of them:

| Tier | Flags | Derivation |
|---|---|---|
| Well-known (default) | `--person full\|lite` | `//peopl.dot//index_bytes(0\|1)` |
| Any RFC-0022 path | `--product <id> --index <n>` | `//<id>//index_bytes(n)` |
| Legacy (pre-RFC-0022) | `--entropy-key <text\|0xhex>` | `blake2b(bip39Entropy, key)` — one level |
| Raw | `--entropy 0x<64hex>` | none — the 32 bytes *are* the secret |

The legacy tier is kept deliberately. The reference apps cut over without migrating existing installs, so an identity registered before the switch still holds its old key on-chain until `migrate_included_key` moves it — reproducing that key is exactly what a debugging CLI is for. The raw tier needs no account at all, so `sign`, `alias`, and `prove` work with a secret produced by any other implementation.

Because a key from the wrong tier is indistinguishable until it fails ring validation, every command now prints the `Scheme:` it used, and mixing selector flags is an error rather than a precedence rule.

The product id stays `peopl.dot` on **every** network. It is a governance-reserved dotNS constant that iOS and Android both pin regardless of chain (Android's `ProductId` regex cannot even express a non-`.dot` TLD), and the network axis for personhood lives in the ring — `chainId` plus collection id — not in the key. `--product` overrides it for clients that deliberately diverge. All-digit ids are rejected, since Substrate SCALE-encodes numeric junctions as `u64` and would otherwise silently derive a different key.

Breaking: the default changed from lite to full, so a bare `dot verifiable alice` returns a different key than in the previous release. `--entropy-key candidate` still works but now selects the labelled legacy tier rather than being the normal path.

Tests pin the published cross-platform vectors (root entropy `0x01..0x20`) against iOS `KeyedHashChainDeriverTests` and the Android equivalent, so a divergence from the phone apps fails loudly, plus the pre-RFC-0022 values for the legacy tier. This also replaces two "snapshot" tests that asserted `expect(x).toBe(x)` and pinned nothing.
