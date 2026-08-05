import { describe, expect, test } from "bun:test";
import type { StoredAccount } from "../config/accounts-types.ts";
import { runCli } from "./__fixtures__/run-cli.ts";
import {
  buildGenericTransaction,
  formatEthTransactError,
  handleEthereumTx,
  parseEthereumCallArgs,
  parseValueOption,
  toHexData,
} from "./tx-eth.ts";

const DEST = "0x03e9Cb96dF143b2339b75E6A0dB018fC79cE6eB1";

describe("parseEthereumCallArgs", () => {
  test("bare transfer: dest only, empty calldata", async () => {
    const call = await parseEthereumCallArgs([DEST]);
    expect(call.dest).toBe(DEST);
    expect(call.data).toBe("0x");
    expect(call.signature).toBeUndefined();
  });

  test("normalizes the destination to EIP-55", async () => {
    const call = await parseEthereumCallArgs([DEST.toLowerCase()]);
    expect(call.dest).toBe(DEST);
  });

  test("raw calldata passes through", async () => {
    const call = await parseEthereumCallArgs([DEST, "0x42cbb15c"]);
    expect(call.data).toBe("0x42cbb15c");
    expect(call.signature).toBeUndefined();
  });

  test("function signature encodes calldata", async () => {
    const call = await parseEthereumCallArgs([DEST, "getBlockNumber()"]);
    expect(call.data).toBe("0x42cbb15c");
    expect(call.signature).toBe("getBlockNumber()");
  });

  test("function signature with arguments", async () => {
    const call = await parseEthereumCallArgs([
      DEST,
      "whiteListAddress(address,bool)",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "true",
    ]);
    expect(call.data.startsWith("0x9dd21928")).toBe(true);
  });

  test("rejects a missing destination", async () => {
    await expect(parseEthereumCallArgs([])).rejects.toThrow("Contract address is required");
  });

  test("rejects a malformed destination", async () => {
    await expect(parseEthereumCallArgs(["nope"])).rejects.toThrow("not a valid contract address");
    await expect(parseEthereumCallArgs(["0x1234"])).rejects.toThrow("not a valid contract address");
  });

  test("rejects extra arguments after raw calldata", async () => {
    await expect(parseEthereumCallArgs([DEST, "0x42cbb15c", "extra"])).rejects.toThrow(
      "Raw calldata takes no further arguments",
    );
  });

  test("rejects an argument that is neither calldata nor a signature", async () => {
    await expect(parseEthereumCallArgs([DEST, "hello"])).rejects.toThrow(
      "neither 0x-hex calldata nor a function signature",
    );
  });
});

describe("parseValueOption", () => {
  test("defaults to 0", () => {
    expect(parseValueOption(undefined)).toBe(0n);
  });

  test("parses wei amounts beyond Number precision", () => {
    expect(parseValueOption("1000000000000000000")).toBe(10n ** 18n);
    expect(parseValueOption("123456789012345678901234567890")).toBe(
      123456789012345678901234567890n,
    );
  });

  test("rejects negatives and non-integers", () => {
    expect(() => parseValueOption("-1")).toThrow("non-negative");
    expect(() => parseValueOption("1.5")).toThrow("Invalid --value");
    expect(() => parseValueOption("abc")).toThrow("Invalid --value");
  });
});

