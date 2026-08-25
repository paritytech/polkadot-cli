import { access, readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { CliError } from "../utils/errors.ts";

const CATEGORIES = ["tx", "query", "const", "apis"] as const;
type Category = (typeof CATEGORIES)[number];

export interface ParsedFileCommand {
  chain?: string;
  category: Category;
  pallet: string;
  item: string;
  args: unknown; // object | array | scalar | undefined
  general?: boolean;
}

/** File extensions recognized as command files */
const FILE_EXTENSIONS = [".json", ".yaml", ".yml"];

/**
 * Check if a dotpath argument looks like a file path rather than a dot-path command.
 *
 * A dotpath is treated as a file if:
 * - It ends with .json, .yaml, or .yml
 * - It starts with ./ or / (absolute or relative path)
 */
export function isFilePath(dotpath: string): boolean {
  if (FILE_EXTENSIONS.some((ext) => dotpath.endsWith(ext))) return true;
  if (dotpath.startsWith("./") || dotpath.startsWith("/")) return true;
  return false;
}

/**
 * Parse --var KEY=VALUE flags into a map.
 *
 * Accepts a single string or an array of strings (CAC may pass either depending
 * on how the flag is defined).
 */
export function parseVarFlags(varFlags: string | string[] | undefined): Record<string, string> {
  if (!varFlags) return {};
  const flags = Array.isArray(varFlags) ? varFlags : [varFlags];
  const vars: Record<string, string> = {};
  for (const flag of flags) {
    const eqIdx = flag.indexOf("=");
    if (eqIdx === -1) {
      throw new CliError(`Invalid --var format "${flag}". Expected KEY=VALUE.`);
    }
    const key = flag.slice(0, eqIdx);
    const value = flag.slice(eqIdx + 1);
    if (!key) {
      throw new CliError(`Invalid --var format "${flag}". Key cannot be empty.`);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Substitute ${VAR} and ${VAR:-default} placeholders in a string.
 *
 * Resolution order for each variable:
 * 1. `vars` map (--var flags merged with file's vars: section)
 * 2. Environment variables (process.env)
 *
 * Throws if a variable is referenced but has no value and no default.
 */
export function substituteVars(text: string, vars: Record<string, string>): string {
  // Match ${VAR} and ${VAR:-default}
  return text.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const defaultSep = expr.indexOf(":-");
    let varName: string;
    let defaultValue: string | undefined;

    if (defaultSep !== -1) {
      varName = expr.slice(0, defaultSep);
      defaultValue = expr.slice(defaultSep + 2);
    } else {
      varName = expr;
    }

    // Resolution: vars map > env > default
    if (varName in vars) return vars[varName]!;
    const envVal = process.env[varName];
    if (envVal !== undefined) return envVal;
    if (defaultValue !== undefined) return defaultValue;

    throw new CliError(
      `Undefined variable "\${${varName}}" in file.\n\n` +
        `  Provide it using one of:\n` +
        `    --var ${varName}=VALUE\n` +
        `    ${varName}=VALUE dot ...    (environment variable)\n` +
        `    \${${varName}:-default}     (inline default in file)`,
    );
  });
}

/**
 * Quote bare hex values in YAML text so they are preserved as strings.
 *
 * YAML's core schema interprets `0x…` as hex integers, which silently drops
 * leading zeros (e.g. `0x000010deadbeef` → `72455405295`). For encoded call
 * data every byte matters, so we wrap unquoted hex values in double quotes.
 */
export function quoteYamlHexValues(text: string): string {
  return text.replace(/^(\s*(?:[^:]+:\s+|-\s+))(0x[0-9a-fA-F]+)\s*$/gm, '$1"$2"');
}

/**
 * Load a JSON or YAML command file and parse it into a structured command.
 *
 * @param filePath - Path to the .json, .yaml, or .yml file
 * @param cliVars - Variables from --var flags (highest priority)
 */
export async function loadCommandFile(
  filePath: string,
  cliVars: Record<string, string>,
): Promise<ParsedFileCommand> {
  // Read file
  try {
    await access(filePath);
  } catch {
    throw new CliError(`File not found: ${filePath}`);
  }

  const rawText = await readFile(filePath, "utf-8");
  if (!rawText.trim()) {
    throw new CliError(`File is empty: ${filePath}`);
  }

  // Determine format
  const isJson = filePath.endsWith(".json");

  // First pass: extract vars section defaults (parse before substitution to get defaults)
  const fileVars: Record<string, string> = {};
  try {
    const preParsed = isJson ? JSON.parse(rawText) : parseYaml(rawText);
    if (preParsed && typeof preParsed === "object" && !Array.isArray(preParsed) && preParsed.vars) {
      const varsSection = preParsed.vars;
      if (typeof varsSection === "object" && !Array.isArray(varsSection)) {
        for (const [key, val] of Object.entries(varsSection)) {
          fileVars[key] = String(val);
        }
      }
    }
  } catch {
    // If pre-parsing fails (e.g. because of unresolved vars in YAML structure),
    // we'll catch the real error after substitution
  }

  // Merge variables: --var flags > env (handled in substituteVars) > file vars
  const mergedVars = { ...fileVars, ...cliVars };

  // Substitute variables
  const substituted = substituteVars(rawText, mergedVars);

  // For YAML: quote bare hex values so they stay as strings instead of being
  // parsed as integers (YAML core schema interprets 0x... as hex numbers,
  // which loses leading zeros that are significant for encoded call data).
  const textToParse = isJson ? substituted : quoteYamlHexValues(substituted);

  // Parse
  let parsed: unknown;
  try {
    parsed = isJson ? JSON.parse(textToParse) : parseYaml(textToParse);
  } catch (err) {
    const format = isJson ? "JSON" : "YAML";
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(`Failed to parse ${format} file "${filePath}": ${msg}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(
      `File "${filePath}" must contain a YAML/JSON object (not an array or scalar).`,
    );
  }

  const doc = parsed as Record<string, unknown>;

  // Extract metadata
  const chain = doc.chain != null ? String(doc.chain) : undefined;
  if (doc.unsigned === true) {
    console.error(
      `Warning: "unsigned: true" in "${filePath}" is deprecated; use "general: true" instead.`,
    );
  }
  const general = doc.general === true || doc.unsigned === true ? true : undefined;

  // Find the category key
  const foundCategories = CATEGORIES.filter((c) => c in doc);
  if (foundCategories.length === 0) {
    throw new CliError(
      `File "${filePath}" must contain exactly one category key: ${CATEGORIES.join(", ")}. None found.`,
    );
  }
  if (foundCategories.length > 1) {
    throw new CliError(
      `File "${filePath}" contains multiple category keys: ${foundCategories.join(", ")}. Only one is allowed.`,
    );
  }

  const category = foundCategories[0]!;
  const categoryObj = doc[category];

  if (!categoryObj || typeof categoryObj !== "object" || Array.isArray(categoryObj)) {
    throw new CliError(
      `"${category}" in file "${filePath}" must be an object with a pallet name as key.`,
    );
  }

  // Extract pallet
  const palletEntries = Object.entries(categoryObj as Record<string, unknown>);
  if (palletEntries.length !== 1) {
    throw new CliError(
      `"${category}" in file "${filePath}" must contain exactly one pallet. Found: ${
        palletEntries.length === 0 ? "none" : palletEntries.map(([k]) => k).join(", ")
      }.`,
    );
  }

  const [pallet, palletObj] = palletEntries[0]!;

  if (!palletObj || typeof palletObj !== "object" || Array.isArray(palletObj)) {
    throw new CliError(
      `"${category}.${pallet}" in file "${filePath}" must be an object with a call/item name as key.`,
    );
  }

  // Extract item (call name, storage item, constant name, api method)
  const itemEntries = Object.entries(palletObj as Record<string, unknown>);
  if (itemEntries.length !== 1) {
    throw new CliError(
      `"${category}.${pallet}" in file "${filePath}" must contain exactly one item. Found: ${
        itemEntries.length === 0 ? "none" : itemEntries.map(([k]) => k).join(", ")
      }.`,
    );
  }

  const [item, args] = itemEntries[0]!;

  return {
    chain,
    category,
    pallet,
    item,
    args: args ?? undefined,
    general,
  };
}
