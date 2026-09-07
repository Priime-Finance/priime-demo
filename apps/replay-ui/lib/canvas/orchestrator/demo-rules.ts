/**
 * THE DEMO'S ROUTER RULE, AND THE FOUR NUMBERS BEHIND IT.
 *
 * ── THE FOUNDER'S RULING (plan R2, docs/plans/ROUTER_LANE_PLAN.md) ────────
 * "If the recursive loop lane has smaller yield for 48 hours than a classic
 * USDC lending on Aave, then the router unwinds the recursive loop position
 * and relocates the capital to a backup Aave USDC lending, and the opposite
 * too."
 *
 * The 48 hours are HIS and are fixed. The margin is DERIVED, not zero: a zero
 * margin churns on noise and pays the friction twice for a crossing that
 * reverses the next day. Both directions are ONE mechanism, because both
 * lanes derive the same rule and lane A's `better_elsewhere` moving to B is
 * lane B's rule read from the other end.
 *
 * This module wraps `deriveOrchRules` and overrides four fields on the
 * `:upgrade` rule: `sustainPins`, `threshold`, `rearmLevel` and, on the floor
 * pair, `moveWeight`. Nothing else is touched and no second rule table exists.
 *
 * ══ THIS IS A DEVIATION FROM THE LIVE ROUTER, AND HERE IS WHY (G1) ════════
 *
 * The live router SHIFTS allocation inside a concentration band. Between a
 * lane and its floor the founder asked for something else: "unwinds the
 * recursive loop position and relocates the capital", and "rebuilds the loop".
 * Measured, the shipped machine cannot do that at any legal dial: at two lanes
 * `minWeight = max(0, 1 - (N - 1) * maxWeight)` is 40%, so a book seated 50/50
 * shifts at most 10pp, and the 80% ceiling only widens the band to [20%, 80%].
 * A 40/60 band is not an evacuation, and leaving 40% of the book in a lane
 * that published minus eleven percent for six weeks is not the product he
 * asked for.
 *
 * So on the FLOOR PAIR ONLY (`lib/canvas/floor-pair.ts`, which owns the four
 * numbers and the predicate) one firing carries the whole lane weight and the
 * pair's band is [0, 1]. Two invariants have to give way for that, and each is
 * cleared BY NAME with its reason in `validateDemoRouter` below:
 *
 *   per-tick-and-budget-caps   R15's [0.05, 0.25] move cap, on the `:upgrade`
 *                              rule of a floor-pair lane and on nothing else.
 *   dial-range                 the concentration dial at 100, outside its own
 *                              [35, 80], so the published ceiling and the
 *                              slots' band state ONE policy.
 *
 * Everything else is enforced unchanged: R25's sustain (the founder's 48
 * hours), R28's 2pp hysteresis gap, R29's cooldown floor, R30's anti-cycle
 * lock and its payback extension, R23's weight sum, R36's class coherence and
 * R38's derived-only rule (re-checked against this module's own derivation).
 * The switch is patient, hysteretic, and refuses to come straight back.
 *
 * ONE MORE OWNER MOVED, and it is named here because it is the same ruling:
 * `sizeMove`'s R33 per-tick clamp is `0.25 x source equity`, which would have
 * quietly sized a whole-lane move down to 12.5pp. The evaluator's own doctrine
 * is that a move is REFUSED, never silently sized down, so the clamp now reads
 * `max(0.25, moveWeight) x source equity`: the identity for every rule inside
 * R15, and the rule's own ask for one that has cleared R15 by name.
 *
 * ── 48 HOURS IN PINS, ON BOTH CADENCES ───────────────────────────────────
 * A sustain window counts OBSERVATIONS, not hours (types.ts: "a sustain
 * window counts observations, not changes"), so the hours have to be
 * converted at the cadence of the source that is being watched.
 *
 *   modeled replay   one pin per day        48h -> 2 pins
 *   live cadence     one pin per hour       48h -> 48 pins
 *
 * The live cadence is MEASURED, not assumed: `lib/vaults/onchain-executions.ts`
 * carries nine captured `handleSignedEnvelope` transactions off Base, and the
 * median gap between consecutive ones is 3,540 seconds with a mode of exactly
 * 3,600. `router-backtest.test.ts` re-computes that median from the capture
 * and fails if the handler's cadence moves off the hour.
 *
 * ── THE FRICTION OF THIS EXACT MOVE ──────────────────────────────────────
 * The move is: repay the USDC debt and withdraw the USDe collateral on Morpho
 * Blue Base, swap USDe to USDC on Base, supply USDC to the Aave v3 Base
 * reserve. The reverse leg is the mirror: withdraw from Aave, swap USDC to
 * USDe, supply the collateral and borrow on Morpho. Four protocol actions
 * each way, one chain, no bridge, no settlement window.
 *
 * TWO TERMS, and the first is the one a flat constant cannot express:
 *
 *   SWAP. The swap rides the LEVERED notional. Moving E dollars of equity out
 *   of a loop at L means selling L x E of collateral, so a swap cost quoted
 *   as a fraction of notional costs L times as much as a fraction of the
 *   capital moved. At the demo's own move size the notional is
 *   2.5 x $3,125 = $7,812.50.
 *
 *   Measured 2026-09-07 against the KyberSwap aggregator on Base, at exactly
 *   that notional, both directions, with the two token addresses read off the
 *   Morpho Blue API for this market (USDe
 *   0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34, USDC
 *   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913):
 *
 *       USDe to USDC   7.12 bps
 *       USDC to USDe   2.64 bps
 *       round trip     9.76 bps
 *
 *   The two legs differ because USDe trades a few basis points under a dollar
 *   and the loop's oracle does not: selling it pays that gap and buying it
 *   back recovers it. It is therefore paid ONCE PER ROUND TRIP, not once per
 *   leg, so the honest per-move figure is HALF the round trip, 4.88 bps, and
 *   charging the expensive leg's 7.12 bps to every move would overcharge a
 *   completed round trip by 4.48 bps. The rule is symmetric by construction,
 *   so the cost it is derived from has to be symmetric too.
 *
 *   GAS. Four actions at $0.50, the product's own Base gas-per-action
 *   constant (`lib/backtest/presets.ts:63`, the same $0.50 `compoundDelta`
 *   charges auto-compound and `dnLpModel` charges a recenter), against the
 *   $3,125 the move carries. It is 100x the $0.005 KyberSwap quoted for the
 *   swap transaction itself on the day, so this leg is a conservative upper
 *   bound and it is the product's, not a new number.
 *
 * ── WHY THIS PAIR DIFFERS FROM `MOVE_FRICTION_FRAC_SAME_CHAIN` ───────────
 * `MOVE_FRICTION_FRAC_SAME_CHAIN` is 0.007, derived as "2 x one-shot exec,
 * about the EXEC_DRAG_APR scale" (rule-schema.ts:75). It is an analogy to an
 * ANNUAL drag constant, applied to any same-chain pair at any size. Measured,
 * this pair costs 0.00186 one way, about a quarter of it, and it differs on
 * both axes the flat constant cannot see:
 *
 *   it is LEVERAGE-DEPENDENT (the swap rides 2.5x the capital moved), and
 *   it is BOOK-SIZE-DEPENDENT (gas is a fixed dollar cost per action).
 *
 * At the modeled $25,000 book the gas leg is 6.4 bps; at the attested $500
 * NAV the same four actions are 320 bps and the derived bar would be 13.5%,
 * at which no crossing in the measured history fires. The friction below is
 * quoted at the product's own modeled reference book, the same denominator
 * `compoundDelta` and `dnLpModel` use, and that choice is what makes the
 * number comparable to every other modeled figure on the screen.
 *
 * ── THE BAR, AND THE ONE FRICTION IT IS DERIVED FROM ─────────────────────
 * `upgradeThreshold` is the arithmetic: `(oneShotFrac + windowCost) / (90/365)`,
 * floored at the 3% register floor. Both endpoints settle same-block, so
 * `windowCost` is exactly zero and the raw one-way break-even is
 * 0.00186 x 365/90 = 0.754%. Twice that, 1.508%, is the ROUND-TRIP
 * break-even: a move and its return, both paid inside one horizon, which is
 * the honest bar for a mechanism whose own hysteresis is symmetric.
 *
 * 1.508% IS THE BAR THAT SHIPS, and the block on `DEMO_UPGRADE_THRESHOLD`
 * below carries the measurement that chose it. The register floor is not the
 * bar any more because the thing that used to force it is gone: the machine
 * charged `MOVE_FRICTION_FRAC_SAME_CHAIN` (0.007) in every cost record while
 * publishing a bar derived from 0.00186, and `paybackMs` turned that second
 * friction into an effective 2.84pp bar no rule had stated. One friction
 * prices one move now (`demoRouterPricing`), the effective floor is the
 * one-way break-even itself, and both derived candidates are reachable.
 *
 * So the founder's ruling changes the PATIENCE (13 scans becomes 2 days) and
 * the measurement changes the BAR (3.00pp becomes 1.51pp). Both are computed
 * here rather than assumed, so if the friction moves they move with it.
 *
 * ── HYSTERESIS, SYMMETRIC, AND LEGALLY NEGATIVE ──────────────────────────
 * `rearmLevel` is `threshold - 2pp`, the R28 floor met exactly, which is what
 * `deriveOrchRules` already does for this metric. At a 1.508% bar that is
 * MINUS 0.492%, and a negative re-arm level is legal, is still exactly the
 * 2pp gap the invariant asks for, and says something a positive one cannot:
 * the rule re-arms only once the improvement has been at or under -0.492% for
 * two consecutive days, which is the OTHER lane leading by 0.492%. A lane
 * that merely stops trailing does not re-arm the rule that left it; the lane
 * it moved to has to fall behind. That is a stricter anti-churn condition
 * than the 1.0% level a 3pp bar produced, not a weaker one. The way back is
 * the SAME margin measured from the other lane, so nothing about the
 * mechanism prefers one direction.
 *
 * ── R38, AND WHY IT IS RE-CHECKED RATHER THAN WAIVED ─────────────────────
 * `validateOrchestrator` re-derives the rule set with `deriveOrchRules` and
 * reports `derived-only` when the config does not byte-equal it. A demo rule
 * set never will. `validateDemoRouter` runs the full validator and clears
 * that one violation ONLY after re-deriving from `demoDeriveAllRouterRules`,
 * which is a pure function of the same three arguments. The invariant's own
 * requirement, that no rule is hand-authored and every rule is re-derivable
 * from (dials, slot, peers), is therefore checked and not waived. Every other
 * invariant, R28 and R25 included, is enforced unchanged.
 */