// CLI-level guards — these fire before any chain connection, so they are
// exercised offline against the fixture metadata.
// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("ethereum tx guards (CLI)", { timeout: 15_000 }, () => {
  const ETH_ACCOUNT: StoredAccount = {
    name: "eth-admin",
    secret: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    publicKey: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8eeeeeeeeeeeeeeeeeeeeeeee",
    derivationPath: "",
    scheme: "ethereum",
  };

  test("ordinary pallet call from a derived -eth identity errors with guidance", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xdead",
      "--from",
      "alice-eth",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("cannot sign substrate extrinsics");
    expect(stderr).toContain("Revive.call");
  });

  test("ordinary pallet call from an ethereum account errors with guidance", async () => {
    const { stderr, exitCode } = await runCli(
      ["tx.System.remark", "0xdead", "--from", "eth-admin"],
      { accounts: [ETH_ACCOUNT] },
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("cannot sign substrate extrinsics");
    expect(stderr).toContain("Revive.call");
  });

  test("raw call hex from an ethereum account errors", async () => {
    const { stderr, exitCode } = await runCli(["tx", "0x00071234", "--from", "eth-admin"], {
      accounts: [ETH_ACCOUNT],
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Raw call hex is a substrate call");
  });

  test("--tip is rejected for ethereum transactions", async () => {
    const { stderr, exitCode } = await runCli(
      ["tx.Revive.call", DEST, "--from", "eth-admin", "--tip", "100"],
      { accounts: [ETH_ACCOUNT] },
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--tip does not apply to ethereum transactions");
  });

  test("--value on a substrate-signed tx is rejected, not silently ignored", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xdead",
      "--from",
      "alice",
      "--value",
      "5",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--value only applies to ethereum transactions");
  });

  test("--encode still encodes the substrate call without touching the eth path", async () => {
    // decode-only flags bypass the signer entirely — unchanged behavior.
    const { stderr, exitCode } = await runCli(
      ["tx.System.remark", "0xdead", "--from", "eth-admin", "--encode"],
      { accounts: [ETH_ACCOUNT] },
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("cannot sign");
  });
});

// In-process coverage of the pure helpers and pre-connect guards (subprocess
// runCli tests above verify behavior but earn no coverage instrumentation).
describe("tx-eth helpers (in-process)", () => {
  test("toHexData normalizes Binary-likes, Uint8Array, and everything else", () => {
    expect(toHexData({ asHex: () => "0x1234" })).toBe("0x1234");
    expect(toHexData(new Uint8Array([0xde, 0xad]))).toBe("0xdead");
    expect(toHexData("garbage")).toBe("0x");
    expect(toHexData(undefined)).toBe("0x");
  });

  test("buildGenericTransaction produces the JSON shape with string limbs", () => {
    const tx = buildGenericTransaction({
      from: "0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac",
      to: DEST,
      data: "0x42cbb15c",
      value: (1n << 64n) + 7n,
      nonce: 3n,
    });
    expect(tx.from).toBe("0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac");
    expect(tx.to).toBe(DEST);
    expect(tx.input.data).toBe("0x42cbb15c");
    expect(tx.nonce).toEqual(["3", "0", "0", "0"]);
    expect(tx.value).toEqual(["7", "1", "0", "0"]);
    expect(tx.chain_id).toBe(null);
    expect(tx.authorization_list).toEqual([]);
  });

  test("formatEthTransactError decodes revert data and messages", async () => {
    const boom =
      "0x08c379a0" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000004" +
      "626f6f6d00000000000000000000000000000000000000000000000000000000";
    expect(await formatEthTransactError({ type: "Data", value: { asHex: () => boom } })).toBe(
      "Contract reverted: boom",
    );
    expect(
      await formatEthTransactError({ type: "Data", value: { asHex: () => "0xdeadbeef" } }),
    ).toBe("Contract reverted with data: 0xdeadbeef");
    expect(await formatEthTransactError({ type: "Message", value: "gas too low" })).toBe(
      "gas too low",
    );
    expect(await formatEthTransactError({ type: "Weird", value: 1 })).toContain("Weird");
  });
});

describe("handleEthereumTx pre-connect guards (in-process)", () => {
  const chainConfig = { rpc: "wss://unused.invalid" };

  test("rejects raw call hex", async () => {
    await expect(
      handleEthereumTx("0x00071234", [], "eth-admin", "polkadot", chainConfig, {}),
    ).rejects.toThrow("Raw call hex is a substrate call");
  });

  test("rejects non-Revive.call targets", async () => {
    await expect(
      handleEthereumTx("System.remark", ["0xdead"], "eth-admin", "polkadot", chainConfig, {}),
    ).rejects.toThrow("cannot sign substrate extrinsics");
  });

  test("rejects inapplicable transaction flags", async () => {
    for (const opts of [{ tip: "1" }, { mortality: "immortal" }, { asset: "{}" }, { ext: "{}" }]) {
      await expect(
        handleEthereumTx("Revive.call", [DEST], "eth-admin", "polkadot", chainConfig, opts),
      ).rejects.toThrow("does not apply to ethereum transactions");
    }
  });

  test("rejects malformed --value and args before touching the network", async () => {
    await expect(
      handleEthereumTx("Revive.call", [DEST], "eth-admin", "polkadot", chainConfig, {
        value: "nope",
      }),
    ).rejects.toThrow("Invalid --value");
    await expect(
      handleEthereumTx("Revive.call", [], "eth-admin", "polkadot", chainConfig, {}),
    ).rejects.toThrow("Contract address is required");
  });
});

// Live previewnet verification of the full dry-run flow: resolve alice-eth
// (Alith), connect, fetch metadata, price via ReviveApi.eth_transact, print
// the report. Needs no funds — a value-0 dry-run skips balance checks. Runs
// as a subprocess: load-meta.test.ts installs process-global mock.module
// replacements for core/client.ts, so an in-process variant of this test
// would silently get the mocked (revive-less) fixture chain in full-suite
// runs. This is the one test in the file that depends on
// wss://previewnet.substrate.dev, so it is opt-in: set DOT_LIVE_TESTS=1 to run
// it. The default `bun test` stays offline and deterministic.
const liveTest = process.env.DOT_LIVE_TESTS ? test : test.skip;
// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("live dry-run (previewnet)", { timeout: 90_000 }, () => {
  // Retry: previewnet occasionally times out under full-suite network concurrency.
  // @ts-expect-error Bun supports test(label, options, fn) at runtime
  liveTest("prices a contract call as the derived alice-eth identity", { retry: 2 }, async () => {
    const { stdout, exitCode } = await runCli(
      [
        "preview-asset-hub.tx.Revive.call",
        DEST,
        "getBlockNumber()",
        "--from",
        "alice-eth",
        "--dry-run",
      ],
      {
        noDefaultChain: true,
        files: {
          // Replace the fixture config wholesale: preview-asset-hub must NOT
          // be in the fixture's chain list, or run-cli would hardlink the
          // polkadot fixture metadata for it and the CLI would decode against
          // a revive-less runtime instead of fetching the real one.
          ".polkadot/config.json": JSON.stringify({
            chains: { "preview-asset-hub": { rpc: "wss://previewnet.substrate.dev/asset-hub" } },
          }),
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("eth chain id 420420417");
    expect(stdout).toContain("0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac"); // Alith
    expect(stdout).toContain("getBlockNumber()");
    expect(stdout).toContain("Gas:");
    expect(stdout).toContain("Return: 0x");
  });
});
