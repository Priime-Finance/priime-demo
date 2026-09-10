"use client";

/**
 * Wagmi config for the demo.
 *
 * Two moving parts vs the trivial config:
 *  1. `demoChain.contracts.multicall3` — the canonical Base deployment at
 *     `0xcA11bde05977b3631167028862bE2a173976CA11`. Without it,
 *     `useReadContracts` degrades to one `eth_call` HTTP request per read;
 *     the DepositCard's 13-read poll on a 12-second cadence turns into ~65
 *     rps against the public RPC per open tab. With multicall3 registered,
 *     wagmi's batcher folds every read into a single `multicall(...)` call.
 *  2. Transport routes through `/api/rpc/[chainId]`, a same-origin Next.js
 *     API-route proxy (`app/api/rpc/[chainId]/route.ts`) that forwards the
 *     JSON-RPC body to the server-only `PRIIME_RPC_URL` (Alchemy keyed).
 *     The URL and its key never enter the browser bundle. Rate-limiting +
 *     method allow-list live on the proxy.
 *
 * SSR note: `ssr: true` hands off to the browser after hydration; the
 * transport is called only from client hooks, so the relative `/api/rpc/…`
 * URL is fine — fetch resolves it against `window.location.origin`.
 */

import { defineChain, http } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337");

/**
 * Base mainnet's canonical Multicall3 deployment (same address across every
 * EVM chain the multicall3 team supported). The local anvil-fork ports run
 * the same bytecode at the same address because the fork inherits it.
 */
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/**
 * Block Multicall3 was deployed on Base. Zero on the fork (anvil rewrites
 * history to the fork block). Kept explicit so wagmi's batcher doesn't
 * probe with an inflated `blockCreated`.
 */
const MULTICALL3_BLOCK: Record<number, number> = { 8453: 5_022, 31337: 0 };

export const demoChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 31337 ? "Anvil (Base fork)" : `Chain ${String(CHAIN_ID)}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [`/api/rpc/${String(CHAIN_ID)}`] } },
  contracts: {
    multicall3: {
      address: MULTICALL3_ADDRESS,
      blockCreated: MULTICALL3_BLOCK[CHAIN_ID] ?? 0,
    },
  },
});

export const wagmiConfig = createConfig({
  chains: [demoChain],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [demoChain.id]: http(`/api/rpc/${String(CHAIN_ID)}`, {
      // Wagmi batches reads through multicall3 above; the batcher below
      // groups OTHER JSON-RPC methods (getBlockNumber, getGasPrice, etc.)
      // into a single HTTP request when the tick window overlaps.
      batch: true,
    }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
