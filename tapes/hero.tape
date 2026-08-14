# hero — the top-of-README loop: ask three different chains for state with no
# endpoint, no config file, and no setup step.

Output docs/static/vhs/hero.gif
Output docs/static/vhs/hero.webm
Output docs/static/vhs/hero.mp4

Source tapes/theme.tape

# Sized to the Assets.Asset JSON, the tallest screen in this tape.
Set Height 660

Source tapes/shell.tape

Type "# no RPC endpoints, no config — every chain is built in"
Enter
Sleep 1s

Type "dot polkadot.query.System.Number"
Enter
Sleep 3s

Type "dot polkadot.query.Balances.TotalIssuance"
Enter
Sleep 3s

Type "dot polkadot-asset-hub.query.Assets.Asset 1337"
Enter
Sleep 5s
