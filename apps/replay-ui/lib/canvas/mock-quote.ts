/**
 * Mock quote synthesis (mockup register).
 *
 * The canvas is a product mockup: every picked market prices. When the live
 * reprice rail serves a quote it wins; otherwise (non-launchable venue, rail
 * failure) the latest catalog scan row prices the lane client-side through
 * the same band-derivation functions the rail uses. No failure states ever
 * render on the canvas.
 */

import type { OpportunitiesPayload, RepriceData } from "@/components/canvas/types";
import type { ProjectedCandidate } from "./opportunities";
import { clampLeverage, deriveHfBands, type RiskPreset } from "./param-schema";

interface CatalogHit {
  row: ProjectedCandidate;
  blockNumber: number;
}

/** Find a candidate row (and its venue's block pin) in the lifted catalog. */
export function catalogRow(opp: OpportunitiesPayload | null, candidateId: string): CatalogHit | null {
  if (!opp || !candidateId) return null;
  for (const v of opp.venues) {
    const row = v.hedged.concat(v.unhedged).find((c) => c.id === candidateId);
    if (row) return { row, blockNumber: v.blockNumber };
  }
  return null;
}

/** Synthesize an ok-shaped quote from a catalog row (client-side, modeled).
 *  The clock is a parameter (serialize.ts `toDraft` precedent): lib/ stays
 *  pure and the call site supplies Date.now(). */
export function mockQuote(
  hit: CatalogHit,
  targetLeverage: number,
  riskPreset: RiskPreset,
  nowMs: number,
): RepriceData {
  const lt = typeof hit.row.lt === "number" && hit.row.lt > 0 ? hit.row.lt : 0.86;
  return {
    ok: true,
    repricedAtMs: nowMs,
    blockNumber: hit.blockNumber,
    candidate: hit.row,
    requestedLeverage: targetLeverage,
    appliedLeverage: clampLeverage(targetLeverage, lt),
    bands: { hf: deriveHfBands(riskPreset), margin: null },
    minDepositUsd: 100,
    violations: [],
  };
}

/** The lane-displayable modeled APY from an ok quote's candidate. */
function candidateApy(c: ProjectedCandidate | null | undefined): number | null {
  if (!c) return null;
  return c.economics?.netApyOnDepositApy ?? c.headlineApr ?? null;
}

/**
 * Composition-honest lane APY. Hedged catalog rows price the short leg's
 * funding INTO netApyOnDepositApy (simulate-v2: + fundingP25, signed). If the
 * hedge module is not installed on the lane, that carry leaves with the leg,
 * so the funding term is stripped from the displayed number. First-order
 * modeled register: the exec-drag/margin-reserve residue stays conservative.
 */
export function composedNetApy(
  c: ProjectedCandidate | null | undefined,
  hasHedge: boolean,
): number | null {
  const base = candidateApy(c);
  if (base === null) return null;
  const funding = c?.economics?.fundingP25Apr ?? null;
  if (!hasHedge && funding !== null && funding !== 0) return base - funding;
  return base;
}
