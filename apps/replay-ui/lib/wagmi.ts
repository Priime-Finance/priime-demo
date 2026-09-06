"use client";

/**
 * Wagmi config for the demo. Mirrors priime-pools' pattern (injected
 * connector, ssr on) but points at the local anvil fork instead of Base.
 *
 * The RPC URL is exposed to the browser on purpose: this is a demo running
 * on 127.0.0.1:8545. When we graduate to Base mainnet, proxy through
 * /api/rpc/[chainId] and reuse the pools chain config.
 */

import { defineChain, http } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337");

export const demoChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 31337 ? "Anvil (Base fork)" : `Chain ${String(CHAIN_ID)}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const wagmiConfig = createConfig({
  chains: [demoChain],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  connectors: [injected({ shimDisconnect: true })],
  transports: { [demoChain.id]: http(RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
