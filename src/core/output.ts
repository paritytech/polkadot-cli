import { binaryToDisplay } from "../utils/binary-display.ts";

const isTTY = process.stdout.isTTY ?? false;

const RESET = isTTY ? "\x1b[0m" : "";
const CYAN = isTTY ? "\x1b[36m" : "";
const GREEN = isTTY ? "\x1b[32m" : "";
const RED = isTTY ? "\x1b[31m" : "";
const YELLOW = isTTY ? "\x1b[33m" : "";
const MAGENTA = isTTY ? "\x1b[35m" : "";
const DIM = isTTY ? "\x1b[2m" : "";
const BOLD = isTTY ? "\x1b[1m" : "";

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return binaryToDisplay(value);
  return value;
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, replacer, 2);
}

export function formatPretty(data: unknown): string {
  const json = JSON.stringify(data, replacer, 2);
  if (!json) return "undefined";
  return colorizeJson(json);
}

function colorizeJson(json: string): string {
  return json
    .replace(/("(?:\\.|[^"\\])*")\s*:/g, `${CYAN}$1${RESET}:`)
    .replace(/:\s*("(?:\\.|[^"\\])*")/g, (match, str) =>
      match.replace(str, `${GREEN}${str}${RESET}`),
    )
    .replace(/:\s*(\d+(?:\.\d+)?)/g, (match, num) => match.replace(num, `${YELLOW}${num}${RESET}`))
    .replace(/:\s*(true|false)/g, (match, bool) => match.replace(bool, `${MAGENTA}${bool}${RESET}`))
    .replace(/:\s*(null)/g, (match, n) => match.replace(n, `${DIM}${n}${RESET}`));
}

export function printResult(data: unknown, format: string = "pretty"): void {
  if (format === "json") {
    console.log(formatJson(data));
  } else {
    console.log(formatPretty(data));
  }
}

export function isJsonOutput(opts: { json?: boolean; output?: string }): boolean {
  return opts.json === true || opts.output === "json";
}

// Awaitable write to process.stdout — multi-MB output via console.log gets
// truncated when piped on Linux because process.exit() doesn't wait for the
// stream's userspace buffer to drain. The write-callback form fires after
// the chunk has been handed to the OS, so awaiting it before the command
// returns ensures the full payload reaches the reader. Use this for any
// command whose output can plausibly exceed ~64 KiB (the Linux pipe buffer);
// short interactive output via console.log is fine.
export function writeStdout(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    process.stdout.write(text, () => resolve());
  });
}

export function printJsonLine(data: unknown): void {
  console.log(JSON.stringify(data, replacer));
}

export function printHeading(text: string): void {
  console.log(`\n${BOLD}${text}${RESET}\n`);
}

/**
 * Heading variant that appends the connected RPC endpoint in dimmed brackets,
 * e.g. `Pallets on polkadot (67)  [wss://rpc.polkadot.io]`. Provides diagnostic
 * value for `inspect`-style commands so it's clear where metadata came from.
 */
export function printHeadingWithEndpoint(text: string, endpoint: string): void {
  console.log(`\n${BOLD}${text}${RESET}  ${DIM}[${endpoint}]${RESET}\n`);
}

export function printItem(name: string, description?: string): void {
  if (description) {
    console.log(`  ${CYAN}${name}${RESET}  ${DIM}${description}${RESET}`);
  } else {
    console.log(`  ${CYAN}${name}${RESET}`);
  }
}

export function printDocs(docs: string[]): void {
  const text = docs.join("\n").trim();
  if (text) {
    console.log(`  ${DIM}${text}${RESET}`);
  }
}

const CHECK_MARK = "✓";

export function printImportResults(params: {
  added: string[];
  overwritten: string[];
  skipped: string[];
  dryRun: boolean;
  noun: string;
}): void {
  const { added, overwritten, skipped, dryRun, noun } = params;

  for (const name of added) {
    console.log(`  ${GREEN}${CHECK_MARK}${RESET} ${name}`);
  }
  for (const name of overwritten) {
    console.log(`  ${YELLOW}⟳${RESET} ${name}${DIM} (overwritten)${RESET}`);
  }
  for (const name of skipped) {
    console.log(`  ${DIM}- ${name} (skipped)${RESET}`);
  }

  if (added.length === 0 && overwritten.length === 0 && skipped.length === 0) {
    const prefix = dryRun ? "(dry run) " : "";
    console.log(`${prefix}No ${noun}s imported.`);
    return;
  }

  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.length} added`);
  if (overwritten.length > 0) parts.push(`${overwritten.length} overwritten`);
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
  const suffix = dryRun ? " (dry run)" : "";
  console.log();
  console.log(`${parts.join(", ")}${suffix}`);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;

  start(msg: string): void {
    this.stop();
    if (!isTTY) {
      console.error(msg);
      return;
    }
    process.stdout.write(`${SPINNER_FRAMES[0]} ${msg}`);
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      process.stdout.write(`\r\x1b[K${SPINNER_FRAMES[this.frame]} ${msg}`);
    }, 80);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.frame = 0;
      if (isTTY) process.stdout.write("\r\x1b[K");
    }
  }

  succeed(msg: string): void {
    this.stop();
    console.error(`${GREEN}${CHECK_MARK}${RESET} ${msg}`);
  }
}

export function firstSentence(docs: string[]): string {
  const text = docs.join(" ").trim();
  if (!text) return "";
  // Match sentence-ending punctuation, but skip common abbreviations like e.g. and i.e.
  const match = text.match(/^.*?(?<![ei]\.g|[ei]\.[eg])(?<!\betc)[.!?](?:\s|$)/);
  return match ? match[0].trim() : text;
}

export { BOLD, CHECK_MARK, CYAN, DIM, GREEN, isTTY, MAGENTA, RED, RESET, Spinner, YELLOW };
