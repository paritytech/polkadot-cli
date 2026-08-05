import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  decodeRevertData,
  encodeFunctionCall,
  ethereumAddressFromPrivateKey,
  ethereumKeyFromMnemonic,
  generateEthereumPrivateKey,
  isEthereumPrivateKey,
  limbsToU256,
  looksLikeFunctionSignature,
  signEthereumTransaction,
  u256ToLimbs,
} from "./ethereum.ts";

// Well-known anvil/hardhat dev key #1 — fixed vector for address derivation.
const ANVIL_KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ANVIL_ADDRESS_1 = "70997970c51812dc3a010c7d01b50e0d17dc79c8";

describe("isEthereumPrivateKey", () => {
  test("accepts a 0x-prefixed 32-byte hex string", () => {
    expect(isEthereumPrivateKey(ANVIL_KEY_1)).toBe(true);
  });

  test("rejects wrong lengths, missing prefix, and non-hex", () => {
    expect(isEthereumPrivateKey(ANVIL_KEY_1.slice(2))).toBe(false); // no 0x
    expect(isEthereumPrivateKey(`${ANVIL_KEY_1}ff`)).toBe(false); // 33 bytes
    expect(isEthereumPrivateKey("0x59c6")).toBe(false); // too short
    expect(isEthereumPrivateKey(`0x${"zz".repeat(32)}`)).toBe(false); // non-hex
    expect(isEthereumPrivateKey("word1 word2 word3")).toBe(false); // mnemonic
  });
});

describe("ethereumAddressFromPrivateKey", () => {
  test("derives the known address for a fixed key", async () => {
    const h160 = await ethereumAddressFromPrivateKey(ANVIL_KEY_1);
    expect(bytesToHex(h160)).toBe(ANVIL_ADDRESS_1);
  });

  test("rejects an invalid key", async () => {
    await expect(ethereumAddressFromPrivateKey("0x1234")).rejects.toThrow(
      "Invalid Ethereum private key",
    );
  });
});

