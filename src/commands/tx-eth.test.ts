import { describe, expect, test } from "bun:test";
import type { StoredAccount } from "../config/accounts-types.ts";
import { runCli } from "./__fixtures__/run-cli.ts";
import { parseEthereumCallArgs, parseValueOption } from "./tx-eth.ts";

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
