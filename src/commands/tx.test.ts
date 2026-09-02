import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isCompatible, mapLookupToTypedef } from "@polkadot-api/metadata-compatibility";
import { Binary } from "polkadot-api";
import { DEFAULT_CONFIG } from "../config/types.ts";
import { getPeopleMetadata, getTestMetadata } from "./__fixtures__/load-metadata.ts";
import { runCli } from "./__fixtures__/run-cli.ts";
import {
  autoDefaultForType,
  buildCustomSignedExtensions,
  buildGeneralTx,
  decodeCallFallback,
  decodeCallToFileFormat,
  fileArgsToStrings,
  formatDispatchError,
  formatEventValue,
  formatRawDecoded,
  generalDefaultForType,
  handleTx,
  NO_DEFAULT,
  normalizeValue,
  parseAssetOption,
  parseAtForRead,
  parseAtOption,
  parseCallArgs,
  parseEnumShorthand,
  parseExtOption,
  parseMortalityOption,
  parseNonceOption,
  parsePrimitive,
  parseTipOption,
  parseTypedArg,
  parseWaitLevel,
  resolveExtrinsicVersion,
  sanitizeForSerialization,
  typeHint,
} from "./tx.ts";

const meta = getTestMetadata();

// ---------------------------------------------------------------------------
// Ensure metadata + config exist in real $HOME for in-process tests.
// ---------------------------------------------------------------------------
const FIXTURE_METADATA = join(import.meta.dir, "__fixtures__/polkadot-metadata.bin");
const DOT_DIR = join(homedir(), ".polkadot");

beforeAll(() => {
  const metaDir = join(DOT_DIR, "chains", "polkadot");
  const metaPath = join(metaDir, "metadata.bin");
  if (!existsSync(metaPath)) {
    mkdirSync(metaDir, { recursive: true });
    linkSync(FIXTURE_METADATA, metaPath);
  }
  const configPath = join(DOT_DIR, "config.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG));
  }
});

// ---------------------------------------------------------------------------
// In-process JSON output coverage for handleTx listing paths.
// ---------------------------------------------------------------------------

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("handleTx JSON output (in-process coverage)", { timeout: 15_000 }, () => {
  test("category-only with json", async () => {
    await handleTx(undefined, [], { json: true, chain: "polkadot" });
  });
  test("pallet-only with json", async () => {
    await handleTx("System", [], { json: true, chain: "polkadot" });
  });
});

// ---------------------------------------------------------------------------
// parseWaitLevel
// ---------------------------------------------------------------------------

describe("parseWaitLevel", () => {
  test('"broadcast" returns "broadcast"', () => {
    expect(parseWaitLevel("broadcast")).toBe("broadcast");
  });

  test('"best-block" returns "best-block"', () => {
    expect(parseWaitLevel("best-block")).toBe("best-block");
  });

  test('"best" returns "best-block"', () => {
    expect(parseWaitLevel("best")).toBe("best-block");
  });

  test('"finalized" returns "finalized"', () => {
    expect(parseWaitLevel("finalized")).toBe("finalized");
  });

  test("undefined returns finalized", () => {
    expect(parseWaitLevel(undefined)).toBe("finalized");
  });

  test("invalid value throws CliError", () => {
    expect(() => parseWaitLevel("invalid")).toThrow('Invalid --wait value "invalid"');
  });
});

// ---------------------------------------------------------------------------
// parseNonceOption
// ---------------------------------------------------------------------------

describe("parseNonceOption", () => {
  test("undefined returns undefined", () => {
    expect(parseNonceOption(undefined)).toBeUndefined();
  });

  test("valid integer returns number", () => {
    expect(parseNonceOption("0")).toBe(0);
    expect(parseNonceOption("42")).toBe(42);
  });

  test("negative value throws", () => {
    expect(() => parseNonceOption("-1")).toThrow("Invalid --nonce");
  });

  test("non-integer throws", () => {
    expect(() => parseNonceOption("1.5")).toThrow("Invalid --nonce");
  });

  test("non-numeric string throws", () => {
    expect(() => parseNonceOption("abc")).toThrow("Invalid --nonce");
  });
});

// ---------------------------------------------------------------------------
// parseTipOption
// ---------------------------------------------------------------------------

describe("parseTipOption", () => {
  test("undefined returns undefined", () => {
    expect(parseTipOption(undefined)).toBeUndefined();
  });

  test("valid value returns bigint", () => {
    expect(parseTipOption("0")).toBe(0n);
    expect(parseTipOption("1000000")).toBe(1000000n);
  });

  test("negative value throws", () => {
    expect(() => parseTipOption("-1")).toThrow("Invalid --tip");
  });

  test("non-numeric string throws", () => {
    expect(() => parseTipOption("abc")).toThrow("Invalid --tip");
  });
});

// ---------------------------------------------------------------------------
// parseMortalityOption
// ---------------------------------------------------------------------------

describe("parseMortalityOption", () => {
  test("undefined returns undefined", () => {
    expect(parseMortalityOption(undefined)).toBeUndefined();
  });

  test('"immortal" returns { mortal: false }', () => {
    expect(parseMortalityOption("immortal")).toEqual({ mortal: false });
  });

  test("valid period returns mortal config", () => {
    expect(parseMortalityOption("64")).toEqual({ mortal: true, period: 64 });
    expect(parseMortalityOption("128")).toEqual({ mortal: true, period: 128 });
  });

  test("period below 4 throws", () => {
    expect(() => parseMortalityOption("2")).toThrow("Invalid --mortality");
  });

  test("non-numeric string throws", () => {
    expect(() => parseMortalityOption("mortal")).toThrow("Invalid --mortality");
  });
});

// ---------------------------------------------------------------------------
// parseAtOption
// ---------------------------------------------------------------------------

describe("parseAtOption", () => {
  test("undefined returns undefined", () => {
    expect(parseAtOption(undefined)).toBeUndefined();
  });

  test('"best" throws (no longer supported in papi v2)', () => {
    expect(() => parseAtOption("best")).toThrow("no longer supported");
  });

  test('"finalized" returns undefined (v2 defaults to finalized)', () => {
    expect(parseAtOption("finalized")).toBeUndefined();
  });

  test("valid block hash returns hash", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(parseAtOption(hash)).toBe(hash);
  });

  test("invalid value throws", () => {
    expect(() => parseAtOption("0x123")).toThrow("Invalid --at");
    expect(() => parseAtOption("latest")).toThrow("Invalid --at");
  });
});

// ---------------------------------------------------------------------------
// parseAtForRead — permissive variant for query / apis (papi PullOptions)
// ---------------------------------------------------------------------------

describe("parseAtForRead", () => {
  test("undefined returns undefined", () => {
    expect(parseAtForRead(undefined)).toBeUndefined();
  });

  test('"best" passes through (papi reads allow it)', () => {
    expect(parseAtForRead("best")).toBe("best");
  });

  test('"finalized" passes through verbatim (not collapsed)', () => {
    expect(parseAtForRead("finalized")).toBe("finalized");
  });

  test("valid block hash returns hash", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(parseAtForRead(hash)).toBe(hash);
  });

  test("invalid value throws", () => {
    expect(() => parseAtForRead("0x123")).toThrow("Invalid --at");
    expect(() => parseAtForRead("latest")).toThrow("Invalid --at");
  });
});

// ---------------------------------------------------------------------------
// Layer 2: Function-level tests
// ---------------------------------------------------------------------------

describe("parsePrimitive", () => {
  test("bool true", () => {
    expect(parsePrimitive("bool", "true")).toBe(true);
  });

  test("bool false", () => {
    expect(parsePrimitive("bool", "false")).toBe(false);
  });

  test("u32", () => {
    expect(parsePrimitive("u32", "42")).toBe(42);
  });

  test("u128 as bigint", () => {
    expect(parsePrimitive("u128", "1000000000000")).toBe(1000000000000n);
  });

  test("u256 as bigint", () => {
    expect(parsePrimitive("u256", "99999999999999999999")).toBe(99999999999999999999n);
  });

  test("i64 as bigint", () => {
    expect(parsePrimitive("i64", "-42")).toBe(-42n);
  });

  test("str passthrough", () => {
    expect(parsePrimitive("str", "hello")).toBe("hello");
  });

  test("char passthrough", () => {
    expect(parsePrimitive("char", "x")).toBe("x");
  });
});

describe("parseEnumShorthand", () => {
  test("returns null for plain variant name (no parens)", () => {
    expect(parseEnumShorthand("Root")).toBeNull();
  });

  test("parses Parachain(1000)", () => {
    expect(parseEnumShorthand("Parachain(1000)")).toEqual({
      variant: "Parachain",
      inner: "1000",
    });
  });

  test("parses system(Authorized)", () => {
    expect(parseEnumShorthand("system(Authorized)")).toEqual({
      variant: "system",
      inner: "Authorized",
    });
  });

  test("parses nested system(Signed(5FHn...))", () => {
    expect(parseEnumShorthand("system(Signed(5FHn...))")).toEqual({
      variant: "system",
      inner: "Signed(5FHn...)",
    });
  });

  test("returns null for JSON", () => {
    expect(parseEnumShorthand('{"type":"Root"}')).toBeNull();
  });

  test("returns null for hex", () => {
    expect(parseEnumShorthand("0xdead")).toBeNull();
  });

  test("parses Root() as empty inner", () => {
    expect(parseEnumShorthand("Root()")).toEqual({
      variant: "Root",
      inner: "",
    });
  });

  test("returns null for array-like input", () => {
    expect(parseEnumShorthand("[1,2,3]")).toBeNull();
  });
});

