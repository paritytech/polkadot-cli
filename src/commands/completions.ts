import type { CAC } from "cac";
import { withHelp } from "../platform/cli.ts";

const ZSH_SCRIPT = `\
_dot_completions() {
  emulate -L zsh
  local -a completions
  local current_word="\${words[CURRENT]}"
  # (@) keeps each preceding word separate — a quoted subscript range without it
  # joins them into one argument, which hides the flag from the completer and
  # breaks value completion for \`--from\` / \`--chain\`.
  local preceding=("\${(@)words[2,CURRENT-1]}")

  # Build args: -- <current_word> <preceding_words...>
  local args=("__complete" "--" "\${current_word}")
  args+=("\${preceding[@]}")

  local output
  output="$(dot "\${args[@]}" 2>/dev/null)"
  [[ -z "$output" ]] && return

  completions=("\${(@f)output}")

  compadd -S '' -- "\${completions[@]}"
}

compdef _dot_completions dot`;

const BASH_SCRIPT = `\
_dot_completions() {
  local current_word="\${COMP_WORDS[COMP_CWORD]}"
  local preceding=("\${COMP_WORDS[@]:1:COMP_CWORD-1}")

  # Build args: -- <current_word> <preceding_words...>
  local args=("__complete" "--" "\${current_word}")
  args+=("\${preceding[@]}")

  local IFS=$'\\n'
  local completions
  completions=($(dot "\${args[@]}" 2>/dev/null))

  [[ \${#completions[@]} -eq 0 ]] && return

  compopt -o nospace
  COMPREPLY=("\${completions[@]}")
}

complete -F _dot_completions dot`;

const FISH_SCRIPT = `\
function __dot_complete
  set -l tokens (commandline -opc)
  set -l current (commandline -ct)

  set -l args "__complete" "--" "$current"
  for t in $tokens[2..-1]
    set -a args "$t"
  end

  dot $args 2>/dev/null
end

complete -c dot -f -a '(__dot_complete)'`;

const SETUP_INSTRUCTIONS: Record<string, string> = {
  zsh: `# Add this to your ~/.zshrc:
#   eval "$(dot completions zsh)"
# Then restart your shell or run: source ~/.zshrc`,
  bash: `# Add this to your ~/.bashrc:
#   eval "$(dot completions bash)"
# Then restart your shell or run: source ~/.bashrc`,
  fish: `# Save this to ~/.config/fish/completions/dot.fish:
#   dot completions fish > ~/.config/fish/completions/dot.fish`,
};

const SCRIPTS: Record<string, string> = {
  zsh: ZSH_SCRIPT,
  bash: BASH_SCRIPT,
  fish: FISH_SCRIPT,
};

export function registerCompletionsCommand(cli: CAC) {
  const command = cli
    .command("completions <shell>", "Generate shell completion script (zsh, bash, fish)")
    .action((shell: string) => {
      const script = SCRIPTS[shell];
      if (!script) {
        console.error(
          `Unsupported shell "${shell}". Supported: ${Object.keys(SCRIPTS).join(", ")}`,
        );
        process.exit(1);
      }

      // Print setup instructions to stderr so they don't pollute the script,
      // and only when stdout is a TTY — inside `eval "$(dot completions zsh)"`
      // or a redirect, stderr still reaches the terminal and would print the
      // instructions on every shell startup.
      const instructions = SETUP_INSTRUCTIONS[shell];
      if (instructions && process.stdout.isTTY) {
        process.stderr.write(`${instructions}\n`);
      }

      // Print the script to stdout
      console.log(script);
    });
  withHelp(command);
}
