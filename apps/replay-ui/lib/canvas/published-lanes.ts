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
  DEMO_SUSTAIN_HOURS,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";
import {
  FLOOR_PAIR_MAX_CONCENTRATION_PCT,
  FLOOR_PAIR_MOVE_WEIGHT,
  FLOOR_PAIR_TURNOVER_PCT_WEEK,
} from "@/lib/canvas/floor-pair";
import type { OrchestratorDials } from "@/lib/canvas/orchestrator/types";
import { routerRuleSentence, type PublishedLane, type PublishedRouter } from "@/lib/vaults/store";

export type { PublishedLane, PublishedRouter };

/**
 * The router block for a published record, or null when no router is on.
 *
 * `dials` is the SAME object the plate and the validator read
 * (`dialsFromParams`) and supplies the reactivity; the three numbers the
 * switch owns come from `lib/canvas/floor-pair.ts`, which is also what the
 * replay folds, so the record cannot describe a machine the run does not
 * have. `lanes` is the array the record itself carries.
 */
export function publishedRouter(
  dials: OrchestratorDials,
  lanes: readonly PublishedLane[],
): PublishedRouter | null {
  if (lanes.length < 2) return null;
  /* THE RECORD PUBLISHES THE SWITCH'S OWN THREE NUMBERS (G1), not the
     reactivity dial's siblings: between a lane and its floor the band is
     [0, 1], one firing carries the whole lane, and the week admits one full
     move. `reactivity` is still the user's, because it scales the cooldown and
     the cooldown is unchanged. A record that published a 60% ceiling over a
     machine that evacuates would state a policy the vault does not keep. */
  return {
    reactivity: dials.reactivity,
    maxConcentrationPct: FLOOR_PAIR_MAX_CONCENTRATION_PCT,
    turnoverBudgetPctWeek: FLOOR_PAIR_TURNOVER_PCT_WEEK,
    ruleSentence: routerRuleSentence({
      lanes,
      thresholdApy: DEMO_UPGRADE_THRESHOLD,
      sustainHours: DEMO_SUSTAIN_HOURS,
      moveWeight: FLOOR_PAIR_MOVE_WEIGHT,
      maxConcentrationPct: FLOOR_PAIR_MAX_CONCENTRATION_PCT,
    }),
    thresholdApy: DEMO_UPGRADE_THRESHOLD,
    rearmApy: DEMO_UPGRADE_REARM,
    sustainHours: DEMO_SUSTAIN_HOURS,
    moveWeight: FLOOR_PAIR_MOVE_WEIGHT,
  };
}
