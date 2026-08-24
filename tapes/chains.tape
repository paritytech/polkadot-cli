# chains — batteries included, then bring your own. The Polkadot and Paseo
# families ship preconfigured with fallback endpoints; any other Substrate chain
# is one `chain add` away, and its parachain ID is read off the chain rather than
# typed in.
#
# The runner deliberately caches metadata only for `polkadot` here: hydration has
# to be genuinely unknown for `chain add` to mean anything.

Output docs/static/vhs/chains.gif
Output docs/static/vhs/chains.webm
Output docs/static/vhs/chains.mp4

Source tapes/theme.tape

# Sized for the add-then-inspect screen, which is taller than the tree: the
# caption and the `chain add` command have to stay in frame above their output.
Set Height 700

Source tapes/shell.tape

Type "# the Polkadot and Paseo families ship preconfigured, endpoints included"
Enter
Sleep 1200ms

Type "dot chain list"
Enter
Sleep 4500ms
Ctrl+L

Type "# any other Substrate chain: point at an RPC, keep the paraId to yourself"
Enter
Sleep 1500ms

Type "dot chain add hydration --rpc wss://hydration-rpc.n.dwellir.com --relay polkadot"
Enter
Sleep 6s

Type "dot chain hydration"
Enter
Sleep 4500ms

Type "dot hydration.query.System.Number"
Enter
Sleep 3500ms
