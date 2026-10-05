---
"polkadot-cli": minor
---

Every error now respects `--json`, including `account`, `chain` and `completions` validation errors that previously always printed plain text. Usage errors add the usage hint as a separate `usage` field (`{"error": "...", "usage": "..."}`), and the exit code stays non-zero.

New `DOT_OUTPUT` env var: set `DOT_OUTPUT=json` to make JSON the default output for every command, e.g. in scripts. `--json` and an explicit `--output <format>` still win, so `--output pretty` gives human-readable output for a single command.
