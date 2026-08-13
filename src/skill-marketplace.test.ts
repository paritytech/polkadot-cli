import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

type MarketplacePlugin = {
  name: string;
  description?: string;
  source?: string;
  strict?: boolean;
  skills?: string[];
};

type Marketplace = {
  name: string;
  owner?: { name?: string; email?: string };
  metadata?: { description?: string; version?: string };
  plugins: MarketplacePlugin[];
};

const MANIFEST_PATH = join(ROOT, ".claude-plugin/marketplace.json");

function loadManifest(): Marketplace {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

function parseFrontmatter(md: string): Record<string, string> {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    const key = m?.[1];
    const value = m?.[2];
    if (key && value) out[key] = value.replace(/^["']|["']$/g, "");
  }
  return out;
}

describe("Claude Code skill marketplace", () => {
  test(".claude-plugin/marketplace.json exists and parses", () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    expect(() => loadManifest()).not.toThrow();
  });

  test("marketplace has required top-level fields", () => {
    const m = loadManifest();
    expect(m.name).toBe("polkadot-cli");
    expect(m.owner?.name).toBeTruthy();
    expect(Array.isArray(m.plugins)).toBe(true);
    expect(m.plugins.length).toBeGreaterThan(0);
  });

  test("dot-cli plugin is declared and configured for strict:false", () => {
    const plugin = loadManifest().plugins.find((p) => p.name === "dot-cli");
    expect(plugin).toBeDefined();
    expect(plugin?.strict).toBe(false);
    expect(plugin?.source).toBe("./");
    expect(plugin?.skills).toContain("./dot-cli");
  });

  test("every skill referenced by the marketplace exists on disk", () => {
    for (const plugin of loadManifest().plugins) {
      for (const skillPath of plugin.skills ?? []) {
        const abs = join(ROOT, skillPath);
        expect(existsSync(abs)).toBe(true);
        expect(statSync(abs).isDirectory()).toBe(true);
        expect(existsSync(join(abs, "SKILL.md"))).toBe(true);
      }
    }
  });

  test("dot-cli/SKILL.md has valid frontmatter with name and description", () => {
    const md = readFileSync(join(ROOT, "dot-cli/SKILL.md"), "utf-8");
    expect(md.startsWith("---")).toBe(true);
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe("dot-cli");
    expect(fm.description).toBeTruthy();
  });

  test("every relative markdown link in SKILL.md resolves", () => {
    const skillFile = join(ROOT, "dot-cli/SKILL.md");
    const md = readFileSync(skillFile, "utf-8");
    const linkRegex = /\]\(([^)\s]+\.md)\)/g;
    const links = [...md.matchAll(linkRegex)].map((m) => m[1]).filter((l): l is string => !!l);
    expect(links.length).toBeGreaterThan(0);
    const base = dirname(skillFile);
    for (const link of links) {
      if (/^https?:/.test(link)) continue;
      expect(existsSync(join(base, link))).toBe(true);
    }
  });

  test("SKILL.md does not document the invalid `<chain>.inspect` dotpath form", () => {
    // Regression: `inspect` is a top-level command, not a dotpath category.
    // `dot polkadot.inspect` / `dot my-chain.inspect` do not parse.
    const md = readFileSync(join(ROOT, "dot-cli/SKILL.md"), "utf-8");
    // Match any word followed by ".inspect" at a word boundary, but allow the
    // phrase `<chain>.inspect` when used to *describe* the invalid form.
    const bareMatches = [...md.matchAll(/\b([a-z][a-z0-9-]+)\.inspect\b/g)]
      .map((m) => m[0])
      .filter((s) => !s.includes("<"));
    expect(bareMatches).toEqual([]);
  });

  test("SKILL.md stays portable across agents (Claude Code + Codex)", () => {
    // Both Claude Code and Codex consume the same SKILL.md; Codex requires only
    // `name` + `description` frontmatter and has no marketplace concept. Guard
    // against drift that would break one agent: the frontmatter must carry the
    // two portable keys, and the body must not hard-code a single agent's UX.
    const md = readFileSync(join(ROOT, "dot-cli/SKILL.md"), "utf-8");
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe("dot-cli");
    expect(fm.description).toBeTruthy();

    const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
    // The guide teaches the `dot` CLI itself — it must not assume a specific
    // agent's plugin/marketplace machinery (that lives in README, not the skill).
    expect(body).not.toMatch(/\/plugin\s+(marketplace|install)/);
  });

  test("SKILL.md covers the post-feedback content areas", () => {
    const md = readFileSync(join(ROOT, "dot-cli/SKILL.md"), "utf-8");
    expect(md).toContain("## Common Errors");
    expect(md).toContain("Complex Arguments");
    expect(md).toMatch(/--at\s*<block>/);
    // --at now applies to query/apis too; the historical-reads guidance lives
    // near the storage examples.
    expect(md).toMatch(/--at\s*<[^>]+>.*historical/);
  });
});