/* THIS IMPORT USED TO BE FIRST AND LOAD-BEARING. It is neither any more.
   F6 was real: `rule-schema` imported `../capacity`, which reaches
   `./templates` -> `./graph-ops` -> `./orchestrator` (index), whose module
   body calls `concentrationFloorPct` back into `rule-schema`, so entering
   `rule-schema` first threw "Cannot access 'CONCENTRATION_BASE_FLOOR_PCT'
   before initialization" at load time. It is FIXED AT ITS OWNER: `capacity`'s
   `fmtCapacityUsd` moved to `lib/canvas/format.ts` (a module with no imports
   at all) and `capacity.ts` re-exports it, so `rule-schema` now imports
   nothing but leaves and can be entered first. `tests/rule-schema-entry.test.ts`
   imports it alone and fails if the cycle comes back. */
import { DN_LP_MODEL } from "@/lib/canvas/templates";

import {
  FLOOR_PAIR_MOVE_WEIGHT,
  isDemoFloorPair,
} from "@/lib/canvas/floor-pair";
import {
  deriveMoveWeight,
  deriveOrchRules,
  exitProfileFor,
  upgradeThreshold,
  validateOrchestrator,
} from "./rule-schema";
import type { ExitEndpoint } from "./rule-schema";
import type { ExitProfile, LoopSlot, OrchRule, OrchViolation, OrchestratorConfig } from "./types";
import { ORCH_DIAL_DEFAULTS, type OrchestratorDials } from "@/lib/canvas/param-schema";
import { HERO_SEED_LEVERAGE } from "@/lib/demo/market";

