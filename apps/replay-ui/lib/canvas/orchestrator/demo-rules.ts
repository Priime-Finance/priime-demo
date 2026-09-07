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
 * This module wraps `deriveOrchRules` and overrides exactly three fields on
 * the `:upgrade` rule: `sustainPins`, `threshold` and `rearmLevel`. Nothing
 * else is touched and no second rule table exists.
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
 * ── THE BAR, AND THE HONEST SURPRISE ─────────────────────────────────────
 * `upgradeThreshold` is the owner: `(oneShotFrac + windowCost) / (90/365)`,
 * floored at the 3% register floor. Both endpoints settle same-block, so
 * `windowCost` is exactly zero and the raw bar is 0.00186 x 365/90 = 0.75%.
 * That is UNDER the register floor, so the bar that ships is 3.0%, and the
 * demo's derived threshold lands on the same digits as the generic same-chain
 * derivation for an entirely different reason: this move is cheap, and the
 * product refuses to advertise a bar below 3pp even when the arithmetic would
 * pay the move back in 23 days. The constant is still COMPUTED here rather
 * than assumed, so if the friction moves the bar moves with it.
 *
 * So the only field the founder's ruling actually changes is the PATIENCE:
 * 13 scans becomes 2 days.
 *
 * ── HYSTERESIS, SYMMETRIC ────────────────────────────────────────────────
 * `rearmLevel` is `threshold - 2pp`, the R28 floor met exactly, which is what
 * `deriveOrchRules` already does for this metric. After a move the rule
 * re-arms only once the improvement has been at or under 1.0% for two
 * consecutive days. The way back is the SAME margin measured from the other
 * lane, so nothing about the mechanism prefers one direction.
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

/* ⚠ THIS IMPORT IS FIRST AND THAT IS LOAD-BEARING, NOT A STYLE CHOICE.
   `rule-schema` imports `../capacity`, which imports `./templates`, which
   imports `./graph-ops`, which imports `./orchestrator` (index) whose module
   body CALLS `concentrationFloorPct` from `rule-schema` at line 120. Entering
   `rule-schema` first therefore throws
   "Cannot access 'CONCENTRATION_BASE_FLOOR_PCT' before initialization" at load
   time. Verified 2026-09-07: a test file whose only import is `rule-schema`
   fails to load, and the same file with `templates` imported first passes.
   Loading `templates` first walks the cycle in the order the app already
   walks it. Reported as a cross-package finding; the fix belongs in
   `rule-schema`/`orchestrator/index`, which this package does not own. */
import { DN_LP_MODEL } from "@/lib/canvas/templates";

import { deriveMoveWeight, deriveOrchRules, upgradeThreshold, validateOrchestrator } from "./rule-schema";
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

/** What one firing moves at the default dials, as a fraction of the book. */
export const DEMO_ROUTER_MOVE_WEIGHT = deriveMoveWeight(ORCH_DIAL_DEFAULTS);

/** The dollars one firing carries, at the modeled book. */
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

/** The improvement a move must clear, through the `upgradeThreshold` owner. */
export const DEMO_UPGRADE_THRESHOLD = upgradeThreshold(demoExitProfile());

/** R28's floor met exactly: the safe side is 2pp inside the bar, both ways. */
export const DEMO_UPGRADE_REARM = Number((DEMO_UPGRADE_THRESHOLD - 0.02).toFixed(6));

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
): OrchRule[] {
  return deriveOrchRules(dials, slot, peers).map((r) =>
    r.metric === "better_elsewhere"
      ? { ...r, sustainPins, threshold: DEMO_UPGRADE_THRESHOLD, rearmLevel: DEMO_UPGRADE_REARM }
      : r,
  );
}

/** Every lane's rules, in the deterministic order `deriveAllOrchRules` uses. */
export function demoDeriveAllRouterRules(
  dials: OrchestratorDials,
  slots: readonly LoopSlot[],
  sustainPins: number = DEMO_SUSTAIN_PINS_DAILY,
): OrchRule[] {
  const sorted = [...slots].sort((a, b) => a.slotId.localeCompare(b.slotId));
  return sorted.flatMap((s) => demoRouterRules(dials, s, sorted, sustainPins));
}

/**
 * The full validator, with R38 re-checked against the demo's own derivation
 * rather than waived. Returns [] on a clean config.
 */
export function validateDemoRouter(
  cfg: OrchestratorConfig,
  sustainPins: number = DEMO_SUSTAIN_PINS_DAILY,
): OrchViolation[] {
  const violations = validateOrchestrator(cfg);
  const expected = JSON.stringify(demoDeriveAllRouterRules(cfg.dials, cfg.loops, sustainPins));
  const actual = JSON.stringify([...cfg.rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId)));
  if (expected !== actual) return violations;
  return violations.filter((v) => v.invariant !== "derived-only");
}
