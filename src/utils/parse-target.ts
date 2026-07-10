export interface Target {
  chain?: string;
  pallet: string;
  item?: string;
}

import { matchCategory } from "./parse-dot-path.ts";

export interface ParseTargetOptions {
  knownChains?: string[];
  allowPalletOnly?: boolean;
}

/**
 * Strip an optional "kind" segment (`tx`/`query`/`const`/`events`/`errors`/…)
 * from a dot-path so `inspect` can tolerate the same paths used to invoke a
 * call. The kind is only meaningful right after an optional chain prefix
 * (position 0 for `kind.Pallet…`, position 1 for `Chain.kind.Pallet…`), and is
 * dropped because inspection describes a pallet/item regardless of call kind.
 *
 * Returns the remaining segments. A kind in any other position is left in place
 * so genuinely-malformed input (e.g. `System.tx.Account`) still errors.
 */
function stripKindSegment(parts: string[], knownChains: string[]): string[] {
  // Chain.kind.… → drop index 1 when index 0 is a known chain and index 1 a kind.
  if (
    parts.length >= 3 &&
    parts[0] &&
    knownChains.some((c) => c.toLowerCase() === parts[0]!.toLowerCase()) &&
    parts[1] &&
    matchCategory(parts[1]!)
  ) {
    return [parts[0]!, ...parts.slice(2)];
  }
  // kind.… → drop the leading kind (only when something follows it).
  if (parts.length >= 2 && parts[0] && matchCategory(parts[0]!)) {
    return parts.slice(1);
  }
  return parts;
}

export function parseTarget(input: string, options?: ParseTargetOptions): Target {
  let parts = input.split(".");

  if (options?.allowPalletOnly) {
    // Be generous: tolerate a `kind` segment (e.g. `polkadot.tx.System.remark`)
    // so the same dot-path that invokes a call also inspects it.
    parts = stripKindSegment(parts, options.knownChains ?? []);

    switch (parts.length) {
      case 1:
        if (!parts[0]) {
          throw new Error(
            `Invalid target "${input}". Expected format: Pallet or Pallet.Item (e.g. System or System.Account)`,
          );
        }
        return { pallet: parts[0] };

      case 2:
        if (!parts[0] || !parts[1]) {
          throw new Error(
            `Invalid target "${input}". Expected format: Pallet.Item or Chain.Pallet (e.g. System.Account or kusama.System)`,
          );
        }
        // Disambiguate: if first segment matches a known chain, treat as Chain.Pallet
        if (options.knownChains?.some((c) => c.toLowerCase() === parts[0]!.toLowerCase())) {
          return { chain: parts[0], pallet: parts[1] };
        }
        return { pallet: parts[0], item: parts[1] };

      case 3:
        if (!parts[0] || !parts[1] || !parts[2]) {
          throw new Error(
            `Invalid target "${input}". Expected format: Chain.Pallet.Item (e.g. kusama.System.Account)`,
          );
        }
        return { chain: parts[0], pallet: parts[1], item: parts[2] };

      default:
        throw new Error(
          `Invalid target "${input}". Expected format: Pallet, Pallet.Item, Chain.Pallet.Item, ` +
            `or a dot-path with a kind segment (e.g. polkadot.tx.System.remark)`,
        );
    }
  }

  // Default: item is required (for tx, query, const)
  switch (parts.length) {
    case 2:
      if (!parts[0] || !parts[1]) {
        throw new Error(
          `Invalid target "${input}". Expected format: Pallet.Item (e.g. System.Account)`,
        );
      }
      return { pallet: parts[0], item: parts[1] };

    case 3:
      if (!parts[0] || !parts[1] || !parts[2]) {
        throw new Error(
          `Invalid target "${input}". Expected format: Chain.Pallet.Item (e.g. kusama.System.Account)`,
        );
      }
      return { chain: parts[0], pallet: parts[1], item: parts[2] };

    default:
      throw new Error(
        `Invalid target "${input}". Expected format: Pallet.Item (e.g. System.Account)`,
      );
  }
}

/**
 * Resolve the effective chain from a parsed target and optional --chain flag.
 * Errors if both are specified.
 */
export function resolveTargetChain(target: Target, chainFlag?: string): string | undefined {
  if (target.chain && chainFlag) {
    throw new Error(
      `Chain specified both as prefix ("${target.chain}") and as --chain flag ("${chainFlag}"). Use one or the other.`,
    );
  }
  return target.chain ?? chainFlag;
}