/**
 * The modeled book the friction is quoted against: the seed TVL every
 * published vault gets (`lib/vaults/store.ts` baseTvlUsd). Read off
 * `DN_LP_MODEL` because `mock-quote`'s own `MODELED.refTvlUsd` is private to
 * that file; both carry the same value from the same source. Cross-package
 * request filed to lift the pair into one exported owner.
 */
export const DEMO_ROUTER_BOOK_USD = DN_LP_MODEL.modeledTvlUsd;

/** Gas per automated action on Base, USD. Same constant, same reason. */
export const DEMO_MOVE_GAS_USD_PER_ACTION = DN_LP_MODEL.gasPerRecenterUsd;

/** Morpho repay, Morpho withdraw, one swap, Aave supply. The reverse leg is
 *  Aave withdraw, one swap, Morpho supply, Morpho borrow: four either way. */
export const DEMO_MOVE_GAS_ACTIONS = 4;

/**
 * THE NOTIONAL THE FRICTION WAS MEASURED AT, and under the switch it is no
 * longer the size of a move.
 *
 * `deriveMoveWeight(ORCH_DIAL_DEFAULTS)` is 0.125, so the shipped machine's
 * firing carries $3,125 of the modeled book, and that is the size the
 * KyberSwap quote below was taken at. A floor-pair firing now carries the
 * whole lane, $12,500 off a book seated 50/50, and the quote was NOT re-taken
 * at that size, so the swap leg is quoted at the size it was measured at.
 *
 * The direction of the error is stated rather than assumed. Gas is a fixed
 * dollar cost, so a SMALLER denominator makes the gas leg a LARGER fraction:
 * 6.4 bps here against 1.6 bps at the whole-lane size. The friction below is
 * therefore an upper bound on the switch's gas, and the bar derived from it is
 * conservative. Re-quoting the swap at $31,250 of USDe would move the swap leg
 * by an unmeasured amount in an unknown direction, and inventing that number
 * is the one thing this module refuses to do.
 */
