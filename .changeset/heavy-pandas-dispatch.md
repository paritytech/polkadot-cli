---
"polkadot-cli": minor
---

Add git/cargo-style external subcommand dispatch (plugins). When the first CLI token is not a built-in command, category, or dot-path, `dot <name> …` looks for an executable named `dot-<name>` on PATH and runs it with the remaining arguments forwarded verbatim, stdio inherited, and the plugin's exit code passed through. Plugins receive `DOT_BIN` pointing at the dispatching `dot` entry script (cargo's `CARGO` convention) so they can call back into the same installation. Dotted tokens (`foo.bar`) and file paths are never dispatched, so dot-path syntax and file input are unaffected; built-in commands always win over a same-named plugin. Unknown-command errors now mention the `dot-<name>` convention when the token could have been a plugin.
