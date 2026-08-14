---
"polkadot-cli": patch
---

Fix `--from` and `--chain` value completion in zsh once other arguments precede the flag.

The generated zsh completer collected the words before the cursor with `local preceding=("${words[2,CURRENT-1]}")`. A quoted subscript range in zsh expands to a *single* word, so `dot polkadot.tx.Balances.transfer_keep_alive bob 100 --from <Tab>` handed the completer one argument — `"polkadot.tx.Balances.transfer_keep_alive bob 100 --from"` — instead of four. Not finding a recognisable flag at the end, it fell back to the top-level candidate list, so the Tab offered subcommands and chain names where account names were expected.

Adding the `(@)` flag (`"${(@)words[2,CURRENT-1]}"`) keeps the words separate. The bug only showed up with two or more preceding words, which is why the documented `dot --from <Tab>` case worked: joining a one-element array is a no-op. The bash and fish completers were already correct — bash slices with `"${COMP_WORDS[@]:1:COMP_CWORD-1}"` and fish uses `(commandline -opc)`, both of which preserve word boundaries.

Found while recording the tab-completion demo tape, where the `--from <Tab>` beat listed every subcommand instead of `alice`, `bob`, …
