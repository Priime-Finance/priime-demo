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

/** APPENDED 2026-08-23: "morpho-blue-ethereum". Adding a member is additive
 *  for producers and EXHAUSTIVE-CHECKING for consumers, which is the point —
 *  `tsc` names every switch that has to answer for the new chain instead of
 *  letting it fall through a default. */
/** APPENDED 2026-08-23 (second): "hyperliquid-funding". Not a lending market —
 *  a PERP BOOK scanned for its own funding and emitted as SPOT-CLASS rows into
 *  this same catalog (loopLeverage 1, no debt leg, `hlCoin` set). See
 *  `venues/hyperliquid-funding.ts` for why it is one catalog and not a second
 *  product. Additive for producers, exhaustive-checking for consumers, exactly
 *  as above. */
export type VenueId =
  | "aave-v3-base"
  | "morpho-blue-base"
  | "morpho-blue-hyperevm"
  | "morpho-blue-ethereum"
  | "hyperliquid-funding";

/**
 * A = hedged (same-underlying, HL perp exists — the existing class).
 * N1 = unhedged delta-neutral-by-construction (USD-stable / USD-stable).
 * N2 = same-underlying without a perp (machinery cut in v1 — tag only,
 *      emitted as ineligible rows; SCOPE-M fix).
 * D = directional (mixed underlyings / EUR-FX) — excluded, ineligible rows.
 */
export type CandidateClass = "A" | "N1" | "N2" | "D";

export interface LegV2 {
  symbol: string;
  token: string;
  decimals: number;
  /** Independent USD reference price (AaveOracle where listed). */
  priceUsd: number;
  priceSource: string;
  /** Effective APY conventions (ECON-H fix): every rate crossing this
   *  boundary is an effective APY — Aave (1+ray/SPY)^SPY−1, Morpho
   *  expm1(r·SPY). Composition stays simple-additive. */
  supplyApy: number;
  borrowApy: number;
  /** Wrapper NAV growth (exchange-rate feed drift / native 4626), APY. */
  intrinsicApy: number | null;
  intrinsicSource: string | null;
  supplyUsd: number;
  borrowUsd: number;
  utilization: number;
  /** Cap headroom in USD. null = uncapped (Aave cap==0 → PASS, capacity
   *  bounded by the other legs — the three-case table, SCOPE-H fix). */
  supplyCapHeadroomUsd: number | null;
  borrowCapHeadroomUsd: number | null;
  capDetail: string;
  /** Human-readable risk flags; flagsOk=false fails risk_feature. */
  flags: string[];
  flagsOk: boolean;
  borrowEnabled: boolean;
  /** Venue receipt tokens (Aave) — the Merkl overlay's join keys:
   *  supply campaigns key on the aToken, borrow campaigns on the
   *  variableDebtToken (live-verified). */
  receiptTokens?: { aToken?: string; variableDebtToken?: string };
}

export interface OracleProvenanceV2 {
  ok: boolean;
  detail: string;
  /** Venue oracle returned identical values across historical pins —
   *  a fixed-price oracle (Morpho USDe/USDC ≡ 1e24). null = not probed. */
  fixedPrice: boolean | null;
  /** Constituent Chainlink feeds fresh at the pinned block (Morpho
   *  wrappers have NO staleness check by design — SEC-H universal gate).
   *  null = not applicable (Aave enforces its own sentinel). */
  staleOk: boolean | null;
  staleDetail: string;
}

/** Output of basis-history.ts computeBasisStats — one-sided detrend
 *  (ECON-C fix: negative median drift is DEVIATION, not trend). */
export interface BasisStats {
  nPins: number;
  spanDays: number;
  maxBasisDev90d: number;
  curBasisDev: number;
  medianWeeklyLogGrowth: number;
  source: string;
}

/** Output of computeCarryStats over the pinned 90d carry series, shifted
 *  by our entry impact (ECON-H fix). All values effective APY fractions. */
export interface CarryStats {
  nPins: number;
  p25Carry: number;
  meanCarry: number;
  minPinCarry: number;
  maxConsecutiveNegativePins: number;
  /** For timeToLiq: borrow p75 and collateral-yield p25 over the series. */
  p75BorrowApy: number;
  p25CollateralYieldApy: number;
}

/** One Merkl campaign matched to a pair leg — raw inputs for the PURE
 *  reward math in simulate-v2 (dilution needs the engine's own capacity). */
export interface RewardCampaignV2 {
  campaignId: string;
  merklType: string;
  side: "collateral" | "debt";
  rewardToken: { address: string; symbol: string; decimals: number; priceUsd: number; priceSource: string };
  /** Recomputed from raw budget: amount/10^dec/durationDays × priceUsd. */
  usdPerDay: number;
  /** Merkl's served APR as a FRACTION (redundancy channel only). */
  servedAprFrac: number;
  /** Merkl's served TVL (cross-check only — dilution uses pinned chain state). */
  merklTvlUsd: number;
  startTs: number;
  endTs: number;
  runwayDays: number;
  distributionType: string;
  creator: string;
  /** Zeroing decisions made by the scanner, with reasons (display + audit). */
  zeroed: string | null;
}