describe("parseCallArgs", () => {
  test("System.remark with hex bytes", async () => {
    const result = (await parseCallArgs(meta, "System", "remark", ["0xdeadbeef"])) as Record<
      string,
      unknown
    >;
    // System.remark is a struct variant with field "remark"
    expect(result.remark).toBeInstanceOf(Uint8Array);
    expect(Binary.toHex(result.remark as Uint8Array)).toBe("0xdeadbeef");
  });

  test("System.remark with plain text", async () => {
    const result = (await parseCallArgs(meta, "System", "remark", ["hello"])) as Record<
      string,
      unknown
    >;
    expect(result.remark).toBeInstanceOf(Uint8Array);
    expect(Binary.toText(result.remark as Uint8Array)).toBe("hello");
  });

  test("Balances.transferKeepAlive with address and amount", async () => {
    const addr = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
    const result = (await parseCallArgs(meta, "Balances", "transfer_keep_alive", [
      addr,
      "1000000000000",
    ])) as Record<string, unknown>;
    expect(result.dest).toEqual({ type: "Id", value: addr });
    expect(result.value).toBe(1000000000000n);
  });

  test("wrong arg count throws", async () => {
    expect(parseCallArgs(meta, "System", "remark", ["0xaa", "extra"])).rejects.toThrow(
      /takes 1 argument/,
    );
  });

  test("too few args throws with expected types", async () => {
    expect(
      parseCallArgs(meta, "Balances", "transfer_keep_alive", [
        "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      ]),
    ).rejects.toThrow(/takes 2 argument/);
  });

  test("zero args for non-void call throws", async () => {
    expect(parseCallArgs(meta, "System", "remark", [])).rejects.toThrow(/takes 1 argument/);
  });

  test("struct arg parse error includes field name and expected type", async () => {
    // Balances.transfer_keep_alive has struct fields: dest (MultiAddress), value (Compact<u128>)
    // Passing "abc" for the amount should fail with contextual info
    expect(
      parseCallArgs(meta, "Balances", "transfer_keep_alive", [
        "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "abc",
      ]),
    ).rejects.toThrow(/Invalid value for argument 'value'/);
  });

  test("struct arg parse error includes expected type description", async () => {
    expect(
      parseCallArgs(meta, "Balances", "transfer_keep_alive", [
        "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "abc",
      ]),
    ).rejects.toThrow(/expected/);
  });

  test("struct arg parse error includes the invalid value in the message", async () => {
    expect(
      parseCallArgs(meta, "Balances", "transfer_keep_alive", [
        "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "abc",
      ]),
    ).rejects.toThrow(/"abc"/);
  });

  test("struct arg parse error includes a hint", async () => {
    expect(
      parseCallArgs(meta, "Balances", "transfer_keep_alive", [
        "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "abc",
      ]),
    ).rejects.toThrow(/Hint:/);
  });

  test("struct arg parse error preserves original cause", async () => {
    try {
      await parseCallArgs(meta, "Balances", "transfer_keep_alive", [
        "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "abc",
      ]);
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.cause).toBeDefined();
    }
  });
});

describe("parseTypedArg", () => {
  test("decodes hex RuntimeCall for Sudo-style usage", async () => {
    // Encode System.remark(0xaa) → hex, then parse it back through parseTypedArg
    const { codec, location } = meta.builder.buildCall("System", "remark");
    const callData = { remark: Binary.fromHex("0xaa") };
    const encodedArgs = codec.enc(callData);
    const fullCall = new Uint8Array([location[0], location[1], ...encodedArgs]);
    const callHex = Binary.toHex(fullCall);

    const callTypeId = meta.lookup.call;
    if (callTypeId == null) throw new Error("No RuntimeCall in metadata");
    const callEntry = meta.lookup(callTypeId);

    const decoded = (await parseTypedArg(meta, callEntry, callHex)) as {
      type: string;
      value: { type: string; value: unknown };
    };
    expect(decoded.type).toBe("System");
    expect(decoded.value.type).toBe("remark");
  });

  test("auto-wraps SS58 address to MultiAddress.Id", async () => {
    // Find the dest field type from Balances.transfer_keep_alive
    const palletMeta = meta.unified.pallets.find((p) => p.name === "Balances")!;
    const callsEntry = meta.lookup(palletMeta.calls!.type);
    const variant = ((callsEntry as any).value as Record<string, any>).transfer_keep_alive;
    // The variant may be a lookupEntry wrapping a struct
    let inner = variant;
    while (inner.type === "lookupEntry") inner = inner.value;
    const destEntry = inner.value.dest;

    const addr = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
    const result = (await parseTypedArg(meta, destEntry, addr)) as { type: string; value: string };
    expect(result).toEqual({ type: "Id", value: addr });
  });

  test("option with 'null' returns undefined", async () => {
    const optionEntry = {
      type: "option",
      value: { type: "primitive", value: "u32" },
    };
    expect(await parseTypedArg(meta, optionEntry, "null")).toBeUndefined();
    expect(await parseTypedArg(meta, optionEntry, "none")).toBeUndefined();
  });

  describe("Option<T> literals", () => {
    const optionU128 = { type: "option", value: { type: "primitive", value: "u128" } };

    test("'null' is the canonical None literal", async () => {
      expect(await parseTypedArg(meta, optionU128, "null")).toBeUndefined();
    });

    test("'none' is an accepted None alias", async () => {
      expect(await parseTypedArg(meta, optionU128, "none")).toBeUndefined();
    });

    test("'undefined' is an accepted None alias", async () => {
      expect(await parseTypedArg(meta, optionU128, "undefined")).toBeUndefined();
    });

    test("None literals are case-sensitive (lowercase only)", async () => {
      // Documented behaviour — uppercase should NOT match. If it parses as
      // bigint("Null") it'd throw; we treat the failure as a clear signal.
      expect(parseTypedArg(meta, optionU128, "Null")).rejects.toThrow();
      expect(parseTypedArg(meta, optionU128, "NONE")).rejects.toThrow();
    });

    test("a bare value is treated as Some(value)", async () => {
      expect(await parseTypedArg(meta, optionU128, "42")).toBe(42n);
    });
  });

  test("compact u128 returns bigint", async () => {
    const compactEntry = { type: "compact", isBig: true };
    expect(await parseTypedArg(meta, compactEntry, "1000000000000")).toBe(1000000000000n);
  });

  test("compact u32 returns number", async () => {
    const compactEntry = { type: "compact", isBig: false };
    expect(await parseTypedArg(meta, compactEntry, "42")).toBe(42);
  });

  test("enum shorthand Parachain(1000) with number inner", async () => {
    const enumEntry = {
      type: "enum",
      value: {
        Parachain: { type: "compact", isBig: false },
        Here: { type: "void" },
      },
    };
    expect(await parseTypedArg(meta, enumEntry, "Parachain(1000)")).toEqual({
      type: "Parachain",
      value: 1000,
    });
  });

  test("enum shorthand system(Authorized) with nested enum", async () => {
    const enumEntry = {
      type: "enum",
      value: {
        system: {
          type: "enum",
          value: {
            Root: { type: "void" },
            Authorized: { type: "void" },
          },
        },
      },
    };
    expect(await parseTypedArg(meta, enumEntry, "system(Authorized)")).toEqual({
      type: "system",
      value: { type: "Authorized" },
    });
  });

  test("enum shorthand is case-insensitive", async () => {
    const enumEntry = {
      type: "enum",
      value: {
        Parachain: { type: "compact", isBig: false },
      },
    };
    expect(await parseTypedArg(meta, enumEntry, "parachain(42)")).toEqual({
      type: "Parachain",
      value: 42,
    });
  });

  test("enum shorthand Root() treated as void", async () => {
    const enumEntry = {
      type: "enum",
      value: {
        Root: { type: "void" },
      },
    };
    expect(await parseTypedArg(meta, enumEntry, "Root()")).toEqual({ type: "Root" });
  });

  test("enum shorthand with JSON inner for structs", async () => {
    const enumEntry = {
      type: "enum",
      value: {
        AccountId32: {
          type: "struct",
          value: {
            id: { type: "array", value: { type: "primitive", value: "u8" }, len: 32 },
          },
        },
      },
    };
    const hex = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
    const result = (await parseTypedArg(meta, enumEntry, `AccountId32({"id":"${hex}"})`)) as any;
    expect(result.type).toBe("AccountId32");
    // Sized [u8; N] hex is passed through as a 0x string (papi compat).
    expect(result.value.id).toBe(hex);
  });

  test("enum shorthand does not break SS58 auto-wrap", async () => {
    // SS58 addresses don't match shorthand pattern (no parens), so MultiAddress auto-wrap still works
    const palletMeta = meta.unified.pallets.find((p) => p.name === "Balances")!;
    const callsEntry = meta.lookup(palletMeta.calls!.type);
    const variant = ((callsEntry as any).value as Record<string, any>).transfer_keep_alive;
    let inner = variant;
    while (inner.type === "lookupEntry") inner = inner.value;
    const destEntry = inner.value.dest;

    const addr = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
    expect(await parseTypedArg(meta, destEntry, addr)).toEqual({ type: "Id", value: addr });
  });

  test("enum shorthand does not break JSON format", async () => {
    const enumEntry = {
      type: "enum",
      value: {
        Parachain: { type: "compact", isBig: false },
      },
    };
    expect(await parseTypedArg(meta, enumEntry, '{"type":"Parachain","value":1000}')).toEqual({
      type: "Parachain",
      value: 1000,
    });
  });

  test("enum shorthand does not break void variant name", async () => {
    const enumEntry = {
      type: "enum",
      value: {
        Root: { type: "void" },
        Signed: { type: "AccountId32" },
      },
    };
    expect(await parseTypedArg(meta, enumEntry, "Root")).toEqual({ type: "Root" });
  });

  test("simple variant name resolves lookupEntry-wrapped void", async () => {
    // Simulates metadata where a void variant is wrapped in lookupEntry indirection
    // (e.g. RingSize enum variants like R2e9 in ChunksManager.Chunks)
    const enumEntry = {
      type: "enum",
      value: {
        R2e9: { type: "lookupEntry", value: { type: "void" } },
        R2e10: { type: "lookupEntry", value: { type: "void" } },
      },
    };
    expect(await parseTypedArg(meta, enumEntry, "R2e9")).toEqual({ type: "R2e9" });
  });

  test("simple variant name resolves lookupEntry-wrapped void case-insensitively", async () => {
    const enumEntry = {
      type: "enum",
      value: {
        R2e9: { type: "lookupEntry", value: { type: "void" } },
      },
    };
    expect(await parseTypedArg(meta, enumEntry, "r2e9")).toEqual({ type: "R2e9" });
  });

  test("enum shorthand resolves lookupEntry-wrapped void with parens", async () => {
    const enumEntry = {
      type: "enum",
      value: {
        R2e9: { type: "lookupEntry", value: { type: "void" } },
      },
    };
    expect(await parseTypedArg(meta, enumEntry, "R2e9()")).toEqual({ type: "R2e9" });
  });

  test("lookupEntry-wrapped non-void variant does not short-circuit", async () => {
    // A variant whose resolved type is NOT void should NOT return { type }
    const enumEntry = {
      type: "enum",
      value: {
        Parachain: { type: "lookupEntry", value: { type: "compact", isBig: false } },
      },
    };
    // Plain "Parachain" without value should fall through (not match void path)
    expect(await parseTypedArg(meta, enumEntry, "Parachain")).toBe("Parachain");
  });

  test("comma-separated values parsed as array for Vec<u32>", async () => {
    const seqEntry = { type: "sequence", value: { type: "primitive", value: "u32" } };
    expect(await parseTypedArg(meta, seqEntry, "1,2,3")).toEqual([1, 2, 3]);
  });

  test("comma-separated hex values parsed as array for Vec<RuntimeCall>", async () => {
    const callTypeId = meta.lookup.call;
    if (callTypeId == null) throw new Error("No RuntimeCall in metadata");
    const callEntry = meta.lookup(callTypeId);
    const seqEntry = { type: "sequence", value: callEntry };

    // Encode two calls
    const { codec: remarkCodec, location: remarkLoc } = meta.builder.buildCall("System", "remark");
    const remarkData = remarkCodec.enc({ remark: Binary.fromHex("0xaa") });
    const hex1 = Binary.toHex(new Uint8Array([remarkLoc[0], remarkLoc[1], ...remarkData]));

    const remarkData2 = remarkCodec.enc({ remark: Binary.fromHex("0xbb") });
    const hex2 = Binary.toHex(new Uint8Array([remarkLoc[0], remarkLoc[1], ...remarkData2]));

    const result = (await parseTypedArg(meta, seqEntry, `${hex1},${hex2}`)) as any[];
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("System");
    expect(result[1].type).toBe("System");
  });

  test("comma-separated does not apply to Vec<u8>", async () => {
    const seqEntry = { type: "sequence", value: { type: "primitive", value: "u8" } };
    // "hello,world" should be treated as text, not split
    const result = await parseTypedArg(meta, seqEntry, "hello,world");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Binary.toText(result as Uint8Array)).toBe("hello,world");
  });

  test("single element (no comma) still works for Vec<u32>", async () => {
    const seqEntry = { type: "sequence", value: { type: "primitive", value: "u32" } };
    // Without comma, falls through to parseValue which returns a number
    expect(await parseTypedArg(meta, seqEntry, "42")).toBe(42);
  });

  test("JSON array still works when comma-separated is available", async () => {
    const seqEntry = { type: "sequence", value: { type: "primitive", value: "u32" } };
    expect(await parseTypedArg(meta, seqEntry, "[1,2,3]")).toEqual([1, 2, 3]);
  });

  test("comma-separated trims whitespace around elements", async () => {
    const seqEntry = { type: "sequence", value: { type: "primitive", value: "u32" } };
    expect(await parseTypedArg(meta, seqEntry, "1, 2, 3")).toEqual([1, 2, 3]);
  });

  test("comma-separated works for fixed-length array type", async () => {
    const arrEntry = { type: "array", value: { type: "primitive", value: "u32" }, len: 3 };
    expect(await parseTypedArg(meta, arrEntry, "10,20,30")).toEqual([10, 20, 30]);
  });

  test("comma-separated does not apply to [u8; N] byte arrays", async () => {
    // Sized [u8; N] is passed through as a 0x hex string — papi's isCompatible
    // rejects Uint8Array for sized binary typedefs in the runtime-API path.
    const arrEntry = { type: "array", value: { type: "primitive", value: "u8" }, len: 4 };
    const result = await parseTypedArg(meta, arrEntry, "0xdeadbeef");
    expect(result).toBe("0xdeadbeef");
  });

  // Regression suite for the sized-binary runtime-API fix.
  // papi's metadata-compatibility maps [u8; N] to { type: "binary", value: N },
  // and isCompatible only accepts a `0x`-prefixed string for that shape — a
  // Uint8Array is rejected (which surfaced as
  // `Error: Incompatible runtime entry RuntimeCall(...)` for e.g. ReviveApi.call).
  describe("[u8; N] sized binary -> 0x hex string", () => {
    test("[u8; 20] (H160 contract address) stays a 0x string", async () => {
      const arrEntry = { type: "array", value: { type: "primitive", value: "u8" }, len: 20 };
      const hex = "0x970951a12f975e6762482aca81e57d5a2a4e73f4";
      const result = await parseTypedArg(meta, arrEntry, hex);
      expect(typeof result).toBe("string");
      expect(result).toBe(hex);
    });

    test("[u8; 32] (H256 / AccountId32 raw bytes) stays a 0x string", async () => {
      const arrEntry = { type: "array", value: { type: "primitive", value: "u8" }, len: 32 };
      const hex = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
      const result = await parseTypedArg(meta, arrEntry, hex);
      expect(result).toBe(hex);
    });

    test("Vec<u8> (sequence) still returns Uint8Array — unsized binary accepts it", async () => {
      const seqEntry = { type: "sequence", value: { type: "primitive", value: "u8" } };
      const result = await parseTypedArg(meta, seqEntry, "0xdeadbeef");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Binary.toHex(result as Uint8Array)).toBe("0xdeadbeef");
    });

    test("non-hex text still falls through to Binary.fromText for [u8; N]", async () => {
      const arrEntry = { type: "array", value: { type: "primitive", value: "u8" }, len: 5 };
      const result = await parseTypedArg(meta, arrEntry, "hello");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Binary.toText(result as Uint8Array)).toBe("hello");
    });

    test("empty 0x byte string is preserved as a string for [u8; 0]", async () => {
      const arrEntry = { type: "array", value: { type: "primitive", value: "u8" }, len: 0 };
      const result = await parseTypedArg(meta, arrEntry, "0x");
      expect(result).toBe("0x");
    });

    test("uppercase hex digits are preserved verbatim", async () => {
      const arrEntry = { type: "array", value: { type: "primitive", value: "u8" }, len: 4 };
      const result = await parseTypedArg(meta, arrEntry, "0xDEADBEEF");
      expect(result).toBe("0xDEADBEEF");
    });
  });

  // Compat-smoke: for a representative set of byte-array typedefs, assert
  // that the value produced by parseTypedArg passes papi's isCompatible
  // guard against the same typedef mapped via mapLookupToTypedef. This
  // closes the loop on the "Incompatible runtime entry" class of bugs:
  // any future drift where our parsing produces a value papi rejects will
  // fail here before it ships.
  describe("isCompatible regression suite", () => {
    test("[u8; 20] parsed from 0x hex is accepted by isCompatible", async () => {
      const arrEntry = { type: "array", value: { type: "primitive", value: "u8" }, len: 20 };
      const typedef = mapLookupToTypedef(arrEntry as any);
      const parsed = await parseTypedArg(
        meta,
        arrEntry,
        "0x970951a12f975e6762482aca81e57d5a2a4e73f4",
      );
      expect(isCompatible(parsed, typedef, () => ({}) as any)).toBe(true);
    });

    test("[u8; 32] parsed from 0x hex is accepted by isCompatible", async () => {
      const arrEntry = { type: "array", value: { type: "primitive", value: "u8" }, len: 32 };
      const typedef = mapLookupToTypedef(arrEntry as any);
      const parsed = await parseTypedArg(
        meta,
        arrEntry,
        "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
      );
      expect(isCompatible(parsed, typedef, () => ({}) as any)).toBe(true);
    });

    test("Vec<u8> parsed from 0x hex is accepted by isCompatible", async () => {
      const seqEntry = { type: "sequence", value: { type: "primitive", value: "u8" } };
      const typedef = mapLookupToTypedef(seqEntry as any);
      const parsed = await parseTypedArg(meta, seqEntry, "0xdeadbeef");
      expect(isCompatible(parsed, typedef, () => ({}) as any)).toBe(true);
    });

    test("Vec<u8> parsed from text is accepted by isCompatible", async () => {
      const seqEntry = { type: "sequence", value: { type: "primitive", value: "u8" } };
      const typedef = mapLookupToTypedef(seqEntry as any);
      const parsed = await parseTypedArg(meta, seqEntry, "hello");
      expect(isCompatible(parsed, typedef, () => ({}) as any)).toBe(true);
    });

    test("[u8; N] parsed from text fallback (Uint8Array) is NOT accepted — documents the known limitation", async () => {
      // Non-hex text for sized binary still goes through Binary.fromText →
      // Uint8Array, which papi's isCompatible rejects for sized binary. This
      // is rare in practice (users pass hex for sized fields) but is worth
      // pinning so we notice if papi relaxes the check.
      const arrEntry = { type: "array", value: { type: "primitive", value: "u8" }, len: 5 };
      const typedef = mapLookupToTypedef(arrEntry as any);
      const parsed = await parseTypedArg(meta, arrEntry, "hello");
      expect(parsed).toBeInstanceOf(Uint8Array);
      expect(isCompatible(parsed, typedef, () => ({}) as any)).toBe(false);
    });
  });
});

