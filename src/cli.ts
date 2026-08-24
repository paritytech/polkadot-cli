#!/usr/bin/env bun
import cac from "cac";
import { version } from "../package.json";
import { registerAccountCommands } from "./commands/account.ts";
import { handleApis } from "./commands/apis.ts";
import { registerChainCommands } from "./commands/chain.ts";
import { registerCompletionsCommand } from "./commands/completions.ts";
import { handleConst } from "./commands/const.ts";
import {
  handleErrors,
  handleEvents,
  handleExtensions,
  showItemHelp,
} from "./commands/focused-inspect.ts";
import { registerHashCommand } from "./commands/hash.ts";
import { registerInspectCommand } from "./commands/inspect.ts";
import { registerMetadataCommand } from "./commands/metadata.ts";
import { registerParachainCommand } from "./commands/parachain.ts";
import { handleQuery } from "./commands/query.ts";
import { handleRpc } from "./commands/rpc.ts";
import { registerSignCommand } from "./commands/sign.ts";
import { registerSkillCommand } from "./commands/skill.ts";
import { handleTx } from "./commands/tx.ts";
import { registerWorkspaceCommands } from "./commands/workspace.ts";
import { loadConfig } from "./config/store.ts";
import { isGlobalDryRun, printGlobalDryRunHint, resolveDryRun } from "./core/dry-run.ts";
import {
  findExternalCommand,
  isExternalCommandCandidate,
  runExternalCommand,
} from "./core/external-command.ts";
import { isFilePath, loadCommandFile, parseVarFlags } from "./core/file-loader.ts";
import {
  getUpdateNotification,
  startBackgroundCheck,
  waitForPendingCheck,
} from "./core/update-notifier.ts";
import { registerVerifiableCommands } from "./features/verifiable/register.ts";
import {
  printMatchedCommandHelp,
  readRawOptionValue,
  registerGlobalOptions,
} from "./platform/cli.ts";
import { CliError, formatRuntimeError, isPapiCleanupError } from "./utils/errors.ts";
import { parseDotPath } from "./utils/parse-dot-path.ts";

