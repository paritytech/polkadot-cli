import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CAC } from "cac";
import scriptingPatternsMd from "../../dot-cli/references/scripting-patterns.md" with {
  type: "text",
};
// The skill markdown is bundled into the binary at build time from the single
// source of truth in `dot-cli/`. That makes the installed `dot` its own
// distribution channel: `dot skill install` always writes the version that
// matches the running CLI (the same files the Claude Code marketplace serves).
import skillMd from "../../dot-cli/SKILL.md" with { type: "text" };
import { version } from "../../package.json";
import { isJsonOutput, writeStdout } from "../core/output.ts";
import { withHelp } from "../platform/cli.ts";
import { CliError } from "../utils/errors.ts";

/** Directory name the skill lives under, and its `name:` frontmatter value. */
export const SKILL_NAME = "dot-cli";

export interface SkillFile {
  /** Path relative to the skill directory. */
  rel: string;
  content: string;
}

/**
 * Stamp the CLI version into the SKILL.md frontmatter. Copies written by
 * `dot skill install` (or printed by `dot skill show`) carry the version of
 * the binary that produced them, so an agent can compare it against
 * `dot --version` and detect a stale skill. The source file in `dot-cli/`
 * stays unstamped — the marketplace serves it raw and versions it itself.
 */
function stampVersion(content: string): string {
  return content.replace(/^name: dot-cli$/m, `name: dot-cli\nversion: ${version}`);
}

/**
 * The complete skill, in the order it should be installed/printed. The first
 * entry is `SKILL.md`; the rest are bundled reference docs it links to.
 */
export const SKILL_FILES: SkillFile[] = [
  { rel: "SKILL.md", content: stampVersion(skillMd) },
  { rel: "references/scripting-patterns.md", content: scriptingPatternsMd },
];

export type SkillAgent = "codex" | "claude";

/** Skills directory each agent scans, relative to the base (home or repo). */
const AGENT_SCAN_DIR: Record<SkillAgent, string> = {
  // Codex scans `~/.agents/skills` (user) and `.agents/skills` (repo).
  codex: join(".agents", "skills"),
  // Claude Code discovers personal skills in `~/.claude/skills` (repo: `.claude/skills`).
  claude: join(".claude", "skills"),
};

export interface SkillTarget {
  /** Human label for output: the agent name, or "path". */
  label: string;
  /** Absolute path of the skill directory to write into. */
  dir: string;
}

/**
 * Resolve the skill directory for an agent. `local` targets the current repo
 * (`.agents`/`.claude` under `cwd`) instead of the user's home directory.
 */
export function agentSkillDir(
  agent: SkillAgent,
  local: boolean,
  home: string = homedir(),
  cwd: string = process.cwd(),
): string {
  const base = local ? cwd : home;
  return join(base, AGENT_SCAN_DIR[agent], SKILL_NAME);
}

export interface SkillOpts {
  codex?: boolean;
  claude?: boolean;
  local?: boolean;
  path?: string;
  references?: boolean;
  json?: boolean;
  output?: string;
}

/**
 * Targets named explicitly via `--codex`/`--claude`/`--path` (in that order).
 * May be empty when the user gave no target.
 */
function explicitTargets(
  opts: SkillOpts,
  home: string = homedir(),
  cwd: string = process.cwd(),
): SkillTarget[] {
  const targets: SkillTarget[] = [];
  if (opts.path) {
    targets.push({ label: "path", dir: join(resolve(opts.path), SKILL_NAME) });
  }
  if (opts.codex) {
    targets.push({ label: "codex", dir: agentSkillDir("codex", !!opts.local, home, cwd) });
  }
  if (opts.claude) {
    targets.push({ label: "claude", dir: agentSkillDir("claude", !!opts.local, home, cwd) });
  }
  return targets;
}

/** Write every skill file into `target.dir`, creating parents. Returns paths written. */
export async function installSkill(target: SkillTarget): Promise<string[]> {
  const written: string[] = [];
  for (const file of SKILL_FILES) {
    const dest = join(target.dir, file.rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.content, "utf-8");
    written.push(dest);
  }
  return written;
}

