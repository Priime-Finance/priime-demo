"use client";

/**
 * ERC-7540 deposit flow against a `PriimeVault` handler.
 *
 * Two on-chain calls per new deposit — the seam every audience walks:
 *
 *   1. `USDC.approve(handler, assets)` — one-off unless the user has topped
 *      the allowance already; skipped by the UI when `allowance >= amount`.
 *   2. `handler.requestDeposit(assets, controller, owner)` — escrows the
 *      USDC into the vault's `totalPendingDepositAssets` bucket. The
 *      escrow is NOT part of NAV; the operator quorum can only fold it in
 *      once it settles the next strike.
 *
 * When the strike lands, `handleSignedEnvelope` runs `_fulfillDeposits` in
 * the same tx: escrow drains, per-controller `claimableDepositRequest`
 * fills, and the ERC-7540 view helpers (`maxMint`, `maxDeposit`) start
 * returning nonzero. A third user tx — `handler.deposit(assets, receiver)`
 * — mints the shares.
 *
 * All three calls use the CONNECTED wallet as `controller`, `owner` and
 * `receiver`. The demo's audience deposits for themselves; a controller
 * distinct from the owner would need an operator approval this UI never
 * sends.
 *
 * This module owns the minimal ABI fragments and the composed
 * `useDepositState` hook the deposit card renders off. Contract addresses
 * come from the loop record (handler) and the `asset()` view on the vault
 * itself, not from client-side config, so a market swap on the loop-server
 * side propagates without any UI change.
 */

