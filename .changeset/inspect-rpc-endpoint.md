---
"polkadot-cli": minor
---

Show the connected RPC endpoint in `inspect` and category-listing headers. The overview headers now include the endpoint the CLI connects to in dimmed brackets, e.g. `Pallets on polkadot (67)  [wss://polkadot.ibp.network]`. This applies to `dot inspect` (pallet list and pallet detail) and the `dot tx` / `dot query` / `dot events` / `dot errors` / `dot extensions` listings. The endpoint is the `--rpc` override when given, otherwise the chain's primary configured RPC, and it's also surfaced as an `rpc` field in the corresponding `--json` output. This adds diagnostic value when metadata resolution looks wrong, making it clear where the metadata came from.
