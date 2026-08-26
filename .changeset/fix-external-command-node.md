---
"polkadot-cli": patch
---

Fix `Error: Bun is not defined` when running an unknown command (e.g. a typo like `dot accouts`) with the published Node build. The `dot-<name>` plugin lookup now uses Node APIs; the proper "Unknown command" error is shown again and plugin dispatch works under Node.
