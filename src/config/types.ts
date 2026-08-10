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

export const DEFAULT_CONFIG: Config = {
  chains: {
    polkadot: {
      rpc: [
        "wss://polkadot-rpc.n.dwellir.com",
        "wss://polkadot.gatotech.network",
        "wss://rpc-polkadot.luckyfriday.io",
        "wss://rpc-polkadot.helixstreet.io",
        "wss://rpc-polkadot.stakeworld.io",
        "wss://polkadot-rpc.publicnode.com",
        "wss://polkadot.api.onfinality.io/public-ws",
        "wss://rpc.interweb-it.com/polkadot",
        "wss://polkadot.rotko.net",
        // Parity's own endpoint stays the last-resort fallback so the default
        // path favours independent providers.
        "wss://rpc.polkadot.io",
      ],
    },
    "polkadot-asset-hub": {
      rpc: [
        "wss://polkadot-asset-hub-rpc.polkadot.io",
        "wss://asset-hub-polkadot-rpc.n.dwellir.com",
        "wss://asset-hub-polkadot.gatotech.network",
        "wss://rpc-asset-hub-polkadot.luckyfriday.io",
        "wss://rpc-asset-hub-polkadot.helixstreet.io",
        "wss://rpc-asset-hub-polkadot.stakeworld.io",
        "wss://statemint.api.onfinality.io/public-ws",
        "wss://asset-hub-polkadot.rotko.net",
        "wss://sys.turboflakes.io/asset-hub-polkadot",
      ],
      relay: "polkadot",
      parachainId: 1000,
    },
    "polkadot-bridge-hub": {
      rpc: [
        "wss://polkadot-bridge-hub-rpc.polkadot.io",
        "wss://bridge-hub-polkadot-rpc.n.dwellir.com",
        "wss://rpc-bridge-hub-polkadot.luckyfriday.io",
        "wss://rpc-bridge-hub-polkadot.stakeworld.io",
        "wss://bridgehub-polkadot.api.onfinality.io/public-ws",
        "wss://bridge-hub-polkadot.rotko.net",
      ],
      relay: "polkadot",
      parachainId: 1002,
    },
    "polkadot-bulletin": {
      rpc: [
        "wss://bulletin-rpc.polkadot.io",
        "wss://rpc-bulletin.luckyfriday.io",
        "wss://rpc.interweb-it.com/bulletin-polkadot",
      ],
      relay: "polkadot",
      parachainId: 1010,
    },
    "polkadot-collectives": {
      rpc: [
        "wss://polkadot-collectives-rpc.polkadot.io",
        "wss://collectives-polkadot-rpc.n.dwellir.com",
        "wss://rpc-collectives-polkadot.luckyfriday.io",
        "wss://rpc-collectives-polkadot.stakeworld.io",
        "wss://collectives.api.onfinality.io/public-ws",
        "wss://collectives-polkadot.rotko.net",
      ],
      relay: "polkadot",
      parachainId: 1001,
    },
    "polkadot-coretime": {
      rpc: [
        "wss://polkadot-coretime-rpc.polkadot.io",
        "wss://coretime-polkadot-rpc.n.dwellir.com",
        "wss://rpc-coretime-polkadot.luckyfriday.io",
        "wss://rpc-coretime-polkadot.stakeworld.io",
        "wss://coretime-polkadot.api.onfinality.io/public-ws",
        "wss://coretime-polkadot.rotko.net",
      ],
      relay: "polkadot",
      parachainId: 1005,
    },
    "polkadot-people": {
      rpc: [
        "wss://polkadot-people-rpc.polkadot.io",
        "wss://people-polkadot-rpc.n.dwellir.com",
        "wss://rpc-people-polkadot.luckyfriday.io",
        "wss://rpc-people-polkadot.helixstreet.io",
        "wss://rpc-people-polkadot.stakeworld.io",
        "wss://people-polkadot.api.onfinality.io/public-ws",
        "wss://people-polkadot.rotko.net",
        "wss://sys.turboflakes.io/people-polkadot",
      ],
      relay: "polkadot",
      parachainId: 1004,
    },
    paseo: {
      rpc: [
        "wss://paseo-rpc.n.dwellir.com",
        "wss://rpc-paseo.stakeworld.io",
        "wss://paseo-v2.rpc.turboflakes.io",
        "wss://rpc.interweb-it.com/paseo",
      ],
    },
    "paseo-asset-hub": {
      rpc: ["wss://asset-hub-paseo-rpc.n.dwellir.com", "wss://sys.turboflakes.io/asset-hub-paseo"],
      relay: "paseo",
      parachainId: 1000,
    },
    "paseo-bulletin": {
      // Parity does not currently serve a Paseo Bulletin endpoint
      // (paseo-bulletin-rpc.polkadot.io does not accept connections).
      rpc: [
        "wss://bullet.sik.rocks",
        "wss://bulletin-paseo.tservices.es:8443",
        "wss://bullet.tunastaking.eu",
      ],
      relay: "paseo",
      parachainId: 1010,
    },
    "paseo-people": {
      rpc: [
        "wss://people-paseo.gatotech.network",
        "wss://people-paseo.rotko.net",
        "wss://rpc.interweb-it.com/people-paseo",
      ],
      relay: "paseo",
      parachainId: 1004,
    },
  },
};

export const BUILTIN_CHAIN_NAMES = new Set(Object.keys(DEFAULT_CONFIG.chains));
