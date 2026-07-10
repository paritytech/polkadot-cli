export type DotCategory =
  | "query"
  | "tx"
  | "const"
  | "events"
  | "errors"
  | "apis"
  | "extensions"
  | "rpc";

export interface ParsedDotPath {
  chain?: string;
  category: DotCategory;
  pallet?: string;
  item?: string;
}

const CATEGORY_ALIASES: Record<string, DotCategory> = {
  query: "query",
  tx: "tx",
  const: "const",
  consts: "const",
  constants: "const",
  events: "events",
  event: "events",
  errors: "errors",
  error: "errors",
  apis: "apis",
  api: "apis",
  extensions: "extensions",
  extension: "extensions",
  ext: "extensions",
  rpc: "rpc",
};

/**
 * Match a segment against the known category aliases (`tx`, `query`, `const`,
 * `events`, `errors`, `apis`, `extensions`, `rpc`, …). Case-insensitive.
 * Returns the canonical category, or `undefined` if the segment is not a kind.
 */
export function matchCategory(segment: string): DotCategory | undefined {
  return CATEGORY_ALIASES[segment.toLowerCase()];
}

function matchChain(segment: string, knownChains: string[]): boolean {
  return knownChains.some((c) => c.toLowerCase() === segment.toLowerCase());
}

/**
 * Parse a dot-path string into its components.
 *
 * Format: [Chain.]category[.Pallet[.Item]]
 *
 * Category match takes priority over chain match for the first segment.
 * Chain matching is case-insensitive against configured chains.
 */
export function parseDotPath(input: string, knownChains: string[] = []): ParsedDotPath {
  const parts = input.split(".");

  switch (parts.length) {
    case 1: {
      // Must be a category: "query", "tx", etc.
      const cat = matchCategory(parts[0]!);
      if (cat) return { category: cat };
      throw new Error(
        `Unknown command "${parts[0]}". Expected a category (query, tx, const, events, errors, apis, extensions, rpc) or a named command.`,
      );
    }

    case 2: {
      // category.Pallet  OR  Chain.category
      const cat = matchCategory(parts[0]!);
      if (cat) {
        return { category: cat, pallet: parts[1]! };
      }
      // Try Chain.category
      const cat2 = matchCategory(parts[1]!);
      if (cat2 && matchChain(parts[0]!, knownChains)) {
        return { chain: parts[0]!, category: cat2 };
      }
      throw new Error(
        `Unknown command "${input}". Expected format: category.Pallet or Chain.category (e.g. query.System or polkadot.query)`,
      );
    }

    case 3: {
      // category.Pallet.Item  OR  Chain.category.Pallet
      const cat = matchCategory(parts[0]!);
      if (cat) {
        return { category: cat, pallet: parts[1]!, item: parts[2]! };
      }
      // Try Chain.category.Pallet
      const cat2 = matchCategory(parts[1]!);
      if (cat2 && matchChain(parts[0]!, knownChains)) {
        return { chain: parts[0]!, category: cat2, pallet: parts[2]! };
      }
      throw new Error(
        `Unknown command "${input}". Expected format: category.Pallet.Item or Chain.category.Pallet`,
      );
    }

    case 4: {
      // Chain.category.Pallet.Item
      const cat = matchCategory(parts[1]!);
      if (cat && matchChain(parts[0]!, knownChains)) {
        return { chain: parts[0]!, category: cat, pallet: parts[2]!, item: parts[3]! };
      }
      throw new Error(
        `Unknown command "${input}". Expected format: Chain.category.Pallet.Item (e.g. polkadot.query.System.Account)`,
      );
    }

    default:
      throw new Error(
        `Unknown command "${input}". Too many segments. Expected format: [Chain.]category[.Pallet[.Item]]`,
      );
  }
}
