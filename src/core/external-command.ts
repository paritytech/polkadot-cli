/**
 * External subcommand dispatch (git/cargo-style plugins).
 *
 * When the first CLI token is not a built-in command, a known category, or a
 * valid dot-path, `dot foo …` looks for an executable named `dot-foo` on PATH
 * and execs it with the remaining arguments. Like `cargo-*` / `git-*`, this
 * lets domain-specific tooling extend `dot` without the CLI loading any
 * third-party code into its own process: plugins are ordinary child processes
 * that talk to `dot` the same way a user does.
 *
 * Node-only APIs here, deliberately: the published `dist/cli.mjs` runs under
 * `node`, where the `Bun` global does not exist. This module is the fallback
 * for every unknown first token — including typos — so a Bun-ism in it
 * surfaces to users as "Bun is not defined" instead of the unknown-command
 * error (biome's `noRestrictedGlobals` now bans `Bun` in shipped source).
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export const PLUGIN_PREFIX = "dot-";

/**
 * A token may name an external plugin only if it is a bare word: no dots
 * (dot-path syntax), no path separators (file input), no leading dash
 * (options). This keeps typos like `polkdot.query.System` on the normal
 * unknown-command error path instead of hitting the filesystem.
 */
export function isExternalCommandCandidate(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve `dot-<name>` on PATH. Returns the absolute path, or null.
 *
 * Reads `process.env.PATH` at call time so tests (and plugins that mutate PATH
 * before invoking `dot`) are honoured. On Windows, executables carry one of the
 * `PATHEXT` suffixes, so each candidate is tried with those as well.
 */
export function findExternalCommand(name: string): string | null {
  if (!isExternalCommandCandidate(name)) return null;
  const file = `${PLUGIN_PREFIX}${name}`;
  const suffixes =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)]
      : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const candidate = join(dir, file + suffix);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Run a resolved plugin with stdio inherited and return its exit code.
 *
 * `DOT_BIN` is set to the entry script of the running `dot` (cargo sets
 * `CARGO` the same way) so plugins can invoke the exact same installation
 * instead of whatever `dot` happens to be first on PATH.
 */
export function runExternalCommand(binPath: string, args: string[]): number {
  const result = spawnSync(binPath, args, {
    stdio: "inherit",
    env: { ...process.env, DOT_BIN: process.argv[1] ?? "dot" },
  });
  if (result.error) {
    console.error(`Failed to run "${binPath}": ${result.error.message}`);
    return 1;
  }
  // Killed by a signal → status is null; mirror shell convention (128 + signo
  // is not portable in JS, so fall back to 1).
  return result.status ?? 1;
}
