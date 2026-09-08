/**
 * REVIEW & LAUNCH arming (recette P1-1). Pure, no React.
 *
 * The canvas must never say "review when ready" while its own data says the
 * builder has something left to fix. Every clause that closes this gate names
 * something they can act on, and states the number the refusal rests on.
 *
 * Scan eligibility is deliberately NOT one of those clauses. It rides out on
 * `ineligible` instead, because it is a market condition the builder cannot
 * change and which is currently true of every market on offer. The long note
 * at the end of `deriveReviewGate` has the measurements.
 *
 * Extended (recette item 9) with the three facts the canvas already held and
 * was re-deciding inline: a lane with no market, a market that cannot absorb
 * one minimum deposit, and a lane whose own modelled net APY is at or below
 * zero. All three are optional on the fact so a caller that does not know
 * them asserts nothing; an absent fact never closes a gate.
 *
 * P0-6, 2026-08-22 — THE GATE SPEAKS THE PRODUCT'S OWN WORDS. Every reason
 * that said `loop` says `lane`: a portfolio can hold a collar lane and an LP
 * lane, neither of which is a loop, and `lane` is already the product's word
 * in seven files. `the orchestrator` becomes `the capital router`
 * (ORCHESTRATOR_DEF.name), and `launch-shaped` — internal vocabulary — becomes
 * `finished`. The one reason that named no action and no number now prints the
 * VALIDATOR'S OWN sentence, which names both. And a fourth optional lane fact
 * lands, `hasModule`, for the one closed state that had no sentence at all: a
 * lane holding nothing but its market.
 */

import { isLiveModule, REVIEW_REASON_COMING_SOON } from "@/lib/demo-scope";

import { pct } from "./format";
import { MODULE_DEFS } from "./modules";
import type { ModuleKey } from "./types";

export interface ReviewLaneFact {
  /** Lane has a live ok quote and a launch-shaped graph on a launchable venue. */
  laneReviewable: boolean;
  /** Scan eligibility from the lane's live quote; null = no quote yet. */
  eligible: boolean | null;
  /** A market is picked on this lane. Omitted = not asserted, never false. */
  hasMarket?: boolean;
  /**
   * This lane holds a module that DOES something with a deposit — anything
   * beyond the `liquidity-source` that merely pins the market.
   *
   * A lane holding only its source is a supply position, not a vault: it is
   * never launch-shaped, and `validatePortfolio` raises no ISSUE for it (its
   * requirement groups are simply unsatisfied), so until this fact existed the
   * gate fell through to "the portfolio has open validation issues" — a
   * sentence naming a problem the validator never reported, on the exact state
   * every module-first build passes through.
   *
   * Optional like every other lane fact here: omitted asserts nothing and can
   * never close the gate.
   */
  hasModule?: boolean;
  /**
   * The module keys seated on this lane. A key that is not live in this build
   * (`lib/demo-scope.ts`) closes the gate with `REVIEW_REASON_COMING_SOON`:
   * the shelf never seats one, so this is the belt to that brace. Optional
   * like every other lane fact: omitted asserts nothing.
   */
  placed?: readonly ModuleKey[];
  /**
   * `validateGraph(lane).missing` — the lane's unsatisfied SINGLETON required
   * groups, i.e. positions this lane must hold and does not.
   *
   * Deliberately NOT `missingAny`: a multi-member group is a fork (`loop` is
   * finished by `safety-buffer` OR `hedge`), and printing one of its members
   * as the thing to add is the steering this wave struck down. A lane whose
   * only gap is a fork gets the generic sentence, and the rack's own bays show
   * the choice.
   *
   * Optional like every other lane fact: omitted asserts nothing.
   */
  missing?: readonly ModuleKey[];
  /** This lane's market can absorb one minimum deposit. Omitted = not asserted. */
  acceptsDeposits?: boolean;
  /**
   * The lane's DISPLAYED modelled net APY (recette item 9). At or below zero
   * the gate closes: the model is saying a depositor ends the period with
   * less than they put in, and this canvas already refuses to publish a
   * vault that cannot take a deposit at all. Null or omitted means "no
   * number yet", which the quote gate above already covers.
   */
  netApy?: number | null;
}

export interface ReviewGate {
  armed: boolean;
  /** Human reason the key is dark; null when armed. */
  reason: string | null;
  /**
   * Every lane's market fails the venue launch gates on the latest scan.
   * This DISCLOSES, it never blocks: see the note at the end of
   * `deriveReviewGate`. Absent on the early-return paths, where the gate is
   * already closed for a reason the builder can act on.
   */
  ineligible?: boolean;
}

/**
 * A validator sentence in the gate's register: its own words, decapitalised to
 * sit beside "pick a market for every lane".
 *
 * ONLY the first character, and only when the second is not also a capital, so
 * `cbETH/WETH cannot be priced on a treasury collar lane` survives intact. A
 * flat `toLowerCase()` would have printed `cbeth/weth`, which is a different
 * market than the one on the rack.
 */
function inRegister(sentence: string): string {
  const [a, b] = [sentence[0] ?? "", sentence[1] ?? ""];
  if (a !== a.toLowerCase() && b === b.toLowerCase()) return a.toLowerCase() + sentence.slice(1);
  return sentence;
}