import { useMemo } from "react";
import type { Abi, Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

/** Minimal ERC-20 ABI: what the deposit flow reads and writes. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const satisfies Abi;

/** Minimal PriimeVault ABI: ERC-7540 deposit flow + ERC-4626 view. */
export const VAULT_ABI = [
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "pendingDepositRequest",
    stateMutability: "view",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "controller", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableDepositRequest",
    stateMutability: "view",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "controller", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxMint",
    stateMutability: "view",
    inputs: [{ name: "controller", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "requestDeposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "controller", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const satisfies Abi;

/**
 * The ERC-7540 request id for a controller's aggregated bucket. The vault
 * uses `0` for every request; documented here so it does not float as a
 * naked literal at call sites.
 */
export const REQUEST_ID = 0n;

export interface DepositReading {
  /** Address of the underlying asset (`USDC` on today's markets). */
  asset: Address | null;
  /** ERC-20 decimals of the underlying asset. `null` until the read lands. */
  assetDecimals: number | null;
  /** ERC-20 symbol of the underlying asset. `null` until the read lands. */
  assetSymbol: string | null;
  /** Connected wallet's underlying-asset balance (base units). */
  walletAssets: bigint | null;
  /** Connected wallet's current allowance to the vault (base units). */
  walletAllowance: bigint | null;
  /** Escrowed pending deposit for the connected wallet (base units). */
  pendingAssets: bigint;
  /** Claimable deposit for the connected wallet, in asset terms (base units). */
  claimableAssets: bigint;
  /** Claimable share count for the connected wallet. */
  claimableShares: bigint;
  /** Connected wallet's minted share balance. */
  walletShares: bigint;
  /** Vault's NAV (total assets attested by the operator quorum). */
  navAssets: bigint;
  /** Vault's outstanding share supply. */
  shareSupply: bigint;
  /** True while any of the reads above is still loading. */
  loading: boolean;
  /** Refetch every read on demand; wagmi handles caching + dedupe. */
  refetch: () => void;
}

/**
 * Compose the reads the deposit card needs. Two round-trips: one for the
 * vault's underlying-asset address, then a batched read of the rest.
 *
 * All reads gate on `enabled` so we do not thrash the RPC before the
 * connected address is known.
 */
export function useDepositReading(handlerAddress: Address | null): DepositReading {
  const { address: user } = useAccount();

  // Step 1: vault.asset() — the underlying USDC address. Never changes.
  const assetRead = useReadContract({
    address: handlerAddress ?? undefined,
    abi: VAULT_ABI,
    functionName: "asset",
    query: { enabled: handlerAddress !== null },
  });
  const asset = assetRead.data ?? null;

  // Step 2: everything else. Batched via useReadContracts so wagmi issues
  // one multicall when the chain supports it and a fan-out otherwise.
  const enabled = handlerAddress !== null && asset !== null && user !== undefined;
  const contracts = useMemo(() => {
    if (!enabled) return undefined;
    return [
      { address: asset, abi: ERC20_ABI, functionName: "decimals" },
      { address: asset, abi: ERC20_ABI, functionName: "symbol" },
      { address: asset, abi: ERC20_ABI, functionName: "balanceOf", args: [user] },
      { address: asset, abi: ERC20_ABI, functionName: "allowance", args: [user, handlerAddress] },
      { address: handlerAddress, abi: VAULT_ABI, functionName: "pendingDepositRequest", args: [REQUEST_ID, user] },
      { address: handlerAddress, abi: VAULT_ABI, functionName: "claimableDepositRequest", args: [REQUEST_ID, user] },
      { address: handlerAddress, abi: VAULT_ABI, functionName: "maxMint", args: [user] },
      { address: handlerAddress, abi: VAULT_ABI, functionName: "balanceOf", args: [user] },
      { address: handlerAddress, abi: VAULT_ABI, functionName: "totalAssets" },
      { address: handlerAddress, abi: VAULT_ABI, functionName: "totalSupply" },
    ] as const;
  }, [asset, handlerAddress, enabled, user]);

  const batch = useReadContracts({
    contracts,
    // Poll every 12s so a strike's fulfillment surfaces without a page
    // refresh. Same cadence LiveLoopDetail uses for its journal reads.
    query: { enabled, refetchInterval: 12_000 },
  });

  const r = batch.data;
  // Positional decode: each `r[i]` is either success with a typed `result`
  // or a failure we surface as `null`. Kept as inline expressions rather
  // than a helper so the shape at each slot stays legible next to its
  // ABI position in the `contracts` array above.
  return {
    asset,
    assetDecimals: r?.[0]?.status === "success" ? r[0].result : null,
    assetSymbol:   r?.[1]?.status === "success" ? r[1].result : null,
    walletAssets:  r?.[2]?.status === "success" ? r[2].result : null,
    walletAllowance: r?.[3]?.status === "success" ? r[3].result : null,
    pendingAssets:   r?.[4]?.status === "success" ? r[4].result : 0n,
    claimableAssets: r?.[5]?.status === "success" ? r[5].result : 0n,
    claimableShares: r?.[6]?.status === "success" ? r[6].result : 0n,
    walletShares:    r?.[7]?.status === "success" ? r[7].result : 0n,
    navAssets:       r?.[8]?.status === "success" ? r[8].result : 0n,
    shareSupply:     r?.[9]?.status === "success" ? r[9].result : 0n,
    loading: assetRead.isLoading || batch.isLoading,
    refetch: () => {
      void assetRead.refetch();
      void batch.refetch();
    },
  };
}

/**
 * Parse a human decimal string into a bigint in `decimals` base units.
 *
 * Returns `null` on empty, malformed, or exceeds-precision input. Accepts a
 * leading period and rejects negative values so a `-` in the raw input is
 * refused rather than silently truncated.
 */
export function parseAssetAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed === ".") return null;
  if (!/^\d*(\.\d*)?$/.test(trimmed)) return null;
  const [whole, fractional = ""] = trimmed.split(".");
  if (fractional.length > decimals) return null;
  const padded = fractional.padEnd(decimals, "0");
  try {
    return BigInt(whole === "" ? "0" : whole) * 10n ** BigInt(decimals) + BigInt(padded === "" ? "0" : padded);
  } catch {
    return null;
  }
}

/**
 * Format a base-unit amount for display. Trims trailing zeros in the
 * fractional part and always includes at least one digit before the
 * decimal point.
 */
export function formatAssetAmount(value: bigint, decimals: number, maxFractionDigits = 6): string {
  if (value === 0n) return "0";
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fractional = abs % base;
  const fracStr = fractional.toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  const wholeStr = whole.toString();
  const sign = negative ? "-" : "";
  return fracStr === "" ? `${sign}${wholeStr}` : `${sign}${wholeStr}.${fracStr}`;
}