describe("generateEthereumPrivateKey", () => {
  test("produces a valid, non-repeating key", async () => {
    const a = await generateEthereumPrivateKey();
    const b = await generateEthereumPrivateKey();
    expect(isEthereumPrivateKey(a)).toBe(true);
    expect(isEthereumPrivateKey(b)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("signEthereumTransaction", () => {
  // Regression vector: this exact transaction was submitted to previewnet
  // asset-hub (chain id 420420417) via `Revive.eth_transact` and executed
  // successfully in block #182227 — a call to Multicall3.getBlockNumber().
  test("reproduces a known-good previewnet payload byte-for-byte", async () => {
    const payload = await signEthereumTransaction(
      "0x2e5f4c6cbd0e6d5a1e8f3a7b9c4d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d",
      {
        chainId: 420420417,
        nonce: 0n,
        to: "0x03e9Cb96dF143b2339b75E6A0dB018fC79cE6eB1",
        value: 0n,
        data: "0x42cbb15c",
        gas: 2000n,
        maxFeePerGas: 1000000000000n,
      },
    );
    expect(payload).toBe(
      "0x02f86f84190f1b41808085e8d4a510008207d09403e9Cb96dF143b2339b75E6A0dB018fC79cE6eB1808442cbb15cc080a0cb5d43d1d28fc22fa6c844011d3878e62b48d11656806bddbb9fd3dc1f266d36a04e014b6a8062ed27a866218c8391e7829e965b642e80207924bace30ca76390b",
    );
  });
});

describe("looksLikeFunctionSignature", () => {
  test("matches human ABI signatures", () => {
    expect(looksLikeFunctionSignature("available(string)")).toBe(true);
    expect(looksLikeFunctionSignature("whiteListAddress(address,bool)")).toBe(true);
    expect(looksLikeFunctionSignature("totalSupply()")).toBe(true);
    expect(looksLikeFunctionSignature("transfer(address to, uint256 amount)")).toBe(true);
  });

  test("rejects raw calldata, addresses, and plain words", () => {
    expect(looksLikeFunctionSignature("0x42cbb15c")).toBe(false);
    expect(looksLikeFunctionSignature("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe(false);
    expect(looksLikeFunctionSignature("transfer")).toBe(false);
    expect(looksLikeFunctionSignature("100")).toBe(false);
  });
});

describe("encodeFunctionCall", () => {
  test("encodes a string argument (verified against previewnet DotNS controller)", async () => {
    // Same calldata that returned `true` from available("claudetest123") on
    // previewnet's DotnsRegistrarController via ReviveApi.call.
    const data = await encodeFunctionCall("available(string)", ["claudetest123"]);
    expect(data).toBe(
      "0xaeb8ce9b0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d636c617564657465737431323300000000000000000000000000000000000000",
    );
  });

  test("encodes address and bool arguments", async () => {
    const data = await encodeFunctionCall("whiteListAddress(address,bool)", [
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "true",
    ]);
    expect(data).toBe(
      "0x9dd2192800000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000000000001",
    );
  });

  test("accepts named-parameter signatures", async () => {
    const bare = await encodeFunctionCall("transfer(address,uint256)", [
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "1000000",
    ]);
    const named = await encodeFunctionCall("transfer(address to, uint256 amount)", [
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "1000000",
    ]);
    expect(named).toBe(bare);
  });

  test("encodes a no-arg call to its bare selector", async () => {
    expect(await encodeFunctionCall("getBlockNumber()", [])).toBe("0x42cbb15c");
  });

  test("rejects an argument-count mismatch", async () => {
    await expect(encodeFunctionCall("available(string)", [])).rejects.toThrow(
      "expects 1 argument(s)",
    );
    await expect(encodeFunctionCall("available(string)", ["a", "b"])).rejects.toThrow(
      "expects 1 argument(s)",
    );
  });

  test("rejects malformed scalar arguments with a pointed message", async () => {
    await expect(
      encodeFunctionCall("transfer(address,uint256)", ["not-an-address", "1"]),
    ).rejects.toThrow("not a valid address");
    await expect(
      encodeFunctionCall("transfer(address,uint256)", [
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "one",
      ]),
    ).rejects.toThrow("not a valid uint256");
    await expect(encodeFunctionCall("setFlag(bool)", ["yes"])).rejects.toThrow("not a valid bool");
  });

  test("rejects invalid hex for bytes arguments", async () => {
    await expect(encodeFunctionCall("setBytes(bytes)", ["zz"])).rejects.toThrow("not valid bytes");
  });

  test("rejects malformed JSON for composite arguments", async () => {
    await expect(encodeFunctionCall("setOwners(address[])", ["not json"])).rejects.toThrow(
      "must be JSON",
    );
  });

  test("encodes tuple arguments passed as JSON", async () => {
    const data = await encodeFunctionCall("setPair((address,uint256))", [
      '["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "42"]',
    ]);
    expect(data).toContain("70997970c51812dc3a010c7d01b50e0d17dc79c8");
  });

  test("encodes array arguments passed as JSON", async () => {
    const data = await encodeFunctionCall("setOwners(address[])", [
      '["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"]',
    ]);
    expect(data.startsWith("0x")).toBe(true);
    expect(data).toContain("70997970c51812dc3a010c7d01b50e0d17dc79c8");
  });
});

describe("decodeRevertData", () => {
  test("decodes Error(string)", async () => {
    // Error("boom")
    const data =
      "0x08c379a0" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000004" +
      "626f6f6d00000000000000000000000000000000000000000000000000000000";
    expect(await decodeRevertData(data)).toBe("reverted: boom");
  });

  test("decodes Panic(uint256)", async () => {
    const data = "0x4e487b71" + "0000000000000000000000000000000000000000000000000000000000000011";
    expect(await decodeRevertData(data)).toBe("panicked with code 0x11");
  });

  test("returns null for custom errors and empty data", async () => {
    expect(await decodeRevertData("0xdeadbeef")).toBe(null);
    expect(await decodeRevertData("0x")).toBe(null);
  });
});

describe("u256 limbs", () => {
  test("round-trips representative values", () => {
    for (const v of [0n, 1n, 936n, 10n ** 12n, (1n << 64n) - 1n, 1n << 64n, (1n << 256n) - 1n]) {
      expect(limbsToU256(u256ToLimbs(v))).toBe(v);
    }
  });

  test("matches the on-chain limb layout (little-endian u64s)", () => {
    // ReviveApi.gas_price on previewnet returns ["1000000000000","0","0","0"].
    expect(u256ToLimbs(1000000000000n)).toEqual([1000000000000n, 0n, 0n, 0n]);
    expect(limbsToU256(["1000000000000", "0", "0", "0"])).toBe(1000000000000n);
  });

  test("rejects out-of-range values", () => {
    expect(() => u256ToLimbs(-1n)).toThrow();
    expect(() => u256ToLimbs(1n << 256n)).toThrow();
    expect(() => limbsToU256([1n, 2n])).toThrow("Expected 4 u64 limbs");
  });
});

describe("ethereumKeyFromMnemonic", () => {
  // Anvil/hardhat "junk" phrase, index 0 — the canonical MetaMask-compat vector.
  test("derives the anvil #0 key at m/44'/60'/0'/0/0", async () => {
    const key = await ethereumKeyFromMnemonic(
      "test test test test test test test test test test test junk",
    );
    expect(key).toBe("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  });

  // The substrate dev phrase at indices 0/1 reproduces the well-known
  // Moonbeam/revive dev accounts Alith and Baltathar.
  test("derives Alith and Baltathar from the substrate dev phrase", async () => {
    const DEV_PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk";
    const alith = await ethereumKeyFromMnemonic(DEV_PHRASE, 0);
    expect(alith).toBe("0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133");
    expect(bytesToHex(await ethereumAddressFromPrivateKey(alith))).toBe(
      "f24ff3a9cf04c71dbc94d0b566f7a27b94566cac",
    );
    const baltathar = await ethereumKeyFromMnemonic(DEV_PHRASE, 1);
    expect(bytesToHex(await ethereumAddressFromPrivateKey(baltathar))).toBe(
      "3cd0a705a2dc65e5b1e1205896baa2be8a07c6e0",
    );
  });
});
