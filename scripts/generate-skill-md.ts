#!/usr/bin/env bun
// Codegen: embed dot-cli/SKILL.md into a TypeScript module so its contents are
// available at runtime from the bundled `dist/cli.mjs`.
//
// Why embed instead of reading the file at runtime?
//   - The npm tarball ships only `dist` (see package.json "files"), so
//     `dot-cli/SKILL.md` is NOT present next to the installed binary.
//   - The CLI runs as a single bundled `dist/cli.mjs`, so there is no reliable
//     package-relative path to the markdown source after a global install.
// Baking the text into a generated TS module that the bundle imports makes the
// SKILL.md content travel inside the binary itself — version-accurate, no
// network, no filesystem layout assumptions.
//
// This script is wired into the `build` script and run before bundling, so the
// generated module can never drift from dot-cli/SKILL.md. It is also committed
// (not gitignored) so `bun src/cli.ts` works in dev and tests without a build.

import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SKILL_SOURCE = join(ROOT, "dot-cli", "SKILL.md");
const OUTPUT = join(ROOT, "src", "generated", "skill-md.ts");

const md = await Bun.file(SKILL_SOURCE).text();

// Serialize as a JSON string literal: this safely escapes backticks, backslashes,
// `${`, newlines, and any other character, so the embedded text round-trips exactly.
const generated = `// AUTO-GENERATED — DO NOT EDIT.
// Source: dot-cli/SKILL.md. Regenerate with: bun run generate:skill
// This embeds the SKILL.md shipped with this binary version so \`dot skill\`
// can print it at runtime from the bundled dist/cli.mjs (the SKILL.md file is
// not included in the npm tarball — only dist is).

export const SKILL_MD = ${JSON.stringify(md)};
`;

await Bun.write(OUTPUT, generated);

// eslint-disable-next-line no-console
console.error(`Generated ${OUTPUT} from ${SKILL_SOURCE} (${md.length} bytes)`);
