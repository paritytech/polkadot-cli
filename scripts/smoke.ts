#!/usr/bin/env bun
/**
 * Live smoke test: runs the built CLI (dist/cli.mjs) against real public RPC.
 *
 *   bun run build && bun run smoke
 *
 * 1. Reads on every built-in chain: block number, a constant, a runtime API
 *    and a raw RPC call.
 * 2. Probes every bundled RPC endpoint on its own. A dead endpoint is reported
 *    as a warning, not a failure: the CLI rotates past it, and one flaky public
 *    node should not turn the nightly run red.
 * 3. With PASEO_CI_MNEMONIC set, submits a remark and a transfer on Paseo Asset
 *    Hub and waits for finality. Skipped without the secret, which GitHub
 *    withholds from pull requests opened from forks.
 *
 * State lives in a throwaway DOT_HOME, never ~/.polkadot.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config/types.ts";

const cli = join(import.meta.dir, "../dist/cli.mjs");
const home = await mkdtemp(join(tmpdir(), "dot-smoke-"));
const env = { ...process.env, DOT_HOME: home, DOT_NO_UPDATE_CHECK: "1", NO_COLOR: "1" };

/** Paseo Asset Hub holds the balances since the Asset Hub migration. */
const TX_CHAIN = "paseo-asset-hub";
/** Fail early with a clear message instead of a cryptic dispatch error. 1 PAS. */
const MIN_BALANCE = 10_000_000_000n;

const failures: string[] = [];
const warnings: string[] = [];

async function dot(args: string[], timeoutMs = 120_000): Promise<string> {
  const proc = Bun.spawn(["node", cli, ...args, "--json"], { env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(`dot ${args.join(" ")} exited ${code}: ${(err || out).trim()}`);
  return out.trim();
}

async function check(label: string, fn: () => Promise<string | void>) {
  const start = performance.now();
  try {
    const detail = await fn();
    const ms = Math.round(performance.now() - start);
    console.log(`ok   ${label} (${ms}ms)${detail ? ` ${detail}` : ""}`);
  } catch (e) {
    console.log(`FAIL ${label}: ${(e as Error).message}`);
    failures.push(label);
  }
}

function lastJsonLine(out: string): any {
  return JSON.parse(out.split("\n").filter(Boolean).at(-1)!);
}

async function freeBalance(account: string): Promise<bigint> {
  const info = JSON.parse(await dot([`${TX_CHAIN}.query.System.Account`, account]));
  return BigInt(info.data.free);
}

async function readChain(chain: string) {
  await check(`${chain} query System.Number`, async () => {
    const n = JSON.parse(await dot([`${chain}.query.System.Number`]));
    if (!(Number(n) > 0)) throw new Error(`unexpected block number ${n}`);
    return `#${n}`;
  });
  await check(`${chain} const System.SS58Prefix`, async () => {
    JSON.parse(await dot([`${chain}.const.System.SS58Prefix`]));
  });
  await check(`${chain} apis Core.version`, async () => {
    const v = JSON.parse(await dot([`${chain}.apis.Core.version`]));
    return `${v.spec_name}@${v.spec_version}`;
  });
  await check(`${chain} rpc system_health`, async () => {
    const h = JSON.parse(await dot([`${chain}.rpc.system_health`]));
    if (h.isSyncing) throw new Error("node reports isSyncing");
  });
}

async function probeEndpoint(chain: string, url: string) {
  try {
    await dot([`${chain}.rpc.chain_getBlockHash`, "0", "--rpc", url], 30_000);
  } catch (e) {
    warnings.push(`${chain}: ${url} (${(e as Error).message.split("\n")[0]})`);
  }
}

/**
 * Submit a transaction and wait for finality. Runs on different PRs share the
 * CI account, so two submissions can race on the nonce; retry with jitter.
 */
async function submit(args: string[], attempts = 3): Promise<any> {
  for (let i = 1; ; i++) {
    try {
      const r = lastJsonLine(await dot(args, 300_000));
      if (r.event !== "finalized" || !r.ok) throw new Error(JSON.stringify(r));
      return r;
    } catch (e) {
      if (i >= attempts) throw e;
      console.log(`retry ${args[0]} (attempt ${i} failed: ${(e as Error).message.split("\n")[0]})`);
      await Bun.sleep(5_000 + Math.random() * 10_000);
    }
  }
}

async function publicKey(address: string): Promise<string> {
  return JSON.parse(await dot(["account", "inspect", address])).publicKey;
}

async function transactions() {
  await dot(["account", "add", "ci", "--env", "PASEO_CI_MNEMONIC"]);
  await dot(["account", "add", "ci-2", "--env", "PASEO_CI_MNEMONIC", "--path", "//2"]);
  const sender = JSON.parse(await dot(["account", "inspect", "ci"])).ss58 as string;
  const receiver = JSON.parse(await dot(["account", "inspect", "ci-2"])).ss58 as string;

  const balance = await freeBalance(sender);
  console.log(`CI account ${sender} holds ${balance} planck on ${TX_CHAIN}`);
  if (balance < MIN_BALANCE) {
    failures.push(`CI account balance below ${MIN_BALANCE} planck`);
    console.log(
      `::error::CI account ${sender} is low on funds. Refill it from https://faucet.polkadot.io (Paseo Asset Hub).`,
    );
    return;
  }

  await check(`${TX_CHAIN} tx System.remark (finalized)`, async () => {
    const r = await submit([`${TX_CHAIN}.tx.System.remark`, "0x736d6f6b65", "--from", "ci"]);
    return `block #${r.blockNumber}`;
  });

  await check(`${TX_CHAIN} tx Balances.transfer_keep_alive (finalized)`, async () => {
    const amount = BigInt(JSON.parse(await dot([`${TX_CHAIN}.const.Balances.ExistentialDeposit`])));
    const r = await submit([
      `${TX_CHAIN}.tx.Balances.transfer_keep_alive`,
      receiver,
      amount.toString(),
      "--from",
      "ci",
    ]);
    // Check the transfer through its own event rather than the receiver's
    // balance, which a concurrent run on another PR may also be topping up.
    const receiverKey = await publicKey(receiver);
    const transfers = (r.events ?? []).filter(
      (e: any) => e.pallet === "Balances" && e.name === "Transfer",
    );
    for (const e of transfers) {
      if (BigInt(e.fields.amount) === amount && (await publicKey(e.fields.to)) === receiverKey) {
        return `block #${r.blockNumber}`;
      }
    }
    throw new Error(`no Balances.Transfer of ${amount} to ${receiver}: ${JSON.stringify(transfers)}`);
  });
}

try {
  const chains = Object.keys(DEFAULT_CONFIG.chains);
  await Promise.all(chains.map(readChain));

  await Promise.all(
    Object.entries(DEFAULT_CONFIG.chains).flatMap(([chain, { rpc }]) =>
      [rpc].flat().map((url) => probeEndpoint(chain, url)),
    ),
  );
  for (const w of warnings) console.log(`::warning::Unreachable RPC endpoint ${w}`);


  if (process.env.PASEO_CI_MNEMONIC) await transactions();
  else console.log("skip transactions: PASEO_CI_MNEMONIC is not set");
} finally {
  await rm(home, { recursive: true, force: true });
}

console.log(`\n${failures.length} failed, ${warnings.length} unreachable endpoint(s)`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