export async function handleSkillShow(opts: SkillOpts = {}): Promise<void> {
  const files = opts.references ? SKILL_FILES : SKILL_FILES.slice(0, 1);
  if (isJsonOutput(opts)) {
    await writeStdout(`${JSON.stringify({ name: SKILL_NAME, files }, null, 2)}\n`);
    return;
  }
  // SKILL.md first; any reference docs follow with a comment marker so the
  // output stays a single pipeable document.
  const [main, ...rest] = files;
  await writeStdout(main!.content);
  for (const file of rest) {
    await writeStdout(`\n\n<!-- ${file.rel} -->\n\n${file.content}`);
  }
}

export async function handleSkillInstall(
  opts: SkillOpts,
  home: string = homedir(),
  cwd: string = process.cwd(),
): Promise<void> {
  const targets = explicitTargets(opts, home, cwd);
  if (targets.length === 0) {
    throw new CliError(
      "Specify where to install: --codex, --claude, or --path <dir>.\n" +
        "  dot skill install --codex     # ~/.agents/skills/dot-cli (Codex CLI)\n" +
        "  dot skill install --claude    # ~/.claude/skills/dot-cli (Claude Code)",
    );
  }

  const installed: { label: string; dir: string; files: string[] }[] = [];
  for (const target of targets) {
    installed.push({ label: target.label, dir: target.dir, files: await installSkill(target) });
  }

  if (isJsonOutput(opts)) {
    await writeStdout(`${JSON.stringify({ name: SKILL_NAME, installed }, null, 2)}\n`);
    return;
  }
  for (const result of installed) {
    await writeStdout(`Installed "${SKILL_NAME}" skill for ${result.label} at ${result.dir}\n`);
  }
  await writeStdout(
    "The skill auto-triggers when you ask about `dot`, Substrate queries, tx, runtime APIs, or XCM.\n" +
      "Re-run this after upgrading `dot` to refresh the skill to the new version.\n",
  );
}

export async function handleSkillPath(
  opts: SkillOpts,
  home: string = homedir(),
  cwd: string = process.cwd(),
): Promise<void> {
  // With no explicit target, show where each agent would install; `--local`
  // alone switches that default from the home directory to the current repo.
  const explicit = explicitTargets(opts, home, cwd);
  const targets =
    explicit.length > 0
      ? explicit
      : [
          { label: "codex", dir: agentSkillDir("codex", !!opts.local, home, cwd) },
          { label: "claude", dir: agentSkillDir("claude", !!opts.local, home, cwd) },
        ];

  if (isJsonOutput(opts)) {
    await writeStdout(`${JSON.stringify(targets, null, 2)}\n`);
    return;
  }
  for (const target of targets) {
    await writeStdout(`${target.label}: ${target.dir}\n`);
  }
}

const SKILL_HELP = `dot skill — install or print the agent skill that teaches AI agents to drive \`dot\`

Usage:
  dot skill [show]                 Print SKILL.md to stdout (--references for the full bundle)
  dot skill install [target]       Install the skill into an agent's skills directory
  dot skill path [target]          Print where the skill would be installed

Targets:
  --codex            Codex CLI    (~/.agents/skills/dot-cli)
  --claude           Claude Code  (~/.claude/skills/dot-cli)
  --local            Install into the current repo instead of your home directory
  --path <dir>       Install into an explicit directory (<dir>/dot-cli)

Options:
  --references       Include bundled reference docs when printing
  --json             Machine-readable output

Examples:
  dot skill install --codex
  dot skill install --claude --local
  dot skill show | less
  dot skill install --path ./vendor/skills`;

export function registerSkillCommand(cli: CAC) {
  const command = cli
    .command("skill [action]", "Install or print the agent skill (Claude Code, Codex)")
    .option("--codex", "Target the Codex CLI skills directory")
    .option("--claude", "Target the Claude Code skills directory")
    .option("--local", "Install into the current repo instead of your home directory")
    .option("--path <dir>", "Install into an explicit directory")
    .option("--references", "Include bundled reference docs when printing")
    .action(async (action: string | undefined, opts: SkillOpts) => {
      switch (action ?? "show") {
        case "show":
          return handleSkillShow(opts);
        case "install":
          return handleSkillInstall(opts);
        case "path":
          return handleSkillPath(opts);
        default:
          throw new CliError(`Unknown skill action "${action}". Use one of: show, install, path.`);
      }
    });
  withHelp(command, () => console.log(SKILL_HELP));
}
