/**
 * Liquidity-source opportunity projection (BC-P2).
 *
 * Pure functions from a scanner KV doc (VenueDocV2) to the client-safe catalog
 * shape. Deliberate field projection: symbols and economics survive;
 * token/oracle addresses, operator notes, scanStats and ineligible spam rows
 * do not.
 *
 * Floor policy (founder ruling 2026-07-28): the 8% house floor is the DEFAULT
 * of a user-tunable screen, not a hard gate. The API returns every scanned
 * candidate with economics; screening happens client-side at the user's floor,
 * and sub-house-floor selections carry the warning register in the UI.
 *
 * ECON-M ruling holds: hedged (A, `score`) and unhedged (N1, `scoreN1`/
 * `apyRiskAdj`) are separate sections, never interleaved.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion --
 * Kit-verbatim file (priime-build-ui-kit integration); not rewriting kit
 * logic to satisfy lint, per the integration's own directive. */

import type { CandidateV2, VenueDocV2 } from "@/lib/strategy-factory/venues/types";

const STALE_MS = 24 * 60 * 60 * 1000;

/** DEMO SCOPE: one venue, because the demo composes one vault on one market. */
export type CanvasVenueId = "morpho-blue-base";

export const VENUE_LABELS: Record<CanvasVenueId, string> = {
  "morpho-blue-base": "Morpho Blue · Base",
};

/** Venues the launch rail can actually serve today (plan: Morpho-first). */
export const LAUNCHABLE_VENUES: ReadonlySet<CanvasVenueId> = new Set(["morpho-blue-base"]);

export interface ProjectedCandidate {
  id: string;
  venue: CanvasVenueId;
  cls: "A" | "N1";
  pair: string;
  collateralSymbol: string;
  debtSymbol: string;
  hlCoin: string | null;
  eligible: boolean;
  eligibleWithRewards: boolean | null;
  /** Liquidation threshold used by the scan (public chain parameter) — the
   *  client risk dial derives house-max leverage from it via the EXISTING
   *  houseMaxLeverage/clampLeverage functions. Null when no economics. */
  lt: number | null;
  /** Headline for screening: A = net APY on deposit; N1 = risk-adjusted APY. */
  headlineApr: number | null;
  score: number | null;
  scoreN1: number | null;
  apyRiskAdj: number | null;
  economics: {
    netApyOnDepositApy: number;
    netCarryOnEquityApy: number;
    loopLeverage: number;
    targetLtv: number;
    capacityUsd: number;
    capacityBinding: string;
    fundingP25Apr: number | null;
    collateralYieldApy: number;
    borrowApyMarginal: number;
  } | null;
  firstFailedGate: string | null;
  /** Every failing gate id (recette P2-2: the "gates N/M" chip must open the
   *  full failing list, not dead-end at a count). Ids only, never details. */
  failedGates: string[];
  gatesPassed: number;
  gatesTotal: number;
  /** false = row renders with the "venue not launchable yet" register. */
  launchable: boolean;
}

export interface ProjectedVenue {
  venue: CanvasVenueId;
  label: string;
  generatedAtMs: number;
  blockNumber: number;
  contentHash: string;
  stale: boolean;
  launchable: boolean;
  hedged: ProjectedCandidate[];
  unhedged: ProjectedCandidate[];
}

function round(v: number | null | undefined, dp = 6): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(dp)) : null;
}

function projectV2Candidate(c: CandidateV2, launchable: boolean): ProjectedCandidate {
  const failedAll = c.gates.filter((g) => !g.pass);
  const failed = failedAll[0];
  const e = c.economics;
  const headline =
    c.cls === "N1" ? round(c.apyRiskAdj) : round(e?.netApyOnDepositApy ?? null);
  return {
    id: c.id,
    venue: c.venue as CanvasVenueId,
    cls: c.cls as "A" | "N1",
    pair: `${c.collateral.symbol}/${c.debt.symbol}`,
    collateralSymbol: c.collateral.symbol,
    debtSymbol: c.debt.symbol,
    hlCoin: c.hlCoin,
    eligible: c.eligible,
    eligibleWithRewards: c.eligibleWithRewards,
    lt: round(e?.ltUsed ?? null, 4),
    headlineApr: headline,
    score: c.score,
    scoreN1: c.scoreN1,
    apyRiskAdj: round(c.apyRiskAdj),
    economics: e
      ? {
          netApyOnDepositApy: round(e.netApyOnDepositApy) ?? 0,
          netCarryOnEquityApy: round(e.netCarryOnEquityApy) ?? 0,
          loopLeverage: round(e.loopLeverage, 3) ?? 0,
          targetLtv: round(e.targetLtv, 4) ?? 0,
          capacityUsd: Math.round(e.capacityUsd),
          capacityBinding: e.capacityBinding,
          fundingP25Apr: round(e.fundingP25Apr),
          collateralYieldApy: round(e.collateralYieldApy) ?? 0,
          borrowApyMarginal: round(e.borrowApyMarginal) ?? 0,
        }
      : null,
    firstFailedGate: failed ? failed.gate : null,
    failedGates: failedAll.map((g) => g.gate),
    gatesPassed: c.gates.filter((g) => g.pass).length,
    gatesTotal: c.gates.length,
    launchable,
  };
}

