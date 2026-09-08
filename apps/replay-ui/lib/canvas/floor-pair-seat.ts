/**
 * THE SEAT, RESOLVED ONCE, AGAINST THE MEASURED CAPTURE.
 *
 * `lib/canvas/floor-pair.ts` owns the RULE (`floorPairSeat`: the loop holds the
 * book unless the pair's own published rates today already clear the bar for
 * the floor) and it takes both facts as arguments, because it is a leaf with
 * one import and it has to stay one: `router-history` reaches `templates`,
 * which reaches `graph-ops`, which imports `floor-pair`. Resolving the capture
 * inside that file would close the initialization cycle F6 already cost this
 * package once, so it is resolved HERE instead, in a module nothing inside
 * that graph imports.
 *
 * Every surface that seats the pair reads this file and nothing re-derives the
 * rule: the plate's bars, the dock's allocation rows, the review sheet's lane
 * rows, the published record's `lanes[].allocationBps`, the vault instrument's
 * Allocation foot row (through the record), and the replay's own initial
 * weights in `router-fold.ts`.
 *
 * THE TWO FACTS IT SUPPLIES:
 *   `routerPublishedToday()`   the last aligned day of the capture, both lanes
 *                              in the published frame at the seed leverage.
 *                              Never `Date.now()`: the Aave series publishes
 *                              one point per day and today IS that day.
 *   `DEMO_UPGRADE_THRESHOLD`   the shipped bar, so the seat asks the same
 *                              question the rule asks.
 */

import {
  floorPairSeat,
  floorPairSeatBps,
  type FloorPairHolder,
} from "@/lib/canvas/floor-pair";
import { nodeFor } from "@/lib/canvas/graph-ops";
import { DEMO_UPGRADE_THRESHOLD } from "@/lib/canvas/orchestrator/demo-rules";
import { routerPublishedToday } from "@/lib/canvas/router-history";
import type { PortfolioGraph } from "@/lib/canvas/types";

/** The lane the rule holds today. Pure and deterministic: the capture is a
 *  committed fixture and the bar is a constant. */
export function demoFloorPairSeat(bar: number = DEMO_UPGRADE_THRESHOLD): FloorPairHolder {
  return floorPairSeat(routerPublishedToday(), bar);
}

/**
 * The seat as an allocation vector in bps, or NULL when these lanes are not
 * the floor pair.
 *
 * Null is what keeps the seat off a rack it was not measured for: a caller
 * that gets null keeps the allocation its own portfolio already carries.
 */
export function demoFloorPairAllocationsBps(
  lanes: readonly { readonly loopId: string; readonly candidateId: string }[],
): Record<string, number> | null {
  return floorPairSeatBps(lanes, demoFloorPairSeat());
}

/**
 * THE ALLOCATION EVERY CANVAS SURFACE DRAWS, PUBLISHES AND PRICES FROM.
 *
 * On the floor pair it is the seat: 100% in the lane the rule holds, 0% in the
 * other. On any other composition it is `stored`, byte for byte, so the
 * allocation dial keeps working everywhere it is still a dial.
 *
 * It is a DERIVED READ rather than a write into the portfolio, because the
 * seat is a property of the pair and not a value the user set: a write would
 * have to be re-applied on every path that can form the pair (adding a lane,
 * pinning a market into one, a template, the copilot), and the one that got
 * missed would put a 50/50 book back on the plate. Read here, the seat cannot
 * be out of date, and `graph-ops` keeps owning what the user's own dial does.
 */
export function seatedAllocationsBps(
  lanes: readonly { readonly loopId: string; readonly candidateId: string }[],
  stored: Record<string, number>,
): Record<string, number> {
  return demoFloorPairAllocationsBps(lanes) ?? stored;
}

/**
 * The same answer for a whole portfolio, which is the shape every canvas
 * surface actually holds.
 *
 * The candidate id is read the way `pricingParamsFor` reads it, off the lane's
 * own seated `liquidity-source`, rather than by importing that function:
 * `pricing-params` imports `graph-ops`, and this module is imported by the
 * canvas, the dock and the fold. A lane with no market carries no id and is
 * therefore not half of any pair, which is the honest reading of a lane the
 * orchestrator does not govern yet.
 */
export function seatedPortfolioAllocationsBps(p: PortfolioGraph): Record<string, number> {
  return seatedAllocationsBps(
    p.loops.map((loop) => ({
      loopId: loop.id,
      candidateId: String(nodeFor(loop, "liquidity-source")?.data.params.candidateId ?? ""),
    })),
    p.orchestrator.allocationsBps,
  );
}

/**
 * The portfolio with the seat applied, for the callers that hand a whole
 * `PortfolioGraph` to an owner rather than reading an allocation themselves.
 *
 * `slotsFromPortfolio` is the one that matters: a slot's `targetWeight` is
 * `allocationsBps / 10000`, and it is what `composedRoute` filters headroom
 * with and what `validateOrchestrator` sums. A plate drawing 100/0 over slots
 * seated 50/50 would be the two-machines defect drawn on one screen.
 *
 * It CANNOT be applied inside `orchestrator/index.ts` itself: this module
 * reaches `graph-ops`, and `graph-ops` reaches `orchestrator/index`, so the
 * import would close the initialization cycle F6 already cost this package
 * once. The caller composes instead, which is why this returns a portfolio
 * rather than mutating one.
 */
export function withSeatedAllocations(p: PortfolioGraph): PortfolioGraph {
  const allocationsBps = seatedPortfolioAllocationsBps(p);
  if (allocationsBps === p.orchestrator.allocationsBps) return p;
  return { ...p, orchestrator: { ...p.orchestrator, allocationsBps } };
}