export const DEMO_ROUTER_MOVE_WEIGHT = deriveMoveWeight(ORCH_DIAL_DEFAULTS);

/** The dollars the quote was taken at: the shipped move weight on the modeled
 *  book. See the block above for why it is not the size of a switch. */
export const DEMO_ROUTER_MOVED_USD = DEMO_ROUTER_BOOK_USD * DEMO_ROUTER_MOVE_WEIGHT;

/** The collateral a move sells or buys: `L` times the capital moved. */
export const DEMO_ROUTER_SWAP_NOTIONAL_USD = HERO_SEED_LEVERAGE * DEMO_ROUTER_MOVED_USD;

/**
 * One-way USDe/USDC swap cost on Base as a fraction of NOTIONAL, measured
 * 2026-09-07 at $7,812.50 through the KyberSwap aggregator: 7.12 bps selling
 * USDe, 2.64 bps buying it, 9.76 bps round trip, and this is half of that.
 * A MEASUREMENT with a date, not a house constant: it is re-measurable at the
 * addresses and the size named in the header.
 */
export const DEMO_SWAP_COST_FRAC_ONE_WAY = 0.000488;

/** The swap leg as a fraction of the CAPITAL MOVED: `L` x the notional cost. */
export const DEMO_MOVE_SWAP_FRAC = HERO_SEED_LEVERAGE * DEMO_SWAP_COST_FRAC_ONE_WAY;

/** The gas leg as a fraction of the capital moved, at the modeled book. */
export const DEMO_MOVE_GAS_FRAC =
  (DEMO_MOVE_GAS_ACTIONS * DEMO_MOVE_GAS_USD_PER_ACTION) / DEMO_ROUTER_MOVED_USD;

/**
 * THE ONE-WAY FRICTION OF THIS MOVE, as a fraction of the capital relocated.
 * 0.00122 of swap plus 0.00064 of gas. Compare `MOVE_FRICTION_FRAC_SAME_CHAIN`
 * 0.007: see the header for the two axes on which they differ.
 */
export const DEMO_MOVE_FRICTION_FRAC_ONE_WAY = DEMO_MOVE_SWAP_FRAC + DEMO_MOVE_GAS_FRAC;

/**
 * The exit profile of a relocation between these two lanes.
 *
 * `settleSeqs` and `windowCost` are ZERO because both ends are atomic: the
 * Aave v3 withdraw settles same-block while the reserve holds unborrowed
 * liquidity (the issuer row's own `instant-usdc` route, settlementDays 0) and
 * a Morpho unwind is one transaction. They are stated rather than omitted, so
 * a future endpoint with a redemption window enters through the same field
 * `exitProfileFor` already prices.
 */
export function demoExitProfile(): ExitProfile {
  return { oneShotFrac: DEMO_MOVE_FRICTION_FRAC_ONE_WAY, settleSeqs: 0, windowCost: 0 };
}

/**
 * THE RAW BREAK-EVEN, one way, before the register floor: the bar at which a
 * single move pays its own friction back inside the 90-day horizon.
 * `upgradeThreshold` floors its answer at 3%, so the raw number is computed
 * here from its own arithmetic and the two are compared rather than confused.
 */
