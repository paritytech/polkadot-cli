#!/usr/bin/env bun
/**
 * Records the VHS tapes in tapes/ into docs/static/vhs/.
 *
 *   bun run tapes              # every tape
 *   bun run tapes hero         # just tapes/hero.tape
 *
 * Recordings run against live public RPC, so output differs between takes —
 * that is deliberate, the numbers on screen are real. State lives in a
 * throwaway DOT_HOME (never ~/.polkadot), rebuilt from scratch before each tape
 * from a shared metadata cache, so no take is interrupted by a first-run
 * metadata spinner and no tape inherits the previous one's accounts or chains.
 */

import { $ } from "bun";
import { cp, readdir, mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const tapesDir = join(repoRoot, "tapes");
const outDir = join(repoRoot, "docs/static/vhs");

/** Config root for recordings. Short and tidy — it is visible on screen in any
 *  tape that prints the active workspace (`dot chain list`, `dot which`). */
const demoHome = "/tmp/dot-demo";

/** Metadata cache shared by every take, warmed once. Tapes get a fresh copy of
 *  the chains they need rather than a shared config root, so recording a subset
 *  produces the same frames as recording everything. */
const cacheHome = "/tmp/dot-demo-cache";

/** Chains each tape talks to. Their metadata is cached before recording so no
 *  take is interrupted by a first-fetch spinner, and only these chains are
 *  visible to the tape — an important detail for `chains.tape`, whose whole
 *  point is a chain that is *not* configured yet. */
const tapeChains: Record<string, string[]> = {
  hero: ["polkadot", "polkadot-asset-hub"],
  inspect: ["polkadot"],
  completions: ["polkadot"],
  submit: ["paseo-asset-hub"],
  accounts: ["polkadot-asset-hub"],
  jq: ["polkadot", "polkadot-asset-hub"],
  "dry-run": ["polkadot-asset-hub"],
  chains: ["polkadot"], // hydration is added on camera, so must not be cached
  sovereign: ["polkadot-asset-hub"],
  "xcm-file": ["paseo-asset-hub"],
  "did-you-mean": ["polkadot"],
  workspaces: [], // entirely offline: init, which, and a local account
  "env-accounts": [], // offline: account add and message signing
};

/** Fake home for the tapes that demonstrate workspace discovery. They need
 *  DOT_HOME unset — it would override discovery — so they get a sandboxed HOME
 *  to work inside. That is a safety measure, not a cosmetic one: discovery walks
 *  up from the cwd and stops at $HOME, so a recording made outside this sandbox
 *  could reach the operator's real ~/.polkadot. */
const workspaceHome = "/tmp/dot-demo-home";

/** Fixture for the env-accounts tape: a committable workspace whose only secret
 *  sits in an ignored .env. The seed is a synthetic 32-byte value — it is a valid
 *  key, so signing really works, but it guards nothing and is never on screen. */
const ciProject = join(workspaceHome, "ci-project");
const ciSeed = `0x${"00".repeat(31)}01`;

/** Env var holding the mnemonic of the throwaway Paseo signer, added to the
 *  recording config root as the env-backed account `demo`. The secret reaches
 *  the shell through the environment and never appears in a tape file. */
const signerEnv = "DOT_TAPE_SIGNER";

/** Tapes that submit a real extrinsic, and so cannot be recorded without the
 *  signer secret. Skipped with a note rather than failing the whole run. */
const signingTapes = new Set(["submit"]);

/** Sourced by the renderable tapes; not recordings in their own right. */
const partials = new Set(["theme.tape", "shell.tape"]);

const requested = process.argv.slice(2).map((name) => name.replace(/\.tape$/, ""));

const available = (await readdir(tapesDir))
  // theme.tape and shell.tape are sourced by the others and declare no Output.
  .filter((file) => file.endsWith(".tape") && !partials.has(file))
  .map((file) => basename(file, ".tape"))
  .filter((name) => requested.length === 0 || requested.includes(name))
  .sort();

const hasSigner = Boolean(process.env[signerEnv]);
const skipped = hasSigner ? [] : available.filter((name) => signingTapes.has(name));
const tapes = available.filter((name) => !skipped.includes(name));

for (const name of skipped) {
  console.log(`Skipping ${name} — it submits a real extrinsic and ${signerEnv} is not set.`);
}

if (tapes.length === 0) {
  // Everything asked for was deliberately skipped — that is not a failure.
  if (skipped.length > 0) process.exit(0);
  console.error(
    requested.length > 0
      ? `No tape matched: ${requested.join(", ")}`
      : "No tapes found in tapes/",
  );
  process.exit(1);
}

console.log("Building dist/cli.mjs …");
await $`bun run build`.cwd(repoRoot).quiet();

console.log(`Preparing ${demoHome} …`);
await rm(demoHome, { recursive: true, force: true });
await mkdir(demoHome, { recursive: true });
await rm(workspaceHome, { recursive: true, force: true });
await mkdir(join(workspaceHome, "paseo"), { recursive: true });
await mkdir(outDir, { recursive: true });

const cliEnv = { ...process.env, DOT_HOME: demoHome, DOT_NO_UPDATE_CHECK: "1" };
const cacheEnv = { ...cliEnv, DOT_HOME: cacheHome };

// The env-accounts fixture: a project directory holding an initialized workspace,
// the .gitignore the docs recommend, and the secret the tape sources.
await mkdir(ciProject, { recursive: true });
await Bun.write(join(ciProject, ".env"), `DOT_CI_SIGNER=${ciSeed}\n`);
await Bun.write(
  join(ciProject, ".gitignore"),
  ".env\n.polkadot/chains/\n.polkadot/update-check.json\n",
);
const workspaceEnv = { ...cliEnv, HOME: workspaceHome, DOT_HOME: undefined };
await $`node ${join(repoRoot, "dist/cli.mjs")} init`.cwd(ciProject).env(workspaceEnv).quiet();
const warmChains = [...new Set(tapes.flatMap((name) => tapeChains[name] ?? []))].sort();
for (const chain of warmChains) {
  console.log(`  caching metadata for ${chain}`);
  await $`node dist/cli.mjs chain update ${chain}`.cwd(repoRoot).env(cacheEnv).quiet();
}

/** Rebuild demoHome from scratch for one tape: nothing but the metadata that
 *  tape needs. Recording a subset then produces the same frames as recording
 *  everything — without this, one tape's accounts and added chains show up in
 *  the next tape's `account list` or `chain list`. */
async function resetDemoHome(name: string) {
  await rm(demoHome, { recursive: true, force: true });
  await mkdir(join(demoHome, "chains"), { recursive: true });
  for (const chain of tapeChains[name] ?? []) {
    await cp(join(cacheHome, "chains", chain), join(demoHome, "chains", chain), {
      recursive: true,
    });
  }
  if (hasSigner && signingTapes.has(name)) {
    console.log(`  adding signer account demo (secret read from ${signerEnv} at signing time)`);
    await $`node dist/cli.mjs account add demo --env ${signerEnv}`.cwd(repoRoot).env(cliEnv).quiet();
  }
}

const vhsEnv = {
  ...cliEnv,
  ZDOTDIR: join(tapesDir, "demo/zdotdir"),
  PATH: `${join(tapesDir, "demo/bin")}:${process.env.PATH}`,
};

for (const name of tapes) {
  console.log(`Recording ${name} …`);
  await resetDemoHome(name);
  await $`vhs ${join("tapes", `${name}.tape`)}`.cwd(repoRoot).env(vhsEnv);
}

console.log("\nRendered:");
for (const name of tapes) {
  for (const ext of ["gif", "webm", "mp4"]) {
    const file = Bun.file(join(outDir, `${name}.${ext}`));
    if (await file.exists()) {
      const kb = Math.round(file.size / 1024);
      console.log(`  docs/static/vhs/${name}.${ext}  ${kb} KB`);
    }
  }
}
