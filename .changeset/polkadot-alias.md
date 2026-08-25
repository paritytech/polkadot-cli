---
"polkadot-cli": minor
---

Add `polkadot` as an alias for the `dot` command. Installing `polkadot-cli` (e.g. `npm install -g polkadot-cli`) now exposes both the `dot` and `polkadot` executables on your `PATH`; they resolve to the same CLI. Shell completions remain registered for `dot` only for now.
