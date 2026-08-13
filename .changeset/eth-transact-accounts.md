---
"polkadot-cli": minor
---

Ethereum (secp256k1) accounts and pallet-revive `eth_transact` submission (#284).

`dot account add <name> --scheme ethereum --secret 0x<64-hex>` (and `create`/`--env`) stores a secp256k1 key; the account's identity is its EIP-55 H160, with the deterministic revive fallback AccountId32 (`H160 ‖ 0xEE×12`) stored as its public key so all existing address resolution works unchanged.

Every mnemonic-backed account additionally has a **derived** ethereum identity, selected with the `-eth` name suffix: `--from <name>-eth` signs with the MetaMask-compatible BIP44 key (`m/44'/60'/0'/0/0`) of the same phrase. Dev accounts use their position as the index, reproducing the revive/Moonbeam dev accounts (`alice-eth` = Alith, `bob-eth` = Baltathar, …). A real stored account named `<name>-eth` wins over derivation; `account inspect` shows the derived identity on the base account and resolves the `-eth` form directly.

When `--from` names an ethereum account, `dot <chain>.tx.Revive.call <dest> [<0xcalldata> | '<sig(types)>' args…] [--value <wei>]` prices the call via a `ReviveApi.eth_transact` dry-run, signs an EIP-1559 transaction with the account's key, and submits it wrapped in the unsigned `Revive.eth_transact` extrinsic — same WebSocket connection, no eth-rpc sidecar. The call executes with the eth address as `msg.sender`, which is what contract-side `owner()`/role checks require. Calldata can be built cast-style from a human ABI signature; failed dry-runs decode Solidity `Error(string)`/`Panic(uint256)` reverts. Verified end-to-end on previewnet asset-hub.

`dot <chain>.tx.Revive.instantiate_with_code <0xcode|@file> ['constructor(types)' args…]` deploys a contract over the same transport — an EIP-1559 creation transaction (empty `to`, init code as data), so the constructor sees the eth address as `msg.sender` and `owner()` lands on the key you hold. Bytecode may be inline hex or `@<path>` to a `solc --bin`/foundry artifact; constructor arguments are ABI-encoded and appended. The deployed address is read from the `Revive.Instantiated` event, and `--dry-run` predicts it from sender and nonce.

`Revive.eth_transact` is now submitted as a **bare** extrinsic rather than a general transaction. pallet-revive rewrites the extrinsic during `check()` and substitutes its own transaction extension, so the extension data the CLI attached was already discarded — but attaching it broke outright on runtimes whose extension set has shifted (asset-hub-next spec 2000035 panics in `validate_transaction`; 2000033 tolerated it). Calls and deployments were verified end-to-end on both.

Adds `ox` (lazy-loaded) for secp256k1 signing, EIP-1559 serialization, and ABI encoding.
