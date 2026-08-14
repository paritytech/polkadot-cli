# Clean, predictable shell for VHS recordings.
#
# scripts/tapes.ts points ZDOTDIR here, and tapes/theme.tape sources this file
# again defensively — so a recording never picks up a personal ~/.zshrc prompt,
# plugin, or alias no matter how vhs was invoked.

[ -n "$DOT_DEMO_SHELL_READY" ] && return
DOT_DEMO_SHELL_READY=1

# Drop anything a personal rc file may already have installed.
precmd_functions=()
preexec_functions=()
unset RPROMPT RPS1
PROMPT='%F{5}❯%f '

# tapes/demo/bin holds the `dot` shim pointing at this checkout's build.
demo_root=${${(%):-%x}:A:h:h}
export PATH="$demo_root/bin:$PATH"

# Throwaway config root — recordings must never read or write ~/.polkadot.
export DOT_HOME=${DOT_HOME:-/tmp/dot-demo}
export DOT_NO_UPDATE_CHECK=1

# No history, no autocorrect prompt, no bell, and `#` captions are real
# comments rather than "command not found".
unset HISTFILE
setopt NO_BEEP INTERACTIVE_COMMENTS
unsetopt CORRECT CORRECT_ALL

# Completions: compinit into a scratch dir, then the CLI's own zsh completer.
autoload -Uz compinit
compinit -u -d /tmp/dot-demo-zcompdump
LISTMAX=1000 # never interrupt a take with "show all N possibilities?"
eval "$(dot completions zsh)"
