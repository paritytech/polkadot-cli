/**
 * External subcommand dispatch (git/cargo-style plugins).
 *
 * When the first CLI token is not a built-in command, a known category, or a
 * valid dot-path, `dot foo …` looks for an executable named `dot-foo` on PATH
 * and execs it with the remaining arguments. Like `cargo-*` / `git-*`, this
 * lets domain-specific tooling extend `dot` without the CLI loading any
 * third-party code into its own process: plugins are ordinary child processes
 * that talk to `dot` the same way a user does.
 */

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

/** Resolve `dot-<name>` on PATH. Returns the absolute path, or null. */
export function findExternalCommand(name: string): string | null {
  if (!isExternalCommandCandidate(name)) return null;
  // Pass PATH explicitly: Bun.which snapshots the environment at startup and
  // would miss runtime process.env.PATH changes otherwise.
  return Bun.which(`${PLUGIN_PREFIX}${name}`, { PATH: process.env.PATH ?? "" });
}

/**
 * Run a resolved plugin with stdio inherited and return its exit code.
 *
 * `DOT_BIN` is set to the entry script of the running `dot` (cargo sets
 * `CARGO` the same way) so plugins can invoke the exact same installation
 * instead of whatever `dot` happens to be first on PATH.
 */
export function runExternalCommand(binPath: string, args: string[]): number {
  const result = Bun.spawnSync([binPath, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, DOT_BIN: process.argv[1] ?? "dot" },
  });
  return result.exitCode ?? 1;
}
