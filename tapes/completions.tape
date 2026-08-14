# completions — tab your way through a runtime you've never read, then run the
# thing you just discovered. Every candidate comes from the chain's metadata.
#
# Keystrokes assume zsh's default behaviour of inserting the longest common
# prefix on Tab, so each Type after a Tab supplies only the missing characters.
# Candidate sets verified with `dot __complete -- <word>`.

Output docs/static/vhs/completions.gif
Output docs/static/vhs/completions.webm
Output docs/static/vhs/completions.mp4

Source tapes/theme.tape

# Tall enough for a listing plus the dry-run report that closes the tape.
Set Height 560

Source tapes/shell.tape

Type "# tab completion is driven by the chain's own metadata"
Enter
Sleep 1s

# "pol" -> the chains, "." -> the categories, "query.Sys" -> the only pallet
# that matches, then a real query against Polkadot.
Type "dot pol"
Tab
Sleep 2s
Type "."
Tab
Sleep 2500ms
Type "query.Sys"
Tab
Sleep 1500ms
Type "Number"
Enter
Sleep 3s
Ctrl+L

# Same idea on the call side: narrow to a call, complete an account name, and
# finish on a dry-run that decodes the call and prices it.
Type "dot polkadot.tx.Bal"
Tab
Sleep 1500ms
Type "tr"
Tab
Sleep 2500ms
Type "keep"
Tab
Sleep 1500ms
Type " bob 10000000000 --from "
Tab
Sleep 2s
Type "alice --dry-run"
Enter
Sleep 5s
