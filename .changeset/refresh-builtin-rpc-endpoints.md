---
"polkadot-cli": minor
---

Refresh the built-in RPC endpoints — every shipped endpoint was health-checked, dead ones removed, and working alternatives added in their place.

The big change is that **IBP is gone**. Both of its domains have been decommissioned: every `*.ibp.network` hostname now returns `NXDOMAIN` (the zone is stripped down to its apex), and `dotters.network` has a broken delegation that returns `SERVFAIL` from every resolver. IBP was the *primary* endpoint for both relay chains, so out of the box the CLI was spending its first connection attempt on a name that no longer resolves. polkadot-js/apps removed the same endpoints wholesale in June 2026 after progressive removals in February and April, so this is a sustained decommission rather than an outage to wait out.

Also removed, all confirmed dead: Dwellir's `*-tn.dwellir.com` hosts, `rpc.amforc.com`, `rpc.permanence.io` and `rpc.subquery.network` (all `NXDOMAIN`), plus every `*.public.curie.radiumblock.co` endpoint — those still resolve and serve valid TLS, but Cloudflare returns `522` because the origin nodes are unreachable.

Added, each verified to sync and report the expected genesis hash: Gatotech, Stakeworld, Helixstreet, interweb, Rotko and TurboFlakes endpoints across the Polkadot and Paseo chains. Dwellir replaces IBP as the relay primary; `wss://rpc.polkadot.io` deliberately stays the last-resort fallback so the default path still favours independent providers.

Endpoint rotation itself needed no new code — polkadot-api's WS provider already walks the configured list on each reconnect attempt, so an unreachable endpoint is skipped automatically. What it did need was a shorter leash: the connection timeout drops from 10s to 4s. Endpoints that refuse outright (DNS failure, connection refused) fail fast and never hit the timeout, but one that accepts the socket and then stalls — a dead node behind a live proxy, exactly the RadiumBlock `522` case — burns it in full before the next endpoint is tried. Worst-case rotation past a stalled endpoint goes from ~10.5s to ~4.5s, while a healthy default connection is unaffected at ~0.5s.

**Breaking:** `paseo-bridge-hub`, `paseo-collectives` and `paseo-coretime` are no longer preconfigured. They had no reachable endpoints, and querying the Paseo relay's `Paras.ParaLifecycles` confirms paras 1001, 1002 and 1005 are not registered — those chains do not exist on Paseo, so there is nothing to point at. Asset Hub (1000) and People (1004) are the only Paseo system parachains, and both remain. Anyone relying on the old names can still add them with `dot chain add`.
