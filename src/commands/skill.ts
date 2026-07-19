import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CAC } from "cac";
import { SKILL_MD } from "../generated/skill-md.ts";
import { withHelp } from "../platform/cli.ts";

/**
 * Default install location for the Claude Code skill. Claude Code discovers
 * user skills under `~/.claude/skills/<name>/SKILL.md`.
 */
function defaultSkillPath(): string {
  return join(homedir(), ".claude", "skills", "dot-cli", "SKILL.md");
}

function printSkillHelp(): void {
  console.log("Usage:");
  console.log(
    "  dot skill                 Print the Claude skill (SKILL.md) baked into this binary",
  );
  console.log(
    "  dot skill install         Write that SKILL.md to ~/.claude/skills/dot-cli/SKILL.md",
  );
  console.log();
  console.log("Options (install):");
  console.log("  --path <file>             Write to a custom path instead of the default location");
  console.log();
  console.log("Why:");
  console.log("  The printed/installed skill is the version that ships with THIS `dot` binary,");
  console.log("  so the Claude skill stays in sync with the installed CLI — upgrade `dot`, run");
  console.log("  `dot skill install` again, and the skill matches.");
  console.log();
  console.log("Examples:");
  console.log("  dot skill                 # print to stdout");
  console.log("  dot skill | less          # page through it");
  console.log("  dot skill install         # install for Claude Code");
  console.log("  dot skill install --path ./SKILL.md");
}

export function registerSkillCommand(cli: CAC) {
  const command = cli
    .command(
      "skill [action]",
      "Print or install the Claude skill (SKILL.md) baked into this binary",
    )
    .option("--path <file>", "Custom install path (for `skill install`)")
    .action((action: string | undefined, opts: { path?: string }) => {
      if (!action) {
        // `dot skill` → print the embedded SKILL.md to stdout.
        process.stdout.write(SKILL_MD);
        if (!SKILL_MD.endsWith("\n")) process.stdout.write("\n");
        return;
      }

      if (action === "install") {
        const target = opts.path ?? defaultSkillPath();
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, SKILL_MD);
        console.log(`Installed dot-cli skill to ${target}`);
        console.log("Restart Claude Code (or start a new session) to pick up the skill.");
        return;
      }

      console.error(`Unknown action "${action}". Use "dot skill" or "dot skill install".`);
      process.exit(1);
    });
  withHelp(command, printSkillHelp);
}