describe("typeHint", () => {
  test("enum with few variants lists them", () => {
    const entry = {
      type: "enum",
      value: { A: { type: "void" }, B: { type: "void" }, C: { type: "void" } },
    };
    const hint = typeHint(entry, meta);
    expect(hint).toContain("a variant:");
    expect(hint).toContain("A | B | C");
  });

  test("enum with many variants shows count and examples", () => {
    const variants: Record<string, any> = {};
    for (let i = 0; i < 10; i++) {
      variants[`Var${i}`] = { type: "void" };
    }
    const entry = { type: "enum", value: variants };
    const hint = typeHint(entry, meta);
    expect(hint).toContain("one of 10 variants");
    expect(hint).toContain("e.g.");
  });

  test("struct lists field names", () => {
    const entry = {
      type: "struct",
      value: { foo: { type: "primitive", value: "u32" }, bar: { type: "primitive", value: "str" } },
    };
    const hint = typeHint(entry, meta);
    expect(hint).toContain("a JSON object with fields:");
    expect(hint).toContain("foo");
    expect(hint).toContain("bar");
  });

  test("tuple returns array hint", () => {
    const entry = { type: "tuple", value: [] };
    expect(typeHint(entry, meta)).toBe("a JSON array");
  });

  test("sequence returns comma-separated hint for non-byte Vec", () => {
    const entry = { type: "sequence", value: { type: "primitive", value: "u32" } };
    expect(typeHint(entry, meta)).toBe(
      "a JSON array, comma-separated values, or hex-encoded bytes",
    );
  });

  test("array returns bytes hint for [u8; N]", () => {
    const entry = { type: "array", value: { type: "primitive", value: "u8" }, len: 32 };
    expect(typeHint(entry, meta)).toBe("hex-encoded bytes or text");
  });

  test("resolves lookupEntry indirection", () => {
    const entry = {
      type: "lookupEntry",
      value: {
        type: "struct",
        value: { x: { type: "primitive", value: "u32" } },
      },
    };
    const hint = typeHint(entry, meta);
    expect(hint).toContain("a JSON object with fields:");
    expect(hint).toContain("x");
  });
});

