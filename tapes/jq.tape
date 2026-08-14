# jq — every command speaks JSON with --json, and stdout carries nothing but the
# data, so a whole storage map can go straight into jq and be aggregated.
#
# Beats use `dot polkadot-asset-hub…Staking.Validators` rather than the relay:
# staking now lives on Asset Hub, and the relay's map is empty.

Output docs/static/vhs/jq.gif
Output docs/static/vhs/jq.webm
Output docs/static/vhs/jq.mp4

Source tapes/theme.tape

# Every beat is a one-line answer, so this stays short.
Set Height 340

Source tapes/shell.tape

Type "# --json output pipes straight into jq"
Enter
Sleep 1s

Type "dot polkadot.query.System.Number --json | jq '.+1'"
Enter
Sleep 3s

Type "# --dump fetches every entry in a storage map"
Enter
Sleep 1500ms

Type "V=$(dot polkadot-asset-hub.query.Staking.Validators --dump --json)"
Enter
Sleep 4s

Type `echo "$V" | jq length`
Enter
Sleep 2500ms

Type `echo "$V" | jq "[.[] | select(.value.blocked)] | length"`
Enter
Sleep 4s