export interface RewardsInfoV2 {
  campaigns: RewardCampaignV2[];
  /** ok = every affirmative signal verified; degraded = something failed
   *  closed (that campaign contributes zero); absent = overlay unavailable
   *  this scan (API down/timeout) — base economics only. */
  integrity: "ok" | "degraded" | "absent";
  /** Rewards can only flip eligibleWithRewards once a live
   *  accrue→claim→sweep test has passed for the campaign type (registry
   *  MERKL_TYPE_MAP.captureVerified). Until then: display-only. */
  capturePath: "unverified" | "verified";
  detail: string;
}

export interface RedemptionInfo {
  kind: "atomic" | "dex-quote" | "none";
  /** Round-trip slippage fraction for the exit notional (dex-quote only). */
  slippage: number | null;
  detail: string;
}

export interface PairInputV2 {
  venue: VenueId;
  chainId: number;
  /** aave: `${cSym}-${dSym}@e${cat}`; morpho: the bytes32 market id. */
  marketKey: string;
  cls: CandidateClass;
  underlying: string; // ETH | BTC | USD | EUR
  hlCoin: string | null;
  c: LegV2;
  d: LegV2;
  lt: number;
  ltSource: "emode" | "market-lltv";
  ltDetail: string;
  /** max(instant, drifted30d) for Morpho; kink-curve recompute for Aave. */
  marginalBorrowApy: number | null;
  marginalBorrowDetail: string;
  /** Collateral supply APY after our own deposit dilutes it (ECON-M fix).
   *  null = venue pays no supply yield on collateral (Morpho). */
  marginalSupplyApy: number | null;
  /** Debt-side available liquidity (entry AND exit bound), USD. */
  availBorrowUsd: number;
  provenance: OracleProvenanceV2;
  basis: BasisStats | null;
  carryHist: CarryStats | null;
  redemption: RedemptionInfo;
  /** Merkl rewards overlay; null = overlay not run for this pair. */
  rewards: RewardsInfoV2 | null;
  notes: string[];
}

// ── Gates ──────────────────────────────────────────────────────────────

export type GateIdV2 =
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
  | "no_perp_confirmed"
  /** APPENDED 2026-08-23 — hyperliquid-funding. On a lane whose REVENUE is the
   *  funding, a percentile above the floor is not enough: a book can clear the
   *  25th percentile and still have paid the short for a fifth of the year in
   *  runs of days. This gate names both numbers (share of hours, longest run)
   *  and is separate from `funding_p25_floor` so a rejection says which. */
  | "funding_negative_share";

export interface GateResultV2 {
  gate: GateIdV2;
  pass: boolean;
  detail: string;
}

export interface EconomicsV2 {
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

  // ── APPENDED 2026-08-23 — the funding venue's evidence (founder D1) ────
  // OPTIONAL, so every existing producer and every committed fixture is
  // byte-identical and every existing consumer compiles untouched. Present
  // only on `hyperliquid-funding` rows today.
  //
  // D1 IS THE REASON THESE ARE FIELDS AND NOT PROSE: a row priced on
  // `min(p25 over 30d, 90d, 180d, 365d)` must publish WHICH window its number
  // came from, or the reader cannot tell a book that is boringly positive over
  // a year from one that is positive over a quarter and was p25 −55.5% over
  // the year before it. That confusion is what let Berachain price at +8.7%.
  /** Days of the window that WON the minimum, i.e. priced the row. */
  fundingWindowDays?: number | null;
  /** Every window the endpoint actually covered, with its own p25 — the
   *  evidence behind the minimum, not a summary of it. */
  fundingWindows?: Array<{
    days: number;
    hours: number;
    p25Apr: number;
    meanApr: number;
    fractionNegative: number;
    longestNegativeStreakHours: number;
  }> | null;
  /** When the percentile was computed. Not the document's timestamp: window
   *  statistics are archived and rotated, so a row states its OWN age. */
  fundingAsOfMs?: number | null;
  /** Days actually spanned by the retrieved series. */
  fundingSpanDays?: number | null;
  /** The asset the lane HOLDS against the short, and where it lives. Null =
   *  no spot leg is registered for this book, which (by the funding-only
   *  ceiling) means the row cannot clear the screen — a true and useful
   *  thing to show rather than a reason to hide the row. */
  spotLeg?: {
    symbol: string;
    protocol: string;
    chain: string;
    chainId: number | null;
    apy: number | null;
    source: string;
    reachable: boolean;
    tvlUsd: number | null;
  } | null;
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
export interface IneligibleRowV2 {
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

// ── KV layout ──────────────────────────────────────────────────────────

export const SF_KV_KEY_V2 = (venue: VenueId) => `sf:candidates:v2:${venue}`;
/** Basis ring buffers are keyed by (venue, token pair): the price-ratio
 *  series is venue-independent (AaveOracle) but the carry series embeds the
 *  venue's own borrow rate — mixing Aave and Morpho rates in one ring would
 *  corrupt rate_inversion_p25. */
export const SF_BASIS_KEY = (venue: VenueId, chainId: number, cToken: string, dToken: string) =>
  `sf:basis:${venue}:${chainId}:${cToken.toLowerCase()}:${dToken.toLowerCase()}`;

export interface VenueSnapshotMeta {
  venue: VenueId;
  chainId: number;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  takenAtMs: number;
}
