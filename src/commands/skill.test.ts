import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./__fixtures__/run-cli.ts";

describe("dot skill", () => {
  test("prints the embedded SKILL.md to stdout", async () => {
    const { stdout, exitCode } = await runCli(["skill"], { noDefaultChain: true });
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
    // Frontmatter + a known heading prove it's the real SKILL.md, not a stub.
    expect(stdout).toContain("name: dot-cli");
    expect(stdout).toContain("# dot CLI (polkadot-cli)");
    expect(stdout).toContain("## Core Pattern");
  });

  test("--help shows usage, not the skill body", async () => {
    const { stdout, exitCode } = await runCli(["skill", "--help"], { noDefaultChain: true });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("dot skill install");
  });

  test("install writes SKILL.md to ~/.claude/skills/dot-cli/SKILL.md under HOME", async () => {
    // runCli sets HOME to an isolated temp dir, so `dot skill install` (which
    // resolves the default path from homedir()) never touches the real ~/.claude.
    const { stdout, exitCode } = await runCli(["skill", "install"], { noDefaultChain: true });
    expect(exitCode).toBe(0);
    expect(stdout).toContain(join(".claude", "skills", "dot-cli", "SKILL.md"));
    expect(stdout).toContain("Installed dot-cli skill to");
  });

  test("install --path writes to a custom location with full SKILL.md contents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dot-skill-test-"));
    try {
      const target = join(dir, "nested", "SKILL.md");
      const { stdout, exitCode } = await runCli(["skill", "install", "--path", target], {
        noDefaultChain: true,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain(target);
      expect(existsSync(target)).toBe(true);

      const installed = readFileSync(target, "utf-8");
      expect(installed).toContain("name: dot-cli");
      expect(installed).toContain("# dot CLI (polkadot-cli)");

      // The installed skill must match the repo's source SKILL.md exactly
      // (anti-drift: the binary is the source of truth, baked from this file).
      const source = readFileSync(join(import.meta.dir, "../../dot-cli/SKILL.md"), "utf-8");
      expect(installed).toBe(source);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unknown action exits non-zero with a hint", async () => {
    const { stderr, exitCode } = await runCli(["skill", "bogus"], { noDefaultChain: true });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown action "bogus"');
  });
});
