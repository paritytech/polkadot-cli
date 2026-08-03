import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cac } from "cac";
import { version } from "../../package.json";
import { patchStdout } from "../test-helpers/patch-stdout.ts";
import {
  agentSkillDir,
  handleSkillInstall,
  handleSkillPath,
  handleSkillShow,
  installSkill,
  registerSkillCommand,
  SKILL_FILES,
  SKILL_NAME,
} from "./skill.ts";

const cleanups: string[] = [];
function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

// bun test --concurrent runs tests within this file in parallel, and they
// share the process-global stdout stream. A module-scoped lock serializes
// captures so one test's patch can never swallow another's output (same
// pattern as withDotHome in workspace.test.ts).
let stdoutLock: Promise<unknown> = Promise.resolve();

/** Run `fn` with stdout captured in-process; return everything it wrote. */
async function capture(fn: () => Promise<void>): Promise<string> {
  const prior = stdoutLock;
  let release: () => void = () => {};
  stdoutLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await prior;
  } catch {
    // ignore prior errors
  }
  let out = "";
  const restore = patchStdout((msg) => {
    out += msg;
  });
  try {
    await fn();
  } finally {
    restore();
    release();
  }
  return out;
}

describe("skill content bundle", () => {
  test("SKILL.md is the first bundled file and carries the dot-cli frontmatter", () => {
    const main = SKILL_FILES[0];
    expect(main?.rel).toBe("SKILL.md");
    expect(main?.content).toContain("name: dot-cli");
    expect(main?.content.length).toBeGreaterThan(100);
  });

  test("the bundled SKILL.md frontmatter is stamped with the CLI version", () => {
    expect(SKILL_FILES[0]?.content).toContain(`name: dot-cli\nversion: ${version}\n`);
    // The source file stays unstamped — the marketplace serves it raw.
    const source = readFileSync(join(import.meta.dir, "../../dot-cli/SKILL.md"), "utf-8");
    expect(source).not.toContain("\nversion:");
  });

  test("the reference doc it links to is bundled too", () => {
    const rels = SKILL_FILES.map((f) => f.rel);
    expect(rels).toContain("references/scripting-patterns.md");
    for (const file of SKILL_FILES) expect(file.content.length).toBeGreaterThan(0);
  });

  test("every file in dot-cli/ is in the bundle — a new reference doc must be added to SKILL_FILES", () => {
    const skillSrcDir = join(import.meta.dir, "../../dot-cli");
    const onDisk = readdirSync(skillSrcDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(skillSrcDir.length + 1));
    const bundled = SKILL_FILES.map((f) => f.rel);
    expect(bundled.toSorted()).toEqual(onDisk.toSorted());
  });
});

describe("agentSkillDir", () => {
  test("codex resolves to ~/.agents/skills/dot-cli", () => {
    expect(agentSkillDir("codex", false, "/home/u", "/repo")).toBe(
      join("/home/u", ".agents", "skills", SKILL_NAME),
    );
  });
  test("claude resolves to ~/.claude/skills/dot-cli", () => {
    expect(agentSkillDir("claude", false, "/home/u", "/repo")).toBe(
      join("/home/u", ".claude", "skills", SKILL_NAME),
    );
  });
  test("--local targets the repo instead of home", () => {
    expect(agentSkillDir("codex", true, "/home/u", "/repo")).toBe(
      join("/repo", ".agents", "skills", SKILL_NAME),
    );
  });
});

describe("installSkill", () => {
  test("writes every bundled file, byte-identical, under the target dir", async () => {
    const dir = join(scratch("dot-skill-install-"), SKILL_NAME);
    const written = await installSkill({ label: "path", dir });

    expect(written).toHaveLength(SKILL_FILES.length);
    for (const file of SKILL_FILES) {
      const dest = join(dir, file.rel);
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, "utf-8")).toBe(file.content);
    }
  });
});

