# accounts — create a key, name an address you only want to watch, derive a
# child, then use those names as arguments anywhere an address is expected.
#
# The mnemonic on screen belongs to an account created seconds earlier in a
# throwaway config root, and is discarded with it.

Output docs/static/vhs/accounts.gif
Output docs/static/vhs/accounts.webm
Output docs/static/vhs/accounts.mp4

Source tapes/theme.tape

# Sized to the last screen, which carries both the inspect table and the account
# query beneath it.
Set Height 760

Source tapes/shell.tape

Type "# a keypair, generated and stored locally"
Enter
Sleep 1s

Type "dot account create demo"
Enter
Sleep 4s
Ctrl+L

# 13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB is the real Polkadot Treasury,
# named here as a watch-only account: no secret, usable as a query target.
Type "# name an address you only want to watch, and derive a child key"
Enter
Sleep 1s

Type "dot account add treasury 13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB"
Enter
Sleep 2500ms

Type "dot account derive demo demo-hot --path //hot"
Enter
Sleep 2500ms

Type "dot account list"
Enter
Sleep 4s
Ctrl+L

Type "# one account, three address shapes — and names work as arguments"
Enter
Sleep 1s

Type "dot account inspect demo"
Enter
Sleep 3500ms

Type "dot polkadot-asset-hub.query.System.Account treasury"
Enter
Sleep 5s
