---
"polkadot-cli": minor
---

Add first-class Codex support to the agent skill, and a `dot skill` command to distribute it. The `dot-cli` SKILL.md was already format-compatible with Codex (same `name`/`description` frontmatter, same `references/` layout) — the gap was purely distribution, since Codex has no marketplace and instead scans `~/.agents/skills` (and repo `.agents/skills`).

The skill markdown is now bundled into the `dot` binary, making the installed CLI the single, version-matched source of truth for its own skill:

- `dot skill show` — print the guide to stdout (`--references` includes bundled reference docs).
- `dot skill install --codex` — install into `~/.agents/skills/dot-cli` (Codex auto-discovers it).
- `dot skill install --claude` — install into `~/.claude/skills/dot-cli` (the Claude Code plugin marketplace still works too).
- `--local` installs into the current repo, `--path <dir>` into an explicit directory, and `dot skill path` prints where each agent's copy lives.

Freshness comes from re-running `dot skill install` after upgrading `dot` — the design does not rely on an agent self-invoking a command from the skill text. Closes #278.
