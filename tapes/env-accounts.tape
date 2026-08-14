# env-accounts — the CI story: an account whose secret lives in an environment
# variable, so the workspace holding it can be committed.
#
# The arc ends on a failure on purpose: with the variable unset the signer cannot
# sign, which is the proof that the committed files carry no key material.
#
# The seed in the fixture .env is a synthetic 32-byte value written by
# scripts/tapes.ts — never a real key, and never printed on screen.

Output docs/static/vhs/env-accounts.gif
Output docs/static/vhs/env-accounts.webm
Output docs/static/vhs/env-accounts.mp4

Source tapes/theme.tape

# Three cleared screens, the tallest being the stored account record.
Set Height 470

Source tapes/shell.tape

# Sandboxed like the workspaces tape: DOT_HOME would override workspace
# discovery, and HOME keeps the walk-up away from a real ~/.polkadot.
Hide
Type "export HOME=/tmp/dot-demo-home; unset DOT_HOME; cd ~/ci-project"
Enter
Ctrl+L
Sleep 300ms
Show

Type "# a signer whose secret lives in the environment, never on disk"
Enter
Sleep 1s

Type "cat .gitignore"
Enter
Sleep 2500ms

Type "set -a; source .env; set +a"
Enter
Sleep 500ms

Type "dot account add ci-signer --env DOT_CI_SIGNER"
Enter
Sleep 3500ms
Ctrl+L

Type "# what the workspace stores is a variable name, not a secret"
Enter
Sleep 1s

Type "cat .polkadot/accounts.json"
Enter
Sleep 4500ms
Ctrl+L

Type "# so it is safe to commit — and with the variable gone, nothing signs"
Enter
Sleep 1500ms

Type `dot sign "release v1.2.3" --from ci-signer`
Enter
Sleep 3500ms

Type `env -u DOT_CI_SIGNER dot sign "release v1.2.3" --from ci-signer`
Enter
Sleep 4s