describe("handleSkillInstall", () => {
  test("--codex installs into a sandboxed home, never a real user dir", async () => {
    const home = scratch("dot-skill-home-");
    const out = await capture(() => handleSkillInstall({ codex: true }, home, "/unused"));

    const skillMd = join(home, ".agents", "skills", SKILL_NAME, "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
    expect(out).toContain("Installed");
    expect(out).toContain("codex");
  });

  test("--claude installs into a sandboxed home, never a real user dir", async () => {
    const home = scratch("dot-skill-home-");
    const out = await capture(() => handleSkillInstall({ claude: true }, home, "/unused"));

    const skillMd = join(home, ".claude", "skills", SKILL_NAME, "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
    expect(out).toContain("claude");
  });

  test("--path installs into <dir>/dot-cli", async () => {
    const dir = scratch("dot-skill-path-");
    const out = await capture(() =>
      handleSkillInstall({ path: dir }, "/unused-home", "/unused-cwd"),
    );

    expect(existsSync(join(dir, SKILL_NAME, "SKILL.md"))).toBe(true);
    expect(out).toContain(join(dir, SKILL_NAME));
  });

  test("re-running install overwrites cleanly (upgrade refresh)", async () => {
    const home = scratch("dot-skill-rehome-");
    await capture(() => handleSkillInstall({ codex: true }, home, "/unused"));
    await capture(() => handleSkillInstall({ codex: true }, home, "/unused"));

    const skillMd = join(home, ".agents", "skills", SKILL_NAME, "SKILL.md");
    expect(readFileSync(skillMd, "utf-8")).toBe(SKILL_FILES[0]!.content);
  });

  test("--json reports every installed file as structured data", async () => {
    const home = scratch("dot-skill-json-");
    const out = await capture(() => handleSkillInstall({ codex: true, json: true }, home, "/u"));

    const parsed = JSON.parse(out);
    expect(parsed.name).toBe(SKILL_NAME);
    expect(parsed.installed).toHaveLength(1);
    expect(parsed.installed[0].label).toBe("codex");
    expect(parsed.installed[0].files).toHaveLength(SKILL_FILES.length);
  });

  test("errors with guidance when no target is given", async () => {
    await expect(handleSkillInstall({}, scratch("dot-skill-none-"), "/unused")).rejects.toThrow(
      /--codex|--claude|--path/,
    );
  });
});

describe("handleSkillShow", () => {
  test("prints SKILL.md by default", async () => {
    const out = await capture(() => handleSkillShow({}));
    expect(out).toContain("name: dot-cli");
  });

  test("--references appends bundled reference docs", async () => {
    const out = await capture(() => handleSkillShow({ references: true }));
    expect(out).toContain("references/scripting-patterns.md");
  });

  test("--json emits the file set as structured data", async () => {
    const out = await capture(() => handleSkillShow({ json: true, references: true }));
    const parsed = JSON.parse(out);
    expect(parsed.name).toBe(SKILL_NAME);
    expect(parsed.files).toHaveLength(SKILL_FILES.length);
  });
});

describe("handleSkillPath", () => {
  test("with no target, reports both agent dirs", async () => {
    const out = await capture(() => handleSkillPath({}, "/home/u", "/repo"));
    expect(out).toContain(join("/home/u", ".agents", "skills", SKILL_NAME));
    expect(out).toContain(join("/home/u", ".claude", "skills", SKILL_NAME));
  });

  test("--local alone reports both repo-local dirs instead of home", async () => {
    const out = await capture(() => handleSkillPath({ local: true }, "/home/u", "/repo"));
    expect(out).toContain(join("/repo", ".agents", "skills", SKILL_NAME));
    expect(out).toContain(join("/repo", ".claude", "skills", SKILL_NAME));
    expect(out).not.toContain("/home/u");
  });

  test("an explicit target narrows the output to that agent", async () => {
    const out = await capture(() => handleSkillPath({ codex: true }, "/home/u", "/repo"));
    expect(out).toContain(join("/home/u", ".agents", "skills", SKILL_NAME));
    expect(out).not.toContain(".claude");
  });

  test("--json emits label/dir pairs", async () => {
    const out = await capture(() => handleSkillPath({ json: true }, "/home/u", "/repo"));
    const parsed = JSON.parse(out);
    expect(parsed).toEqual([
      { label: "codex", dir: join("/home/u", ".agents", "skills", SKILL_NAME) },
      { label: "claude", dir: join("/home/u", ".claude", "skills", SKILL_NAME) },
    ]);
  });
});

describe("registerSkillCommand dispatch", () => {
  async function runSkill(argv: string[]): Promise<string> {
    const cli = cac("dot");
    registerSkillCommand(cli);
    cli.parse(["node", "dot", ...argv], { run: false });
    return capture(async () => {
      await cli.runMatchedCommand();
    });
  }

  test("bare `dot skill` defaults to show", async () => {
    const out = await runSkill(["skill"]);
    expect(out).toContain("name: dot-cli");
  });

  test("`dot skill install --path` routes to install", async () => {
    const dir = scratch("dot-skill-dispatch-");
    const out = await runSkill(["skill", "install", "--path", dir]);
    expect(out).toContain("Installed");
    expect(existsSync(join(dir, SKILL_NAME, "SKILL.md"))).toBe(true);
  });

  test("`dot skill path --codex` routes to path", async () => {
    const out = await runSkill(["skill", "path", "--codex"]);
    expect(out).toContain(join(".agents", "skills", SKILL_NAME));
  });

  test("an unknown action errors with the valid actions listed", async () => {
    await expect(runSkill(["skill", "frobnicate"])).rejects.toThrow(/show, install, path/);
  });
});