// Early exit for shell completion — avoid loading update checker or heavy imports
if (process.argv[2] === "__complete") {
  (async () => {
    try {
      const dashDashIndex = process.argv.indexOf("--");
      const completionArgs = dashDashIndex >= 0 ? process.argv.slice(dashDashIndex + 1) : [];
      const currentWord = completionArgs[0] ?? "";
      const precedingWords = completionArgs.slice(1);
      const { generateCompletions } = await import("./completions/complete.ts");
      const results = await generateCompletions(currentWord, precedingWords);
      if (results.length > 0) {
        process.stdout.write(`${results.join("\n")}\n`);
      }
    } catch {
      // Silently exit — no completions is better than a broken shell
    }
    process.exit(0);
  })();
} else {
  startBackgroundCheck(version);

  const cli = cac("dot");

  registerGlobalOptions(cli);

  registerChainCommands(cli);
  registerInspectCommand(cli);
  registerMetadataCommand(cli);
  registerAccountCommands(cli);
  registerHashCommand(cli);
  registerSignCommand(cli);
  registerParachainCommand(cli);
  registerCompletionsCommand(cli);
  registerVerifiableCommands(cli);
  registerWorkspaceCommands(cli);
  registerSkillCommand(cli);

  // Default command: dot-path syntax for query, tx, const, events, errors
  cli
    .command("[dotpath] [...args]")
    .option("--from <name>", "Account to sign with (for tx)")
    .option("--dry-run", "Estimate fees without submitting (for tx)")
    .option("--encode", "Encode call to hex without signing (for tx)")
    .option("--to-yaml", "Decode call to YAML file format (for tx)")
    .option("--to-json", "Decode call to JSON file format (for tx)")
    .option("--ext <json>", "Custom signed extension values as JSON (for tx)")
    .option("--asset <json>", "Pay fees in an alternative asset (XCM location JSON, for tx)")
    .option(
      "-w, --wait <level>",
      "Resolve at: broadcast, best-block (or best), finalized (for tx)",
      {
        default: "finalized",
      },
    )
    .option("--dump", "Dump all entries of a storage map (without specifying a key)")
    .option("--var <kv>", "Template variable for file input (KEY=VALUE, repeatable)")
    .option("--nonce <n>", "Custom nonce for manual tx sequencing (for tx)")
    .option("--tip <amount>", "Tip to prioritize transaction (for tx)")
    .option("--mortality <spec>", '"immortal" or period number (for tx)')
    .option(
      "--at <block>",
      'Block hash, "best", or "finalized" to read/validate against (tx, query, apis)',
    )
    .option(
      "--general",
      "Submit as a general (v5) transaction — authorized via extensions, no signer (for tx)",
    )
    .option("--unsigned", "(deprecated) Alias for --general")
    .option("--refresh", "Refresh the cached RPC method list from the node (for rpc)")
    .action(
      async (
        dotpath: string | undefined,
        args: string[],
        opts: {
          chain?: string;
          rpc?: string;
          output?: string;
          json?: boolean;
          from?: string;
          dryRun?: boolean;
          encode?: boolean;
          toYaml?: boolean;
          toJson?: boolean;
          ext?: string;
          asset?: string;
          wait?: string;
          nonce?: string;
          tip?: string;
          mortality?: string;
          at?: string;
          general?: boolean;
          unsigned?: boolean;
          dump?: boolean;
          refresh?: boolean;
          var?: string | string[];
        },
      ) => {
        if (!dotpath) {
          printHelp();
          return;
        }

        // Read --at from raw argv to bypass CAC/mri's numeric coercion of
        // hex block hashes. opts.at is unreliable for hex strings.
        const atRaw = readRawOptionValue("at");

        // --- File-based command input ---
        if (isFilePath(dotpath)) {
          // Collect all --var flags from process.argv (CAC only keeps the last)
          const cliVars = collectVarFlags(process.argv);
          const cmd = await loadCommandFile(dotpath, cliVars);

          // --chain flag overrides file's chain
          const effectiveChain = opts.chain ?? cmd.chain;
          const handlerOpts = {
            chain: effectiveChain,
            rpc: opts.rpc,
            output: opts.output,
            json: opts.json,
          };
          const target = `${cmd.pallet}.${cmd.item}`;

          switch (cmd.category) {
            case "tx": {
              const fileDecodeOnly = Boolean(opts.encode || opts.toYaml || opts.toJson);
              const fileDryRun = resolveDryRun(opts.dryRun, fileDecodeOnly);
              if (fileDryRun && isGlobalDryRun() && opts.dryRun === undefined) {
                printGlobalDryRunHint();
              }
              await handleTx(target, args, {
                ...handlerOpts,
                from: opts.from,
                general: resolveGeneralFlag(opts) ?? cmd.general,
                dryRun: fileDryRun,
                encode: opts.encode,
                toYaml: opts.toYaml,
                toJson: opts.toJson,
                ext: opts.ext,
                asset: opts.asset,
                wait: opts.wait,
                nonce: opts.nonce,
                tip: opts.tip,
                mortality: opts.mortality,
                at: atRaw,
                parsedArgs: cmd.args,
              });
              break;
            }
            case "query":
              await handleQuery(target, args, {
                ...handlerOpts,
                dump: opts.dump,
                at: atRaw,
                parsedArgs: cmd.args,
              });
              break;
            case "const":
              await handleConst(target, handlerOpts);
              break;
            case "apis":
              await handleApis(target, args, {
                ...handlerOpts,
                at: atRaw,
                parsedArgs: cmd.args,
              });
              break;
          }
          return;
        }

        const config = await loadConfig();
        const knownChains = Object.keys(config.chains);

        let parsed: import("./utils/parse-dot-path.ts").ParsedDotPath;
        try {
          parsed = parseDotPath(dotpath, knownChains);
        } catch {
          // External plugin dispatch (git/cargo-style): `dot foo …` execs
          // `dot-foo …` if found on PATH. Only when the unknown word is the
          // first CLI token, so the forwarded argv is exactly what the user
          // typed after the plugin name (flags untouched by our parsing).
          if (process.argv[2] === dotpath) {
            const externalBin = findExternalCommand(dotpath);
            if (externalBin) {
              process.exit(runExternalCommand(externalBin, process.argv.slice(3)));
            }
          }
          const pluginHint = isExternalCommandCandidate(dotpath)
            ? ` No "dot-${dotpath}" plugin found on PATH.`
            : "";
          throw new CliError(
            `Unknown command "${dotpath}". Run "dot --help" for available commands.${pluginHint}`,
          );
        }

        // When dotpath doesn't include pallet/item, absorb them from positional args.
        // Only consume item from args if pallet was also consumed from args,
        // to avoid misinterpreting method arguments as item names
        // (e.g. `dot query.System 0x1234` should NOT treat 0x1234 as an item).
        // Flat categories (rpc, extensions) only absorb the identifier slot —
        // any remaining positionals are method arguments, not sub-items.
        const isFlatCategory = parsed.category === "rpc" || parsed.category === "extensions";
        if (!parsed.pallet && args.length > 0) {
          parsed.pallet = args.shift()!;
          if (!isFlatCategory && !parsed.item && args.length > 0) {
            parsed.item = args.shift()!;
          }
        }

        // Resolve chain: dotpath chain takes precedence, --chain flag as fallback
        if (parsed.chain && opts.chain) {
          throw new CliError(
            `Chain specified both as prefix ("${parsed.chain}") and as --chain flag ("${opts.chain}"). Use one or the other.`,
          );
        }
        const effectiveChain = parsed.chain ?? opts.chain;
        const handlerOpts = {
          chain: effectiveChain,
          rpc: opts.rpc,
          output: opts.output,
          json: opts.json,
        };

        // Build target from pallet + item
        const target = parsed.pallet
          ? parsed.item
            ? `${parsed.pallet}.${parsed.item}`
            : parsed.pallet
          : undefined;

        // Item-level help: show metadata + usage instead of executing
        if (cli.options.help && parsed.pallet && parsed.item) {
          await showItemHelp(parsed.category, target!, handlerOpts);
          return;
        }

        switch (parsed.category) {
          case "query":
            await handleQuery(target, args, { ...handlerOpts, dump: opts.dump, at: atRaw });
            break;
          case "tx": {
            const decodeOnly = Boolean(opts.encode || opts.toYaml || opts.toJson);
            const dryRun = resolveDryRun(opts.dryRun, decodeOnly);
            if (dryRun && isGlobalDryRun() && opts.dryRun === undefined) {
              printGlobalDryRunHint();
            }
            // Handle raw hex: if pallet starts with 0x, it's a raw call hex
            const txOpts = {
              ...handlerOpts,
              from: opts.from,
              general: resolveGeneralFlag(opts),
              dryRun,
              encode: opts.encode,
              toYaml: opts.toYaml,
              toJson: opts.toJson,
              ext: opts.ext,
              asset: opts.asset,
              wait: opts.wait,
              nonce: opts.nonce,
              tip: opts.tip,
              mortality: opts.mortality,
              at: atRaw,
            };
            if (parsed.pallet && /^0x[0-9a-fA-F]+$/.test(parsed.pallet)) {
              await handleTx(parsed.pallet, args, txOpts);
            } else {
              await handleTx(target, args, txOpts);
            }
            break;
          }
          case "const":
            await handleConst(target, handlerOpts);
            break;
          case "events":
            await handleEvents(target, handlerOpts);
            break;
          case "errors":
            await handleErrors(target, handlerOpts);
            break;
          case "apis":
            await handleApis(target, args, { ...handlerOpts, at: atRaw });
            break;
          case "extensions": {
            if (parsed.item) {
              const suggestion = parsed.chain
                ? `dot ${parsed.chain}.extensions.${parsed.pallet}`
                : opts.chain
                  ? `dot extensions.${parsed.pallet} --chain ${opts.chain}`
                  : `dot extensions.${parsed.pallet} --chain <chain>`;
              throw new CliError(`Transaction extensions have no sub-items. Try "${suggestion}".`);
            }
            await handleExtensions(parsed.pallet, handlerOpts);
            break;
          }
          case "rpc": {
            if (parsed.item) {
              const suggestion = parsed.chain
                ? `dot ${parsed.chain}.rpc.${parsed.pallet}`
                : opts.chain
                  ? `dot rpc.${parsed.pallet} --chain ${opts.chain}`
                  : `dot rpc.${parsed.pallet} --chain <chain>`;
              throw new CliError(`RPC methods have no sub-items. Try "${suggestion}".`);
            }
            await handleRpc(parsed.pallet, args, {
              ...handlerOpts,
              help: cli.options.help,
              refresh: opts.refresh,
            });
            break;
          }
        }
      },
    );

  cli.option("--help, -h", "Display this message");
  cli.version(version);

  /** Merge --general with the deprecated --unsigned alias, warning when the alias is used */
  function resolveGeneralFlag(opts: {
    general?: boolean;
    unsigned?: boolean;
  }): boolean | undefined {
    if (opts.unsigned) {
      console.error(
        "Warning: --unsigned is deprecated and will be removed; use --general instead (it submits a v5 general transaction, which is not unsigned — authorization lives in the transaction extensions).",
      );
    }
    return opts.general ?? opts.unsigned;
  }

  /** Collect all --var KEY=VALUE flags from argv (CAC only keeps the last for repeated options) */
  function collectVarFlags(argv: string[]): Record<string, string> {
    const vars: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--var" && i + 1 < argv.length) {
        vars.push(argv[i + 1]!);
        i++;
      } else if (argv[i]!.startsWith("--var=")) {
        vars.push(argv[i]!.slice(6));
      }
    }
    return parseVarFlags(vars);
  }

  function printHelp() {
    console.log(`dot/${version} — Polkadot CLI`);
    console.log();
    console.log("Usage:");
    console.log("  dot <category>[.Pallet[.Item]] [args] [options]");
    console.log("  dot [Chain.]<category>[.Pallet[.Item]] [args] [options]");
    console.log("  dot <file.yaml|file.json> [options]");
    console.log();
    console.log("Categories:");
    console.log("  query     Query on-chain storage");
    console.log("  tx        Submit an extrinsic");
    console.log("  const     Look up or list pallet constants");
    console.log("  events    List or inspect pallet events");
    console.log("  errors    List or inspect pallet errors");
    console.log("  apis      Browse and call runtime APIs");
    console.log("  extensions  List transaction extensions on a chain");
    console.log("  rpc       Call raw JSON-RPC methods on a node");
    console.log();
    console.log("Examples:");
    console.log("  dot polkadot.query.System.Account <addr>            Query a storage item");
    console.log(
      "  dot polkadot.query.System                           List storage items in System",
    );
    console.log("  dot tx.System.remark 0xdead --from alice --chain polkadot");
    console.log("  dot tx.People.create_people_collection --general --chain polkadot-people");
    console.log("  dot polkadot.const.Balances.ExistentialDeposit");
    console.log("  dot polkadot.events.Balances                        List events in Balances");
    console.log("  dot polkadot.apis.Core.version                      Call a runtime API");
    console.log(
      "  dot metadata polkadot                               Dump runtime metadata as JSON",
    );
    console.log(
      "  dot polkadot.extensions                             List transaction extensions",
    );
    console.log("  dot polkadot.extensions.CheckMortality              Inspect one extension");
    console.log(
      "  dot polkadot.rpc                                    List RPC methods on the node",
    );
    console.log("  dot polkadot.rpc.system_health                      Call a JSON-RPC method");
    console.log("  dot query.System.Number --chain polkadot            --chain flag form");
    console.log(
      "  dot ./transfer.yaml --from alice                    Run from file (chain in YAML)",
    );
    console.log("  dot tx.0x1f0003... --to-yaml --chain polkadot       Decode hex call to YAML");
    console.log(
      "  dot tx.System.remark 0xdead --to-json --chain polkadot   Output as JSON file format",
    );
    console.log("  dot polkadot.query.System.Number --json             JSON output");
    console.log();
    console.log("Commands:");
    console.log("  inspect [target]   Inspect chain metadata (alias: explore)");
    console.log("  metadata <chain>   Dump runtime metadata as JSON (--raw for SCALE hex)");
    console.log("  chain              Manage chain configurations");
    console.log("  account            Manage accounts");
    console.log("  hash               Hash utilities");
    console.log("  sign               Sign a message with an account keypair");
    console.log(
      "  parachain          Derive parachain sovereign accounts (deprecated — use `account inspect --parachain`)",
    );
    console.log("  verifiable         Bandersnatch member keys, ring-VRF proofs, sign/verify");
    console.log("  completions <sh>   Generate shell completions (zsh, bash, fish)");
    console.log("  init               Initialize a local .polkadot workspace in this directory");
    console.log(
      "  which              Show the active config root (workspace, DOT_HOME, or global)",
    );
    console.log("  skill              Install/print the agent skill (Claude Code, Codex)");
    console.log();
    console.log("Plugins:");
    console.log(
      '  dot <name> …       Runs a "dot-<name>" executable found on PATH (git/cargo-style)',
    );
    console.log();
    console.log("Global options:");
    console.log("  --chain <name>     Target chain (required)");
    console.log("  --rpc <url>        Override RPC endpoint");
    console.log("  --json             Output as JSON");
    console.log("  --output <format>  Output format: pretty or json");
    console.log("  --help, -h         Display this message");
    console.log("  --version          Show version");
  }

  async function showUpdateAndExit(code: number): Promise<never> {
    await waitForPendingCheck();
    const note = getUpdateNotification(version);
    if (note) process.stderr.write(`${note}\n`);
    process.exit(code);
  }

  async function handleError(err: unknown): Promise<never> {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
    } else if (err instanceof Error) {
      // CACError for missing args, polkadot-api errors, etc.
      console.error(`Error: ${formatRuntimeError(err)}`);
    } else {
      console.error("An unexpected error occurred:", err);
    }
    return showUpdateAndExit(1);
  }

  // papi schedules timers inside chainHead follow streams that can fire after
  // client.destroy() — those rejections are benign cleanup races and would
  // otherwise crash the process (e.g. after `dot chain update --all`).
  process.on("unhandledRejection", (reason) => {
    if (isPapiCleanupError(reason)) return;
    console.error(`Error: ${formatRuntimeError(reason)}`);
    process.exit(1);
  });

  async function main() {
    try {
      cli.parse(process.argv, { run: false });

      if (cli.options.version) {
        await showUpdateAndExit(0);
      } else if (cli.options.help) {
        // A named command with registered help (account, chain, sign, …) prints
        // its own usage block — even when an action positional is present, e.g.
        // `dot account add --help`. Without this, the action would run and fail
        // on the missing argument instead of showing help (issue #238).
        if (printMatchedCommandHelp(cli)) {
          await showUpdateAndExit(0);
        } else if ((cli as any).matchedCommand) {
          // The default dot-path command handles item-level help inside its
          // action (e.g. `dot polkadot.query.System.Account --help`).
          const result = (cli as any).runMatchedCommand();
          if (result && typeof result.then === "function") {
            await result.then(() => showUpdateAndExit(0), handleError);
          }
        } else {
          printHelp();
          await showUpdateAndExit(0);
        }
      } else if (!(cli as any).matchedCommand) {
        printHelp();
        await showUpdateAndExit(0);
      } else {
        const result = (cli as any).runMatchedCommand();
        if (result && typeof result.then === "function") {
          await result.then(() => showUpdateAndExit(0), handleError);
        }
      }
    } catch (err) {
      await handleError(err);
    }
  }

  main();
} // end __complete early-exit else block