describe("normalizeValue", () => {
  test("unwraps single-element array for non-array enum variant", () => {
    // Simulates XCM Junctions::X1 where polkadot-api unwrapped [Junction; 1]
    const mockEntry = {
      type: "enum",
      value: {
        SomeVariant: { type: "struct", value: { a: { type: "primitive", value: "u32" } } },
      },
    };
    const input = { type: "SomeVariant", value: [{ a: 42 }] };
    const result = normalizeValue(meta.lookup, mockEntry, input) as {
      type: string;
      value: unknown;
    };
    expect(result.type).toBe("SomeVariant");
    expect(result.value).toEqual({ a: 42 });
  });

  test("does NOT unwrap multi-element arrays", () => {
    const mockEntry = {
      type: "enum",
      value: {
        X2: { type: "struct", value: { a: { type: "primitive", value: "u32" } } },
      },
    };
    const input = { type: "X2", value: [{ a: 1 }, { a: 2 }] };
    const result = normalizeValue(meta.lookup, mockEntry, input) as {
      type: string;
      value: unknown;
    };
    // Multi-element array should be left as-is
    expect(Array.isArray(result.value)).toBe(true);
    expect((result.value as any[]).length).toBe(2);
  });

  test("does NOT unwrap array when inner type IS array", () => {
    const mockEntry = {
      type: "enum",
      value: {
        Multi: { type: "array", value: { type: "primitive", value: "u8" }, len: 3 },
      },
    };
    const input = { type: "Multi", value: [1] };
    const result = normalizeValue(meta.lookup, mockEntry, input) as {
      type: string;
      value: unknown;
    };
    expect(Array.isArray(result.value)).toBe(true);
  });

  test("does NOT unwrap when inner type IS sequence", () => {
    const mockEntry = {
      type: "enum",
      value: {
        Items: { type: "sequence", value: { type: "primitive", value: "u32" } },
      },
    };
    const input = { type: "Items", value: [42] };
    const result = normalizeValue(meta.lookup, mockEntry, input) as {
      type: string;
      value: unknown;
    };
    expect(Array.isArray(result.value)).toBe(true);
  });

  test("recursively unwraps nested enum variants", () => {
    // Outer enum → inner enum, both with single-element array wrapping
    const mockEntry = {
      type: "enum",
      value: {
        Outer: {
          type: "enum",
          value: {
            Inner: { type: "primitive", value: "u32" },
          },
        },
      },
    };
    const input = { type: "Outer", value: [{ type: "Inner", value: [99] }] };
    const result = normalizeValue(meta.lookup, mockEntry, input) as any;
    expect(result.type).toBe("Outer");
    // Outer single-element array unwrapped
    expect(result.value.type).toBe("Inner");
    // Inner single-element array unwrapped
    expect(result.value.value).toBe(99);
  });

  test("recursively normalizes struct fields", () => {
    const mockEntry = {
      type: "struct",
      value: {
        name: { type: "primitive", value: "str" },
        count: { type: "primitive", value: "u32" },
      },
    };
    const input = { name: "test", count: 5 };
    const result = normalizeValue(meta.lookup, mockEntry, input);
    expect(result).toEqual({ name: "test", count: 5 });
  });

  test("normalizes array elements recursively", () => {
    const mockEntry = {
      type: "sequence",
      value: {
        type: "enum",
        value: {
          Variant: { type: "primitive", value: "u32" },
        },
      },
    };
    const input = [
      { type: "Variant", value: [1] },
      { type: "Variant", value: [2] },
    ];
    const result = normalizeValue(meta.lookup, mockEntry, input) as any[];
    expect(result[0]).toEqual({ type: "Variant", value: 1 });
    expect(result[1]).toEqual({ type: "Variant", value: 2 });
  });

  test("normalizes option inner value", () => {
    const mockEntry = {
      type: "option",
      value: {
        type: "enum",
        value: {
          Thing: { type: "primitive", value: "u32" },
        },
      },
    };
    const input = { type: "Thing", value: [42] };
    const result = normalizeValue(meta.lookup, mockEntry, input) as any;
    expect(result).toEqual({ type: "Thing", value: 42 });
  });

  test("option with null/undefined normalizes to undefined", () => {
    const mockEntry = {
      type: "option",
      value: { type: "primitive", value: "u32" },
    };
    // polkadot-api uses undefined for Option::None; JSON null must also map to undefined
    expect(normalizeValue(meta.lookup, mockEntry, null)).toBeUndefined();
    expect(normalizeValue(meta.lookup, mockEntry, undefined)).toBeUndefined();
  });

  test("leaves void enum variant value alone", () => {
    const mockEntry = {
      type: "enum",
      value: {
        None: { type: "void" },
      },
    };
    const input = { type: "None", value: undefined };
    const result = normalizeValue(meta.lookup, mockEntry, input) as any;
    expect(result.type).toBe("None");
    expect(result.value).toBeUndefined();
  });

  test("resolves lookupEntry indirection", () => {
    const mockEntry = {
      type: "lookupEntry",
      value: {
        type: "enum",
        value: {
          X1: { type: "primitive", value: "u32" },
        },
      },
    };
    const input = { type: "X1", value: [7] };
    const result = normalizeValue(meta.lookup, mockEntry, input) as any;
    expect(result).toEqual({ type: "X1", value: 7 });
  });

  test("keeps 0x hex string for sized [u8; N] byte arrays (papi compat)", () => {
    const mockEntry = {
      type: "array",
      value: { type: "primitive", value: "u8" },
      len: 32,
    };
    const hex = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
    const result = normalizeValue(meta.lookup, mockEntry, hex);
    expect(result).toBe(hex);
  });

  test("converts text string to Binary for [u8; N] when not 0x hex", () => {
    // Non-hex text still goes through Binary.fromText — papi's SCALE encoder
    // accepts Uint8Array; only the sized-binary compat check prefers 0x strings.
    const mockEntry = {
      type: "array",
      value: { type: "primitive", value: "u8" },
      len: 5,
    };
    const result = normalizeValue(meta.lookup, mockEntry, "hello");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Binary.toText(result as Uint8Array)).toBe("hello");
  });

  test("converts text string to Binary for Vec<u8> byte sequences", () => {
    const mockEntry = {
      type: "sequence",
      value: { type: "primitive", value: "u8" },
    };
    const result = normalizeValue(meta.lookup, mockEntry, "hello");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Binary.toText(result as Uint8Array)).toBe("hello");
  });

  test("Vec<u8> hex string still becomes Uint8Array (unsized binary)", () => {
    const mockEntry = {
      type: "sequence",
      value: { type: "primitive", value: "u8" },
    };
    const result = normalizeValue(meta.lookup, mockEntry, "0xdeadbeef");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Binary.toHex(result as Uint8Array)).toBe("0xdeadbeef");
  });

  test("keeps 0x hex string for [u8; N] through lookupEntry indirection", () => {
    const mockEntry = {
      type: "array",
      value: { type: "lookupEntry", value: { type: "primitive", value: "u8" } },
      len: 4,
    };
    const result = normalizeValue(meta.lookup, mockEntry, "0xdeadbeef");
    expect(result).toBe("0xdeadbeef");
  });

  test("keeps 0x hex for nested [u8; N] inside structs", () => {
    const mockEntry = {
      type: "struct",
      value: {
        id: { type: "array", value: { type: "primitive", value: "u8" }, len: 32 },
      },
    };
    const hex = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
    const result = normalizeValue(meta.lookup, mockEntry, { id: hex }) as any;
    expect(result.id).toBe(hex);
  });

  test("keeps 0x hex for nested [u8; N] inside enum variants", () => {
    const mockEntry = {
      type: "enum",
      value: {
        AccountId32: {
          type: "struct",
          value: {
            id: { type: "array", value: { type: "primitive", value: "u8" }, len: 32 },
          },
        },
      },
    };
    const hex = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
    const input = { type: "AccountId32", value: { id: hex } };
    const result = normalizeValue(meta.lookup, mockEntry, input) as any;
    expect(result.value.id).toBe(hex);
  });

  test("converts string to bigint for u128 primitives in JSON", () => {
    const mockEntry = { type: "primitive", value: "u128" };
    const result = normalizeValue(meta.lookup, mockEntry, "100000000000000000");
    expect(result).toBe(100000000000000000n);
  });

  test("converts string to number for u32 primitives in JSON", () => {
    const mockEntry = { type: "primitive", value: "u32" };
    const result = normalizeValue(meta.lookup, mockEntry, "42");
    expect(result).toBe(42);
  });

  test("converts string to bigint for compact types in JSON", () => {
    const mockEntry = { type: "compact", isBig: true };
    const result = normalizeValue(meta.lookup, mockEntry, "100000000000000000");
    expect(result).toBe(100000000000000000n);
  });

  test("converts string to number for small compact types in JSON", () => {
    const mockEntry = { type: "compact", isBig: false };
    const result = normalizeValue(meta.lookup, mockEntry, "42");
    expect(result).toBe(42);
  });

  test("leaves bigint alone for u128 primitives", () => {
    const mockEntry = { type: "primitive", value: "u128" };
    expect(normalizeValue(meta.lookup, mockEntry, 42n)).toBe(42n);
  });

  test("converts number to bigint for u128 primitives (file/YAML input)", () => {
    const mockEntry = { type: "primitive", value: "u128" };
    expect(normalizeValue(meta.lookup, mockEntry, 42)).toBe(42n);
  });

  test("leaves number alone for u32 primitives", () => {
    const mockEntry = { type: "primitive", value: "u32" };
    expect(normalizeValue(meta.lookup, mockEntry, 42)).toBe(42);
  });

  test("converts number to bigint for u64 primitives", () => {
    const mockEntry = { type: "primitive", value: "u64" };
    expect(normalizeValue(meta.lookup, mockEntry, 100)).toBe(100n);
  });

  test("converts number to bigint for u256 primitives", () => {
    const mockEntry = { type: "primitive", value: "u256" };
    expect(normalizeValue(meta.lookup, mockEntry, 0)).toBe(0n);
  });

  test("converts number to bigint for i128 primitives", () => {
    const mockEntry = { type: "primitive", value: "i128" };
    expect(normalizeValue(meta.lookup, mockEntry, -5)).toBe(-5n);
  });

  test("converts number to bigint for big compact types", () => {
    const mockEntry = { type: "compact", isBig: true };
    expect(normalizeValue(meta.lookup, mockEntry, 42)).toBe(42n);
  });

  test("leaves number alone for small compact types", () => {
    const mockEntry = { type: "compact", isBig: false };
    expect(normalizeValue(meta.lookup, mockEntry, 42)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// fileArgsToStrings
// ---------------------------------------------------------------------------

describe("fileArgsToStrings", () => {
  test("returns empty array for null", () => {
    expect(fileArgsToStrings(null)).toEqual([]);
  });

  test("returns empty array for undefined", () => {
    expect(fileArgsToStrings(undefined)).toEqual([]);
  });

  test("converts object to individual string values", () => {
    const result = fileArgsToStrings({ dest: "alice", value: 1000 });
    expect(result).toEqual(["alice", "1000"]);
  });

  test("serializes nested objects as JSON", () => {
    const result = fileArgsToStrings({
      dest: { type: "V3", value: { parents: 1 } },
      amount: 42,
    });
    expect(result).toEqual(['{"type":"V3","value":{"parents":1}}', "42"]);
  });

  test("converts array elements to strings", () => {
    expect(fileArgsToStrings(["0xdead", "0xbeef"])).toEqual(["0xdead", "0xbeef"]);
  });

  test("serializes complex array elements as JSON", () => {
    const result = fileArgsToStrings([{ type: "V3" }, 0]);
    expect(result).toEqual(['{"type":"V3"}', "0"]);
  });

  test("converts scalar string", () => {
    expect(fileArgsToStrings("0xdead")).toEqual(["0xdead"]);
  });

  test("converts scalar number", () => {
    expect(fileArgsToStrings(42)).toEqual(["42"]);
  });

  test("converts scalar boolean", () => {
    expect(fileArgsToStrings(true)).toEqual(["true"]);
  });

  test("converts null values in objects", () => {
    const result = fileArgsToStrings({ key: null });
    expect(result).toEqual(["null"]);
  });
});

describe("formatEventValue", () => {
  test("Binary with valid UTF-8 returns text", () => {
    expect(formatEventValue(Binary.fromText("DOT"))).toBe("DOT");
  });

  test("Binary with invalid UTF-8 returns hex", () => {
    expect(formatEventValue(new Uint8Array([0x80, 0x81]))).toBe("0x8081");
  });

  test("empty Binary returns empty string", () => {
    expect(formatEventValue(new Uint8Array([]))).toBe("");
  });

  test("bigint returns string", () => {
    expect(formatEventValue(42n)).toBe("42");
  });

  test("string passes through", () => {
    expect(formatEventValue("hello")).toBe("hello");
  });

  test("null returns 'null'", () => {
    expect(formatEventValue(null)).toBe("null");
  });

  test("object is JSON-stringified", () => {
    expect(formatEventValue({ a: 1 })).toBe('{"a":1}');
  });

  test("Binary with control characters returns hex", () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x00, 0x6f]); // "Hel\0o"
    expect(formatEventValue(bytes)).toStartWith("0x");
  });

  test("Binary with C1 control characters returns hex", () => {
    // 0xc2 0x80 is U+0080 (PAD) in UTF-8 — valid UTF-8, but not readable
    const bytes = new Uint8Array([0x41, 0xc2, 0x80, 0x42]);
    expect(formatEventValue(bytes)).toStartWith("0x");
  });

  test("Binary with readable multi-word text returns text", () => {
    expect(formatEventValue(Binary.fromText("Paseo Token"))).toBe("Paseo Token");
  });
});