export function projectVenueDocV2(doc: VenueDocV2, nowMs: number): ProjectedVenue {
  const venue = doc.venue as CanvasVenueId;
  const launchable = LAUNCHABLE_VENUES.has(venue);
  const projected = (doc.candidates as CandidateV2[]).map((c) =>
    projectV2Candidate(c, launchable),
  );
  return {
    venue,
    label: VENUE_LABELS[venue] ?? venue,
    generatedAtMs: doc.generatedAtMs,
    blockNumber: doc.blockNumber,
    contentHash: doc.contentHash,
    stale: nowMs - doc.generatedAtMs > STALE_MS,
    launchable,
    hedged: projected.filter((c) => c.cls === "A"),
    unhedged: projected.filter((c) => c.cls === "N1"),
  };
}

// ── the demo market ────────────────────────────────────────────────────────

/**
 * The one market the demo composes on: the USDe/USDC recursive loop on Morpho
 * Blue, Base. Same id the scan carries in its `ineligible` list and the same
 * id `lib/vaults/hero.ts` pins as HERO_MARKET_ID, so the composed vault and
 * the attested vault name the same market.
 */
export const DEMO_MARKET_ID = "morpho-blue-base:8453:USDe-USDC:0x54cf9be5";

/**
 * The demo market as a catalog row, MODELED.
 *
 * The scan snapshot does not carry economics for it: the v1 gates exclude the
 * market because Morpho pays no supply APY on USDe collateral, so its carry is
 * incentive-paid. The demo spec says that out loud rather than hiding it, and
 * the numbers below are the spec's own, held self-consistent:
 *
 *   liquidation LTV 91.5%, run at ~80% LTV, ~5x
 *   spread          collateral 4.4% - borrow 3.5% = +0.9% per turn
 *   net at 5x       4.4% x 5 - 3.5% x 4 = 8.0%
 *
 * cls N1: a stable/stable loop has no price leg, so no perp hedge belongs on
 * it, and `validateGraph` refuses one. Every figure here renders under the
 * canvas's "modeled" register.
 */
export function demoMarketCandidate(): ProjectedCandidate {
  return {
    id: DEMO_MARKET_ID,
    venue: "morpho-blue-base",
    cls: "N1",
    pair: "USDe/USDC",
    collateralSymbol: "USDe",
    debtSymbol: "USDC",
    hlCoin: null,
    eligible: true,
    eligibleWithRewards: true,
    lt: 0.915,
    headlineApr: 0.08,
    score: null,
    scoreN1: null,
    apyRiskAdj: 0.08,
    economics: {
      netApyOnDepositApy: 0.08,
      netCarryOnEquityApy: 0.08,
      loopLeverage: 5,
      targetLtv: 0.8,
      capacityUsd: 10_000_000,
      capacityBinding: "modeled",
      fundingP25Apr: null,
      collateralYieldApy: 0.044,
      borrowApyMarginal: 0.035,
    },
    firstFailedGate: null,
    failedGates: [],
    gatesPassed: 0,
    gatesTotal: 0,
    launchable: true,
  };
}

type SelectionState =
  | { kind: "none" }
  | { kind: "valid"; candidate: ProjectedCandidate }
  | { kind: "doc-changed"; candidate: ProjectedCandidate }
  | { kind: "gone" };

/** Pin check: a selection made pre-scan must be visibly invalidated post-scan. */
export function selectionState(
  params: { candidateId?: unknown; contentHash?: unknown },
  venueDoc: ProjectedVenue | null,
): SelectionState {
  const id = typeof params.candidateId === "string" ? params.candidateId : "";
  if (!id || !venueDoc) return { kind: "none" };
  const candidate = [...venueDoc.hedged, ...venueDoc.unhedged].find((c) => c.id === id);
  if (!candidate) return { kind: "gone" };
  const pinned = typeof params.contentHash === "string" ? params.contentHash : "";
  if (pinned && pinned !== venueDoc.contentHash) return { kind: "doc-changed", candidate };
  return { kind: "valid", candidate };
}
