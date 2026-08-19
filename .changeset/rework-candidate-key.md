---
"polkadot-cli": minor
---

Derive Bandersnatch member keys per RFC-0022, replacing the `candidate` entropy key.

Member keys now come from the ring-VRF keyed-hash tree the reference apps use: the BIP39 entropy is hashed with key `"ring-vrf"` to get a tree root, then folded through the hard junctions `//peopl.dot` and `//index_bytes(n)`. Index 0 is the **full** person (ring `pop:polkadot.network/people`), index 1 the **lite** person (`…/people-lite`) — two keys held at once, not a rotation. `dot verifiable` takes `--person full|lite` in place of `--entropy-key`, `dot account create` stores both under `full` / `lite`, and the derived entropy is what `alias`, `sign`, and `prove` use.

The previous scheme was a single keyed blake2b over the BIP39 entropy — `--entropy-key candidate` for a full person, unkeyed for lite — which is not a junction path at all. `--entropy-key` is now rejected with a pointer to `--person` rather than ignored: silently deriving a different key would produce proofs no ring accepts. The default changed too, from lite to full, matching the apps' own fallback and pallet-people's "no collection junction → PoP ring" rule.

The product id stays `peopl.dot` on **every** network. It is a governance-reserved dotNS constant that iOS and Android both pin regardless of chain (Android's `ProductId` regex cannot express a non-`.dot` TLD), and the network axis for personhood lives in the ring — `chainId` plus collection id — not in the key. `--product <id>` overrides it for clients that deliberately diverge; a different id derives a key no ring holds, so it is an escape hatch rather than a per-network switch. All-digit ids are rejected, since Substrate SCALE-encodes numeric junctions as `u64` and would silently derive a different key.

This is breaking for anyone holding a key from the old scheme. The reference apps cut over the same way without migrating existing installs, so an identity registered before the switch keeps its old on-chain key until the runtime's `migrate_included_key` moves it — and that key is no longer derivable here.

Tests pin the published cross-platform vectors (root entropy `0x01..0x20`) against iOS `KeyedHashChainDeriverTests` and the Android equivalent, so a divergence from the phone apps fails loudly. This also replaces two "snapshot" tests that asserted `expect(x).toBe(x)` and pinned nothing.
