# Starts the recording shell, off camera. Sourced by every tape as the last
# statement before its first visible beat — everything after this point is a
# command, so no tape may set a setting past here.
#
# tapes/demo/zdotdir/.zshrc is already active via ZDOTDIR when recording through
# `bun run tapes`; sourcing it again is a guarded no-op that also covers a bare
# `vhs tapes/<name>.tape`, where a personal ~/.zshrc would otherwise be in frame.

Hide
Type "source tapes/demo/zdotdir/.zshrc"
Enter
Ctrl+L
Sleep 500ms
Show
