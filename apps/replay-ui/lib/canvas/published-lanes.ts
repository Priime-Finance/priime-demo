/**
 * WHAT A TWO-LANE PUBLISH WRITES ONTO THE RECORD.
 *
 * ── THE SEAM THIS FILE HOLDS (router lane plan R5, seam 1) ────────────────
 * The record's `lanes` and `router` fields are DECLARED by `lib/vaults/store.ts`
 * (`VaultRecord`, admitted into `PublishInput`) and READ by the Capital router
 * instrument on the vault page. The canvas writes them, and this file is the
 * one place that composes the router half.
 *
 * INTEGRATION (WP-5) COLLAPSED THE TWO SHAPES INTO ONE. While the packages
 * were building in parallel this file carried its own `PublishedLane` and
 * `PublishedRouter` interfaces, because neither package could edit the other's
 * file; they disagreed with the store's in three members and in the router's
 * rule field (an array of decoded per-slot sentences against the store's one
 * depositor sentence). Both are now imported from the store, so the shape the
 * canvas writes is by construction the shape the page reads, and a member
 * added on one side cannot go unwritten on the other.
 *
 * ── EVERY FIGURE HERE HAS ONE OWNER AND NONE OF THEM IS THIS FILE ─────────
 * The published APY is the lane's own display number (`laneComputed[].netApy`,
 * `publishedNetApy` with the compute fee inside). The allocation is the
 * orchestrator's `allocationsBps`. The three dials are `dialsFromParams` on the
 * portfolio's own orchestrator params. The bar, the hysteresis, the founder's
 * window and the move weight are the four named constants in
 * `lib/canvas/orchestrator/demo-rules.ts`. The sentence is
 * `routerRuleSentence` in the store, which is also the backfill a record
 * published without the field gets, so there is exactly one spelling of the
 * rule in the product. Nothing below computes a number.
 *
 * ── WHY THE RECORD STATES HOURS AND NOT PINS ─────────────────────────────
 * `demoRouterRules` counts PINS, and the pin count depends on the cadence:
 * two daily pins in the modeled replay, 48 hourly pins on the handler this
 * record's vault actually runs (`lib/vaults/onchain-executions.ts`). The
 * record carries the founder's window itself, `DEMO_SUSTAIN_HOURS`, which is
 * the one quantity both cadences agree on and the only one a depositor reads.
 */

import {
  DEMO_ROUTER_MOVE_WEIGHT,
  DEMO_SUSTAIN_HOURS,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";
import type { OrchestratorDials } from "@/lib/canvas/orchestrator/types";
import { routerRuleSentence, type PublishedLane, type PublishedRouter } from "@/lib/vaults/store";

export type { PublishedLane, PublishedRouter };

/**
 * The router block for a published record, or null when no router is on.
 *
 * `dials` is the SAME object the plate and the validator read
 * (`dialsFromParams`), and `lanes` is the array the record itself carries, so
 * the record cannot describe a router over lanes the canvas did not show, and
 * the sentence cannot name a size the `Max move` row disagrees with:
 * `routerRuleSentence` derives the size from these same lanes and this same
 * concentration cap through `routerMaxMoveFrac`.
 */
export function publishedRouter(
  dials: OrchestratorDials,
  lanes: readonly PublishedLane[],
): PublishedRouter | null {
  if (lanes.length < 2) return null;
  return {
    reactivity: dials.reactivity,
    maxConcentrationPct: dials.maxConcentrationPct,
    turnoverBudgetPctWeek: dials.turnoverBudgetPctWeek,
    ruleSentence: routerRuleSentence({
      lanes,
      thresholdApy: DEMO_UPGRADE_THRESHOLD,
      sustainHours: DEMO_SUSTAIN_HOURS,
      moveWeight: DEMO_ROUTER_MOVE_WEIGHT,
      maxConcentrationPct: dials.maxConcentrationPct,
    }),
    thresholdApy: DEMO_UPGRADE_THRESHOLD,
    rearmApy: DEMO_UPGRADE_REARM,
    sustainHours: DEMO_SUSTAIN_HOURS,
    moveWeight: DEMO_ROUTER_MOVE_WEIGHT,
  };
}
