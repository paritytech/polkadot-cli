import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchStdout } from "../test-helpers/patch-stdout.ts";
import { withDotHome } from "../test-helpers/with-dot-home.ts";
import { handleInit, handleWhich, initWorkspace } from "./workspace.ts";

const CLI_PATH = join(import.meta.dir, "../cli.ts");

const cleanups: string[] = [];
function scratch(prefix: string): string {
  // realpath: subprocess process.cwd() reports the canonical /private/var
  // path on macOS, so expectations must be built from the real path.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

describe("initWorkspace", () => {
  // All tests run under withDotHome so the DOT_HOME reads/writes are
  // serialized within this file (bun --concurrent shares process.env).
  test("creates an empty .polkadot directory and reports its path", async () => {
    const home = scratch("dot-init-home-");
    const cwd = join(home, "project");
    mkdirSync(cwd);
    await withDotHome(
      "ignored",
      async () => {
        const result = await initWorkspace(cwd, home);
        expect(result.workspacePath).toBe(join(cwd, ".polkadot"));
        expect(result.warnings).toEqual([]);
        expect(existsSync(join(cwd, ".polkadot"))).toBe(true);
      },
      { DOT_HOME: undefined },
    );
  });

  test("errors when a workspace already exists in cwd", async () => {
    const home = scratch("dot-init-exists-");
    const cwd = join(home, "project");
    mkdirSync(join(cwd, ".polkadot"), { recursive: true });
    await withDotHome(
      "ignored",
      async () => {
        expect(initWorkspace(cwd, home)).rejects.toThrow(/already exists at .*\.polkadot/);
      },
      { DOT_HOME: undefined },
    );
  });

  test("refuses to initialize in the home directory", async () => {
    const home = scratch("dot-init-homedir-");
    await withDotHome(
      "ignored",
      async () => {
        expect(initWorkspace(home, home)).rejects.toThrow(/home directory.*global config root/);
        expect(existsSync(join(home, ".polkadot"))).toBe(false);
      },
      { DOT_HOME: undefined },
    );
  });

  test("warns when the new workspace shadows a parent workspace", async () => {
    const home = scratch("dot-init-shadow-");
    const parent = join(home, "parent");
    const nested = join(parent, "nested");
    mkdirSync(join(parent, ".polkadot"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    await withDotHome(
      "ignored",
      async () => {
        const result = await initWorkspace(nested, home);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain(`shadows ${join(parent, ".polkadot")}`);
        expect(existsSync(join(nested, ".polkadot"))).toBe(true);
      },
      { DOT_HOME: undefined },
    );
  });

  test("warns that custom chains in the shadowed global config will disappear", async () => {
    const home = scratch("dot-init-shadow-chains-");
    const cwd = join(home, "project");
    mkdirSync(cwd);
    // Simulate chains previously added to the global config that the new
    // workspace is about to shadow — a builtin plus a user-added chain.
    mkdirSync(join(home, ".polkadot"), { recursive: true });
    writeFileSync(
      join(home, ".polkadot", "config.json"),
      JSON.stringify({ chains: { polkadot: { rpc: "wss://x" }, mychain: { rpc: "wss://y" } } }),
    );
    await withDotHome(
      "ignored",
      async () => {
        const result = await initWorkspace(cwd, home);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain("1 custom chain(s)");
        expect(result.warnings[0]).toContain("mychain");
        // The builtin must not be counted as a custom chain.
        expect(result.warnings[0]).not.toContain("polkadot,");
      },
      { DOT_HOME: undefined },
    );
  });

  test("warns when DOT_HOME is set and masks discovery", async () => {
    const home = scratch("dot-init-masked-");
    const cwd = join(home, "project");
    mkdirSync(cwd);
    await withDotHome("/some/dot-home", async () => {
      const result = await initWorkspace(cwd, home);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("DOT_HOME is set (/some/dot-home)");
      expect(existsSync(join(cwd, ".polkadot"))).toBe(true);
    });
  });
});

// Patch the stdout/stderr streams INSIDE the withDotHome callback: its
// module-scoped lock serializes these tests, so the (process-global) stream
// patches can never capture output from a concurrently running test.
async function captureHandler(
  dotHome: string,
  env: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<{ stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  await withDotHome(
    dotHome,
    async () => {
      const restore = patchStdout((msg) => stdout.push(msg));
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      try {
        await fn();
      } finally {
        restore();
        process.stderr.write = originalStderrWrite;
      }
    },
    env,
  );
  return { stdout, stderr };
}

describe("handleInit", () => {
  test("prints the workspace path, the dot-which hint, and warnings", async () => {
    const home = scratch("dot-handle-init-");
    const parent = join(home, "parent");
    const nested = join(parent, "nested");
    mkdirSync(join(parent, ".polkadot"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    // home param defaults to the real homedir() inside initWorkspace; the
    // scratch tree is outside it, so the parent workspace is discovered.
    const { stdout, stderr } = await captureHandler("ignored", { DOT_HOME: undefined }, () =>
      handleInit(nested),
    );

    expect(stdout.join("\n")).toContain(
      `Initialized empty dot workspace at ${join(nested, ".polkadot")}`,
    );
    expect(stdout.join("\n")).toContain("dot which");
    expect(stderr.join("")).toContain(
      `Warning: This workspace shadows ${join(parent, ".polkadot")}`,
    );
  });
});

describe("handleWhich", () => {
  test("prints path and source label for a discovered workspace", async () => {
    const home = scratch("dot-handle-which-");
    const project = join(home, "project");
    mkdirSync(join(project, ".polkadot"), { recursive: true });

    const { stdout } = await captureHandler("ignored", { DOT_HOME: undefined }, () =>
      handleWhich({}, project),
    );
    expect(stdout.join("\n").split("\n")).toEqual([
      join(project, ".polkadot"),
      "Source: local workspace (discovered from current directory)",
    ]);
  });

  test("prints JSON with --json", async () => {
    const home = scratch("dot-handle-which-json-");
    const project = join(home, "project");
    mkdirSync(join(project, ".polkadot"), { recursive: true });

    const { stdout } = await captureHandler("ignored", { DOT_HOME: undefined }, () =>
      handleWhich({ json: true }, project),
    );
    expect(JSON.parse(stdout.join(""))).toEqual({
      path: join(project, ".polkadot"),
      source: "workspace",
    });
  });

  test("reports the DOT_HOME source label when the env var is set", async () => {
    const { stdout } = await captureHandler("/custom/root", {}, () => handleWhich({}, tmpdir()));
    expect(stdout.join("\n").split("\n")).toEqual([
      "/custom/root",
      "Source: DOT_HOME environment variable",
    ]);
  });

  test("reports the global config when nothing else applies", async () => {
    const cwd = scratch("dot-handle-which-global-");
    const { stdout } = await captureHandler("ignored", { DOT_HOME: undefined }, () =>
      handleWhich({}, cwd),
    );
    expect(stdout.join("\n").split("\n")[1]).toBe("Source: global config");
  });
});

// Integration tests run the CLI in a SUBPROCESS with a faked HOME and a
// pinned cwd, so workspace discovery is exercised end-to-end without ever
// touching the developer's real ~/.polkadot.
async function runDot(
  args: string[],
  opts: { cwd: string; env?: Record<string, string | undefined> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    env: { ...process.env, DOT_HOME: undefined, ...opts.env },
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("workspace integration", { timeout: 15_000 }, () => {
  test("dot init + dot which: workspace is created and discovered", async () => {
    const home = scratch("dot-ws-int-");
    const project = join(home, "dot", "paseo");
    mkdirSync(project, { recursive: true });

    const init = await runDot(["init"], { cwd: project, env: { HOME: home } });
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain(
      `Initialized empty dot workspace at ${join(project, ".polkadot")}`,
    );
    expect(init.stdout).toContain("dot which");

    const which = await runDot(["which"], { cwd: project, env: { HOME: home } });
    expect(which.exitCode).toBe(0);
    expect(which.stdout).toContain(join(project, ".polkadot"));
    expect(which.stdout).toContain("local workspace");
  });

  test("dot which from a subdirectory finds the parent workspace (--json)", async () => {
    const home = scratch("dot-ws-sub-");
    const project = join(home, "project");
    const sub = join(project, "scripts");
    mkdirSync(join(project, ".polkadot"), { recursive: true });
    mkdirSync(sub, { recursive: true });

    const which = await runDot(["which", "--json"], { cwd: sub, env: { HOME: home } });
    expect(which.exitCode).toBe(0);
    expect(JSON.parse(which.stdout)).toEqual({
      path: join(project, ".polkadot"),
      source: "workspace",
    });
  });

  test("dot which without a workspace reports the global config", async () => {
    const home = scratch("dot-ws-global-");
    const cwd = join(home, "plain");
    mkdirSync(cwd, { recursive: true });

    const which = await runDot(["which"], { cwd, env: { HOME: home } });
    expect(which.exitCode).toBe(0);
    expect(which.stdout).toContain(join(home, ".polkadot"));
    expect(which.stdout).toContain("global config");
  });

  test("dot which reports DOT_HOME when it overrides discovery", async () => {
    const home = scratch("dot-ws-env-");
    const project = join(home, "project");
    mkdirSync(join(project, ".polkadot"), { recursive: true });

    const which = await runDot(["which", "--json"], {
      cwd: project,
      env: { HOME: home, DOT_HOME: "/custom/root" },
    });
    expect(which.exitCode).toBe(0);
    expect(JSON.parse(which.stdout)).toEqual({ path: "/custom/root", source: "env" });
  });

  test("accounts created inside a workspace stay out of ~/.polkadot (full isolation)", async () => {
    const home = scratch("dot-ws-isolation-");
    const project = join(home, "dot", "mytestnet");
    mkdirSync(join(project, ".polkadot"), { recursive: true });

    const create = await runDot(["account", "create", "sudo", "--json"], {
      cwd: project,
      env: { HOME: home },
    });
    expect(create.exitCode).toBe(0);

    const workspaceAccounts = join(project, ".polkadot", "accounts.json");
    expect(existsSync(workspaceAccounts)).toBe(true);
    const saved = JSON.parse(readFileSync(workspaceAccounts, "utf-8"));
    expect(saved.accounts).toHaveLength(1);
    expect(saved.accounts[0].name).toBe("sudo");

    expect(existsSync(join(home, ".polkadot", "accounts.json"))).toBe(false);
  });

  test("DOT_HOME beats a discovered workspace for reads and writes", async () => {
    const home = scratch("dot-ws-precedence-");
    const project = join(home, "project");
    const dotHome = join(home, "custom-root");
    mkdirSync(join(project, ".polkadot"), { recursive: true });
    mkdirSync(dotHome, { recursive: true });

    const create = await runDot(["account", "create", "envwins", "--json"], {
      cwd: project,
      env: { HOME: home, DOT_HOME: dotHome },
    });
    expect(create.exitCode).toBe(0);
    expect(existsSync(join(dotHome, "accounts.json"))).toBe(true);
    expect(existsSync(join(project, ".polkadot", "accounts.json"))).toBe(false);
  });

  test("dot init fails loudly when run again in the same directory", async () => {
    const home = scratch("dot-ws-reinit-");
    const project = join(home, "project");
    mkdirSync(project, { recursive: true });

    const first = await runDot(["init"], { cwd: project, env: { HOME: home } });
    expect(first.exitCode).toBe(0);
    const second = await runDot(["init"], { cwd: project, env: { HOME: home } });
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("already exists");
  });

  test("dot init refuses to run in $HOME", async () => {
    const home = scratch("dot-ws-home-");
    const init = await runDot(["init"], { cwd: home, env: { HOME: home } });
    expect(init.exitCode).toBe(1);
    expect(init.stderr).toContain("global config root");
    // Note: $HOME/.polkadot may still exist afterwards — the update notifier
    // creates the global config dir for its cache. The unit test covers
    // "init created nothing"; here we only assert the refusal.
  });

  test("unknown account error names the active workspace", async () => {
    const home = scratch("dot-ws-error-");
    const project = join(home, "project");
    mkdirSync(join(project, ".polkadot"), { recursive: true });

    const sign = await runDot(["sign", "hello", "--from", "sudo"], {
      cwd: project,
      env: { HOME: home },
    });
    expect(sign.exitCode).toBe(1);
    expect(sign.stderr).toContain(
      `Unknown account "sudo" in workspace ${join(project, ".polkadot")}`,
    );
  });
});
