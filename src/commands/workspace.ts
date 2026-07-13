import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CAC } from "cac";
import { peekConfiguredChains, type ResolvedConfigDir, resolveConfigDir } from "../config/store.ts";
import { BUILTIN_CHAIN_NAMES } from "../config/types.ts";
import { canonicalPath, findWorkspace, WORKSPACE_DIR_NAME } from "../config/workspace.ts";
import { isJsonOutput, writeStdout } from "../core/output.ts";
import { withHelp } from "../platform/cli.ts";
import { CliError } from "../utils/errors.ts";

export interface InitResult {
  /** Absolute path of the created workspace directory. */
  workspacePath: string;
  /** Non-fatal notes about the surrounding environment, one per line. */
  warnings: string[];
}

/**
 * Create an empty `.polkadot/` workspace in `cwd`.
 *
 * Deliberately minimal: no seeding from the global config and no
 * `.gitignore` — whether to commit or ignore the workspace is the user's
 * conscious decision. Edge cases are loud instead of silent: re-init is an
 * error, `$HOME` is refused (that's the global config root), and shadowed
 * parent workspaces or a masking DOT_HOME produce warnings.
 */
export async function initWorkspace(cwd: string, home: string = homedir()): Promise<InitResult> {
  const dir = canonicalPath(cwd);
  if (dir === canonicalPath(home)) {
    throw new CliError(
      `Cannot initialize a workspace in your home directory — ${join(dir, WORKSPACE_DIR_NAME)} is the global config root.`,
    );
  }

  const workspacePath = join(dir, WORKSPACE_DIR_NAME);
  const exists = await stat(workspacePath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    throw new CliError(`A workspace already exists at ${workspacePath}.`);
  }

  const warnings: string[] = [];
  const parentWorkspace = findWorkspace(dir, home);
  if (parentWorkspace) {
    warnings.push(`This workspace shadows ${parentWorkspace} for commands run below ${dir}.`);
  }
  const dotHome = process.env.DOT_HOME;
  if (dotHome && dotHome.length > 0) {
    warnings.push(
      `DOT_HOME is set (${dotHome}) and takes precedence — this workspace will not be picked up until you unset it.`,
    );
  } else {
    // With no DOT_HOME the new workspace becomes the active root, shadowing
    // whatever was resolved from here before it existed (a parent workspace,
    // or the global ~/.polkadot). Chains added there won't be visible from
    // this workspace even though they remain on disk — warn so it isn't a
    // silent disappearance (the exact footgun this warning exists to prevent).
    const shadowedPath = parentWorkspace ?? join(home, WORKSPACE_DIR_NAME);
    const userChains = (await peekConfiguredChains(shadowedPath)).filter(
      (name) => !BUILTIN_CHAIN_NAMES.has(name),
    );
    if (userChains.length > 0) {
      warnings.push(
        `${userChains.length} custom chain(s) in the shadowed config ${shadowedPath} ` +
          `(${userChains.join(", ")}) will not be visible from this workspace. ` +
          "Re-add them here, or migrate with `dot chain export` / `dot chain import`.",
      );
    }
  }

  await mkdir(workspacePath, { recursive: true });
  return { workspacePath, warnings };
}

const SOURCE_LABELS: Record<ResolvedConfigDir["source"], string> = {
  env: "DOT_HOME environment variable",
  workspace: "local workspace (discovered from current directory)",
  global: "global config",
};

export async function handleInit(cwd: string = process.cwd()): Promise<void> {
  const result = await initWorkspace(cwd);
  for (const warning of result.warnings) {
    process.stderr.write(`Warning: ${warning}\n`);
  }
  await writeStdout(
    `Initialized empty dot workspace at ${result.workspacePath}\n` +
      "Check which workspace is active with: dot which\n",
  );
}

export async function handleWhich(
  opts: { json?: boolean; output?: string },
  cwd: string = process.cwd(),
): Promise<void> {
  const resolved = resolveConfigDir(cwd);
  if (isJsonOutput(opts)) {
    await writeStdout(`${JSON.stringify({ path: resolved.path, source: resolved.source })}\n`);
    return;
  }
  await writeStdout(`${resolved.path}\nSource: ${SOURCE_LABELS[resolved.source]}\n`);
}

export function registerWorkspaceCommands(cli: CAC) {
  const initCommand = cli
    .command("init", "Initialize a local .polkadot workspace in the current directory")
    .action(() => handleInit());
  withHelp(initCommand);

  const whichCommand = cli
    .command("which", "Show the active config root (workspace, DOT_HOME, or global)")
    .action((opts: { json?: boolean; output?: string }) => handleWhich(opts));
  withHelp(whichCommand);
}
