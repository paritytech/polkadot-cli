# workspaces — `dot init` puts a .polkadot/ in any directory, discovered
# git-style, and an identity created inside it does not exist outside it.
#
# Sandboxing: the hidden setup points HOME at /tmp/dot-demo-home and unsets
# DOT_HOME, because DOT_HOME takes precedence over workspace discovery and would
# mask the very feature being shown. The shell then works entirely inside that
# fake home — which is essential, not cosmetic: discovery walks up from the
# current directory and stops at $HOME, so running this anywhere outside the
# sandbox would let it reach the operator's real ~/.polkadot.

Output docs/static/vhs/workspaces.gif
Output docs/static/vhs/workspaces.webm
Output docs/static/vhs/workspaces.mp4

Source tapes/theme.tape

# Holds the whole session: both workspaces, the created account, and the error
# that proves the isolation. Nothing is cleared, so the contrast stays readable.
Set Height 760

Source tapes/shell.tape

Hide
Type "export HOME=/tmp/dot-demo-home; unset DOT_HOME; cd ~/paseo"
Enter
Ctrl+L
Sleep 300ms
Show

Type "# any directory can hold its own chains and accounts"
Enter
Sleep 1s

Type "dot init"
Enter
Sleep 2s

Type "dot which"
Enter
Sleep 2500ms

Type "dot account create sudo"
Enter
Sleep 4s

Type "# step out of the directory and that identity is simply gone"
Enter
Sleep 1500ms

Type "cd .."
Enter
Sleep 500ms

Type "dot which"
Enter
Sleep 2500ms

Type "dot account inspect sudo"
Enter
Sleep 4s
