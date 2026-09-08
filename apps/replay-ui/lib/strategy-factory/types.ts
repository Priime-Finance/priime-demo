/**
 * Strategy Factory — shared types (Phase 1, read-only discovery).
 *
 * Plan: docs/plans/strategy-factory-plan.md. Everything here is a pure data
 * shape; the scanner produces snapshots, the simulator consumes them and
 * produces ranked candidates. Content-hash discipline: a candidate document
 * is a deterministic function of (onchain block-pinned reads, HL snapshot
 * hash) — Gate 1 requires identical output for identical inputs.
 */

export interface DolomiteMarketRow {
  marketId: number;
  token: string;
  symbol: string;
  decimals: number;
  /** USD price of one whole token (getMarketPrice scaled by 1e(36-dec)). */
  priceUsd: number;
  /** Dolomite oracle contract for this market (provenance gate input). */
  oracleAddr: string;
  interestSetterAddr: string;
  borrowApr: number;
  supplyApr: number;
  supplyWei: number;
  borrowWei: number;
  supplyUsd: number;
  borrowUsd: number;
  utilization: number;
  /** 0 = UNCAPPED per Dolomite semantics, but the eligibility gate treats
   *  missing caps as INELIGIBLE (fail closed, C0-H). */
  maxSupplyWei: number;
  maxBorrowWei: number;
  isClosing: boolean;
  marginPremium: number;
  spreadPremium: number;
  /** Risk-override category: 0 NONE, 1 BERA, 2 BTC, 3 ETH, 4 STABLE. */
  eModeCategory: number;
  /** Nonzero = BORROW_ONLY / SINGLE_COLLATERAL restriction flags. */
  riskFeature: number;
  /** ERC-4626 intrinsic yield (NAV growth annualized) — null when the token
   *  does not respond to convertToAssets or history is unavailable. */
  intrinsicApr: number | null;
  /** ERC-4626 totalAssets in USD (donation-gate input); null if not 4626. */
  vaultTotalAssetsUsd: number | null;
}

export interface DolomiteSnapshot {
  chainId: number;
  blockNumber: number;
  blockHash: string;
  takenAtMs: number;
  /** E-Mode category params: category -> liquidation threshold (0..1). */
  categoryLt: Record<number, number>;
  /** Base (non-E-Mode) liquidation threshold from getMarginRatio. */
  baseLt: number;
  markets: DolomiteMarketRow[];
}

export interface HlCoinStats {
  coin: string;
  assetIndex: number;
  szDecimals: number;
  maxLeverage: number;
  markPx: number;
  oiUsd: number;
  dayNtlVlm: number;
  /** Current funding as APR, positive = shorts receive. */
  currentFundingApr: number;
  /** Paginated 90d hourly funding APR series stats. */
  funding: {
    hours: number;
    meanApr: number;
    stdevApr: number;
    /** p25 of the hourly APR distribution — the ranking input (C1-H). */
    p25Apr: number;
    fractionNegative: number;
    longestNegativeStreakHours: number;
  } | null;
  /** Top-10 cumulative book depth per side, USD. */
  depthBidUsd: number;
  depthAskUsd: number;
  minViableOrderUsd: number;
}

export interface HlSnapshot {
  takenAtMs: number;
  /** sha256 of the canonical-serialized snapshot content (determinism). */
  contentHash: string;
  coins: Record<string, HlCoinStats>;
}

export type GateId =
  | "same_underlying"
  | "native_perp"
  | "oracle_provenance"
  | "erc4626_integrity"
  | "caps_fail_closed"
  | "emode_geometry"
  | "risk_feature"
  | "debt_market_open"
  | "marginal_rates_carry"
  | "hl_oi_depth"
  | "hl_min_size"
  | "funding_p25_floor"
  | "capacity_floor"
  | "borrow_liquidity";

export interface GateResult {
  gate: GateId;
  pass: boolean;
  detail: string;
}

export interface CandidateEconomics {
  /** Liquidation threshold used (E-Mode or base). */
  ltUsed: number;
  eMode: boolean;
  targetLtv: number;
  loopLeverage: number;
  /** Carry components, annualized, on loop equity. */
  collateralYieldApr: number;
  borrowAprSpot: number;
  /** Borrow APR recomputed at marginal utilization incl. our flows (C1-C). */
  borrowAprMarginal: number;
  fundingP25Apr: number;
  executionDragApr: number;
  /** Net carry on loop equity at cap TVL, using marginal rates + p25 funding. */
  netCarryOnEquityApr: number;
  /** Net APY on user deposit (through the 25/75 split). */
  netApyOnDepositApr: number;
  /** Capacity bound, USD (min over borrow avail, supply cap, exit liquidity,
   *  HL OI/depth, economic floor). */
  capacityUsd: number;
  capacityBinding: string;
}

export interface Candidate {
  id: string;
  collateral: { marketId: number; symbol: string; token: string };
  debt: { marketId: number; symbol: string; token: string };
  hlCoin: string;
  underlying: string;
  gates: GateResult[];
  eligible: boolean;
  economics: CandidateEconomics | null;
  /** 0-100, only for eligible candidates. */
  score: number | null;
  notes: string[];
}

export interface CandidateDocument {
  version: 1;
  generatedAtMs: number;
  dolomiteBlock: number;
  dolomiteBlockHash: string;
  hlSnapshotHash: string;
  /** sha256 over the canonical serialization of `candidates` + inputs refs. */
  contentHash: string;
  candidates: Candidate[];
  /** Live strategy parity check (Gate 1): simulated vs realized carry. */
  parity: {
    strategyId: number;
    simulatedNetApyOnEquity: number;
    realizedNetApyOnEquity7d: number | null;
    deltaBps: number | null;
  } | null;
}
