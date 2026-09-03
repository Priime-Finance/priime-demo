/**
 * Strategy Factory — multi-venue shared types (v2 pipeline).
 *
 * The v2 pipeline covers the Base venues (Aave v3, Morpho Blue). The v1
 * Dolomite pipeline (../types.ts) is UNTOUCHED and keeps writing
 * sf:candidates:latest — the deployed admin surface never regresses while
 * this ships (SCOPE-H shadow fix). Per-venue v2 docs live under their own
 * KV keys; a failed venue simply does not write, so the last good doc
 * survives with its timestamp (OPS-C/OPS-H fixes: no shared doc, no
 * read-modify-write race, failure ≠ empty).
 *
 * evaluatePairV2 (simulate-v2.ts) is PURE over these shapes: every IO
 * result — provenance, staleness, basis history, marginal rates, redemption
 * quotes — is precomputed by the venue adapter and arrives as data.
 */

type VenueId = "aave-v3-base" | "morpho-blue-base" | "morpho-blue-hyperevm";

/**
 * A = hedged (same-underlying, HL perp exists — the existing class).
 * N1 = unhedged delta-neutral-by-construction (USD-stable / USD-stable).
 * N2 = same-underlying without a perp (machinery cut in v1 — tag only,
 *      emitted as ineligible rows; SCOPE-M fix).
 * D = directional (mixed underlyings / EUR-FX) — excluded, ineligible rows.
 */
type CandidateClass = "A" | "N1" | "N2" | "D";

// ── Gates ──────────────────────────────────────────────────────────────

type GateIdV2 =
  // shared (generalized from v1)
  | "peg_class"            // same_underlying generalization (address-keyed)
  | "oracle_provenance"
  | "oracle_staleness"     // universal Morpho gate, both lists (SEC-H fix)
  | "yield_source_integrity" // erc4626_integrity generalization
  | "caps"                 // per-venue three-case table
  | "lt_geometry"          // emode_geometry generalization
  | "risk_feature"
  | "debt_market_open"
  | "market_sanity"        // APY ceiling + util ceiling (spam-market trap)
  | "marginal_rates_carry"
  | "capacity_floor"
  | "borrow_liquidity"
  // class A (hedged) only
  | "native_perp"
  | "wrapper_basis"        // class-A wrapper vs hedge basis (ECON-C fix)
  | "hl_oi_depth"
  | "hl_min_size"
  | "funding_p25_floor"
  // class N1 (unhedged) only
  | "depeg_basis"
  | "independent_price_feed"
  | "rate_inversion_p25"
  | "redemption_liquidity"
  | "no_perp_confirmed";

interface GateResultV2 {
  gate: GateIdV2;
  pass: boolean;
  detail: string;
}

interface EconomicsV2 {
  ltUsed: number;
  targetLtv: number;
  loopLeverage: number;
  collateralYieldApy: number;
  borrowApySpot: number;
  borrowApyMarginal: number;
  fundingP25Apr: number | null; // class A only
  executionDragApr: number;
  netCarryOnEquityApy: number;
  netApyOnDepositApy: number;
  capacityUsd: number;
  capacityBinding: string;
  // N1 risk surface (SCOPE-H fix: first-class columns, not buried detail)
  maxBasisDev90d: number | null;
  curBasisDev: number | null;
  carryP25: number | null;
  timeToLiqDays: number | null; // null = carry-positive (no rate-decay path)
  depegSizedMaxLtv: number | null;
  // Merkl rewards overlay (deposit-basis, diluted, time-weighted, capped
  // at MERKL_REWARD_CAP_ON_DEPOSIT). null = no reward data; 0 = real zero.
  rewardApyDiluted: number | null;
  netApyWithRewards: number | null;
  rewardRunwayDays: number | null;
}

export interface CandidateV2 {
  /** `${venue}:${chainId}:${cSym}-${dSym}:${marketKey}` — market-keyed
   *  because Morpho lists multiple LLTV tiers of the same symbol pair. */
  id: string;
  venue: VenueId;
  chainId: number;
  cls: CandidateClass;
  collateral: { symbol: string; token: string };
  debt: { symbol: string; token: string };
  hlCoin: string | null;
  underlying: string;
  marketKey: string;
  gates: GateResultV2[];
  eligible: boolean;
  /** Separate tier (never merged into `eligible`): passes every non-econ
   *  gate AND base carry ≥ 0 AND netApyWithRewards ≥ floor AND the
   *  campaign type's capture path is verified. null = no reward data. */
  eligibleWithRewards: boolean | null;
  economics: EconomicsV2 | null;
  /** Class A score (0-100, comparable with the v1 Dolomite list). */
  score: number | null;
  /** Class N1 score — DIFFERENT field on purpose (ECON-M fix): naive
   *  consumers must not sort hedged and unhedged candidates together. */
  scoreN1: number | null;
  /** N1 headline ordering: netApy − L·maxBasisDev90d (one worst basis
   *  event amortized annually). */
  apyRiskAdj: number | null;
  notes: string[];
}

/** Minimal row for excluded/spam pairs (OPS-M KV-size fix). */
interface IneligibleRowV2 {
  id: string;
  cls: CandidateClass | "unmapped";
  firstFailedGate: string;
  reason: string;
}

export interface VenueDocV2 {
  version: 2;
  venue: VenueId;
  chainId: number;
  blockNumber: number;
  blockHash: string;
  generatedAtMs: number;
  /** null when the venue emitted no class-A pairs (no HL fetch needed). */
  hlSnapshotHash: string | null;
  /** Morpho only: sha256 of the sorted on-chain-verified market-id set —
   *  the non-pinnable enumeration input (the hl-scan.ts hash pattern). */
  marketIdSetHash: string | null;
  /** Merkl campaign-set IDENTITY hash — stable fields only (campaignId,
   *  timestamps, tokens), floats excluded, so the pin-header signal means
   *  "the campaign set changed", not "a price wiggled". null = overlay
   *  absent this scan. */
  merklCampaignSetHash: string | null;
  contentHash: string;
  candidates: CandidateV2[];
  ineligible: IneligibleRowV2[];
  scanStats: {
    pairsSeen: number;
    tookMs: number;
    rpcHost: string;
    notes: string[];
  };
}
