import { rpcRequest } from "./rpc.ts";

/**
 * Chain properties as surfaced by `system_properties` / `chainSpec_v1_properties`.
 *
 * `tokenDecimals` and `tokenSymbol` are intentionally left wide: some chains
 * return scalars, others return arrays (multiple native-ish tokens). We preserve
 * whatever the node returns rather than silently picking the first element, so
 * `--json` faithfully reflects the chain's response shape. Missing fields are
 * normalized to `null` so the JSON schema is stable for `jq`.
 */
export interface ChainProperties {
  tokenDecimals: number | number[] | null;
  tokenSymbol: string | string[] | null;
  ss58Format: number | null;
}

/**
 * RPC methods that expose chain properties, in the order we try them.
 *
 * `system_properties` is the legacy method but is universally implemented by
 * Substrate nodes, so we try it first and fall back to the modern chainHead
 * `chainSpec_v1_properties` only if the node doesn't expose it. Both return the
 * same `{ tokenDecimals, tokenSymbol, ss58Format }` shape.
 */
export const PROPERTY_METHODS = ["system_properties", "chainSpec_v1_properties"] as const;

/**
 * Extract the three canonical property fields from a raw RPC response,
 * preserving scalar-vs-array shape and defaulting missing fields to `null`.
 * Handles empty `{}` responses gracefully (all nulls).
 */
export function normalizeProperties(raw: unknown): ChainProperties {
  const props = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    tokenDecimals: (props.tokenDecimals as number | number[] | undefined) ?? null,
    tokenSymbol: (props.tokenSymbol as string | string[] | undefined) ?? null,
    ss58Format: (props.ss58Format as number | undefined) ?? null,
  };
}

export type RpcRequestFn = <T>(
  rpcUrl: string | string[],
  method: string,
  params: unknown[],
) => Promise<T>;

/**
 * Fetch chain properties from a node, trying each method in {@link PROPERTY_METHODS}
 * in order and falling back to the next on failure. `source` reports which method
 * actually answered. Throws the last error if every method fails.
 *
 * `request` is injectable for testing; it defaults to the real one-shot RPC call.
 */
export async function fetchChainProperties(
  rpcUrl: string | string[],
  request: RpcRequestFn = rpcRequest,
): Promise<{ properties: ChainProperties; source: string }> {
  let lastError: unknown;
  for (const method of PROPERTY_METHODS) {
    try {
      const raw = await request<unknown>(rpcUrl, method, []);
      return { properties: normalizeProperties(raw), source: method };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch chain properties from the node.");
}
