import { describe, expect, spyOn, test } from "bun:test";
import { Binary } from "polkadot-api";
import {
  firstSentence,
  formatJson,
  formatPretty,
  isJsonOutput,
  printImportResults,
  Spinner,
  writeStdout,
} from "./output.ts";

describe("formatJson", () => {
  test("formats object with 2-space indentation", () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  test("converts bigint values to strings", () => {
    expect(formatJson({ balance: 1000000000000n })).toBe('{\n  "balance": "1000000000000"\n}');
  });

  test("converts Uint8Array with non-readable bytes to hex", () => {
    expect(formatJson({ hash: new Uint8Array([0x00, 0xde, 0xad]) })).toBe(
      '{\n  "hash": "0x00dead"\n}',
    );
  });

  test("converts empty Uint8Array to empty string", () => {
    expect(formatJson({ data: new Uint8Array([]) })).toBe('{\n  "data": ""\n}');
  });

  test("handles nested objects with mixed types", () => {
    const data = {
      name: "alice",
      age: 30,
      balance: 42n,
      key: new Uint8Array([0xab, 0xcd]),
      active: true,
      extra: null,
    };
    const parsed = JSON.parse(formatJson(data));
    expect(parsed).toEqual({
      name: "alice",
      age: 30,
      balance: "42",
      key: "0xabcd",
      active: true,
      extra: null,
    });
  });

  test("converts Binary with valid UTF-8 to text", () => {
    expect(formatJson({ symbol: Binary.fromText("DOT") })).toBe('{\n  "symbol": "DOT"\n}');
  });

  test("converts Binary with invalid UTF-8 to hex", () => {
    expect(formatJson({ data: new Uint8Array([0x80, 0x81]) })).toBe('{\n  "data": "0x8081"\n}');
  });

  test("converts empty Binary to empty string", () => {
    expect(formatJson({ data: new Uint8Array([]) })).toBe('{\n  "data": ""\n}');
  });

  test("converts Uint8Array with control characters to hex", () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x00, 0x6c, 0x6f]); // "Hel\0lo"
    expect(formatJson({ data: bytes })).toBe('{\n  "data": "0x48656c006c6f"\n}');
  });

  test("converts Uint8Array with C1 control characters to hex", () => {
    // 0xc2 0x80 is U+0080 (PAD) in UTF-8 -- valid UTF-8, but not readable
    const bytes = new Uint8Array([0x41, 0xc2, 0x80, 0x42]);
    expect(formatJson({ data: bytes })).toBe('{\n  "data": "0x41c28042"\n}');
  });

  test("converts Uint8Array with invalid UTF-8 to hex", () => {
    expect(formatJson({ hash: new Uint8Array([0xfe, 0xff]) })).toBe('{\n  "hash": "0xfeff"\n}');
  });

  test("handles nested object with Binary, bigint, and primitives", () => {
    const data = {
      deposit: 6693666000n,
      name: Binary.fromText("Paseo Token"),
      symbol: Binary.fromText("PAS"),
      decimals: 10,
      is_frozen: false,
    };
    const parsed = JSON.parse(formatJson(data));
    expect(parsed).toEqual({
      deposit: "6693666000",
      name: "Paseo Token",
      symbol: "PAS",
      decimals: 10,
      is_frozen: false,
    });
  });

  test("handles arrays with mixed values", () => {
    const data = [1, "hello", 99n, new Uint8Array([0xff, 0xfe]), true, null];
    const parsed = JSON.parse(formatJson(data));
    expect(parsed).toEqual([1, "hello", "99", "0xfffe", true, null]);
  });

  test("returns 'null' for null input", () => {
    expect(formatJson(null)).toBe("null");
  });

  test("Uint8Array with readable text renders as text (papi v2 unified behavior)", () => {
    // In papi v2, Binary values are Uint8Array — both go through text detection
    const textBytes = new TextEncoder().encode("Hello");
    expect(formatJson({ msg: textBytes })).toBe('{\n  "msg": "Hello"\n}');
  });

  test("Binary.fromText output renders as text via Uint8Array path (papi v2)", () => {
    // Binary.fromText now returns Uint8Array, not a Binary instance
    const value = Binary.fromText("DOT");
    expect(value).toBeInstanceOf(Uint8Array);
    expect(formatJson({ symbol: value })).toBe('{\n  "symbol": "DOT"\n}');
  });
});