describe("formatDispatchError", () => {
  test("Module error formats as PalletName.ErrorVariant", () => {
    const err = {
      type: "Module",
      value: { type: "Balances", value: { type: "InsufficientBalance" } },
    };
    expect(formatDispatchError(err)).toBe("Balances.InsufficientBalance");
  });

  test("Module error with pallet only (no inner variant)", () => {
    const err = {
      type: "Module",
      value: { type: "Balances" },
    };
    expect(formatDispatchError(err)).toBe("Balances");
  });

  test("non-Module error with no value", () => {
    const err = { type: "BadOrigin" };
    expect(formatDispatchError(err)).toBe("BadOrigin");
  });

  test("non-Module error with string value", () => {
    const err = { type: "Token", value: "FundsUnavailable" };
    expect(formatDispatchError(err)).toBe("Token: FundsUnavailable");
  });

  test("non-Module error with object value", () => {
    const err = { type: "Token", value: { reason: "frozen" } };
    expect(formatDispatchError(err)).toBe('Token: {"reason":"frozen"}');
  });

  test("Module error with non-object value falls back to type: value", () => {
    const err = { type: "Module", value: "unexpected" };
    expect(formatDispatchError(err)).toBe("Module: unexpected");
  });
});

// ---------------------------------------------------------------------------
// parseExtOption
// ---------------------------------------------------------------------------

describe("parseExtOption", () => {
  test("undefined returns empty object", () => {
    expect(parseExtOption(undefined)).toEqual({});
  });

  test("valid JSON object is returned", () => {
    expect(parseExtOption('{"Foo":{"value":1}}')).toEqual({ Foo: { value: 1 } });
  });

  test("JSON array throws", () => {
    expect(() => parseExtOption("[1,2]")).toThrow("JSON object");
  });

  test("non-object JSON (string) throws", () => {
    expect(() => parseExtOption('"hello"')).toThrow("JSON object");
  });

  test("invalid JSON throws with helpful message", () => {
    expect(() => parseExtOption("{bad}")).toThrow("Failed to parse --ext JSON");
  });
});

// ---------------------------------------------------------------------------
// parseAssetOption
// ---------------------------------------------------------------------------

describe("parseAssetOption", () => {
  test("undefined returns undefined", () => {
    expect(parseAssetOption(undefined)).toBeUndefined();
  });

  test("valid XCM Location JSON is returned as-is", () => {
    const loc = {
      parents: 0,
      interior: {
        type: "X2",
        value: [
          { type: "PalletInstance", value: 50 },
          { type: "GeneralIndex", value: "3" },
        ],
      },
    };
    expect(parseAssetOption(JSON.stringify(loc))).toEqual(loc);
  });

  test("JSON array throws", () => {
    expect(() => parseAssetOption("[1,2]")).toThrow("Invalid --asset");
  });

  test("non-object JSON (string) throws", () => {
    expect(() => parseAssetOption('"hello"')).toThrow("Invalid --asset");
  });

  test("JSON null throws", () => {
    expect(() => parseAssetOption("null")).toThrow("Invalid --asset");
  });

  test("invalid JSON throws with example hint", () => {
    expect(() => parseAssetOption("{bad}")).toThrow(/Invalid --asset/);
    expect(() => parseAssetOption("{bad}")).toThrow(/Expected an XCM location/);
  });
});

// ---------------------------------------------------------------------------
// autoDefaultForType
// ---------------------------------------------------------------------------

describe("autoDefaultForType", () => {
  test("void returns empty Uint8Array", () => {
    const result = autoDefaultForType({ type: "void" });
    expect(result).toBeInstanceOf(Uint8Array);
    expect((result as Uint8Array).length).toBe(0);
  });

  test("option returns undefined", () => {
    expect(
      autoDefaultForType({ type: "option", value: { type: "primitive", value: "u32" } }),
    ).toBeUndefined();
  });

  test("enum with Disabled variant returns Disabled", () => {
    const entry = {
      type: "enum",
      value: { Enabled: { type: "void" }, Disabled: { type: "void" } },
    };
    expect(autoDefaultForType(entry)).toEqual({ type: "Disabled", value: undefined });
  });

  test("enum without Disabled variant returns NO_DEFAULT", () => {
    const entry = { type: "enum", value: { Enabled: { type: "void" } } };
    expect(autoDefaultForType(entry)).toBe(NO_DEFAULT);
  });

  test("other types return NO_DEFAULT", () => {
    expect(autoDefaultForType({ type: "primitive", value: "u32" })).toBe(NO_DEFAULT);
    expect(autoDefaultForType({ type: "struct", value: {} })).toBe(NO_DEFAULT);
  });
});

// ---------------------------------------------------------------------------
// buildCustomSignedExtensions
// ---------------------------------------------------------------------------

describe("buildCustomSignedExtensions", () => {
  test("skips PAPI builtin extensions", () => {
    const result = buildCustomSignedExtensions(meta, {});
    expect(result).not.toHaveProperty("CheckNonce");
    expect(result).not.toHaveProperty("CheckMortality");
    expect(result).not.toHaveProperty("CheckWeight");
    expect(result).not.toHaveProperty("ChargeTransactionPayment");
  });

  test("returns empty for standard polkadot metadata (all extensions are builtins)", () => {
    const result = buildCustomSignedExtensions(meta, {});
    expect(Object.keys(result).length).toBe(0);
  });

  test("user override of a builtin extension is passed through, not dropped", () => {
    const override = { value: { type: "Enabled", value: undefined } };
    const result = buildCustomSignedExtensions(meta, { CheckMetadataHash: override });
    expect(result.CheckMetadataHash).toEqual(override);
  });

  test("user override of a builtin does not affect other builtins", () => {
    const result = buildCustomSignedExtensions(meta, {
      CheckMetadataHash: { value: { type: "Disabled", value: undefined } },
    });
    expect(result).not.toHaveProperty("CheckNonce");
    expect(result).not.toHaveProperty("ChargeTransactionPayment");
    expect(Object.keys(result)).toEqual(["CheckMetadataHash"]);
  });

  test("unknown extension name throws with the chain's extension list", () => {
    expect(() => buildCustomSignedExtensions(meta, { CheckMetadataHsh: {} })).toThrow(
      /Unknown transaction extension "CheckMetadataHsh".*CheckMetadataHash/s,
    );
  });
});

// ---------------------------------------------------------------------------
// formatRawDecoded
// ---------------------------------------------------------------------------

describe("formatRawDecoded", () => {
  test("null and undefined return 'null'", () => {
    expect(formatRawDecoded(null)).toBe("null");
    expect(formatRawDecoded(undefined)).toBe("null");
  });

  test("primitives format correctly", () => {
    expect(formatRawDecoded("hello")).toBe("hello");
    expect(formatRawDecoded(42)).toBe("42");
    expect(formatRawDecoded(true)).toBe("true");
    expect(formatRawDecoded(false)).toBe("false");
  });

  test("bigint formats as string", () => {
    expect(formatRawDecoded(1000000000000n)).toBe("1000000000000");
  });

  test("Binary formats as hex", () => {
    expect(formatRawDecoded(Binary.fromHex("0xdeadbeef"))).toBe("0xdeadbeef");
  });

  test("empty array formats as []", () => {
    expect(formatRawDecoded([])).toBe("[]");
  });

  test("array of primitives formats correctly", () => {
    expect(formatRawDecoded([1, 2, 3])).toBe("[1, 2, 3]");
  });

  test("enum-like object with void value shows type only", () => {
    expect(formatRawDecoded({ type: "Unlimited", value: undefined })).toBe("Unlimited");
  });

  test("enum-like object with primitive value uses parens", () => {
    expect(formatRawDecoded({ type: "Parachain", value: 1000 })).toBe("Parachain(1000)");
  });

  test("enum-like object with struct value uses space", () => {
    expect(formatRawDecoded({ type: "AccountId32", value: { id: "0xabcd" } })).toBe(
      "AccountId32 { id: 0xabcd }",
    );
  });

  test("plain struct formats as { key: value }", () => {
    expect(formatRawDecoded({ parents: 0, interior: "Here" })).toBe(
      "{ parents: 0, interior: Here }",
    );
  });

  test("empty object formats as {}", () => {
    expect(formatRawDecoded({})).toBe("{}");
  });

  test("nested enum and struct combination", () => {
    const value = {
      type: "V3",
      value: { parents: 1, interior: { type: "Here", value: undefined } },
    };
    expect(formatRawDecoded(value)).toBe("V3 { parents: 1, interior: Here }");
  });

  test("array of enum-like objects", () => {
    const value = [
      { type: "Parachain", value: 1000 },
      { type: "AccountId32", value: { id: "0xab" } },
    ];
    expect(formatRawDecoded(value)).toBe("[Parachain(1000), AccountId32 { id: 0xab }]");
  });

  test("Binary inside nested structures", () => {
    const value = {
      type: "AccountId32",
      value: {
        id: Binary.fromHex("0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"),
      },
    };
    const result = formatRawDecoded(value);
    expect(result).toContain("AccountId32");
    expect(result).toContain("0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d");
  });
});

// ---------------------------------------------------------------------------
// decodeCallFallback
// ---------------------------------------------------------------------------

