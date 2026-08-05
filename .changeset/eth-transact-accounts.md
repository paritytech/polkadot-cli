---
"polkadot-cli": minor
---

Ethereum (secp256k1) accounts and pallet-revive `eth_transact` submission (#284).

`dot account add <name> --scheme ethereum --secret 0x<64-hex>` (and `create`/`--env`) stores a secp256k1 key; the account's identity is its EIP-55 H160, with the deterministic revive fallback AccountId32 (`H160 ‖ 0xEE×12`) stored as its public key so all existing address resolution works unchanged.

Every mnemonic-backed account additionally has a **derived** ethereum identity, selected with the `-eth` name suffix: `--from <name>-eth` signs with the MetaMask-compatible BIP44 key (`m/44'/60'/0'/0/0`) of the same phrase. Dev accounts use their position as the index, reproducing the revive/Moonbeam dev accounts (`alice-eth` = Alith, `bob-eth` = Baltathar, …). A real stored account named `<name>-eth` wins over derivation; `account inspect` shows the derived identity on the base account and resolves the `-eth` form directly.

When `--from` names an ethereum account, `dot <chain>.tx.Revive.call <dest> [<0xcalldata> | '<sig(types)>' args…] [--value <wei>]` prices the call via a `ReviveApi.eth_transact` dry-run, signs an EIP-1559 transaction with the account's key, and submits it wrapped in the unsigned `Revive.eth_transact` extrinsic — same WebSocket connection, no eth-rpc sidecar. The call executes with the eth address as `msg.sender`, which is what contract-side `owner()`/role checks require. Calldata can be built cast-style from a human ABI signature; failed dry-runs decode Solidity `Error(string)`/`Panic(uint256)` reverts. Verified end-to-end on previewnet asset-hub.

Adds `ox` (lazy-loaded) for secp256k1 signing, EIP-1559 serialization, and ABI encoding.
