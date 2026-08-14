# Shared look for every polkadot-cli tape — settings only, no commands, so a
# tape can override any of them afterwards (VHS applies settings in order, and
# they must all precede the first command).
#
# Each tape sources this first, then sets its own Height — sized so the busiest
# screen fills the frame without leaving a band of dead black — then sources
# tapes/shell.tape to start the shell. Paths are relative to the repo root, so
# always record via `bun run tapes`.

Require node

Set Shell zsh
Set FontFamily "iA Writer Mono V, JetBrains Mono, Menlo, monospace"
Set FontSize 20
Set Width 1200
Set Padding 30
Set Margin 0
Set BorderRadius 0
Set CursorBlink false
Set TypingSpeed 45ms
Set Framerate 24

# Pure black to sit flush inside the docs site's code blocks, with the ANSI
# slots the CLI actually uses (cyan field names, yellow primitives, magenta
# containers, green enum variants) mapped onto the Polkadot palette.
Set Theme { "name": "polkadot", "background": "#000000", "foreground": "#E6E6E6", "cursor": "#FF2670", "selection": "#7916F3", "black": "#1B1B1B", "red": "#FF2670", "green": "#56F5A4", "yellow": "#E4FF07", "blue": "#7916F3", "magenta": "#FF2670", "cyan": "#07FFFF", "white": "#E6E6E6", "brightBlack": "#6E6E6E", "brightRed": "#FF5C8F", "brightGreen": "#7BFFC0", "brightYellow": "#F0FF6B", "brightBlue": "#9E5CF7", "brightMagenta": "#FF5C8F", "brightCyan": "#6BFFFF", "brightWhite": "#FFFFFF" }