export function deriveReviewGate(args: {
  validationOk: boolean;
  /**
   * The first sentence `validatePortfolio` raised, verbatim. Optional: absent
   * asserts nothing, and a caller that does not have one gets the fallback
   * below rather than a sentence invented here.
   */
  validationIssue?: string | null;
  lanes: ReviewLaneFact[];
  orchOn: boolean;
  launchShapedCount: number;
}): ReviewGate {
  if (args.lanes.length === 0) {
    return { armed: false, reason: "nothing on the canvas yet" };
  }
  /* RUNS FIRST, and before the market clause, because a lane holding nothing
     that earns is not a vault whichever market it is pointed at. This is the
     state a module-first build starts in and the one the gate was silent
     about. */
  if (args.lanes.some((l) => l.hasModule === false)) {
    return { armed: false, reason: "add a module to every lane" };
  }
  if (args.lanes.some((l) => l.hasMarket === false)) {
    return { armed: false, reason: "pick a market for every lane" };
  }
  /* COMING SOON OUTRANKS EVERY CLAUSE BELOW: a lane holding a module this
     build does not run has nothing to quote, validate or price. */
  if (args.lanes.some((l) => (l.placed ?? []).some((k) => !isLiveModule(k)))) {
    return { armed: false, reason: REVIEW_REASON_COMING_SOON };
  }
  /* THE ROUTER CLAUSE RUNS BEFORE THE VALIDATOR'S SENTENCE, and it moved here
     in the same edit that started printing that sentence. `validatePortfolio`
     raises this same fact as an issue reading "The orchestrator needs at least
     two launch-shaped loops to govern" — three words a builder has never seen,
     in the sentence explaining why their vault will not publish. Printing the
     validator verbatim is right everywhere else and wrong here, because this is
     the one fact the gate already says better. Same condition, same trigger,
     the product's own words. */
  if (args.orchOn && args.launchShapedCount < 2) {
    return { armed: false, reason: "the capital router needs two finished lanes" };
  }
  if (!args.validationOk) {
    /* The validator already wrote a sentence naming the module and the lane it
       does not fit. Printing "the portfolio has open validation issues" over
       the top of it was the only reason in the product that named no action and
       no number, and it hid a sentence that named both. */
    if (args.validationIssue) return { armed: false, reason: inRegister(args.validationIssue) };

    /* NO ISSUE, SO NOTHING IS WRONG — SOMETHING IS MISSING, and those are
       different sentences. Added in the wave audit 2026-08-22.

       `validateGraph` closes on two independent grounds: an ISSUE (a module
       that cannot be here) and an UNSATISFIED REQUIRED GROUP (a position the
       lane does not hold yet). Only the first has a sentence of its own, so
       the second fell to the fallback below and the product told the builder
       a module did not fit when every module fitted perfectly. Measured live
       on `/build?new=1`: `{liquidity-source, auto-center}` pinned to the LP
       row — a lane one press from finished — read `one lane holds a module
       that does not fit it`.

       So name what is missing. `missing` is the lane's unsatisfied SINGLETON
       groups, which are positions rather than choices; a multi-member group
       is a fork, and naming one of its members would be the steering this
       wave struck down, so `missingAny` deliberately does not reach here. */
    const wanted = [...new Set(args.lanes.flatMap((l) => l.missing ?? []))];
    if (wanted.length > 0 && wanted.length <= 2) {
      const names = wanted.map((k) => MODULE_DEFS[k].name.toLowerCase());
      return { armed: false, reason: `add ${names.join(" and ")} to finish` };
    }
    if (wanted.length > 2) {
      return { armed: false, reason: "some lanes are missing required modules" };
    }
    return { armed: false, reason: "one lane holds a module that does not fit it" };
  }
  if (!args.lanes.every((l) => l.laneReviewable)) {
    return { armed: false, reason: "waiting on a live quote for every lane" };
  }
  if (args.lanes.some((l) => l.acceptsDeposits === false)) {
    return { armed: false, reason: "one market is not accepting deposits" };
  }
  /* The reason names the number, because the number is the objection: a
     depositor is owed the figure the refusal rests on, not an adjective. */
  const neg = args.lanes.find((l) => typeof l.netApy === "number" && l.netApy <= 0);
  if (neg) {
    return {
      armed: false,
      reason: `one lane models ${pct(neg.netApy)} net, at or below zero`,
    };
  }
  /* Scan eligibility DISCLOSES, it does not block. It used to close the gate,
     and on the live catalog that made the primary action permanently dead:
     all 26 rows across all four venues carry `eligible: false`, because the
     launch gates are the ones a REAL vault must clear to open with real
     capital (a sample row passes 13 of 17 and fails risk_feature,
     debt_market_open, wrapper_basis, marginal_rates_carry).

     Every other clause above names something the builder can act on: pick a
     market, fix a validation issue, wait for a quote, choose a market that
     accepts deposits, lower a leverage that models negative. This one names a
     market condition they cannot change and that is true of every market on
     offer. A gate that is permanently closed and unactionable is not a
     safeguard, it is a dead end, and it is the same shape as the ratified
     ruling that catalog staleness belongs in chrome rather than in a
     notification, because it would be permanently true and permanently
     unactionable.

     So the fact travels instead of blocking: `ineligible` rides on the gate,
     the review decode carries per-lane eligibility, and the published record
     states it. The canvas still refuses to publish a vault that cannot take a
     deposit or that models a loss. */
  const ineligible = args.lanes.every((l) => l.eligible === false);
  return { armed: true, reason: null, ineligible };
}
