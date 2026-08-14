# inspect — the runtime documents itself: storage shapes, call arguments, event
# fields and error meanings, all read from cached metadata with no network.
#
# Ends on the event/error pair rather than the call, whose rustdoc footer link
# makes for a scrappy final frame.

Output docs/static/vhs/inspect.gif
Output docs/static/vhs/inspect.webm
Output docs/static/vhs/inspect.mp4

Source tapes/theme.tape

# Screens are cleared between beats, so this only has to hold the tallest one
# (the System.Account struct).
Set Height 520

Source tapes/shell.tape

Type "# the chain's metadata is the documentation — offline, no network"
Enter
Sleep 1s

Type "dot inspect polkadot.System.Account"
Enter
Sleep 4s
Ctrl+L

Type "dot inspect polkadot.tx.Balances.transfer_keep_alive"
Enter
Sleep 4500ms
Ctrl+L

Type "dot inspect polkadot.Balances.Transfer"
Enter
Sleep 2500ms

Type "dot inspect polkadot.Balances.InsufficientBalance"
Enter
Sleep 4s