describe("isJsonOutput", () => {
  test("returns true for json flag", () => {
    expect(isJsonOutput({ json: true })).toBe(true);
  });

  test("returns true for output json", () => {
    expect(isJsonOutput({ output: "json" })).toBe(true);
  });

  test("returns false for no flags", () => {
    expect(isJsonOutput({}, {})).toBe(false);
  });

  test("returns false for non-json output", () => {
    expect(isJsonOutput({ output: "pretty" })).toBe(false);
  });

  test("returns false when json is false", () => {
    expect(isJsonOutput({ json: false }, {})).toBe(false);
  });

  test("DOT_OUTPUT=json enables JSON when no flag is given", () => {
    expect(isJsonOutput({}, { DOT_OUTPUT: "json" })).toBe(true);
    expect(isJsonOutput({}, { DOT_OUTPUT: " JSON " })).toBe(true);
  });

  test("DOT_OUTPUT=pretty or an unknown value stays pretty", () => {
    expect(isJsonOutput({}, { DOT_OUTPUT: "pretty" })).toBe(false);
    expect(isJsonOutput({}, { DOT_OUTPUT: "yaml" })).toBe(false);
    expect(isJsonOutput({}, { DOT_OUTPUT: "" })).toBe(false);
  });

  test("an explicit --output overrides DOT_OUTPUT", () => {
    expect(isJsonOutput({ output: "pretty" }, { DOT_OUTPUT: "json" })).toBe(false);
    expect(isJsonOutput({ output: "json" }, { DOT_OUTPUT: "pretty" })).toBe(true);
  });

  test("--json wins over DOT_OUTPUT=pretty", () => {
    expect(isJsonOutput({ json: true }, { DOT_OUTPUT: "pretty" })).toBe(true);
  });
});