export const DEMO_BAR_ONE_WAY_BREAKEVEN = Number(
  ((DEMO_MOVE_FRICTION_FRAC_ONE_WAY * 365) / 90).toFixed(5),
);

/** The ROUND-TRIP break-even: a move and its return, both paid inside one
 *  horizon. Twice the one-way bar, and the honest bar for a mechanism whose
 *  own hysteresis is symmetric. */
export const DEMO_BAR_ROUND_TRIP_BREAKEVEN = Number((2 * DEMO_BAR_ONE_WAY_BREAKEVEN).toFixed(5));

/** The register floor, through the shipped owner: never advertise a bar under
 *  3pp. `UPGRADE_THRESHOLD_FLOOR` itself is not edited. */
export const DEMO_BAR_REGISTER_FLOOR = upgradeThreshold(demoExitProfile());

/**
 * ══ THE BAR THAT SHIPS, RE-MEASURED UNDER ONE FRICTION (G2) ══════════════
 *
 * F4 measured the three candidates under 10pp band shifts and the register
 * floor won. The first fix wave re-measured them under the switch and the
 * register floor won again, but for a reason that turned out to be an
 * ARTEFACT: the evaluator was charging `MOVE_FRICTION_FRAC_SAME_CHAIN` (0.007)
 * in every cost record while the rule published a bar derived from the
 * measured 0.00186, so `paybackMs` refused anything under an effective 2.84pp
 * and only the 3.0pp candidate survived a gate no rule had stated. That second
 * friction is gone (`demoRouterPricing`), and the ranking was taken again at
 * all three bars, over both windows, in every regime, folded through the
 * shipped `evaluateOrchestrator` (`tests/router-backtest.test.ts`, table in
 * docs/plans/ROUTER_QUANT.md, section "under the switch, measured friction",
 * 2026-09-07 night).
 *
 * The since-incentive window is the one this vault could have existed in, and
 * it is the one G2 rules by. Measured there, THE ROUND-TRIP BAR AND THE
 * REGISTER FLOOR ARE IDENTICAL: the same move count and the same routed return
 * to the third decimal in all four regimes. The one-way bar is separated and
 * it is separated the wrong way, taking a move on the default regime that ends
 * the window at 2.221% against 2.946% for standing still. So the measurement
 * ties the top two and G2's tie-break rules: prefer the lower derived bar,
 * because it is the closer reading of the founder's sentence.
 *
 * **1.508% ships.** It is the round-trip break-even, twice the one-way
 * `upgradeThreshold` arithmetic on the measured friction, so it still moves if
 * the friction moves. `UPGRADE_THRESHOLD_FLOOR` is not edited: this constant
 * sits UNDER the register floor by name, which is the licence G2 granted a
 * demo-scoped owner, and `DEMO_BAR_REGISTER_FLOOR` stays exported so the floor
 * it sits under is readable rather than implied. All three candidates stay
 * exported, because the sensitivity is the argument and a deleted candidate is
 * an argument nobody can check.
 */
export const DEMO_UPGRADE_THRESHOLD = DEMO_BAR_ROUND_TRIP_BREAKEVEN;

/**
 * R28's floor met exactly: the safe side is 2pp inside the bar, both ways.
 *
 * A bar UNDER 2pp puts the re-arm BELOW ZERO, which is where the shipped
 * 1.508% bar puts it (-0.492%). That is legal, it is still exactly the 2pp gap
 * `validateOrchestrator` asks for, and it means the OTHER lane has to lead by
 * that much before the rule re-arms: a lane that merely stops trailing does
 * not re-arm the rule that left it. It is exported as a function so the
 * sensitivity folds derive their re-arm the same way the shipped one does.
 */
export function demoRearmFor(bar: number): number {
  return Number((bar - 0.02).toFixed(6));
}

export const DEMO_UPGRADE_REARM = demoRearmFor(DEMO_UPGRADE_THRESHOLD);

