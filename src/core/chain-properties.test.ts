import { describe, expect, test } from "bun:test";
import {
  fetchChainProperties,
  normalizeProperties,
  type RpcRequestFn,
} from "./chain-properties.ts";

describe("normalizeProperties", () => {
  test("preserves scalar decimals/symbol and ss58 format", () => {
    expect(normalizeProperties({ tokenDecimals: 10, tokenSymbol: "DOT", ss58Format: 0 })).toEqual({
      tokenDecimals: 10,
      tokenSymbol: "DOT",
      ss58Format: 0,
    });
  });

  test("preserves array-typed decimals/symbol (multi-token chains)", () => {
    expect(
      normalizeProperties({
        tokenDecimals: [12, 10],
        tokenSymbol: ["ACA", "AUSD"],
        ss58Format: 10,
      }),
    ).toEqual({
      tokenDecimals: [12, 10],
      tokenSymbol: ["ACA", "AUSD"],
      ss58Format: 10,
    });
  });

  test("empty {} yields all nulls", () => {
    expect(normalizeProperties({})).toEqual({
      tokenDecimals: null,
      tokenSymbol: null,
      ss58Format: null,
    });
  });

  test("partial properties fill missing fields with null", () => {
    expect(normalizeProperties({ ss58Format: 42 })).toEqual({
      tokenDecimals: null,
      tokenSymbol: null,
      ss58Format: 42,
    });
  });

  test("non-object responses degrade to all nulls", () => {
    expect(normalizeProperties(null)).toEqual({
      tokenDecimals: null,
      tokenSymbol: null,
      ss58Format: null,
    });
  });
});

describe("fetchChainProperties", () => {
  test("uses system_properties when it succeeds", async () => {
    const calls: string[] = [];
    const request = (async (_url, method) => {
      calls.push(method);
      return { tokenDecimals: 10, tokenSymbol: "DOT", ss58Format: 0 };
    }) as RpcRequestFn;

    const { properties, source } = await fetchChainProperties("wss://example", request);

    expect(calls).toEqual(["system_properties"]);
    expect(source).toBe("system_properties");
    expect(properties.tokenSymbol).toBe("DOT");
  });

  test("falls back to chainSpec_v1_properties when system_properties is unavailable", async () => {
    const calls: string[] = [];
    const request = (async (_url, method) => {
      calls.push(method);
      if (method === "system_properties") {
        throw new Error("Method not found");
      }
      return { tokenDecimals: [12, 10], tokenSymbol: ["ACA", "AUSD"], ss58Format: 10 };
    }) as RpcRequestFn;

    const { properties, source } = await fetchChainProperties("wss://example", request);

    expect(calls).toEqual(["system_properties", "chainSpec_v1_properties"]);
    expect(source).toBe("chainSpec_v1_properties");
    expect(properties.tokenDecimals).toEqual([12, 10]);
  });

  test("returns empty properties when the node reports {}", async () => {
    const request = (async () => ({})) as RpcRequestFn;
    const { properties } = await fetchChainProperties("wss://example", request);
    expect(properties).toEqual({ tokenDecimals: null, tokenSymbol: null, ss58Format: null });
  });

  test("throws the last error when every method fails", async () => {
    const request = (async (_url, method) => {
      throw new Error(`boom ${method}`);
    }) as RpcRequestFn;

    expect(fetchChainProperties("wss://example", request)).rejects.toThrow(
      "boom chainSpec_v1_properties",
    );
  });
});
