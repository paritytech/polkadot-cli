---
"polkadot-cli": patch
---

Errors now respect `--json` / `--output json`: the message is printed to stdout as `{"error": "..."}` instead of plain text on stderr, and the exit code stays non-zero, so scripts can parse failures the same way as results.