/**
 * ══ ONE FRICTION FOR ONE MOVE, AND THIS IS WHERE IT IS CHARGED ═══════════
 *
 * The bar above is DERIVED from `DEMO_MOVE_FRICTION_FRAC_ONE_WAY`, the rail
 * this pair was measured on. Every surface that then PRICES a move used to
 * ask `exitProfileFor(source, dest)` instead, which knows only whether the
 * two venues share a chain and answers the flat `MOVE_FRICTION_FRAC_SAME_CHAIN`
 * (0.007, itself an analogy to an annual drag constant). So the machine
 * published a bar derived from 18.6 bps and then charged 70 bps: the dock
 * printed `Move cost 0.70%`, the evaluator's cost record carried it into every
 * decision, and `paybackMs` turned it into an EFFECTIVE bar of 2.84pp that
 * silently overrode whatever the rule published. Two frictions for one move,
 * and the depositor sentence named the one that was not charged.
 *
 * This is the one owner. It answers BOTH questions a priced move asks (what
 * does the rail cost, and what bar does that cost justify) so no caller can
 * take one from here and the other from somewhere else, and it is scoped by
 * the SAME predicate the rest of the switch is scoped by: a portfolio that is
 * not this pair gets `exitProfileFor` and `upgradeThreshold` unchanged.
 *
 * Its readers are the three surfaces that price a move:
 *   `lib/canvas/router-fold.ts`            through `evaluateOrchestrator`'s
 *                                          `exitProfile` hook, so the replay,
 *                                          the run panel and the backtest all
 *                                          charge the measured rail
 *   `components/canvas/dock/LanePanel.tsx` `composedRoute`, the dock's
 *                                          `Move cost` and its printed bar
 *   this module                            the bar the rule publishes
 */
export function demoRouterPricing(
  candidateIds: readonly string[],
  source: ExitEndpoint,
  dest: ExitEndpoint,
): { exit: ExitProfile; bar: number } {
  if (isDemoFloorPair([...new Set(candidateIds)])) {
    return { exit: demoExitProfile(), bar: DEMO_UPGRADE_THRESHOLD };
  }
  const exit = exitProfileFor(source, dest);
  return { exit, bar: upgradeThreshold(exit) };
}

/** The profile alone, in the shape `evaluateOrchestrator`'s hook takes. Same
 *  owner, same predicate: a curried `demoRouterPricing().exit`. */
export function demoRouterExitProfile(
  candidateIds: readonly string[],
): (source: ExitEndpoint, dest: ExitEndpoint) => ExitProfile {
  return (source, dest) => demoRouterPricing(candidateIds, source, dest).exit;
}

/** The founder's window, in hours. Fixed by ruling; the margin is derived. */
export const DEMO_SUSTAIN_HOURS = 48;

/** 48 hours at one observation per day. */
export const DEMO_SUSTAIN_PINS_DAILY = 2;

/** 48 hours at the live handler's measured hourly cadence. */
export const DEMO_SUSTAIN_PINS_HOURLY = 48;

/**
 * The demo's rule set for one lane.
 *
 * `deriveOrchRules` produces everything; this replaces three fields on the
 * one rule the founder's sentence is about. A rule that is not
 * `better_elsewhere` passes through untouched, so the funding guard, the gate
 * guard and the capacity guard are the shipped ones.
 *
 * `sustainPins` defaults to the daily replay's 2. The live route passes
 * `DEMO_SUSTAIN_PINS_HOURLY` for the same 48 hours on the hourly cadence:
 * one window, two clocks, and the caller states which clock it is on.
 */
export function demoRouterRules(
  dials: OrchestratorDials,
  slot: LoopSlot,
  peers: readonly LoopSlot[] = [],
  sustainPins: number = DEMO_SUSTAIN_PINS_DAILY,
  bar: number = DEMO_UPGRADE_THRESHOLD,
): OrchRule[] {
  /* THE SWITCH APPLIES TO BOTH ENDS OF THE PAIR. On the loop lane the peer IS
     the floor; on the floor lane the same mechanism is read from the other end
     (plan R2: lane A's rule moves to B, lane B's rule moves back to A), and the
     founder's sentence asks for the rebuild to be as whole as the evacuation.
     A lane whose portfolio is not this pair keeps the shipped move weight. */
  const wholeLane = isFloorPairSlot(slot, peers);
  return deriveOrchRules(dials, slot, peers).map((r) =>
    r.metric === "better_elsewhere"
      ? {
          ...r,
          sustainPins,
          threshold: bar,
          rearmLevel: demoRearmFor(bar),
          ...(wholeLane ? { moveWeight: FLOOR_PAIR_MOVE_WEIGHT } : {}),
        }
      : r,
  );
}

