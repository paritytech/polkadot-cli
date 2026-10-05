import type { CAC, Command } from "cac";

/**
 * Symbol under which a command's `--help` printer is stashed directly on the
 * `cac` Command object. We attach the printer to the command instance rather
 * than keeping a module-level Map: `bun build` can duplicate this module in the
 * bundle (it is imported both directly and re-exported via `platform/index.ts`),
 * and a module-level Map would then split — `withHelp` writing to one copy while
 * `printMatchedCommandHelp` reads an empty other copy, silently dropping all
 * help. Issue #238 regressed exactly this way in the published bundle even
 * though the source and tests were correct. A `Symbol.for` lives in the global
 * registry, so duplicated module copies still resolve to the same key, and the
 * state lives on the single command instance.
 */
const HELP_PRINTER = Symbol.for("polkadot-cli.helpPrinter");

type WithHelpPrinter = Command & { [HELP_PRINTER]?: () => void };

/**
 * Associate a help printer with a `cac` command so `--help` prints proper usage
 * even when an action positional is present (the bug behind #238). Pass a custom
 * printer for commands with a rich usage block; omit it to fall back to `cac`'s
 * auto-generated per-command help. Returns the command for chaining.
 */
export function withHelp(command: Command, printHelp?: () => void): Command {
  (command as WithHelpPrinter)[HELP_PRINTER] = printHelp ?? (() => command.outputHelp());
  return command;
}

/**
 * Print the registered help for the matched command. Returns true if the
 * matched command had a registered help printer (and it was printed). Commands
 * without a registered printer — notably the default dot-path command, which
 * handles item-level help inside its own action — return false so the caller
 * can fall through to running them.
 */
export function printMatchedCommandHelp(cli: CAC): boolean {
  const matched = (cli as unknown as { matchedCommand?: WithHelpPrinter }).matchedCommand;
  const printer = matched?.[HELP_PRINTER];
  if (!printer) return false;
  printer();
  return true;
}

/**
 * Register the shared global options on a `cac` instance. Kept in one place so
 * every entry point exposes an identical surface.
 */
export function registerGlobalOptions(cli: CAC): void {
  cli.option("--chain <name>", "Target chain (required)");
  cli.option("--rpc <url>", "Override RPC endpoint for this call");
  // No default: an absent --output must stay distinguishable from an explicit
  // `--output pretty` so the DOT_OUTPUT env var can supply the default.
  cli.option("--output <format>", "Output format: pretty or json (default: $DOT_OUTPUT or pretty)");
  cli.option("--json", "Output as JSON (shorthand for --output json)");
}

/**
 * Read `--name <value>` / `--name=value` straight from raw argv. CAC delegates
 * to mri, which silently coerces 0x-hex option values to JS Numbers (losing
 * bytes / precision) — re-reading from argv keeps the original string intact.
 * Mirrors mri's rules where it matters: scanning stops at the `--` terminator
 * and the last occurrence wins. Matching is exact (`--name` or `--name=`), so
 * sibling flags that share a prefix (e.g. `--member` vs `--members`) never
 * collide.
 */
export function readRawOptionValue(
  name: string,
  argv: readonly string[] = process.argv,
): string | undefined {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") break;
    if (arg === flag && i + 1 < argv.length) value = argv[i + 1];
    else if (arg.startsWith(prefix)) value = arg.slice(prefix.length);
  }
  return value;
}
