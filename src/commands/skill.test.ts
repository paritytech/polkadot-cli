import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchStdout } from "../test-helpers/patch-stdout.ts";
import {
  agentSkillDir,
  handleSkillInstall,
  handleSkillPath,
  handleSkillShow,
  installSkill,
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

/** Run `fn` with stdout captured in-process; return everything it wrote. */
async function capture(fn: () => Promise<void>): Promise<string> {
  let out = "";
  const restore = patchStdout((msg) => {
    out += msg;
  });
  try {
    await fn();
  } finally {
    restore();
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

  test("the reference doc it links to is bundled too", () => {
    const rels = SKILL_FILES.map((f) => f.rel);
    expect(rels).toContain("references/scripting-patterns.md");
    for (const file of SKILL_FILES) expect(file.content.length).toBeGreaterThan(0);
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
});