/** Is this slot one half of the demo's floor pair? Pure, and a function of the
 *  same three arguments R38 re-derives from. */
export function isFloorPairSlot(slot: LoopSlot, peers: readonly LoopSlot[]): boolean {
  const ids = [slot.candidateId, ...peers.filter((p) => p.slotId !== slot.slotId).map((p) => p.candidateId)];
  return isDemoFloorPair([...new Set(ids)]);
}

/** Every lane's rules, in the deterministic order `deriveAllOrchRules` uses. */
export function demoDeriveAllRouterRules(
  dials: OrchestratorDials,
  slots: readonly LoopSlot[],
  sustainPins: number = DEMO_SUSTAIN_PINS_DAILY,
  bar: number = DEMO_UPGRADE_THRESHOLD,
): OrchRule[] {
  const sorted = [...slots].sort((a, b) => a.slotId.localeCompare(b.slotId));
  return sorted.flatMap((s) => demoRouterRules(dials, s, sorted, sustainPins, bar));
}

/**
 * WHAT THE SWITCH RELAXES, BY NAME, WITH THE REASON. Nothing else is cleared.
 *
 * Exported so a test can assert the list rather than trust the filter, and so
 * a reader of the module can see the whole deviation in one object.
 */
export const DEMO_ROUTER_RELAXATIONS: readonly {
  readonly invariant: string;
  readonly rule: string;
  readonly scope: string;
  readonly reason: string;
  /** The scope above, as the predicate the validator actually applies. */
  readonly matches: (v: OrchViolation, wholeLaneRuleIds: ReadonlySet<string>) => boolean;
}[] = [
  {
    invariant: "per-tick-and-budget-caps",
    rule: "R15 move cap",
    scope: "the `:upgrade` rule of a floor-pair lane, and no other rule",
    reason:
      "one firing carries the whole lane, because between a lane and its floor the router evacuates and rebuilds rather than shifting inside a band",
    matches: (v, ids) => [...ids].some((id) => v.detail.startsWith(`${id}:`)),
  },
  {
    invariant: "dial-range",
    rule: "the concentration floor and ceiling",
    scope: "maxConcentrationPct on a two-lane floor pair, and no other dial",
    reason:
      "the pair's band is [0, 1], and the published ceiling has to state the same policy the slots carry",
    matches: (v) => v.detail.startsWith("maxConcentrationPct "),
  },
];

/**
 * The full validator, with R38 re-checked against the demo's own derivation
 * rather than waived, and the switch's two relaxations cleared by name.
 * Returns [] on a clean config.
 */
export function validateDemoRouter(
  cfg: OrchestratorConfig,
  sustainPins: number = DEMO_SUSTAIN_PINS_DAILY,
  bar: number = DEMO_UPGRADE_THRESHOLD,
): OrchViolation[] {
  const violations = validateOrchestrator(cfg);
  const expected = JSON.stringify(demoDeriveAllRouterRules(cfg.dials, cfg.loops, sustainPins, bar));
  const actual = JSON.stringify([...cfg.rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId)));
  /* R38 IS RE-CHECKED, NOT WAIVED: the rule set has to be re-derivable from
     (dials, slots) through this module's own pure function before anything is
     cleared. A tampered draft keeps every violation it earned, including this
     one. */
  if (expected !== actual) return violations;

  /* The pair the switch is declared for. A config that is not this pair gets
     no relaxation at all, so a third lane or a different market puts the
     shipped invariants straight back. */
  const pair = isDemoFloorPair(cfg.loops.map((l) => l.candidateId));
  const wholeLaneRuleIds = new Set(
    cfg.rules.filter((r) => r.metric === "better_elsewhere" && r.moveWeight === FLOOR_PAIR_MOVE_WEIGHT).map((r) => r.ruleId),
  );
  /* THE LIST IS THE FILTER, not a second copy of it. `DEMO_ROUTER_RELAXATIONS`
     is what this module publishes as its deviation and what the test asserts,
     so a relaxation nobody wrote down cannot be applied and one that is written
     down cannot be silently skipped. */
  return violations.filter((v) => {
    if (v.invariant === "derived-only") return false;
    if (!pair) return true;
    return !DEMO_ROUTER_RELAXATIONS.some(
      (r) => r.invariant === v.invariant && r.matches(v, wholeLaneRuleIds),
    );
  });
}
