/**
 * THE FLOOR PAIR, AND THE FOUR NUMBERS THAT MAKE THE ROUTER A SWITCH.
 *
 * ── THE FOUNDER'S RULING (G1, docs/plans/ROUTER_LANE_PLAN.md) ─────────────
 * "The demo router between a lane and its floor is a SWITCH, not a band
 * shift." His sentence is an evacuation: the loop is unwound and the capital
 * relocated, then the loop is rebuilt. A 40/60 band is not an evacuation, and
 * no legal setting of the concentration dial reaches one: `minWeight =
 * max(0, 1 - (N - 1) * maxWeight)` is 40% at two lanes and the dial's 80%
 * ceiling only widens the band to [20%, 80%].
 *
 * So for THIS PAIR the band is the whole book and one firing carries the whole
 * lane. The numbers live here, in a module with one import, because three
 * owners need them and none of them may retype one:
 *
 *   `lib/canvas/orchestrator/demo-rules.ts`   the `:upgrade` rule's moveWeight
 *   `lib/canvas/orchestrator/index.ts`        the canvas slot builder's band
 *   `lib/canvas/router-fold.ts`               the replay's slots and dials
 *
 * ── WHICH PAIR, AND WHY IT IS ASKED BY ID ────────────────────────────────
 * G1's condition is structural: the peer is a TREASURY-FAMILY lane, on the
 * SAME CHAIN, reachable by an ATOMIC route. All three facts are true of
 * exactly one pair in this build, and both of its ids already have one owner
 * in `lib/demo-scope.ts`, the register that decides what is live at all. This
 * module asks that owner rather than re-deriving the family from the id prefix
 * and the chain from the venue suffix, which would put a second owner on two
 * facts `templates.ts` and `rule-schema.ts` already hold.
 *
 * The three structural facts are PINNED BY TEST against those owners
 * (`tests/demo-rules.test.ts`): the floor id is in `TREASURY_CANDIDATES`, both
 * venues answer the same `chainOfVenue`, and the floor's own
 * `redemption-route` settles in 0 days. If any of them stops being true the
 * test fails rather than this file drifting.
 *
 * ── THE DEVIATION IS DECLARED, NOT HIDDEN ────────────────────────────────
 * This is a deviation from the live router, and every invariant it relaxes is
 * cleared BY NAME with its reason in `validateDemoRouter`. R25 (sustain), R28
 * (hysteresis), R29 (cooldown) and R30 (anti-cycle and the payback edge lock)
 * are enforced unchanged, so the switch is patient, hysteretic and refuses to
 * come straight back.
 */

import { FLOOR_MARKET_ID, HERO_MARKET_ID, isLiveMarket } from "@/lib/demo-scope";

/**
 * A MARKET THAT IS LIVE BY REGISTER AND WAS NEVER SCREENED (item 8c).
 *
 * The demo's two markets reach a lane through `lib/demo-scope.ts`, not through
 * a scan: the loop market sits in the scan snapshot's `ineligible` list
 * (its carry is incentive-paid and the v1 gate does not credit it) and the
 * treasury floor is a hand-authored issuer row. So neither was ranked against
 * `ECON_FLOOR_APY` and neither has a screen to fall below. Every surface that
 * asks "what screen was this lane admitted through" asks THIS, and the answer
 * for both is none.
 *
 * It is the register's own predicate rather than a second list: a market that
 * stops being live stops being unscreened-and-live at the same instant.
 */
export function isDemoScopedMarket(candidateId: string): boolean {
  return isLiveMarket(candidateId);
}

/**
 * Is this the loop and its floor, and nothing else?
 *
 * Exactly two lanes, and they are the register's two live markets. A third
 * lane, a lane pinned to something else, or one lane alone is not this pair
 * and keeps the shipped band: the switch is a claim about a specific pair of
 * endpoints and it must not leak onto a portfolio it was not measured for.
 */
export function isDemoFloorPair(candidateIds: readonly string[]): boolean {
  if (candidateIds.length !== 2) return false;
  return candidateIds.includes(HERO_MARKET_ID) && candidateIds.includes(FLOOR_MARKET_ID);
}

/**
 * The concentration ceiling this pair publishes, in percent.
 *
 * 100 is outside the dial's own [35, 80] range, which is exactly why
 * `validateDemoRouter` clears `dial-range` for this pair by name: the dial and
 * the band have to state ONE policy, and a config publishing a 60% ceiling
 * over slots banded [0, 1] would be the D3 defect (a printed policy with no
 * mechanism behind it) written the other way round.
 */
export const FLOOR_PAIR_MAX_CONCENTRATION_PCT = 100;

/** The band, derived from the ceiling above at this pair's two lanes, through
 *  B.5's own `max(0, 1 - (N - 1) * maxWeight)`. [0, 1]: no floor, no cap. */
export const FLOOR_PAIR_MAX_WEIGHT = FLOOR_PAIR_MAX_CONCENTRATION_PCT / 100;
export const FLOOR_PAIR_MIN_WEIGHT = Math.max(0, 1 - (2 - 1) * FLOOR_PAIR_MAX_WEIGHT);

/**
 * What one firing carries: the WHOLE lane weight.
 *
 * Outside R15's [0.05, 0.25] move cap by construction, and cleared by name.
 * `applyMove` still clamps it to the room the source actually has, so a lane
 * already at zero moves nothing and the decision records what moved.
 */
export const FLOOR_PAIR_MOVE_WEIGHT = 1;

/**
 * The weekly turnover ceiling, in percent of the book.
 *
 * 100 admits ONE full move per week and refuses the second, which is the
 * budget doing its job rather than the budget being switched off: the
 * evaluator refuses a firing it cannot fund and never sizes it down.
 */
export const FLOOR_PAIR_TURNOVER_PCT_WEEK = 100;
