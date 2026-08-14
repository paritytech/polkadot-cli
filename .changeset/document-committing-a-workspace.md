---
"polkadot-cli": patch
---

Document what is safe to commit from a `.polkadot/` workspace, and how env-backed accounts make that possible in CI.

`dot init` deliberately writes no `.gitignore` and the docs left the decision at "your call", which is unhelpful precisely where the stakes are highest. The new guidance — in the README, the docs site, and the bundled `dot-cli` skill — is per-file rather than wholesale:

- `.polkadot/config.json` is the thing worth sharing: it pins the chains and endpoints a repo talks to, so a clone plus `dot chain update` is a working setup.
- `.polkadot/chains/` should be ignored. It is a regenerable cache, roughly 450 KB of binary metadata per chain, rewritten by every runtime upgrade.
- `.polkadot/update-check.json` should be ignored; it is the update-notifier timestamp.
- `.polkadot/accounts.json` is committable only while every entry is env-backed (`--env`) or watch-only. Those entries store a variable name or a public key and no key material, so the file carries nothing secret.

That last point is a property of the file's current contents rather than of the format — one `dot account create` in the same directory writes a mnemonic into the same tracked file — so the guidance ships with a one-line guard suitable for CI or a pre-commit hook:

```bash
jq -e '[.accounts[].secret | select(type == "string")] | length == 0' .polkadot/accounts.json
```

Also documented explicitly: **the CLI does not read `.env` files.** It reads environment variables and nothing else, so a `.env` next to a workspace has no effect until something loads it (`set -a; source .env; set +a`, direnv, `dotenvx run --`). In CI the file is unnecessary — the runner's secret store supplies the variable directly. Related, and previously undocumented: `dot account add --env` works with the variable unset, recording an empty public key and reporting `Address will resolve when $VAR is set.`, so a repository can define its CI signer on a machine that never holds the secret.

No behaviour changes — documentation and the bundled skill only.
