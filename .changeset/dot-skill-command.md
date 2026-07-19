---
"polkadot-cli": minor
---

Add a `dot skill` subcommand that makes the installed binary the source of AI-facing truth, keeping the Claude Code skill in sync with the installed CLI.

- `dot skill` prints the `SKILL.md` baked into this binary version to stdout.
- `dot skill install` writes it to `~/.claude/skills/dot-cli/SKILL.md` (creating the directory, overwriting if present, and printing where it wrote). `--path <file>` overrides the destination.

The SKILL.md is embedded into the bundled `dist/cli.mjs` at build time via a codegen step (`scripts/generate-skill-md.ts` → `src/generated/skill-md.ts`), wired into `bun run build`. This means the content travels inside the binary itself — version-accurate, no network, and no dependency on `dot-cli/SKILL.md` being shipped in the npm tarball (it isn't). The codegen runs on every build, so the embedded skill can never drift from the repo's `dot-cli/SKILL.md`.
