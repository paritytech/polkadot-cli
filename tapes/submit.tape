# submit — a real extrinsic on Paseo Asset Hub: dry-run it, then sign, broadcast
# and wait for a block, ending on the events the chain emitted and a link to the
# transaction in an explorer.
#
# Needs DOT_TAPE_SIGNER set to the throwaway Paseo signer's mnemonic; the runner
# registers it as the env-backed account `demo` and skips this tape when the
# secret is absent. The mnemonic never enters this file.
#
# Every recording of this tape spends real (testnet) funds.

Output docs/static/vhs/submit.gif
Output docs/static/vhs/submit.webm
Output docs/static/vhs/submit.mp4

Source tapes/theme.tape

# The one tape that overrides the shared font size. The submission report is by
# far the widest and tallest output in the set — 64-char hashes, an address per
# event, two explorer URLs — and at the shared size it wrapped and scrolled, which
# pushed the sign/broadcast/in-block progression off the final frame. Trading
# columns for glyph size keeps the whole receipt on one screen.
Set FontSize 16
Set Height 790

Source tapes/shell.tape

Type "# a real transfer on Paseo Asset Hub — dry-run it first"
Enter
Sleep 1s

Type "dot paseo-asset-hub.tx.Balances.transfer_keep_alive bob 10000000000 --from demo --dry-run"
Enter
Sleep 5s
Ctrl+L

Type "# now for real: sign, broadcast, wait for a block"
Enter
Sleep 1s

Type "dot paseo-asset-hub.tx.Balances.transfer_keep_alive bob 10000000000 --from demo -w best"
Enter
Sleep 12s