describe("Spinner", () => {
  test("succeed writes to stderr, not stdout", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    const spinner = new Spinner();
    spinner.succeed("done");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toContain("done");
    expect(logSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  test("succeed includes check mark", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const spinner = new Spinner();
    spinner.succeed("Finalized");

    expect(errorSpy.mock.calls[0]![0]).toContain("✓");
    expect(errorSpy.mock.calls[0]![0]).toContain("Finalized");

    errorSpy.mockRestore();
  });

  test("start writes to stderr in non-TTY (piped) mode", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    // In test environment, stdout.isTTY is typically false (non-TTY)
    const spinner = new Spinner();
    spinner.start("Loading...");
    spinner.stop();

    // In non-TTY mode, start() should use console.error
    // In TTY mode, it writes to process.stdout directly (not console.log)
    expect(logSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("firstSentence", () => {
  test("single sentence", () => {
    expect(firstSentence(["Transfer succeeded."])).toBe("Transfer succeeded.");
  });

  test("multi-line sentence joined", () => {
    expect(firstSentence(["The runtime can be supplied", "later."])).toBe(
      "The runtime can be supplied later.",
    );
  });

  test("multiple sentences returns first", () => {
    expect(firstSentence(["First sentence. Second sentence."])).toBe("First sentence.");
  });

  test("sentence ending with exclamation mark", () => {
    expect(firstSentence(["MUST BE GREATER THAN ZERO!"])).toBe("MUST BE GREATER THAN ZERO!");
  });

  test("sentence ending with question mark", () => {
    expect(firstSentence(["Is this valid?"])).toBe("Is this valid?");
  });

  test("no punctuation returns full text", () => {
    expect(firstSentence(["No period here"])).toBe("No period here");
  });

  test("empty docs returns empty string", () => {
    expect(firstSentence([])).toBe("");
  });

  test("whitespace-only docs returns empty string", () => {
    expect(firstSentence(["  ", "  "])).toBe("");
  });

  test("sentence ending at end of string (no trailing space)", () => {
    expect(firstSentence(["Done."])).toBe("Done.");
  });

  test("skips e.g. abbreviation", () => {
    expect(firstSentence(["Some amount was deposited (e.g. for transaction fees)."])).toBe(
      "Some amount was deposited (e.g. for transaction fees).",
    );
  });

  test("skips i.e. abbreviation", () => {
    expect(firstSentence(["The value (i.e. the amount) must be positive."])).toBe(
      "The value (i.e. the amount) must be positive.",
    );
  });

  test("skips etc. abbreviation", () => {
    expect(firstSentence(["Handles fees, tips, etc. in a single call."])).toBe(
      "Handles fees, tips, etc. in a single call.",
    );
  });

  test("multi-line with e.g. abbreviation", () => {
    expect(firstSentence(["Some amount was deposited (e.g.", "for transaction fees)."])).toBe(
      "Some amount was deposited (e.g. for transaction fees).",
    );
  });

  test("e.g. at end of text with no sentence terminator", () => {
    expect(firstSentence(["See the docs, e.g."])).toBe("See the docs, e.g.");
  });

  test("abbreviation followed by real sentence boundary", () => {
    expect(firstSentence(["Use e.g. this method. Then do something else."])).toBe(
      "Use e.g. this method.",
    );
  });
});

describe("printImportResults", () => {
  const capture = (fn: () => void): string => {
    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(" "));
    });
    try {
      fn();
    } finally {
      spy.mockRestore();
    }
    return lines.join("\n");
  };

  test("prints one line per added entry with a checkmark", () => {
    const out = capture(() =>
      printImportResults({
        added: ["a", "b", "c"],
        overwritten: [],
        skipped: [],
        dryRun: false,
        noun: "chain",
      }),
    );
    expect(out).toMatch(/✓ a/);
    expect(out).toMatch(/✓ b/);
    expect(out).toMatch(/✓ c/);
    // No comma-joined list
    expect(out).not.toContain("a, b, c");
    expect(out).toContain("3 added");
  });

  test("prints overwritten entries with overwritten marker and count", () => {
    const out = capture(() =>
      printImportResults({
        added: [],
        overwritten: ["x", "y"],
        skipped: [],
        dryRun: false,
        noun: "chain",
      }),
    );
    expect(out).toContain("x");
    expect(out).toContain("y");
    expect(out).toContain("(overwritten)");
    expect(out).toContain("2 overwritten");
  });

  test("prints skipped entries dimmed and counted", () => {
    const out = capture(() =>
      printImportResults({
        added: [],
        overwritten: [],
        skipped: ["s1", "s2"],
        dryRun: false,
        noun: "account",
      }),
    );
    expect(out).toContain("s1 (skipped)");
    expect(out).toContain("s2 (skipped)");
    expect(out).toContain("2 skipped");
  });

  test("summary combines multiple categories", () => {
    const out = capture(() =>
      printImportResults({
        added: ["a"],
        overwritten: ["b", "c"],
        skipped: ["d"],
        dryRun: false,
        noun: "chain",
      }),
    );
    expect(out).toContain("1 added, 2 overwritten, 1 skipped");
  });

  test("dry-run adds suffix to summary", () => {
    const out = capture(() =>
      printImportResults({
        added: ["a"],
        overwritten: [],
        skipped: [],
        dryRun: true,
        noun: "chain",
      }),
    );
    expect(out).toContain("1 added (dry run)");
  });

  test("no results prints 'No <noun>s imported' with dry-run prefix", () => {
    const out = capture(() =>
      printImportResults({
        added: [],
        overwritten: [],
        skipped: [],
        dryRun: true,
        noun: "chain",
      }),
    );
    expect(out).toContain("(dry run) No chains imported");
  });

  test("no results without dry-run still uses the noun", () => {
    const out = capture(() =>
      printImportResults({
        added: [],
        overwritten: [],
        skipped: [],
        dryRun: false,
        noun: "account",
      }),
    );
    expect(out).toContain("No accounts imported");
    expect(out).not.toContain("(dry run)");
  });
});

describe("writeStdout", () => {
  // Patches process.stdout.write to capture writes and control when the
  // callback fires, so we can prove writeStdout's promise waits for it.
  function patchManual(): {
    captured: string[];
    fireCallbacks: () => void;
    restore: () => void;
  } {
    const captured: string[] = [];
    const pendingCallbacks: Array<() => void> = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      captured.push(typeof chunk === "string" ? chunk : String(chunk));
      const cb = rest.find((a) => typeof a === "function") as ((err?: Error) => void) | undefined;
      if (cb) pendingCallbacks.push(cb);
      return true;
    }) as typeof process.stdout.write;
    return {
      captured,
      fireCallbacks: () => {
        for (const cb of pendingCallbacks.splice(0)) cb();
      },
      restore: () => {
        process.stdout.write = original;
      },
    };
  }

  test("does not resolve until the write callback fires", async () => {
    const { fireCallbacks, restore } = patchManual();
    let resolved = false;
    try {
      const promise = writeStdout("payload\n").then(() => {
        resolved = true;
      });
      // Yield once so any synchronous resolution would have set the flag.
      await Promise.resolve();
      expect(resolved).toBe(false);
      fireCallbacks();
      await promise;
      expect(resolved).toBe(true);
    } finally {
      restore();
    }
  });

  test("delivers the full text to process.stdout.write", async () => {
    const { captured, fireCallbacks, restore } = patchManual();
    try {
      // Build a payload large enough to cross the Linux pipe buffer (~64 KiB).
      const big = `${"x".repeat(70_000)}\n`;
      const promise = writeStdout(big);
      fireCallbacks();
      await promise;
      expect(captured.length).toBe(1);
      expect(captured[0]!.length).toBe(big.length);
      expect(captured[0]!.endsWith("\n")).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("formatPretty", () => {
  test("returns a string for a plain object", () => {
    const result = formatPretty({ a: 1 });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns 'undefined' for undefined input", () => {
    expect(formatPretty(undefined)).toBe("undefined");
  });

  test("preserves same data as formatJson", () => {
    const data = { name: "bob", count: 5 };
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape codes
    const stripped = formatPretty(data).replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toBe(formatJson(data));
  });
});
