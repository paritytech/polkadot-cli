# dry-run — see the call before you sign it. --dry-run decodes the extrinsic and
# estimates the fee without broadcasting, --encode prints just the call bytes for
# an offline signer or a multisig, and DOT_DRY_RUN=1 makes the whole shell safe:
# every tx in the session is simulated, whether or not it passes --dry-run.

Output docs/static/vhs/dry-run.gif
Output docs/static/vhs/dry-run.webm
Output docs/static/vhs/dry-run.mp4

Source tapes/theme.tape

# Two points below the shared size, so the 84-character call hex fits on one line
# in both the simulation report and the --encode output. At 20 it wraps, and a
# call hash broken across two lines is exactly the thing a reader wants to copy.
Set FontSize 18
Set Height 490

Source tapes/shell.tape

Type "# what would this transaction actually do? nothing leaves the machine"
Enter
Sleep 1200ms

Type "dot polkadot-asset-hub.tx.Balances.transfer_keep_alive bob 10000000000 --from alice --dry-run"
Enter
Sleep 5s
Ctrl+L

Type "# just the call bytes, for an offline signer or a multisig"
Enter
Sleep 1200ms

Type "dot polkadot-asset-hub.tx.Balances.transfer_keep_alive bob 10000000000 --encode"
Enter
Sleep 3s
Ctrl+L

Type "# and a safety net for scripts: simulate every tx in the session"
Enter
Sleep 1200ms

Type "export DOT_DRY_RUN=1"
Enter
Sleep 800ms

Type "dot polkadot-asset-hub.tx.Balances.transfer_keep_alive bob 10000000000 --from alice"
Enter
Sleep 5500ms