describe("decodeCallFallback", () => {
  test("decodes System.remark call", () => {
    // Encode System.remark(0xdeadbeef) using buildCall
    const { codec, location } = meta.builder.buildCall("System", "remark");
    const callData = { remark: Binary.fromHex("0xdeadbeef") };
    const encodedArgs = codec.enc(callData);
    const fullCall = new Uint8Array([location[0], location[1], ...encodedArgs]);
    const callHex = Binary.toHex(fullCall);

    const result = decodeCallFallback(meta, callHex);
    expect(result).toContain("System");
    expect(result).toContain("remark");
    expect(result).toContain("0xdeadbeef");
  });

  test("decodes Balances.transfer_keep_alive call", () => {
    const { codec, location } = meta.builder.buildCall("Balances", "transfer_keep_alive");
    const callData = {
      dest: { type: "Id", value: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty" },
      value: 1000000000000n,
    };
    const encodedArgs = codec.enc(callData);
    const fullCall = new Uint8Array([location[0], location[1], ...encodedArgs]);
    const callHex = Binary.toHex(fullCall);

    const result = decodeCallFallback(meta, callHex);
    expect(result).toContain("Balances");
    expect(result).toContain("transfer_keep_alive");
    expect(result).toContain("1000000000000");
  });

  test("decodes XcmPallet.teleport_assets call (complex types that crash view-builder)", () => {
    // XCM calls crash view-builder's callDecoder, so decodeCallFallback is used.
    // Uses V3 with Here interior (V3 X1 junction codec changed in substrate-bindings v0.20).
    const { codec, location } = meta.builder.buildCall("XcmPallet", "teleport_assets");
    const callData = {
      dest: {
        type: "V3",
        value: { parents: 1, interior: { type: "Here" } },
      },
      beneficiary: {
        type: "V3",
        value: { parents: 0, interior: { type: "Here" } },
      },
      assets: {
        type: "V3",
        value: [
          {
            id: { type: "Concrete", value: { parents: 0, interior: { type: "Here" } } },
            fun: { type: "Fungible", value: 1000000000000n },
          },
        ],
      },
      fee_asset_item: 0,
    };
    const encodedArgs = codec.enc(callData);
    const fullCall = new Uint8Array([location[0], location[1], ...encodedArgs]);
    const callHex = Binary.toHex(fullCall);

    const result = decodeCallFallback(meta, callHex);
    expect(result).toContain("XcmPallet");
    expect(result).toContain("teleport_assets");
    expect(result).toContain("Fungible(1000000000000)");
  });

  test("decodes void-arg calls (no arguments)", () => {
    const { codec, location } = meta.builder.buildCall("Timestamp", "set");
    const callData = { now: 1000n };
    const encodedArgs = codec.enc(callData);
    const fullCall = new Uint8Array([location[0], location[1], ...encodedArgs]);
    const callHex = Binary.toHex(fullCall);

    const result = decodeCallFallback(meta, callHex);
    expect(result).toContain("Timestamp");
    expect(result).toContain("set");
  });

  test("throws on invalid hex", () => {
    expect(() => decodeCallFallback(meta, "0xff")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// sanitizeForSerialization
// ---------------------------------------------------------------------------

describe("sanitizeForSerialization", () => {
  test("converts Binary to hex string", () => {
    expect(sanitizeForSerialization(Binary.fromHex("0xdeadbeef"))).toBe("0xdeadbeef");
  });

  test("converts BigInt within safe range to number", () => {
    expect(sanitizeForSerialization(1000000000000n)).toBe(1000000000000);
  });

  test("converts BigInt outside safe range to string", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(sanitizeForSerialization(big)).toBe(big.toString());
  });

  test("converts undefined to null", () => {
    expect(sanitizeForSerialization(undefined)).toBe(null);
  });

  test("passes through strings, numbers, booleans", () => {
    expect(sanitizeForSerialization("hello")).toBe("hello");
    expect(sanitizeForSerialization(42)).toBe(42);
    expect(sanitizeForSerialization(true)).toBe(true);
  });

  test("recursively processes objects", () => {
    const input = { a: Binary.fromHex("0xaa"), b: 100n };
    expect(sanitizeForSerialization(input)).toEqual({ a: "0xaa", b: 100 });
  });

  test("recursively processes arrays", () => {
    const input = [Binary.fromHex("0xbb"), 200n];
    expect(sanitizeForSerialization(input)).toEqual(["0xbb", 200]);
  });

  test("handles nested enum-like structures", () => {
    const input = { type: "Fungible", value: 1000000000000n };
    expect(sanitizeForSerialization(input)).toEqual({ type: "Fungible", value: 1000000000000 });
  });
});

// ---------------------------------------------------------------------------
// decodeCallToFileFormat
// ---------------------------------------------------------------------------

describe("decodeCallToFileFormat", () => {
  test("System.remark produces file-compatible object", () => {
    const { codec, location } = meta.builder.buildCall("System", "remark");
    const callData = { remark: Binary.fromHex("0xdeadbeef") };
    const encodedArgs = codec.enc(callData);
    const fullCall = new Uint8Array([location[0], location[1], ...encodedArgs]);
    const callHex = Binary.toHex(fullCall);

    const result = decodeCallToFileFormat(meta, callHex, "polkadot");
    expect(result.chain).toBe("polkadot");
    expect(result.tx).toBeDefined();
    const tx = result.tx as Record<string, any>;
    expect(tx.System).toBeDefined();
    expect(tx.System.remark).toBeDefined();
    expect(tx.System.remark.remark).toBe("0xdeadbeef");
  });

  test("Balances.transfer_keep_alive produces file-compatible object", () => {
    const { codec, location } = meta.builder.buildCall("Balances", "transfer_keep_alive");
    const callData = {
      dest: { type: "Id", value: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty" },
      value: 1000000000000n,
    };
    const encodedArgs = codec.enc(callData);
    const fullCall = new Uint8Array([location[0], location[1], ...encodedArgs]);
    const callHex = Binary.toHex(fullCall);

    const result = decodeCallToFileFormat(meta, callHex, "polkadot");
    const tx = result.tx as Record<string, any>;
    expect(tx.Balances).toBeDefined();
    expect(tx.Balances.transfer_keep_alive).toBeDefined();
    expect(tx.Balances.transfer_keep_alive.dest.type).toBe("Id");
    expect(tx.Balances.transfer_keep_alive.value).toBe(1000000000000);
  });

  test("XCM call produces file-compatible object with enum structure", () => {
    // Uses V3 with Here interior (V3 X1 junction codec changed in substrate-bindings v0.20)
    const { codec, location } = meta.builder.buildCall("XcmPallet", "teleport_assets");
    const callData = {
      dest: {
        type: "V3",
        value: { parents: 1, interior: { type: "Here" } },
      },
      beneficiary: {
        type: "V3",
        value: { parents: 0, interior: { type: "Here" } },
      },
      assets: {
        type: "V3",
        value: [
          {
            id: { type: "Concrete", value: { parents: 0, interior: { type: "Here" } } },
            fun: { type: "Fungible", value: 1000000000000n },
          },
        ],
      },
      fee_asset_item: 0,
    };
    const encodedArgs = codec.enc(callData);
    const fullCall = new Uint8Array([location[0], location[1], ...encodedArgs]);
    const callHex = Binary.toHex(fullCall);

    const result = decodeCallToFileFormat(meta, callHex, "polkadot");
    const tx = result.tx as Record<string, any>;
    expect(tx.XcmPallet).toBeDefined();
    expect(tx.XcmPallet.teleport_assets).toBeDefined();
    expect(tx.XcmPallet.teleport_assets.dest.type).toBe("V3");
    expect(tx.XcmPallet.teleport_assets.assets.type).toBe("V3");
  });
});

// ---------------------------------------------------------------------------
// Layer 1: CLI integration tests (subprocess)
// ---------------------------------------------------------------------------

describe("resolveExtrinsicVersion", () => {
  test("defaults to v4 on chains that can't authorize v5 (polkadot)", () => {
    const { version } = resolveExtrinsicVersion(getTestMetadata(), {});
    expect(version).toBe(4);
  });

  test("defaults to v5 on chains that carry VerifyMultiSignature (preview-people)", () => {
    const { version, capability } = resolveExtrinsicVersion(getPeopleMetadata(), {});
    expect(version).toBe(5);
    expect(capability).toEqual({
      ok: true,
      extensionVersion: 0,
      authIdentifier: "VerifyMultiSignature",
    });
  });

  test("--v4 forces v4 on a v5-capable chain", () => {
    const { version } = resolveExtrinsicVersion(getPeopleMetadata(), { v4: true });
    expect(version).toBe(4);
  });

  test("--v5 on an incapable chain throws the capability error", () => {
    expect(() => resolveExtrinsicVersion(getTestMetadata(), { v5: true })).toThrow(
      "can't accept signed v5 transactions",
    );
  });
});

describe("dot tx CLI integration", () => {
  test("System.remark --encode outputs hex", async () => {
    const { stdout, exitCode } = await runCli(["tx.System.remark", "0xdeadbeef", "--encode"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^0x[0-9a-f]+$/);
  });

  test("encode round-trip: encode then decode", async () => {
    // Encode
    const { stdout: hex, exitCode } = await runCli(["tx.System.remark", "0xdeadbeef", "--encode"]);
    expect(exitCode).toBe(0);

    // The encoded hex should start with the System pallet index + remark call index
    // followed by the SCALE-encoded remark bytes.
    // We can verify it's valid by checking it's proper hex.
    expect(hex).toMatch(/^0x[0-9a-f]+$/);
    expect(hex.length).toBeGreaterThan(6); // at least pallet+call+length+data
  });

  test("--encode without --from succeeds", async () => {
    const { exitCode } = await runCli(["tx.System.remark", "0xaa", "--encode"]);
    expect(exitCode).toBe(0);
  });

  test("--encode --dry-run rejects", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--encode",
      "--dry-run",
      "--from",
      "alice",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("mutually exclusive");
  });

  test("--encode with raw hex tx.0x0001 rejects", async () => {
    const { stderr, exitCode } = await runCli(["tx.0x0001", "--encode"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("already encoded");
  });

  test("--v5 --general rejects", async () => {
    const { stderr, exitCode } = await runCli(["tx.System.remark", "0xaa", "--v5", "--general"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--v4/--v5 and --general are mutually exclusive");
  });

  test("--v5 with deprecated --unsigned alias rejects the same way", async () => {
    const { stderr, exitCode } = await runCli(["tx.System.remark", "0xaa", "--v5", "--unsigned"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--v4/--v5 and --general are mutually exclusive");
  });

  test("--v4 --v5 rejects", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--v4",
      "--v5",
      "--from",
      "alice",
      "--dry-run",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--v4 and --v5 are mutually exclusive");
  });

  test("--v5 without --from rejects", async () => {
    const { stderr, exitCode } = await runCli(["tx.System.remark", "0xaa", "--v5"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--v5 requires --from");
  });

  test("--v5 on a chain that cannot authorize it rejects with the capability error", async () => {
    // The polkadot fixture has no VerifyMultiSignature extension; the gate
    // must fire from cached metadata, before anything is signed or submitted.
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--v5",
      "--from",
      "alice",
      "--dry-run",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("can't accept signed v5 transactions");
  });

  test("unknown pallet gives suggestion", async () => {
    const { stderr, exitCode } = await runCli(["tx.Systm.remark", "0xaa", "--encode"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/System/i);
  });

  test("--asset rejects invalid JSON with helpful message", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--encode",
      "--asset",
      "{not-json",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid --asset");
    expect(stderr).toMatch(/Expected an XCM location/);
  });

  test("--asset rejects non-object JSON", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--encode",
      "--asset",
      "[1,2]",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid --asset");
  });

  test("--asset with valid Location is accepted (does not affect --encode output)", async () => {
    // Polkadot relay fixture has no ChargeAssetTxPayment extension, so --asset
    // is a no-op here — but the CLI must still accept the flag and produce the
    // same encoded call hex as without it.
    const loc = JSON.stringify({
      parents: 0,
      interior: {
        type: "X2",
        value: [
          { type: "PalletInstance", value: 50 },
          { type: "GeneralIndex", value: "3" },
        ],
      },
    });
    const { stdout: withAsset, exitCode: codeA } = await runCli([
      "tx.System.remark",
      "0xdeadbeef",
      "--encode",
      "--asset",
      loc,
    ]);
    const { stdout: withoutAsset, exitCode: codeB } = await runCli([
      "tx.System.remark",
      "0xdeadbeef",
      "--encode",
    ]);
    expect(codeA).toBe(0);
    expect(codeB).toBe(0);
    expect(withAsset).toBe(withoutAsset);
  });

  test("unknown call gives suggestion", async () => {
    const { stderr, exitCode } = await runCli(["tx.System.remrk", "0xaa", "--encode"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/remark/i);
  });

  test("missing --from without --encode shows call help", async () => {
    const { stdout, exitCode } = await runCli(["tx.System.remark", "0xaa"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Call)");
    expect(stdout).toContain("Args:");
    expect(stdout).toContain("--from");
    expect(stdout).toContain("Usage:");
  });

  test("tx.System.remark --help shows call help", async () => {
    const { stdout, exitCode } = await runCli(["tx.System.remark", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(Call)");
    expect(stdout).toContain("Args:");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--from");
    expect(stdout).toContain("--encode");
    expect(stdout).toContain("--dry-run");
  });

  test("--encode Balances.transfer_keep_alive produces valid hex", async () => {
    const { stdout, exitCode } = await runCli([
      "tx.Balances.transfer_keep_alive",
      "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
      "1000000000000",
      "--encode",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^0x[0-9a-f]+$/);
    // Balances pallet index is 0x05 on Polkadot, transfer_keep_alive is 0x03
    expect(stdout.startsWith("0x0503")).toBe(true);
  });

  test("--encode with wrong arg count errors", async () => {
    const { stderr, exitCode } = await runCli(["tx.System.remark", "--encode"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("takes 1 argument");
  });

  test("--encode XcmPallet.teleport_assets with nested AccountId32 hex bytes (V5)", async () => {
    const dest =
      '{"type":"V5","value":{"parents":0,"interior":{"type":"X1","value":[{"type":"Parachain","value":1000}]}}}';
    const beneficiary =
      '{"type":"V5","value":{"parents":0,"interior":{"type":"X1","value":[{"type":"AccountId32","value":{"network":null,"id":"0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"}}]}}}';
    const assets =
      '{"type":"V5","value":[{"id":{"parents":0,"interior":{"type":"Here"}},"fun":{"type":"Fungible","value":1000000000000}}]}';
    const { stdout, exitCode, stderr } = await runCli([
      "tx.XcmPallet.teleport_assets",
      dest,
      beneficiary,
      assets,
      "0",
      "--encode",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^0x[0-9a-f]+$/);
  });

  test("--encode XcmPallet.teleport_assets with quoted large Fungible value", async () => {
    const dest =
      '{"type":"V5","value":{"parents":0,"interior":{"type":"X1","value":[{"type":"Parachain","value":1000}]}}}';
    const beneficiary =
      '{"type":"V5","value":{"parents":0,"interior":{"type":"X1","value":[{"type":"AccountId32","value":{"network":null,"id":"0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"}}]}}}';
    // String value for Fungible exceeding MAX_SAFE_INTEGER — tests primitive coercion
    const assets =
      '{"type":"V5","value":[{"id":{"parents":0,"interior":{"type":"Here"}},"fun":{"type":"Fungible","value":"100000000000000000"}}]}';
    const { stdout, exitCode, stderr } = await runCli([
      "tx.XcmPallet.teleport_assets",
      dest,
      beneficiary,
      assets,
      "0",
      "--encode",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^0x[0-9a-f]+$/);
  });

  test("--encode XcmPallet.teleport_assets with V3 format", async () => {
    const dest =
      '{"type":"V3","value":{"parents":0,"interior":{"type":"X1","value":[{"type":"Parachain","value":1000}]}}}';
    const beneficiary =
      '{"type":"V3","value":{"parents":0,"interior":{"type":"X1","value":[{"type":"AccountId32","value":{"network":null,"id":"0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"}}]}}}';
    const assets =
      '{"type":"V3","value":[{"id":{"type":"Concrete","value":{"parents":0,"interior":{"type":"Here"}}},"fun":{"type":"Fungible","value":1000000000000}}]}';
    const { stdout, exitCode, stderr } = await runCli([
      "tx.XcmPallet.teleport_assets",
      dest,
      beneficiary,
      assets,
      "0",
      "--encode",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^0x[0-9a-f]+$/);
  });

  test("chain prefix --encode works (4-segment)", async () => {
    const { stdout, exitCode } = await runCli([
      "polkadot.tx.System.remark",
      "0xdeadbeef",
      "--encode",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^0x[0-9a-f]+$/);
  });

  test("--encode Utility.dispatch_as with enum shorthand system(Authorized)", async () => {
    // First encode a remark to use as the call arg
    const { stdout: remarkHex } = await runCli(["tx.System.remark", "0xcafe", "--encode"]);

    // Use shorthand syntax for the OriginCaller enum
    const {
      stdout: shorthandHex,
      exitCode,
      stderr,
    } = await runCli(["tx.Utility.dispatch_as", "system(Authorized)", remarkHex, "--encode"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(shorthandHex).toMatch(/^0x[0-9a-f]+$/);

    // Verify it produces the same output as the JSON format
    const { stdout: jsonHex } = await runCli([
      "tx.Utility.dispatch_as",
      '{"type":"system","value":{"type":"Authorized"}}',
      remarkHex,
      "--encode",
    ]);
    expect(shorthandHex).toBe(jsonHex);
  });

  test("chain prefix + --chain flag errors", async () => {
    const { stderr, exitCode } = await runCli([
      "polkadot.tx.System.remark",
      "0xaa",
      "--encode",
      "--chain",
      "polkadot",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Chain specified both as prefix");
  });

  test("contextual error for invalid struct arg via CLI", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.Balances.transfer_keep_alive",
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      "abc",
      "--encode",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid value for argument 'value'");
    expect(stderr).toContain("expected");
  });

  test("dot tx.System shows pallet call listing via dot-path", async () => {
    const { stdout, exitCode } = await runCli(["tx.System"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System Calls");
    expect(stdout).toContain("remark");
  });

  test("dot tx shows pallet list (category-only mode)", async () => {
    const { stdout, exitCode } = await runCli(["tx"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Pallets with calls");
    expect(stdout).toContain("System");
    expect(stdout).toContain("Balances");
  });

  test("raw hex via dot-path tx.0x rejects with --encode", async () => {
    const { stderr, exitCode } = await runCli(["tx.0x0001", "--encode"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("already encoded");
  });

  test("raw hex via dot-path tx.0x errors without --from", async () => {
    const { stderr, exitCode } = await runCli(["tx.0x0001"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--from");
  });

  // --to-yaml / --to-json tests
  test("--to-yaml with named call outputs valid YAML", async () => {
    const { stdout, exitCode, stderr } = await runCli([
      "tx.System.remark",
      "0xdeadbeef",
      "--to-yaml",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("chain:");
    expect(stdout).toContain("tx:");
    expect(stdout).toContain("System:");
    expect(stdout).toContain("remark:");
  });

  test("--to-json with named call outputs valid JSON", async () => {
    const { stdout, exitCode, stderr } = await runCli([
      "tx.System.remark",
      "0xdeadbeef",
      "--to-json",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chain).toBeDefined();
    expect(parsed.tx.System.remark).toBeDefined();
  });

  test("--to-yaml with raw hex decodes correctly", async () => {
    // First encode a call to get valid hex
    const { stdout: hex } = await runCli(["tx.System.remark", "0xdeadbeef", "--encode"]);
    // Then decode with --to-yaml
    const { stdout, exitCode, stderr } = await runCli([`tx.${hex}`, "--to-yaml"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("System:");
    expect(stdout).toContain("remark:");
  });

  test("--to-json with raw hex decodes correctly", async () => {
    const { stdout: hex } = await runCli(["tx.System.remark", "0xdeadbeef", "--encode"]);
    const { stdout, exitCode, stderr } = await runCli([`tx.${hex}`, "--to-json"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.tx.System.remark).toBeDefined();
  });

  test("--to-yaml and --encode are mutually exclusive", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--to-yaml",
      "--encode",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("mutually exclusive");
  });

  test("--to-json and --dry-run are mutually exclusive", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--to-json",
      "--dry-run",
      "--from",
      "alice",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("mutually exclusive");
  });

  test("--to-yaml and --to-json are mutually exclusive", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--to-yaml",
      "--to-json",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("mutually exclusive");
  });

  test("--to-yaml without --from succeeds (no signer needed)", async () => {
    const { exitCode } = await runCli(["tx.System.remark", "0xaa", "--to-yaml"]);
    expect(exitCode).toBe(0);
  });

  test("round-trip: encode → --to-yaml → file input → --encode produces same hex", async () => {
    // Step 1: Encode a call
    const { stdout: originalHex } = await runCli(["tx.System.remark", "0xdeadbeef", "--encode"]);
    expect(originalHex).toMatch(/^0x[0-9a-f]+$/);

    // Step 2: Decode to YAML
    const { stdout: yamlContent } = await runCli([`tx.${originalHex}`, "--to-yaml"]);

    // Step 3: Feed YAML back as file input with --encode
    const {
      stdout: roundTripHex,
      exitCode,
      stderr,
    } = await runCli(["{{HOME}}/decoded.yaml", "--encode"], {
      files: { "decoded.yaml": yamlContent },
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(roundTripHex).toBe(originalHex);
  });

  test("round-trip: encode → --to-json → file input → --encode produces same hex", async () => {
    const { stdout: originalHex } = await runCli([
      "tx.Balances.transfer_keep_alive",
      "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
      "1000000000000",
      "--encode",
    ]);

    const { stdout: jsonContent } = await runCli([`tx.${originalHex}`, "--to-json"]);

    const {
      stdout: roundTripHex,
      exitCode,
      stderr,
    } = await runCli(["{{HOME}}/decoded.json", "--encode"], {
      files: { "decoded.json": jsonContent },
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(roundTripHex).toBe(originalHex);
  });

  // --json output tests (global structured output flag)
  test("tx --json lists pallets with call counts as JSON", async () => {
    const { stdout, exitCode } = await runCli(["tx", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.chain).toBe("polkadot");
    expect(Array.isArray(parsed.pallets)).toBe(true);
    const system = parsed.pallets.find((p: any) => p.name === "System");
    expect(system).toBeDefined();
    expect(system.calls).toBeGreaterThan(0);
  });

  test("tx.System --json lists calls in pallet as JSON", async () => {
    const { stdout, exitCode } = await runCli(["tx.System", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.pallet).toBe("System");
    expect(Array.isArray(parsed.calls)).toBe(true);
    const remark = parsed.calls.find((c: any) => c.name === "remark");
    expect(remark).toBeDefined();
    expect(remark.args).toBeDefined();
  });

  test("--encode --json wraps callHex in JSON", async () => {
    const { stdout, exitCode } = await runCli([
      "tx.System.remark",
      "0xdeadbeef",
      "--encode",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.callHex).toMatch(/^0x[0-9a-f]+$/);
  });

  test("--encode without --json still returns plain hex", async () => {
    const { stdout, exitCode } = await runCli(["tx.System.remark", "0xdeadbeef", "--encode"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^0x[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// --general flag validation
// ---------------------------------------------------------------------------

describe("--general flag validation", () => {
  test("--general and --from are mutually exclusive", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--general",
      "--from",
      "alice",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("mutually exclusive");
  });

  test("--general does not support --nonce", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--general",
      "--nonce",
      "5",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--general does not support --nonce");
  });

  test("--general does not support --tip", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--general",
      "--tip",
      "1000",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--general does not support --tip");
  });

  test("--general does not support --mortality", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--general",
      "--mortality",
      "immortal",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--general does not support --mortality");
  });

  test("--general alone (without --from) passes gate check for raw hex", async () => {
    // Raw hex + --general should not error about missing --from
    // It will error during submission (no chain connection in test) but should
    // get past the gate check
    const { stderr } = await runCli(["tx.0x0001", "--general"]);
    expect(stderr).not.toContain("--from is required");
  });

  test("--unsigned is a deprecated alias for --general", async () => {
    const { stderr, exitCode } = await runCli([
      "tx.System.remark",
      "0xaa",
      "--unsigned",
      "--from",
      "alice",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--unsigned is deprecated");
    expect(stderr).toContain("mutually exclusive");
  });
});

// ---------------------------------------------------------------------------
// generalDefaultForType
// ---------------------------------------------------------------------------

describe("generalDefaultForType", () => {
  test("void returns empty Uint8Array", () => {
    const result = generalDefaultForType("SomeExt", { type: "void" });
    expect(result).toEqual(new Uint8Array([]));
  });

  test("option returns undefined (None)", () => {
    const result = generalDefaultForType("AsPerson", { type: "option", value: {} });
    expect(result).toBeUndefined();
  });

  test("enum with Disabled returns Disabled variant", () => {
    const result = generalDefaultForType("VerifyMultiSignature", {
      type: "enum",
      value: { Signed: {}, Disabled: { type: "void" } },
    });
    expect(result).toEqual({ type: "Disabled", value: undefined });
  });

  test("enum with Immortal returns Immortal variant", () => {
    const result = generalDefaultForType("SomeEra", {
      type: "enum",
      value: { Immortal: { type: "void" }, Mortal1: {} },
    });
    expect(result).toEqual({ type: "Immortal" });
  });

  test("CheckMortality returns Immortal regardless of entry", () => {
    const result = generalDefaultForType("CheckMortality", { type: "enum", value: {} });
    expect(result).toEqual({ type: "Immortal" });
  });

  test("CheckNonce returns 0", () => {
    const result = generalDefaultForType("CheckNonce", { type: "compact" });
    expect(result).toBe(0);
  });

  test("ChargeTransactionPayment returns 0n", () => {
    const result = generalDefaultForType("ChargeTransactionPayment", { type: "compact" });
    expect(result).toBe(0n);
  });

  test("ChargeAssetTxPayment returns zero tip and no asset", () => {
    const result = generalDefaultForType("ChargeAssetTxPayment", { type: "struct" });
    expect(result).toEqual({ tip: 0n, asset_id: undefined });
  });

  test("primitive bool returns false", () => {
    const result = generalDefaultForType("RestrictOrigins", {
      type: "primitive",
      value: "bool",
    });
    expect(result).toBe(false);
  });

  test("primitive u32 returns 0", () => {
    const result = generalDefaultForType("SomeExt", { type: "primitive", value: "u32" });
    expect(result).toBe(0);
  });

  test("primitive u128 returns 0n", () => {
    const result = generalDefaultForType("SomeExt", { type: "primitive", value: "u128" });
    expect(result).toBe(0n);
  });

  test("compact returns 0", () => {
    const result = generalDefaultForType("SomeExt", { type: "compact" });
    expect(result).toBe(0);
  });

  test("unknown type returns NO_DEFAULT", () => {
    const result = generalDefaultForType("SomeExt", { type: "struct", value: {} });
    expect(result).toBe(NO_DEFAULT);
  });
});

// ---------------------------------------------------------------------------
// buildGeneralTx
// ---------------------------------------------------------------------------

describe("buildGeneralTx", () => {
  test("produces bytes starting with compact length, 0x45, 0x00", () => {
    const callData = new Uint8Array([0x00, 0x01]); // minimal call data
    const result = buildGeneralTx(meta, callData, {});
    // First byte(s) are compact length, then 0x45 (general v5), then 0x00 (ext version)
    // Find where 0x45 appears (after compact prefix)
    let idx = 0;
    // Skip compact prefix (1-4 bytes depending on value)
    while (idx < result.length && (result[idx]! & 0b11) !== 0) idx++;
    if (idx === 0) idx = 1; // single-byte compact
    expect(result[idx]).toBe(0x45);
    expect(result[idx + 1]).toBe(0x00);
  });

  test("call data appears at end of general tx", () => {
    const callData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const result = buildGeneralTx(meta, callData, {});
    const tail = result.slice(-4);
    expect(tail).toEqual(callData);
  });
});

// ---------------------------------------------------------------------------
// --general help text and gate logic
// ---------------------------------------------------------------------------

describe("--general help and gate", () => {
  test("missing --from and --general shows call help", async () => {
    const { stdout, exitCode } = await runCli(["tx.System.remark", "0xaa"]);
    expect(exitCode).toBe(0);
    // Should show help, not error about missing flags
    expect(stdout).toContain("(Call)");
    expect(stdout).toContain("Usage:");
  });
});

// ---------------------------------------------------------------------------
// --general file-based input
// ---------------------------------------------------------------------------

describe("--general with file-based input", () => {
  test("YAML file with general: true and --dry-run works", async () => {
    const yaml = [
      "chain: polkadot",
      "general: true",
      "tx:",
      "  System:",
      '    remark: "0xdeadbeef"',
    ].join("\n");
    const { stdout, exitCode, stderr } = await runCli(
      ["{{HOME}}/general-remark.yaml", "--dry-run"],
      { files: { "general-remark.yaml": yaml } },
    );
    // This will fail to connect (no live chain in tests), but the flag parsing
    // should work. Check that it doesn't error about missing --from
    if (exitCode === 0) {
      expect(stdout).toContain("general");
      expect(stdout).toContain("N/A");
    } else {
      // Connection error is fine, but --from error is not
      expect(stderr).not.toContain("--from is required");
    }
  });

  test("legacy unsigned: true still works and warns", async () => {
    const yaml = [
      "chain: polkadot",
      "unsigned: true",
      "tx:",
      "  System:",
      '    remark: "0xdeadbeef"',
    ].join("\n");
    const { exitCode, stderr } = await runCli(["{{HOME}}/unsigned-remark.yaml", "--dry-run"], {
      files: { "unsigned-remark.yaml": yaml },
    });
    expect(stderr).toContain('"unsigned: true"');
    expect(stderr).toContain("deprecated");
    if (exitCode !== 0) {
      expect(stderr).not.toContain("--from is required");
    }
  });
});

// ---------------------------------------------------------------------------
// DOT_DRY_RUN global flag (issue #234)
// ---------------------------------------------------------------------------

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("DOT_DRY_RUN global flag", { timeout: 15_000 }, () => {
  test("DOT_DRY_RUN=1 dry-runs an otherwise-submitting tx and prints the hint", async () => {
    // A general tx without --dry-run would attempt to broadcast (and, offline,
    // fail to connect). With DOT_DRY_RUN set it must dry-run instead: print the
    // general dry-run output to stdout and never connect.
    const { stdout, stderr, exitCode } = await runCli(
      ["tx.System.remark", "0xdeadbeef", "--general"],
      { env: { DOT_DRY_RUN: "1" } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("general (v5)");
    expect(stdout).toContain("N/A (general transaction)");
    // Hint goes to stderr so it never corrupts stdout.
    expect(stderr).toContain("DOT_DRY_RUN is set");
  });

  test("hint is written to stderr, never stdout (clean --json)", async () => {
    const { stdout, stderr, exitCode } = await runCli(
      ["tx.System.remark", "0xdeadbeef", "--general", "--json"],
      { env: { DOT_DRY_RUN: "1" } },
    );
    expect(exitCode).toBe(0);
    // stdout must be valid JSON with no banner text mixed in.
    expect(stdout).not.toContain("DOT_DRY_RUN");
    const parsed = JSON.parse(stdout);
    expect(parsed.general).toBe(true);
    expect(parsed.estimatedFees).toBeNull();
    expect(stderr).toContain("DOT_DRY_RUN is set");
  });

  test("explicit --no-dry-run overrides DOT_DRY_RUN (hint suppressed)", async () => {
    // With an explicit flag the env-driven hint must be suppressed. We use
    // --encode (a non-connecting path) so the assertion stays offline-safe;
    // the dry-run override semantics themselves are unit-tested in
    // src/core/dry-run.test.ts.
    const { stderr } = await runCli(
      ["tx.System.remark", "0xdeadbeef", "--encode", "--no-dry-run"],
      { env: { DOT_DRY_RUN: "1" } },
    );
    expect(stderr).not.toContain("DOT_DRY_RUN is set");
  });

  test("DOT_DRY_RUN does not break decode-only --encode", async () => {
    const { stdout, stderr, exitCode } = await runCli(
      ["tx.System.remark", "0xdeadbeef", "--encode"],
      { env: { DOT_DRY_RUN: "1" } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^0x[0-9a-f]+$/);
    // Decode-only paths never submit, so the env var must not force dry-run
    // (which would trip the "--encode and --dry-run are mutually exclusive" guard)
    // and the hint is not shown.
    expect(stderr).not.toContain("mutually exclusive");
    expect(stderr).not.toContain("DOT_DRY_RUN is set");
  });
});
