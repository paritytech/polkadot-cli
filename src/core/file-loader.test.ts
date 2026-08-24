import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isFilePath,
  loadCommandFile,
  parseVarFlags,
  quoteYamlHexValues,
  substituteVars,
} from "./file-loader.ts";

// ---------------------------------------------------------------------------
// isFilePath
// ---------------------------------------------------------------------------

describe("isFilePath", () => {
  test("detects .json extension", () => {
    expect(isFilePath("remark.json")).toBe(true);
  });

  test("detects .yaml extension", () => {
    expect(isFilePath("transfer.xcm.yaml")).toBe(true);
  });

  test("detects .yml extension", () => {
    expect(isFilePath("query.yml")).toBe(true);
  });

  test("detects relative path starting with ./", () => {
    expect(isFilePath("./some-file")).toBe(true);
  });

  test("detects absolute path starting with /", () => {
    expect(isFilePath("/tmp/remark.json")).toBe(true);
  });

  test("does not match dot-path commands", () => {
    expect(isFilePath("tx.System.remark")).toBe(false);
  });

  test("does not match plain words", () => {
    expect(isFilePath("polkadot")).toBe(false);
  });

  test("does not match hex strings", () => {
    expect(isFilePath("0x1234")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseVarFlags
// ---------------------------------------------------------------------------

describe("parseVarFlags", () => {
  test("parses single KEY=VALUE", () => {
    expect(parseVarFlags(["AMOUNT=1000"])).toEqual({ AMOUNT: "1000" });
  });

  test("parses multiple KEY=VALUE", () => {
    expect(parseVarFlags(["A=1", "B=2"])).toEqual({ A: "1", B: "2" });
  });

  test("handles value with equals sign", () => {
    expect(parseVarFlags(["KEY=a=b=c"])).toEqual({ KEY: "a=b=c" });
  });

  test("handles empty value", () => {
    expect(parseVarFlags(["KEY="])).toEqual({ KEY: "" });
  });

  test("handles single string input", () => {
    expect(parseVarFlags("KEY=value")).toEqual({ KEY: "value" });
  });

  test("returns empty for undefined", () => {
    expect(parseVarFlags(undefined)).toEqual({});
  });

  test("throws on missing =", () => {
    expect(() => parseVarFlags(["NOEQUALS"])).toThrow('Invalid --var format "NOEQUALS"');
  });

  test("throws on empty key", () => {
    expect(() => parseVarFlags(["=value"])).toThrow("Key cannot be empty");
  });
});

// ---------------------------------------------------------------------------
// substituteVars
// ---------------------------------------------------------------------------

describe("substituteVars", () => {
  test("substitutes simple ${VAR}", () => {
    expect(substituteVars("amount: ${AMOUNT}", { AMOUNT: "1000" })).toBe("amount: 1000");
  });

  test("substitutes multiple vars", () => {
    expect(substituteVars("${A} and ${B}", { A: "x", B: "y" })).toBe("x and y");
  });

  test("uses default with ${VAR:-default}", () => {
    expect(substituteVars("chain: ${CHAIN:-polkadot}", {})).toBe("chain: polkadot");
  });

  test("var takes precedence over default", () => {
    expect(substituteVars("chain: ${CHAIN:-polkadot}", { CHAIN: "kusama" })).toBe("chain: kusama");
  });

  test("falls back to environment variable", () => {
    const key = `__TEST_FILE_LOADER_${Date.now()}`;
    process.env[key] = "from-env";
    try {
      expect(substituteVars(`val: \${${key}}`, {})).toBe("val: from-env");
    } finally {
      delete process.env[key];
    }
  });

  test("env var takes precedence over default but not over explicit var", () => {
    const key = `__TEST_FILE_LOADER2_${Date.now()}`;
    process.env[key] = "from-env";
    try {
      // env beats default
      expect(substituteVars(`\${${key}:-fallback}`, {})).toBe("from-env");
      // explicit var beats env
      expect(substituteVars(`\${${key}:-fallback}`, { [key]: "explicit" })).toBe("explicit");
    } finally {
      delete process.env[key];
    }
  });

  test("throws on undefined variable without default", () => {
    expect(() => substituteVars("${MISSING}", {})).toThrow('Undefined variable "${MISSING}"');
  });

  test("leaves text without vars unchanged", () => {
    expect(substituteVars("no vars here", {})).toBe("no vars here");
  });

  test("handles empty default", () => {
    expect(substituteVars("${VAR:-}", {})).toBe("");
  });
});

// ---------------------------------------------------------------------------
// quoteYamlHexValues
// ---------------------------------------------------------------------------

describe("quoteYamlHexValues", () => {
  test("quotes bare hex value after key", () => {
    expect(quoteYamlHexValues("call: 0xdeadbeef")).toBe('call: "0xdeadbeef"');
  });

  test("quotes hex with leading zeros (preserves them as string)", () => {
    expect(quoteYamlHexValues("call: 0x000010deadbeef")).toBe('call: "0x000010deadbeef"');
  });

  test("quotes hex in array items", () => {
    expect(quoteYamlHexValues("  - 0xdeadbeef")).toBe('  - "0xdeadbeef"');
  });

  test("does not double-quote already quoted hex", () => {
    expect(quoteYamlHexValues('call: "0xdeadbeef"')).toBe('call: "0xdeadbeef"');
  });

  test("does not touch decimal numbers", () => {
    expect(quoteYamlHexValues("ref_time: 2020000000")).toBe("ref_time: 2020000000");
  });

  test("does not touch non-hex strings", () => {
    expect(quoteYamlHexValues("type: Here")).toBe("type: Here");
  });

  test("handles indented YAML keys", () => {
    expect(quoteYamlHexValues("              call: 0x000010deadbeef")).toBe(
      '              call: "0x000010deadbeef"',
    );
  });

  test("handles multiline YAML correctly", () => {
    const input = [
      "chain: people",
      "tx:",
      "  System:",
      "    remark:",
      "      call: 0x000010deadbeef",
      "      ref_time: 2020000000",
    ].join("\n");
    const result = quoteYamlHexValues(input);
    expect(result).toContain('call: "0x000010deadbeef"');
    expect(result).toContain("ref_time: 2020000000");
  });

  test("does not touch bare 0x without digits (not a YAML hex integer)", () => {
    expect(quoteYamlHexValues("data: 0x")).toBe("data: 0x");
  });
});

// ---------------------------------------------------------------------------
// loadCommandFile
// ---------------------------------------------------------------------------

/** Write a temp file and return its path */
async function writeTempFile(name: string, content: string): Promise<string> {
  const path = join(tmpdir(), `dot-test-${Date.now()}-${name}`);
  await Bun.write(path, content);
  return path;
}

describe("loadCommandFile", () => {
  const tempFiles: string[] = [];

  async function writeTemp(name: string, content: string): Promise<string> {
    const path = await writeTempFile(name, content);
    tempFiles.push(path);
    return path;
  }

  afterAll(async () => {
    for (const f of tempFiles) {
      try {
        (await Bun.file(f).exists()) && (await Bun.$`rm ${f}`.quiet());
      } catch {}
    }
    tempFiles.length = 0;
  });

  // --- JSON ---

  test("parses JSON tx file", async () => {
    const path = await writeTemp(
      "remark.json",
      JSON.stringify({
        chain: "polkadot",
        tx: { System: { remark: ["0xdeadbeef"] } },
      }),
    );
    const result = await loadCommandFile(path, {});
    expect(result).toEqual({
      chain: "polkadot",
      category: "tx",
      pallet: "System",
      item: "remark",
      args: ["0xdeadbeef"],
    });
  });

  test("parses JSON query file", async () => {
    const path = await writeTemp(
      "query.json",
      JSON.stringify({
        query: { System: { Account: ["5GrwvaEF"] } },
      }),
    );
    const result = await loadCommandFile(path, {});
    expect(result).toEqual({
      chain: undefined,
      category: "query",
      pallet: "System",
      item: "Account",
      args: ["5GrwvaEF"],
    });
  });

  test("parses JSON const file", async () => {
    const path = await writeTemp(
      "const.json",
      JSON.stringify({
        chain: "polkadot",
        const: { Balances: { ExistentialDeposit: null } },
      }),
    );
    const result = await loadCommandFile(path, {});
    expect(result).toEqual({
      chain: "polkadot",
      category: "const",
      pallet: "Balances",
      item: "ExistentialDeposit",
      args: undefined,
    });
  });

  test("parses JSON apis file", async () => {
    const path = await writeTemp(
      "apis.json",
      JSON.stringify({
        apis: { Core: { version: null } },
      }),
    );
    const result = await loadCommandFile(path, {});
    expect(result).toEqual({
      chain: undefined,
      category: "apis",
      pallet: "Core",
      item: "version",
      args: undefined,
    });
  });

  // --- YAML ---

  test("parses YAML tx file", async () => {
    const yaml = `
chain: people-paseo
tx:
  System:
    remark:
      - "0xdead"
`;
    const path = await writeTemp("remark.yaml", yaml);
    const result = await loadCommandFile(path, {});
    expect(result).toEqual({
      chain: "people-paseo",
      category: "tx",
      pallet: "System",
      item: "remark",
      args: ["0xdead"],
    });
  });

  test("parses YAML with named args (struct)", async () => {
    const yaml = `
tx:
  Balances:
    transfer_keep_alive:
      dest: "5GrwvaEF"
      value: 1000000000000
`;
    const path = await writeTemp("transfer.yaml", yaml);
    const result = await loadCommandFile(path, {});
    expect(result.args).toEqual({
      dest: "5GrwvaEF",
      value: 1000000000000,
    });
  });

  test("parses .yml extension", async () => {
    const path = await writeTemp("test.yml", "tx:\n  System:\n    remark:\n      - '0xaa'\n");
    const result = await loadCommandFile(path, {});
    expect(result.category).toBe("tx");
  });

  // --- Variables ---

  test("substitutes vars from --var flags", async () => {
    const yaml = `
tx:
  System:
    remark:
      - "\${DATA}"
`;
    const path = await writeTemp("var.yaml", yaml);
    const result = await loadCommandFile(path, { DATA: "0xcafe" });
    expect(result.args).toEqual(["0xcafe"]);
  });

  test("uses file vars section as defaults", async () => {
    const yaml = `
vars:
  DATA: "0xbeef"
tx:
  System:
    remark:
      - "\${DATA}"
`;
    const path = await writeTemp("filevar.yaml", yaml);
    const result = await loadCommandFile(path, {});
    expect(result.args).toEqual(["0xbeef"]);
  });

  test("--var flags override file vars", async () => {
    const yaml = `
vars:
  DATA: "0xbeef"
tx:
  System:
    remark:
      - "\${DATA}"
`;
    const path = await writeTemp("override.yaml", yaml);
    const result = await loadCommandFile(path, { DATA: "0xcafe" });
    expect(result.args).toEqual(["0xcafe"]);
  });

  test("uses ${VAR:-default} when var is missing", async () => {
    const yaml = `
chain: \${CHAIN:-polkadot}
tx:
  System:
    remark:
      - "0xaa"
`;
    const path = await writeTemp("default.yaml", yaml);
    const result = await loadCommandFile(path, {});
    expect(result.chain).toBe("polkadot");
  });

  // --- Hex preservation ---

  test("preserves hex --var values as strings in YAML", async () => {
    const yaml = `
tx:
  System:
    remark:
      call: \${CALL}
`;
    const path = await writeTemp("hex.yaml", yaml);
    const result = await loadCommandFile(path, { CALL: "0x000010deadbeef" });
    expect(result.args).toEqual({ call: "0x000010deadbeef" });
  });

  test("preserves hex --var values with leading zeros", async () => {
    const yaml = `
tx:
  System:
    remark:
      data: \${DATA}
`;
    const path = await writeTemp("hexzero.yaml", yaml);
    const result = await loadCommandFile(path, { DATA: "0x0000ff" });
    expect(result.args).toEqual({ data: "0x0000ff" });
  });

  // --- Error cases ---

  test("throws on file not found", async () => {
    await expect(loadCommandFile("/nonexistent/file.yaml", {})).rejects.toThrow("File not found");
  });

  test("throws on empty file", async () => {
    const path = await writeTemp("empty.yaml", "   ");
    await expect(loadCommandFile(path, {})).rejects.toThrow("File is empty");
  });

  test("throws on no category key", async () => {
    const path = await writeTemp("nocat.json", JSON.stringify({ chain: "polkadot" }));
    await expect(loadCommandFile(path, {})).rejects.toThrow(
      "must contain exactly one category key",
    );
  });

  test("throws on multiple category keys", async () => {
    const path = await writeTemp(
      "multi.json",
      JSON.stringify({ tx: { A: { b: null } }, query: { C: { d: null } } }),
    );
    await expect(loadCommandFile(path, {})).rejects.toThrow("multiple category keys");
  });

  test("throws on invalid JSON", async () => {
    const path = await writeTemp("bad.json", "{ invalid json }");
    await expect(loadCommandFile(path, {})).rejects.toThrow("Failed to parse JSON");
  });

  test("throws on array root", async () => {
    const path = await writeTemp("arr.json", "[1, 2, 3]");
    await expect(loadCommandFile(path, {})).rejects.toThrow("must contain a YAML/JSON object");
  });

  test("throws on missing pallet", async () => {
    const path = await writeTemp("nopallet.json", JSON.stringify({ tx: {} }));
    await expect(loadCommandFile(path, {})).rejects.toThrow("exactly one pallet");
  });

  test("throws on multiple pallets", async () => {
    const path = await writeTemp(
      "multi-pallet.json",
      JSON.stringify({ tx: { System: { remark: null }, Balances: { transfer: null } } }),
    );
    await expect(loadCommandFile(path, {})).rejects.toThrow("exactly one pallet");
  });

  test("throws on missing item", async () => {
    const path = await writeTemp("noitem.json", JSON.stringify({ tx: { System: {} } }));
    await expect(loadCommandFile(path, {})).rejects.toThrow("exactly one item");
  });

  test("throws on undefined variable", async () => {
    const yaml = "tx:\n  System:\n    remark:\n      - ${UNDEFINED_VAR}\n";
    const path = await writeTemp("undef.yaml", yaml);
    await expect(loadCommandFile(path, {})).rejects.toThrow("Undefined variable");
  });

  test("throws when category value is not an object", async () => {
    const path = await writeTemp("badcat.json", JSON.stringify({ tx: "not-an-object" }));
    await expect(loadCommandFile(path, {})).rejects.toThrow("must be an object with a pallet name");
  });

  test("throws when category value is an array", async () => {
    const path = await writeTemp("arrcat.json", JSON.stringify({ tx: [1, 2] }));
    await expect(loadCommandFile(path, {})).rejects.toThrow("must be an object with a pallet name");
  });

  test("throws when pallet value is not an object", async () => {
    const path = await writeTemp(
      "badpallet.json",
      JSON.stringify({ tx: { System: "not-an-object" } }),
    );
    await expect(loadCommandFile(path, {})).rejects.toThrow(
      "must be an object with a call/item name",
    );
  });

  test("throws when pallet value is an array", async () => {
    const path = await writeTemp("arrpallet.json", JSON.stringify({ tx: { System: [1] } }));
    await expect(loadCommandFile(path, {})).rejects.toThrow(
      "must be an object with a call/item name",
    );
  });

  test("throws on multiple items in pallet", async () => {
    const path = await writeTemp(
      "multi-item.json",
      JSON.stringify({ tx: { System: { remark: null, set_code: null } } }),
    );
    await expect(loadCommandFile(path, {})).rejects.toThrow("exactly one item");
  });

  // --- general field ---

  test("parses general: true from JSON", async () => {
    const path = await writeTemp(
      "general.json",
      JSON.stringify({
        chain: "people",
        general: true,
        tx: { People: { create_people_collection: null } },
      }),
    );
    const result = await loadCommandFile(path, {});
    expect(result.general).toBe(true);
    expect(result.chain).toBe("people");
    expect(result.pallet).toBe("People");
    expect(result.item).toBe("create_people_collection");
  });

  test("parses general: true from YAML", async () => {
    const path = await writeTemp(
      "general.yaml",
      "chain: people\ngeneral: true\ntx:\n  People:\n    create_people_collection: null\n",
    );
    const result = await loadCommandFile(path, {});
    expect(result.general).toBe(true);
  });

  test("general defaults to undefined when not set", async () => {
    const path = await writeTemp(
      "no-general.json",
      JSON.stringify({ tx: { System: { remark: null } } }),
    );
    const result = await loadCommandFile(path, {});
    expect(result.general).toBeUndefined();
  });

  test("general: false is treated as undefined", async () => {
    const path = await writeTemp(
      "general-false.json",
      JSON.stringify({ general: false, tx: { System: { remark: null } } }),
    );
    const result = await loadCommandFile(path, {});
    expect(result.general).toBeUndefined();
  });

  test("legacy unsigned: true maps to general", async () => {
    const path = await writeTemp(
      "unsigned-legacy.json",
      JSON.stringify({ unsigned: true, tx: { System: { remark: null } } }),
    );
    const result = await loadCommandFile(path, {});
    expect(result.general).toBe(true);
  });
});
