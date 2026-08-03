export interface ChainConfig {
  rpc: string | string[];
  relay?: string;
  parachainId?: number;
}

export interface Config {
  chains: Record<string, ChainConfig>;
}

/** Return the first (primary) RPC endpoint. */
export function primaryRpc(rpc: string | string[]): string {
  return Array.isArray(rpc) ? rpc[0]! : rpc;
}

/**
 * Resolve the RPC endpoint the CLI connects to for a chain: an explicit
 * `--rpc` override when given, otherwise the chain's primary configured
 * endpoint. Used for diagnostic display (e.g. the `inspect` header).
 */
export function connectedEndpoint(rpc: string | string[], rpcOverride?: string): string {
  return rpcOverride ?? primaryRpc(rpc);
}

export const DEFAULT_CONFIG: Config = {
  chains: {
    polkadot: {
      rpc: [
        "wss://polkadot.ibp.network",
        "wss://polkadot.dotters.network",
        "wss://polkadot-rpc.n.dwellir.com",
        "wss://polkadot-rpc.publicnode.com",
        "wss://rpc-polkadot.luckyfriday.io",
        "wss://polkadot.api.onfinality.io/public-ws",
        "wss://rpc-polkadot.helixstreet.io",
        "wss://polkadot-rpc-tn.dwellir.com",
        "wss://polkadot.public.curie.radiumblock.co/ws",
        "wss://rpc-polkadot.stakeworld.io",
        "wss://polkadot.rpc.subquery.network/public/ws",
        "wss://rpc.polkadot.io",
      ],
    },
    "polkadot-asset-hub": {
      rpc: [
        "wss://polkadot-asset-hub-rpc.polkadot.io",
        "wss://asset-hub-polkadot.ibp.network",
        "wss://asset-hub-polkadot.dotters.network",
        "wss://asset-hub-polkadot-rpc.n.dwellir.com",
        "wss://rpc-asset-hub-polkadot.luckyfriday.io",
        "wss://statemint.api.onfinality.io/public-ws",
        "wss://statemint-rpc-tn.dwellir.com",
        "wss://statemint.public.curie.radiumblock.co/ws",
        "wss://asset-hub-polkadot.rpc.permanence.io",
      ],
      relay: "polkadot",
      parachainId: 1000,
    },
    "polkadot-bridge-hub": {
      rpc: [
        "wss://polkadot-bridge-hub-rpc.polkadot.io",
        "wss://bridge-hub-polkadot.ibp.network",
        "wss://bridge-hub-polkadot.dotters.network",
        "wss://bridge-hub-polkadot-rpc.n.dwellir.com",
        "wss://rpc-bridge-hub-polkadot.luckyfriday.io",
        "wss://bridgehub-polkadot.api.onfinality.io/public-ws",
        "wss://polkadot-bridge-hub-rpc-tn.dwellir.com",
        "wss://bridgehub-polkadot.public.curie.radiumblock.co/ws",
      ],
      relay: "polkadot",
      parachainId: 1002,
    },
    "polkadot-collectives": {
      rpc: [
        "wss://polkadot-collectives-rpc.polkadot.io",
        "wss://collectives-polkadot.ibp.network",
        "wss://collectives-polkadot.dotters.network",
        "wss://collectives-polkadot-rpc.n.dwellir.com",
        "wss://rpc-collectives-polkadot.luckyfriday.io",
        "wss://collectives.api.onfinality.io/public-ws",
        "wss://polkadot-collectives-rpc-tn.dwellir.com",
        "wss://collectives.public.curie.radiumblock.co/ws",
      ],
      relay: "polkadot",
      parachainId: 1001,
    },
    "polkadot-coretime": {
      rpc: [
        "wss://polkadot-coretime-rpc.polkadot.io",
        "wss://coretime-polkadot.ibp.network",
        "wss://coretime-polkadot.dotters.network",
        "wss://coretime-polkadot-rpc.n.dwellir.com",
        "wss://rpc-coretime-polkadot.luckyfriday.io",
        "wss://coretime-polkadot.api.onfinality.io/public-ws",
      ],
      relay: "polkadot",
      parachainId: 1005,
    },
    "polkadot-people": {
      rpc: [
        "wss://polkadot-people-rpc.polkadot.io",
        "wss://people-polkadot.ibp.network",
        "wss://people-polkadot.dotters.network",
        "wss://people-polkadot-rpc.n.dwellir.com",
        "wss://rpc-people-polkadot.luckyfriday.io",
        "wss://people-polkadot.api.onfinality.io/public-ws",
      ],
      relay: "polkadot",
      parachainId: 1004,
    },
    paseo: {
      rpc: [
        "wss://paseo.ibp.network",
        "wss://paseo.dotters.network",
        "wss://paseo-rpc.n.dwellir.com",
        "wss://paseo.rpc.amforc.com",
      ],
    },
    "paseo-asset-hub": {
      rpc: [
        "wss://asset-hub-paseo.ibp.network",
        "wss://asset-hub-paseo.dotters.network",
        "wss://asset-hub-paseo-rpc.n.dwellir.com",
        "wss://sys.turboflakes.io/asset-hub-paseo",
      ],
      relay: "paseo",
      parachainId: 1000,
    },
    "paseo-bridge-hub": {
      rpc: ["wss://bridge-hub-paseo.ibp.network", "wss://bridge-hub-paseo.dotters.network"],
      relay: "paseo",
      parachainId: 1002,
    },
    "paseo-collectives": {
      rpc: ["wss://collectives-paseo.ibp.network", "wss://collectives-paseo.dotters.network"],
      relay: "paseo",
      parachainId: 1001,
    },
    "paseo-coretime": {
      rpc: ["wss://coretime-paseo.ibp.network", "wss://coretime-paseo.dotters.network"],
      relay: "paseo",
      parachainId: 1005,
    },
    "paseo-people": {
      rpc: [
        "wss://people-paseo.ibp.network",
        "wss://people-paseo.dotters.network",
        "wss://people-paseo.rpc.amforc.com",
      ],
      relay: "paseo",
      parachainId: 1004,
    },
  },
};

export const BUILTIN_CHAIN_NAMES = new Set(Object.keys(DEFAULT_CONFIG.chains));
