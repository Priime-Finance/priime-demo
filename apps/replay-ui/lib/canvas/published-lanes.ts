/**
 * WHAT A TWO-LANE PUBLISH WRITES ONTO THE RECORD, and the shapes it writes it in.
 *
 * ── THE SEAM THIS FILE HOLDS (router lane plan R5, seam 1) ────────────────
 * The record's `lanes` and `router` fields are DECLARED by WP-3 in
 * `lib/vaults/store.ts` (`VaultRecord` + the `PublishInput` pick) and READ by
 * WP-3's Capital router instrument. WP-1 writes them. Neither package may edit
 * the other's file, so the two shapes below are WP-1's local declaration of
 * what it writes, under the field names the plan gives, and integration
 * reconciles them with WP-3's declaration. When WP-3's `VaultRecord` carries
 * the same two names, `PublishFlow` passes them straight through and these
 * interfaces can be deleted in favour of the store's.
 *
 * ── EVERY FIGURE HERE HAS ONE OWNER AND NONE OF THEM IS THIS FILE ─────────
 * The published APY is the lane's own display number (`laneComputed[].netApy`,
 * `publishedNetApy` with the compute fee inside). The allocation is the
 * orchestrator's `allocationsBps`. The three dials are `dialsFromParams` on the
 * portfolio's own orchestrator params. The rule sentence is
 * `decodeOrchRule` over `demoRouterRules`, which is the founder's 48-hour
 * sustain and the quant's derived threshold from
 * `lib/canvas/orchestrator/demo-rules.ts`. Nothing below computes a number.
 *
 * ── WHY THE HOURLY PIN COUNT AND NOT THE DAILY ONE ───────────────────────
 * `demoRouterRules` defaults to `DEMO_SUSTAIN_PINS_DAILY` (2), the modeled
 * replay's cadence. A PUBLISHED record describes the machine the vault runs,
 * and that handler lands hourly (`lib/vaults/onchain-executions.ts`), so the
 * record states the same 48 hours as `DEMO_SUSTAIN_PINS_HOURLY` (48). One
 * window, two clocks, and the caller says which clock it is on.
 */

import { decodeOrchRule } from "@/lib/canvas/orchestrator/rule-schema";
import {
  DEMO_SUSTAIN_PINS_HOURLY,
  demoDeriveAllRouterRules,
} from "@/lib/canvas/orchestrator/demo-rules";
import type { LoopSlot, OrchestratorDials } from "@/lib/canvas/orchestrator/types";
import type { LaneFamily } from "@/lib/canvas/graph-ops";

/** One lane of a published multi-lane vault, as the record carries it. */
export interface PublishedLane {
  /** The canvas's own name for the lane (`Lane 1`). */
  label: string;
  /** The scanner venue key (`morpho-blue-base`, `treasury-ausdc-base`). */
  venue: string;
  /** The market the lane's source plate pins, as the plate prints it. */
  market: string;
  /** Which product this lane is. Decides what the reader may state about it. */
  family: LaneFamily;
  /** The lane's published net APY AT PUBLISH, the compute fee already inside.
   *  Null when the lane did not price, which the reader renders as nothing. */
  publishedApy: number | null;
  /** The router's steady-state weight for this lane. The set sums to 10000. */
  allocationBps: number;
}

/** The capital router as the record carries it: three dials and its rules. */
export interface PublishedRouter {
  /** The three dials, verbatim from `OrchestratorDials`. */
  reactivity: OrchestratorDials["reactivity"];
  maxConcentrationPct: number;
  turnoverBudgetPctWeek: number;
  /**
   * The upgrade rule, decoded, one sentence per lane. `decodeOrchRule` names
   * the slot it belongs to, so the two directions of the founder's one
   * mechanism read as two sentences about one machine rather than two rules.
   */
  ruleSentences: string[];
  /** The sustain the sentences are stated on: 48 hourly pins. */
  sustainPins: number;
}

/**
 * The router block for a published record, or null when no router is on.
 *
 * `slots` and `dials` are the SAME objects the plate and the validator read
 * (`slotsFromPortfolio`, `dialsFromParams`), so the record cannot describe a
 * router the canvas did not show.
 */
export function publishedRouter(
  dials: OrchestratorDials,
  slots: readonly LoopSlot[],
): PublishedRouter | null {
  if (slots.length < 2) return null;
  const rules = demoDeriveAllRouterRules(dials, slots, DEMO_SUSTAIN_PINS_HOURLY).filter(
    (r) => r.metric === "better_elsewhere",
  );
  return {
    reactivity: dials.reactivity,
    maxConcentrationPct: dials.maxConcentrationPct,
    turnoverBudgetPctWeek: dials.turnoverBudgetPctWeek,
    ruleSentences: rules.map(decodeOrchRule),
    sustainPins: DEMO_SUSTAIN_PINS_HOURLY,
  };
}
