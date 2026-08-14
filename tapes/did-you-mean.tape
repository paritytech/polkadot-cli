# did-you-mean — a typo should be a hint, not a stack trace. Every name the CLI
# resolves is fuzzy-matched on failure, whether it comes from metadata (pallets,
# storage items, constants, runtime API methods) or from the local config
# (account names), and a call with the wrong arity answers with its signature.
#
# Deterministic: the suggestions come from cached metadata and the built-in dev
# accounts, so only the one successful query touches the network.
#
# Closes on the account error, the tallest screen, so the frame the viewer is
# left looking at is a full one.

Output docs/static/vhs/did-you-mean.gif
Output docs/static/vhs/did-you-mean.webm
Output docs/static/vhs/did-you-mean.mp4

Source tapes/theme.tape

# Sized for the account error, which lists every name it could have meant.
Set Height 380

Source tapes/shell.tape

Type "# misspell a pallet and the CLI names the ones you might have meant"
Enter
Sleep 1200ms

Type "dot polkadot.query.Systm.Numbr"
Enter
Sleep 2500ms

Type "dot polkadot.query.System.Numbr"
Enter
Sleep 2500ms

Type "dot polkadot.query.System.Number"
Enter
Sleep 2500ms
Ctrl+L

Type "# the wrong number of arguments answers with the call's own signature"
Enter
Sleep 1200ms

Type "dot polkadot.tx.Balances.transfer_keep_alive bob --from alice --dry-run"
Enter
Sleep 3500ms
Ctrl+L

Type "# and account names match against this config root, not a static list"
Enter
Sleep 1500ms

Type "dot polkadot.tx.Balances.transfer_keep_alive bob 1 --from alise --dry-run"
Enter
Sleep 5s
