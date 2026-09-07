/**
 * Orchestrator rule derivation + validation + evaluation (ORCHESTRATOR_SPEC
 * §2, §4). The BC-P3 one-derivation-one-validator contract: deriveOrchRules
 * is the ONLY producer of OrchRule[]; validateOrchestrator is the mirror of
 * validateBands (typed violations; any violation blocks render/compile).
 *
 * Every mechanism here transplants a rule that survived production:
 * streaks-with-reset from confirmForceCloseClear, hysteresis floors from the
 * SS-2/15pp band incidents, cooldown floors and the 2×-friction test from
 * the 2026-05-13 rebalance-bleed retune, the 0.25-per-tick clamp from the
 * W15 reserve system, emergency-does-one-bounded-thing from the defender.
 *
 * HONEST V1 LINE (§3): everything in this file is composition + modeled
 * preview. There is NO execution rail; intents are display + log only.
 */

/* `ECON_FLOOR_APY` is NO LONGER IMPORTED HERE, and that is the point of B.4:
   the screen a lane was admitted through now arrives ON the slot
   (`screenedAtApy`), so the derivation cannot apply a levered-loop gate to a
   lane that never passed it. `MIN_CAPACITY_USD` stays because the absolute
   capacity leg is switched by the same slot field, not looked up per lane. */
/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import {
  DEPEG_MAX_CUR,
  KILL_SWITCH_CEILING_APR as LAUNCH_KILL_SWITCH_CEILING_APR,
  MIN_CAPACITY_USD,
  MIN_HEDGED_DEPOSIT_USD,
} from "@/lib/model-constants";
/* BOTH FROM `../format`, WHICH HAS NO IMPORTS AT ALL, and that is what makes
   this file safe to enter first (F6). `fmtCapacityUsd` used to come from
   `../capacity`, which reaches `./templates` -> `./graph-ops` ->
   `./orchestrator` (index), whose module body calls `concentrationFloorPct`
   back into this file: entering here first threw "Cannot access
   'CONCENTRATION_BASE_FLOOR_PCT' before initialization" at LOAD time, so a
   route whose module graph happened to reach this file first threw at runtime
   rather than at build. `capacity.ts` re-exports the formatter, so no other
   caller moved. `tests/rule-schema-entry.test.ts` imports this module alone. */
import { fmtCapacityUsd, pct } from "../format";
import {
  clampOrchDials,
  minDepositUsd,
  ORCH_COOLDOWN_FLOOR_MS,
  ORCH_DIAL_DEFAULTS,
  ORCH_REACTIVITY_K,
  type HlMarginBandsDerived,
  type OrchestratorDials,
} from "../param-schema";
import { PAUSE_DESTINATION } from "./types";
import type {
  ExitProfile,
  LoopSlot,
  ObservationRef,
  OrchestratorConfig,
  OrchRule,
  OrchRuleState,
  OrchViolation,
  PinObservation,
  ReallocIntent,
  SlotLiveState,
} from "./types";

/* `PinObservation` MOVED to ./types (spec B.2) and is re-exported here so the
   dozen call sites that import it from this module keep one import path. Its
   shape is now `{ ref: ObservationRef, breaching, safeSide, nowMs }`: the
   block number and the content hash were three jobs wearing two names. */
export type { PinObservation };

// ── Grounding constants (all real, cited in the spec header) ──────────────

/** R8: orchestrator funding exit must fire strictly above W13's kill band. */
export const KILL_SWITCH_CEILING_APR = LAUNCH_KILL_SWITCH_CEILING_APR; // −10
export const ORCH_FUNDING_FLOOR_APR = -0.05;
/** R13: the 0.25 per-move cap mirrors the reserve rail's 0.25·E clamp. */
export const MOVE_WEIGHT_CAP = 0.25;
export const MOVE_WEIGHT_FLOOR = 0.05;
/** R13 sizing assumption: expected firings per week for the budget split. */
const EXPECTED_FIRINGS_PER_WEEK = 2;
/** R32 friction defaults: 2 × one-shot exec ≈ EXEC_DRAG_APR scale. */
export const MOVE_FRICTION_FRAC_SAME_CHAIN = 0.007;
export const MOVE_FRICTION_FRAC_CROSS_CHAIN = 0.02;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * D12 — THE PAYBACK HORIZON, and why the flat 3% was only ever right by
 * accident.
 *
 * A move costs `friction` ONCE, as a fraction of the capital moved, and buys
 * an APY improvement `Δ` that accrues continuously. It breaks even after
 * `friction / Δ` years. A threshold is therefore not a taste parameter: it
 * is `friction / H` for whatever payback horizon H the house is willing to
 * wait, and it MUST move with the friction.
 *
 * H = 90 days is the same window the basis deviation is measured over, so
 * the two numbers that decide a destination are quoted over one horizon.
 *
 *   same chain  0.007 / (90/365) = 2.84%  → floored at the 3% register
 *   cross chain 0.020 / (90/365) = 8.11%
 *
 * The old flat 3% was the same-chain answer applied to a cross-chain move,
 * so a 3.1pp cross-chain "upgrade" cleared a bar it pays back in 243 days —
 * against a reverse lock of 6 days. It could round-trip forty times before
 * the first leg broke even.
 */
export const PAYBACK_HORIZON_DAYS = 90;
const PAYBACK_HORIZON_YEARS = PAYBACK_HORIZON_DAYS / 365;
/** The register floor: never advertise a bar below 3%, even on cheap rails. */
export const UPGRADE_THRESHOLD_FLOOR = 0.03;

/**
 * The chain a venue settles on. Venue ids are `${protocol}-${chain}` by
 * construction (`aave-v3-base`, `morpho-blue-hyperevm`,
 * `dolomite-berachain`), so the chain is the last segment. Kept here rather
 * than as a LoopSlot field so no caller can supply a slot whose declared
 * chain disagrees with its venue.
 */
export function chainOfVenue(venue: string): string {
  const i = venue.lastIndexOf("-");
  return i > 0 ? venue.slice(i + 1) : venue;
}

/** The one-shot rail cost of a move, as a fraction of the capital moved. The
 *  SOLE owner of the same/cross pair; every exit profile reads it here. */
function oneShotFrac(sameChain: boolean): number {
  return sameChain ? MOVE_FRICTION_FRAC_SAME_CHAIN : MOVE_FRICTION_FRAC_CROSS_CHAIN;
}

/**
 * One end of a move, carrying the three facts that price leaving it or
 * arriving at it.
 *
 * `moveFrictionFrac(sameChain)` used to answer the whole question with a
 * boolean about chains, and a boolean about chains cannot say how long the
 * capital is OUT OF THE MARKET. A treasury lane is exactly the case it could
 * not price: the rail is cheap and the redemption window is the cost.
 */
export interface ExitEndpoint {
  /** `${protocol}-${chain}`; `chainOfVenue` parses the suffix. */
  venue: string;
  /**
   * The lane's own return in the PUBLISHED frame — the number the product
   * prints and the number `riskAdjUnified` ranks on. A venue-frame APY here
   * prices the wait in a frame no surface draws (the recorded two-frames
   * defect), so the caller composes first and passes the composed number.
   */
  publishedNetApy: number;
  /**
   * MEASURED days the capital is out of the market when it leaves this
   * endpoint. 0 for an atomic rail. Sourced from the row (`redemption-route`
   * writes the picked issuer's own window); never a house constant.
   */
  settlementDays: number;
  /** Observations this endpoint's source publishes per day. Converts a wait
   *  in days into the clock that ends it. 0 when the source has no cadence. */
  observationsPerDay: number;
}

/**
 * The one-shot and carried cost of leaving `source` for `dest`.
 *
 * `exitDiscountFrac` is DELIBERATELY ABSENT from this arithmetic. Nothing in
 * the repo measures a secondary-market exit discount, and a fabricated
 * constant reaching a signed artifact is the defect the register exists to
 * refuse. When something measures one it enters here, as a fourth term with a
 * source, and not before.
 *
 * THE WAIT IS BOTH LEGS, and this is a stated extension of the spec's
 * `windowCost = sourceApy * settleDays / 365`. Capital redeems out of the
 * source (T+N) and then subscribes into the destination (T+M), earning
 * nothing across either. Counting only the source's leg understates the cost
 * of moving INTO a treasury lane, which is the router's headline move on an
 * inversion, and understating the headline move is the defect. Every
 * non-treasury lane carries `settlementDays: 0`, so the sum is byte-for-byte
 * the spec's formula everywhere it already applied.
 *
 * The foregone return is the SOURCE's, in both legs: the frame is "against
 * staying put", and staying put is what the source would have paid.
 * `publishedNetApy` may be negative — on an inversion it is — and the sign is
 * carried through rather than clamped, because a wait that avoids a negative
 * carry is genuinely cheaper and the register floor below is what keeps the
 * published bar honest.
 */
export function exitProfileFor(source: ExitEndpoint, dest: ExitEndpoint): ExitProfile {
  const sameChain = chainOfVenue(source.venue) === chainOfVenue(dest.venue);
  const settleDays = Math.max(0, source.settlementDays) + Math.max(0, dest.settlementDays);
  const perDay = Math.max(0, dest.observationsPerDay);
  return {
    oneShotFrac: oneShotFrac(sameChain),
    settleSeqs: settleDays > 0 && perDay > 0 ? Math.ceil(settleDays * perDay) : 0,
    windowCost: (source.publishedNetApy * settleDays) / 365,
  };
}

/**
 * The RAIL-ONLY profile: chain cost, no settlement window.
 *
 * This is everything `deriveOrchRules` is allowed to know. R38 re-derives the
 * rule set byte-for-byte from `(dials, slot, peers)` alone, and a `LoopSlot`
 * carries no settlement clock and no APY, so a derivation that priced a wait
 * would be reading a fact it cannot re-read. The rule publishes the bar the
 * rail alone justifies; the evaluator, which does hold both endpoints, prices
 * the actual move through `exitProfileFor` and can only ever refuse more.
 */
export function railExitProfile(sameChain: boolean): ExitProfile {
  return { oneShotFrac: oneShotFrac(sameChain), settleSeqs: 0, windowCost: 0 };
}

/**
 * The improvement a move must clear to pay its own cost back inside the
 * horizon. Chain-aware, because the rail cost is; window-aware, because the
 * wait is.
 *
 * THE BREAK-EVEN, DERIVED (this is the sensitivity the register records, and
 * there are TWO crossings because the published bar is quoted on a grid):
 *
 *   RAW crossing. `oneShotFrac + windowCost` has to clear
 *   `0.03 × 90/365 = 0.0073972`. A same-chain rail spends 0.007 of that and
 *   leaves 0.0003972 for the window, so at a 2.75% published source
 *   `0.0275 × d/365 > 0.0003972` needs d > 5.27 days.
 *
 *   PUBLISHED crossing. The bar rounds to 3 decimals, a 0.1pp grid, so the
 *   number a reader sees leaves 3.0% only once the raw bar reaches 0.0305,
 *   which is d ≥ 6.91 days.
 *
 * Both are computed here rather than typed. Either way the window binds on
 * the WRAPPED shape, whose redemption is a multi-day cooldown, and is
 * numerically inert on an atomic issuer. That is why no unmeasured exit
 * discount is needed to make the term matter. The days themselves are a
 * MEASURED row field, not a number this file knows.
 */
export function upgradeThreshold(exit: ExitProfile): number {
  const raw = (exit.oneShotFrac + exit.windowCost) / PAYBACK_HORIZON_YEARS;
  return Math.max(UPGRADE_THRESHOLD_FLOOR, Number(raw.toFixed(3)));
}

/**
 * How long the capital must stay put for a move to break even, in ms.
 * `Infinity` when the improvement is non-positive: a move that buys nothing
 * never pays anything back, and the reverse edge stays locked.
 */
export function paybackMs(exit: ExitProfile, improvementApy: number): number {
  if (!(improvementApy > 0)) return Infinity;
  return ((exit.oneShotFrac + exit.windowCost) / improvementApy) * YEAR_MS;
}

// ── D4: the concentration ceiling is a function of the lane count ─────────

/** The dial's own grid step and hard ceiling; the floor moves, these do not. */
export const CONCENTRATION_STEP_PCT = 5;
export const CONCENTRATION_MAX_PCT = 80;
/** The register floor: below this a pilot-sized book over-fragments. */
export const CONCENTRATION_BASE_FLOOR_PCT = 35;

/**
 * The lowest ceiling N lanes can actually satisfy, snapped UP to the dial's
 * own 5% grid.
 *
 * `max_i w_i ≥ 1/N` for any Σw = 1, so a ceiling under 100/N is a rule no
 * allocation can obey. The static 35 was infeasible at exactly one lane
 * count and it was the common one: at N = 2 the even split is 50/50 and the
 * dial happily offered 35, so the vault was in permanent violation of its
 * own printed policy and tip B11's apply just walked the breach between the
 * two lanes until the oscillation mute swallowed it.
 *
 * ── ONE LANE, AND THE CONTRADICTION THIS FUNCTION USED TO CARRY (INV-2) ───
 * The old body said "a single lane holds the whole book by definition, so the
 * ceiling is vacuous there" and then returned 35, which the caller went on to
 * ENFORCE as a ceiling. Both halves cannot be true. Measured consequence: a
 * one-lane portfolio published `weights-sum: loop_x: 0 ≤ 1 ≤ 1 ≤ 0.6 ≤ 1
 * fails` at the default dial and at every other stop, because the lane's
 * `targetWeight` is 1 by construction and no reachable ceiling is. That is
 * the demo's own A/B negative half (`?lanes=carry`), so the shape the product
 * shows to prove the treasury lane matters was itself in violation.
 *
 * The repair is the general rule with no exception carved out of it: the
 * lowest feasible ceiling is `100/N` on the grid, which is 100 at N = 1, and
 * the dial's hard ceiling may not cap the feasible floor below itself — a
 * ceiling under `100/N` is exactly the unsatisfiable rule this function
 * exists to refuse. Nothing moves at N ≥ 2: `100/N` is at most 50 there, so
 * `CONCENTRATION_MAX_PCT` was never the binding term except at one lane.
 *
 * `laneCount < 1` (an ungoverned portfolio) keeps the register floor: there
 * is no even split to be feasible against.
 */
export function concentrationFloorPct(laneCount: number): number {
  if (!Number.isFinite(laneCount) || laneCount < 1) return CONCENTRATION_BASE_FLOOR_PCT;
  const feasible = Math.ceil(100 / laneCount / CONCENTRATION_STEP_PCT) * CONCENTRATION_STEP_PCT;
  return Math.max(CONCENTRATION_BASE_FLOOR_PCT, feasible);
}

/**
 * The ceiling a lane count admits: the dial's hard stop, or the feasible
 * floor when that floor is higher. ONE OWNER for the pair, because the floor
 * and the ceiling have to be read against each other or the band inverts.
 */
export function concentrationCeilingPct(laneCount: number): number {
  return Math.max(concentrationFloorPct(laneCount), CONCENTRATION_MAX_PCT);
}

/**
 * The dial value a lane count actually permits. Snapped to the 5% grid.
 *
 * MOVED HERE FROM `index.ts` so that `buildOrchestratorConfig` can clamp the
 * dial it publishes at the lane count it publishes it for. It used to live in
 * the barrel, which this file cannot import (initialization cycle), so the
 * config carried an unclamped `maxConcentrationPct` while both slot builders
 * carried the clamped one, and `validateOrchestrator` compared the two.
 */
export function clampConcentrationPct(value: number, laneCount: number): number {
  const floor = concentrationFloorPct(laneCount);
  const ceiling = concentrationCeilingPct(laneCount);
  if (!Number.isFinite(value)) return Math.min(ceiling, Math.max(floor, ORCH_DIAL_DEFAULTS.maxConcentrationPct));
  const snapped =
    floor +
    Math.round((Math.min(ceiling, Math.max(floor, value)) - floor) / CONCENTRATION_STEP_PCT) *
      CONCENTRATION_STEP_PCT;
  return Math.min(ceiling, Math.max(floor, snapped));
}

// ── R7: the default derived rule set (per loop) ───────────────────────────

/** Base (k=1) cooldowns per rule family; scaled by k, floored at 6h (R15). */
const BASE_COOLDOWN_MS: Record<string, number> = {
  "apy-floor": 24 * HOUR_MS,
  capacity: 12 * HOUR_MS,
  funding: 24 * HOUR_MS,
  gate: 6 * HOUR_MS,
  "basis-warn": 12 * HOUR_MS,
  upgrade: 72 * HOUR_MS,
};

function sustain(base: number, k: number): number {
  return Math.max(2, Math.ceil(base * k)); // R15: sustainPins ≥ 2
}

function cooldown(ruleKey: string, k: number): number {
  return Math.max(ORCH_COOLDOWN_FLOOR_MS, Math.round((BASE_COOLDOWN_MS[ruleKey] ?? 24 * HOUR_MS) * k));
}

/** R13: per-firing moveWeight from the turnover budget, clamped to R15 range. */
export function deriveMoveWeight(dials: OrchestratorDials): number {
  const w = Math.min(MOVE_WEIGHT_CAP, dials.turnoverBudgetPctWeek / 100 / EXPECTED_FIRINGS_PER_WEEK);
  return Math.max(MOVE_WEIGHT_FLOOR, Number(w.toFixed(6)));
}

/**
 * The R7 table for ONE slot. k = reactivity multiplier (R11). Rule ids are
 * `${slotId}:${family}` so state persists per (ruleId) == per (rule, slot).
 *
 * EVERY LANE GETS THE FULL SET, AT EVERY LANE COUNT (recette item 19). This
 * derivation was already lane-count blind; what was not was every SURFACE
 * above it, all of which only ran at N ≥ 2, so a single-lane vault published
 * carrying neither a funding guard nor a yield guard while the plate said
 * FOLLOW THE YIELD. A one-lane portfolio cannot reallocate, but it can
 * absolutely notice that its funding went negative and stop — that is the
 * guard, and it is derived here regardless of how many peers exist.
 *
 * `peers` is the rest of the portfolio and affects exactly one number: the
 * `upgrade` threshold, which must cover the most expensive destination this
 * slot could reach (D12). No peers, or peers on this slot's own chain, and
 * the same-chain bar applies.
 *
 * ── WHICH RULES A LANE GETS, AND THE QUESTION THAT DECIDES (spec B.4) ─────
 * The gate is no longer "what class is this slot", it is "does this lane
 * produce the quantity this rule reads". A rule that reads a quantity its
 * lane cannot produce is not a guard, it is a promise — the D11 sentence
 * applied to a rule, and it is why `basis_early_warn` sat on every N1 lane
 * reading a `curBasisDev` no client row carries.
 *
 *   apy-floor        slot.screenedAtApy !== null, AT that threshold.
 *                    ECON_FLOOR_APY is the LEVERED-LOOP scan gate. A lane at
 *                    L = 1 never passed through it, so there is no screen for
 *                    it to fall below, and applying it anyway leaves the lane
 *                    permanently breaching and every firing resolving to
 *                    `pause`. Measured: all 24 funding fixture rows sit under
 *                    the floor, max 0.076961, zero eligible.
 *   capacity abs     same gate, same reason: MIN_CAPACITY_USD is the same
 *                    scan. Threshold 0 turns the absolute leg off; it is not
 *                    a $0 floor, and the decode drops the clause.
 *   capacity shrink  EVERY slot. Half of a 13-pin trailing high is an
 *                    observation about the lane's OWN history and is honest
 *                    anywhere, screened or not.
 *   gate, upgrade    every slot, unchanged.
 *   funding          slot.metrics.funding (was `cls === "A"`).
 *   basis-warn       slot.metrics.basis (was `cls === "N1"`).
 *
 * `cls` is no longer read here. It stays a closed two-member union and keeps
 * its existing job on the slot; it just stopped being a proxy for a question
 * the slot can now answer directly.
 *
 * BYTE MOVEMENT, STATED. A levered lane whose metrics agree with its old
 * class derives byte-identically to today. An UNLEVERED lane loses
 * `apy-floor` and the absolute capacity leg (founder call H-3, approved), and
 * a lane whose source publishes neither funding nor basis loses that rule.
 * Both are re-pins, not regressions: the rule that leaves was one the lane
 * could never satisfy.
 *
 * NOTE (documented deviation): R7 lists the `upgrade` rearmLevel as +0.015,
 * which violates R28's own ≥2pp floor against the +0.03 threshold. R28 is
 * the invariant; the rearm is set at threshold − 2pp (gap exactly 2pp).
 */
export function deriveOrchRules(
  dials: OrchestratorDials,
  slot: LoopSlot,
  peers: readonly LoopSlot[] = [],
): OrchRule[] {
  const d = clampOrchDials(dials);
  const k = ORCH_REACTIVITY_K[d.reactivity];
  const moveWeight = deriveMoveWeight(d);
  const chain = chainOfVenue(slot.venue);
  const sameChainOnly = peers.every((p) => p.slotId === slot.slotId || chainOfVenue(p.venue) === chain);
  const upgradeAt = upgradeThreshold(railExitProfile(sameChainOnly));
  /* The absolute capacity floor is the same scan gate as the APY floor, so it
     is on exactly when the lane was screened. 0 is the leg OFF, not a $0
     bound, and `decodeOrchRule` drops the clause rather than printing one. */
  const capacityAbs = slot.screenedAtApy !== null ? MIN_CAPACITY_USD : 0;
  const rules: OrchRule[] = [
    {
      ruleId: `${slot.slotId}:capacity`,
      metric: "capacity_shrink",
      threshold: capacityAbs, // 100_000 abs when screened, else the shrink leg alone
      shrinkFrac: 0.5,
      lookbackPins: 13,
      sustainPins: sustain(3, k),
      rearmLevel: 1.15 * capacityAbs, // 15% relative — the param-schema 15pp echo
      cooldownMs: cooldown("capacity", k),
      moveWeight,
      destination: "best_eligible",
    },
    {
      ruleId: `${slot.slotId}:gate`,
      metric: "gate_flip",
      threshold: 0,
      shrinkFrac: null,
      lookbackPins: 0,
      /** R9: 2 fixed, not 1 — every scanner gate fails closed on missing data;
       *  two consecutive failing pins at distinct blocks distinguishes a real
       *  flip from an RPC flap (FC_CLEAR_CONSECUTIVE_FLAT = 2 reasoning). */
      sustainPins: 2,
      rearmLevel: 0, // boolean metric: re-arm = sustainPins clean pins
      cooldownMs: cooldown("gate", k),
      moveWeight,
      destination: PAUSE_DESTINATION,
    },
    {
      ruleId: `${slot.slotId}:upgrade`,
      metric: "better_elsewhere",
      threshold: upgradeAt,
      shrinkFrac: null,
      lookbackPins: 0,
      sustainPins: sustain(13, k),
      rearmLevel: Number((upgradeAt - 0.02).toFixed(6)), // R28 floor: exactly 2pp
      cooldownMs: cooldown("upgrade", k),
      moveWeight,
      destination: "best_eligible",
    },
  ];
  if (slot.screenedAtApy !== null) {
    rules.push({
      ruleId: `${slot.slotId}:apy-floor`,
      metric: "net_apy_floor",
      threshold: slot.screenedAtApy, // the screen this lane was ADMITTED through
      shrinkFrac: null,
      lookbackPins: 0,
      sustainPins: sustain(6, k),
      rearmLevel: slot.screenedAtApy + 0.02, // floor + 2pp (≥ CARRY_P25_FLOOR gap)
      cooldownMs: cooldown("apy-floor", k),
      moveWeight,
      destination: "best_eligible",
    });
  }
  if (slot.metrics.funding) {
    rules.push({
      ruleId: `${slot.slotId}:funding`,
      metric: "funding_p25_streak",
      threshold: ORCH_FUNDING_FLOOR_APR, // −0.05, strictly above the −10 APR kill band (R8)
      shrinkFrac: null,
      lookbackPins: 0,
      sustainPins: sustain(6, k),
      rearmLevel: 0.0,
      cooldownMs: cooldown("funding", k),
      moveWeight,
      destination: "best_eligible",
    });
  }
  if (slot.metrics.basis) {
    rules.push({
      ruleId: `${slot.slotId}:basis-warn`,
      metric: "basis_early_warn",
      threshold: 0.5 * DEPEG_MAX_CUR, // 0.0025
      shrinkFrac: null,
      lookbackPins: 0,
      sustainPins: sustain(3, k),
      rearmLevel: 0.4 * DEPEG_MAX_CUR, // 20% relative gap
      cooldownMs: cooldown("basis-warn", k),
      moveWeight,
      destination: "best_eligible",
    });
  }
  return rules.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** All rules for all slots, deterministic order (R14: one pure derivation). */
export function deriveAllOrchRules(dials: OrchestratorDials, slots: LoopSlot[]): OrchRule[] {
  const sorted = [...slots].sort((a, b) => a.slotId.localeCompare(b.slotId));
  return sorted.flatMap((s) => deriveOrchRules(dials, s, sorted));
}

// ── Canonical serialization + hash (contentHash discipline) ───────────────

export function canonicalRules(rules: OrchRule[]): string {
  return JSON.stringify(
    [...rules]
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId))
      .map((r) => ({
        ruleId: r.ruleId,
        metric: r.metric,
        threshold: r.threshold,
        shrinkFrac: r.shrinkFrac,
        lookbackPins: r.lookbackPins,
        sustainPins: r.sustainPins,
        rearmLevel: r.rearmLevel,
        cooldownMs: r.cooldownMs,
        moveWeight: r.moveWeight,
        destination: r.destination,
      })),
  );
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function rulesHash(rules: OrchRule[]): Promise<string> {
  return sha256Hex(canonicalRules(rules));
}

/** Build the deep derived config from dials + slots (R16). By construction
 *  R38 holds; validateOrchestrator still re-checks for tampered inputs. */
export async function buildOrchestratorConfig(
  dials: OrchestratorDials,
  loops: LoopSlot[],
): Promise<OrchestratorConfig> {
  const rules = deriveAllOrchRules(dials, loops);
  /* THE PUBLISHED DIAL IS CLAMPED AT THE LANE COUNT, which is the same number
     both slot builders clamp `maxWeight` with and the same number
     `LanePanel` renders. `clampOrchDials` is lane-count blind by design (it
     is the wire-format clamp), so the config used to publish a ceiling the
     slots beside it did not honour. `deriveAllOrchRules` is deliberately fed
     the UNCLAMPED dials above: no rule reads `maxConcentrationPct`, so
     `rulesHash` does not move, and R38 re-derives from `cfg.dials` through
     the same lane-blind reactivity and turnover fields it always did. */
  const clamped = clampOrchDials(dials);
  return {
    v: 1,
    loops: [...loops].sort((a, b) => a.slotId.localeCompare(b.slotId)),
    dials: {
      ...clamped,
      maxConcentrationPct: clampConcentrationPct(clamped.maxConcentrationPct, loops.length),
    },
    rules,
    rulesHash: await rulesHash(rules),
  };
}

// ── R4: the ONE cross-class ranking metric ────────────────────────────────

/**
 * D12 — the deviation is a 90-DAY figure and the yield is ANNUAL. Subtracting
 * one from the other unannualized understated the risk penalty by 365/90 ≈
 * 4.06x, on the single metric that decides where capital goes: a 3x lane
 * with a 0.4% 90-day basis deviation was docked 1.2pp when its annualized
 * exposure to that same deviation is 4.87pp. The cheap-looking destination
 * was systematically the volatile one.
 *
 * Both terms are now per-annum, which is the only way the subtraction means
 * anything at all.
 *
 * ── ONE FRAME PER SCREEN (spec WP-1, INV-11) ─────────────────────────────
 * The first argument is the PUBLISHED number: the lane's return after
 * `composedTerms` and the compute fee, which is the number the chart draws
 * and the number the card prints. It used to be named `netApyOnDepositApy`,
 * the VENUE frame, and the two differ by the fee — so the chart drew one
 * ranking and the router decided on another. Two objects on one screen must
 * not disagree about what a return is.
 *
 * The contract binds the PRODUCER of `SlotLiveState.riskAdjUnified`, which is
 * where this function is actually called from: pass the composed published
 * number, never the venue-frame one.
 */
export const BASIS_DEV_ANNUALIZER = 365 / PAYBACK_HORIZON_DAYS;

export function riskAdjUnified(
  publishedNetApy: number,
  loopLeverage: number,
  maxBasisDev90d: number | null,
): number {
  return publishedNetApy - loopLeverage * (maxBasisDev90d ?? 0) * BASIS_DEV_ANNUALIZER;
}

// ── §4 validator: mirror of validateBands ─────────────────────────────────

export function validateOrchestrator(cfg: OrchestratorConfig): OrchViolation[] {
  const v: OrchViolation[] = [];

  // R23 weights-sum. With the reserve deleted the loops ARE the book, so the
  // sum is over the loops alone and there is no idle term to absorb a gap.
  const sum = cfg.loops.reduce((s, l) => s + l.targetWeight, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    v.push({ invariant: "weights-sum", detail: `Σ targetWeights = ${sum} ≠ 1` });
  }
  for (const l of cfg.loops) {
    if (!(l.minWeight >= 0 && l.minWeight <= l.targetWeight && l.targetWeight <= l.maxWeight && l.maxWeight <= 1)) {
      v.push({
        invariant: "weights-sum",
        detail: `${l.slotId}: 0 ≤ ${l.minWeight} ≤ ${l.targetWeight} ≤ ${l.maxWeight} ≤ 1 fails`,
      });
    }
  }

  // R15 dial clamps. The concentration floor is LANE-COUNT AWARE (D4): a
  // ceiling under 1/N is arithmetically unsatisfiable, so at 2 lanes the
  // static 35 asked for a split no allocation can produce and every apply
  // just moved the violation to the other lane.
  const d = cfg.dials;
  const concFloor = concentrationFloorPct(cfg.loops.length);
  /* THE UPPER BOUND IS LANE-AWARE TOO, or the band inverts at one lane: the
     feasible floor there is 100 and a hard stop of 80 would put every legal
     value outside its own range. `concentrationCeilingPct` is the one owner
     of that pairing. */
  const concCeiling = concentrationCeilingPct(cfg.loops.length);
  if (d.maxConcentrationPct < concFloor || d.maxConcentrationPct > concCeiling) {
    v.push({
      invariant: "dial-range",
      detail: `maxConcentrationPct ${d.maxConcentrationPct} outside [${concFloor}, ${concCeiling}] at ${cfg.loops.length} loops`,
    });
  }
  if (d.turnoverBudgetPctWeek < 10 || d.turnoverBudgetPctWeek > 100) {
    v.push({ invariant: "dial-range", detail: `turnoverBudgetPctWeek ${d.turnoverBudgetPctWeek} outside [10, 100]` });
  }

  for (const r of cfg.rules) {
    // R25 no-flapping-sustain
    if (r.sustainPins < 2) {
      v.push({ invariant: "no-flapping-sustain", detail: `${r.ruleId}: sustainPins ${r.sustainPins} < 2` });
    }
    // R29 cooldown-floor
    if (r.cooldownMs < ORCH_COOLDOWN_FLOOR_MS) {
      v.push({ invariant: "cooldown-floor", detail: `${r.ruleId}: cooldown ${r.cooldownMs}ms < 6h` });
    }
    // R15 moveWeight range
    if (r.moveWeight < MOVE_WEIGHT_FLOOR - 1e-9 || r.moveWeight > MOVE_WEIGHT_CAP + 1e-9) {
      v.push({ invariant: "per-tick-and-budget-caps", detail: `${r.ruleId}: moveWeight ${r.moveWeight} outside [0.05, 0.25]` });
    }
    // R28 hysteresis-floor (skip boolean gate_flip)
    if (r.metric === "net_apy_floor" || r.metric === "funding_p25_streak") {
      if (r.rearmLevel - r.threshold < 0.02 - 1e-9) {
        v.push({ invariant: "hysteresis-floor", detail: `${r.ruleId}: rearm ${r.rearmLevel} − threshold ${r.threshold} < 2pp` });
      }
    } else if (r.metric === "better_elsewhere") {
      if (r.threshold - r.rearmLevel < 0.02 - 1e-9) {
        v.push({ invariant: "hysteresis-floor", detail: `${r.ruleId}: threshold ${r.threshold} − rearm ${r.rearmLevel} < 2pp` });
      }
    } else if (r.metric === "capacity_shrink") {
      if (r.rearmLevel < r.threshold * 1.15 - 1e-6) {
        v.push({ invariant: "hysteresis-floor", detail: `${r.ruleId}: rearm ${r.rearmLevel} < 15% above floor ${r.threshold}` });
      }
    } else if (r.metric === "basis_early_warn") {
      if (r.threshold - r.rearmLevel < r.threshold * 0.2 - 1e-9) {
        v.push({ invariant: "hysteresis-floor", detail: `${r.ruleId}: basis rearm gap under 20% relative` });
      }
    }
    // R8/R35 funding-orders-below-kill (APR units: −0.10 == −10% APR band edge)
    if (r.metric === "funding_p25_streak" && r.threshold <= -0.1) {
      v.push({
        invariant: "funding-orders-below-kill",
        detail: `${r.ruleId}: funding threshold ${r.threshold} not strictly above the W13 kill band (−0.10)`,
      });
    }
    /* R36 — REWRITTEN TO THE PRODUCTION PREDICATE (spec B.4).
       The question stopped being "what class is this slot" and became "does
       this lane produce the quantity this rule reads". `cls` answered a
       nearby question and answered it wrong on both sides: a treasury lane
       lands at N1 and would have been handed a basis warning on a
       `curBasisDev` no client row carries, and a class-A lane that is not a
       funding market would have been handed a funding streak with no print
       behind it. A rule reading a quantity its lane cannot produce is not a
       guard, it is a promise. */
    const slot = cfg.loops.find((l) => r.ruleId.startsWith(`${l.slotId}:`));
    if (slot) {
      if (r.metric === "funding_p25_streak" && !slot.metrics.funding) {
        v.push({
          invariant: "class-coherence",
          detail: `${r.ruleId}: funding rule on a lane whose source publishes no funding print`,
        });
      }
      if (r.metric === "basis_early_warn" && !slot.metrics.basis) {
        v.push({
          invariant: "class-coherence",
          detail: `${r.ruleId}: basis rule on a lane whose pinned row carries no basis deviation`,
        });
      }
    }
  }

  // R38 derived-only: rules must byte-equal the derivation
  if (canonicalRules(cfg.rules) !== canonicalRules(deriveAllOrchRules(cfg.dials, cfg.loops))) {
    v.push({ invariant: "derived-only", detail: "rules do not byte-equal deriveOrchRules(dials, slots) — tampered draft" });
  }

  return v;
}

// ── Evaluation state machine (R18/R24/R25/R28/R29) ───────────────────────

export function initialRuleState(): OrchRuleState {
  return {
    streak: 0,
    /* -1, not 0, so a genuine seq 0 is legal. Seeding 0 with a `<=` test is
       why `initialRuleState` + `blockNumber: 0` (the funding scanner's own
       ruling) rejected the first pin and every pin after it: every rack
       funding lane carried a guard structurally incapable of firing. */
    lastSeq: -1,
    lastKind: null,
    firedAtMs: null,
    armed: true,
    rearmStreak: 0,
    lastMoveDirection: null,
  };
}

/**
 * Advance one rule's state on one pin. Pure. Returns whether the rule FIRES
 * on this pin (streak reached while armed and cooldown clear).
 *
 * THE GATE BELOW IS SPEC B.3. It was installed by WP-0 because the field
 * rename forced it (`lastPinHash` no longer exists, so there was no
 * behaviour-preserving translation of the old two-leg test) and VERIFIED HERE
 * against its own acceptance: ten `{kind:"nav", seq:0..9}` refs carrying an
 * IDENTICAL hash and `breaching: true` fire exactly once, on the pin that
 * reaches `sustainPins`; ten refs at one seq fire never, because only the
 * first advances and a streak of one clears no window.
 *
 * WHAT THIS REPAIRS IN PRODUCTION, not only in the mockup:
 * `run-scan-hl-funding.ts` writes `blockNumber: 0` by ruling, and the old
 * `initialRuleState()` seeded `lastPinBlock: 0` against a `<=` test, so
 * `0 <= 0` rejected the first pin and every pin after it. Every rack funding
 * lane shipped a guard structurally incapable of firing. `lastSeq` seeds to
 * -1 and this gate is what makes those guards able to fire at all.
 *
 * R24 is now ONE test asking ONE question. Identity is `(kind, seq)`; the
 * content hash left the dedupe path entirely and is evidence. A repeated
 * identical document carries the same seq and is refused. A NEW document
 * advances whatever its content says, because a sustain window counts
 * OBSERVATIONS, not changes: a metric below threshold at NAV 419 and still
 * below at NAV 420 has breached twice.
 *
 * WHAT THIS GIVES UP, STATED PLAINLY. The old leg 2 refused a new block that
 * re-served identical content; that now advances. What replaces the
 * protection is leg 1: `seq` is the SOURCE DOCUMENT's own generation, so a
 * cached re-serve returns the same seq and is caught there.
 *
 * R25: any non-breaching pin resets the streak to 0; breaches while re-arming
 *      reset the re-arm counter (the confirmForceCloseClear asymmetry:
 *      flaps re-arm the counter in the safe direction only, never fire).
 */
export function advanceRuleState(
  rule: OrchRule,
  state: OrchRuleState,
  pin: PinObservation,
): { state: OrchRuleState; fired: boolean } {
  const r = pin.ref;
  if (state.lastKind !== null && r.kind !== state.lastKind) {
    // A re-pin onto a different clock. Ordinals are incomparable across kinds,
    // so the state resets rather than comparing a NAV index to a block height.
    return { state: { ...initialRuleState(), lastSeq: r.seq, lastKind: r.kind }, fired: false };
  }
  if (state.lastSeq >= 0 && r.seq <= state.lastSeq) {
    return { state, fired: false }; // R24 dedupe
  }
  const next: OrchRuleState = { ...state, lastSeq: r.seq, lastKind: r.kind };

  if (!next.armed) {
    // hysteresis re-arm: sustainPins CONSECUTIVE safe-side pins (R28)
    if (pin.safeSide) {
      next.rearmStreak += 1;
      if (next.rearmStreak >= rule.sustainPins) {
        next.armed = true;
        next.rearmStreak = 0;
        next.streak = 0;
      }
    } else {
      next.rearmStreak = 0;
    }
    return { state: next, fired: false };
  }

  if (pin.breaching) {
    next.streak += 1;
  } else {
    next.streak = 0; // R25 reset-on-recovery
    return { state: next, fired: false };
  }

  const cooldownClear = next.firedAtMs === null || pin.nowMs - next.firedAtMs >= rule.cooldownMs;
  if (next.streak >= rule.sustainPins && cooldownClear) {
    next.firedAtMs = pin.nowMs;
    next.armed = false;
    next.rearmStreak = 0;
    next.streak = 0;
    return { state: next, fired: true };
  }
  return { state: next, fired: false };
}

// ── R6/R27 destination selection ──────────────────────────────────────────

/** One legal destination, with the two numbers that ranked it. */
export interface RankedDestination {
  slotId: string;
  /** In the PUBLISHED frame — see `riskAdjUnified`. `-Infinity` when unknown. */
  riskAdjUnified: number;
  /** Half-capacity headroom in USD after this move. */
  headroom: number;
}

/**
 * The full ranking, not just its head.
 *
 * The runner-up is carried because the attestation has to say WHAT THE
 * ALTERNATIVE WAS AND BY HOW MUCH IT LOST, and a record that reconstructs its
 * own alternative afterwards is a record written beside the decision instead
 * of derived from it. `{ reason: "no legal peer" }` is the honest form when
 * the ranking held one entry or none.
 */
export interface DestinationRanking {
  /** Best first. Empty ⇒ the capital stays put. */
  ranked: RankedDestination[];
  /** `ranked[0].slotId`, or `PAUSE_DESTINATION`. */
  destination: string;
  alternative: { slotId: string; riskAdjUnified: number; lostBy: number } | { reason: "no legal peer" };
  /**
   * How many supplied slots were outside the composed universe. Non-zero
   * means the WHOLE call was refused, and the count is surfaced rather than
   * swallowed: a silent filter turns a corrupted input into a quiet move.
   */
  refused: number;
}

/**
 * Deterministic destination ranking. Candidate set = slots that are eligible
 * at the latest observation, registry-Live, non-emergency, without a
 * breaching/unarmed evacuation rule of their own, and with half-capacity
 * headroom (0.5 × capacityUsd − allocatedUsd ≥ moveUsd) — never let the
 * orchestrator itself become the capacityBinding. Rank: riskAdjUnified desc,
 * then larger headroom, then lexicographic candidateId (determinism required
 * for the intent content-hash).
 *
 * ── THE CURATION BOUNDARY, ENFORCED RATHER THAN ASSERTED (INV-3) ──────────
 * `allowedSlotIds` is `cfg.loops`, the slots the USER COMPOSED. Until now the
 * candidate universe was whatever array the caller passed, so the only thing
 * standing between the router and a destination nobody composed was the
 * caller being right. The type system never checked it and no test did
 * either.
 *
 * A supplied slot outside the allowlist REFUSES THE WHOLE CALL — it does not
 * quietly filter that one row out. The reason is that a candidate array
 * disagreeing with the composed config is not a bad row, it is an
 * inconsistent state, and picking a winner from the remainder publishes a
 * decision taken against a universe the record cannot describe. Refusing
 * returns `pause`: the capital stays exactly where it is, which is the one
 * outcome that is true no matter which half of the disagreement was wrong.
 *
 * With no reserve to fall back on (D11), no legal destination also means the
 * capital STAYS PUT and the loop pauses. That is a truthful outcome; the
 * reserve was not.
 */
export function selectDestination(
  slots: SlotLiveState[],
  sourceSlotId: string,
  moveUsd: number,
  destination: OrchRule["destination"],
  allowedSlotIds: readonly string[],
): DestinationRanking {
  const paused: DestinationRanking = {
    ranked: [],
    destination: PAUSE_DESTINATION,
    alternative: { reason: "no legal peer" },
    refused: 0,
  };

  const allowed = new Set(allowedSlotIds);
  const refused = slots.reduce((n, s) => (allowed.has(s.slotId) ? n : n + 1), 0);
  if (refused > 0) return { ...paused, refused };
  if (destination === PAUSE_DESTINATION) return paused;

  const ranked: RankedDestination[] = slots
    .filter((s) => s.slotId !== sourceSlotId)
    .filter((s) => s.eligible && s.statusLive && !s.emergency && !s.evacuationBreaching) // R27
    .map((s) => ({
      slotId: s.slotId,
      candidateId: s.candidateId,
      riskAdjUnified: s.riskAdjUnified ?? -Infinity,
      headroom: 0.5 * (s.capacityUsd ?? 0) - s.allocatedUsd,
    }))
    .filter((c) => c.headroom >= moveUsd)
    .sort((a, b) => {
      if (b.riskAdjUnified !== a.riskAdjUnified) return b.riskAdjUnified - a.riskAdjUnified;
      if (b.headroom !== a.headroom) return b.headroom - a.headroom;
      return a.candidateId.localeCompare(b.candidateId);
    })
    .map(({ slotId, riskAdjUnified, headroom }) => ({ slotId, riskAdjUnified, headroom }));

  if (ranked.length === 0) return paused; // R6.3
  const runnerUp = ranked[1];
  /* A peer whose riskAdjUnified was never measured sorts last on `-Infinity`,
     which is the right ORDER and a distance nobody can state: the subtraction
     yields NaN or Infinity. The record then reports no comparison rather than
     printing a fabricated margin, which is the whole reason the alternative is
     carried at all. */
  const lostBy = runnerUp ? ranked[0].riskAdjUnified - runnerUp.riskAdjUnified : NaN;
  return {
    ranked,
    destination: ranked[0].slotId,
    alternative:
      runnerUp && Number.isFinite(lostBy)
        ? { slotId: runnerUp.slotId, riskAdjUnified: runnerUp.riskAdjUnified, lostBy }
        : { reason: "no legal peer" },
    refused: 0,
  };
}

/* `selectDestinationId` WAS HERE and is deleted (gate round 1, 2026-09-03).
   WP-1 built it as "the thin head-of-ranking wrapper for existing callers"
   and the existing callers turned out to be tests: both production consumers
   — the evaluator and `LanePanel`'s composed route — need `alternative` and
   `refused`, which is the whole reason the ranking is returned. The barrel
   never re-exported it either, so nothing outside this directory could reach
   it without importing this file directly, which throws on the initialization
   cycle. INV-12 reported it as a function referenced only by a test, and the
   honest resolution for a door nothing can open is to not ship the door.
   Callers that want only the head read `.destination` off the ranking, which
   is one field access and cannot drift from the sort that produced it. */

// ── R31/R33 move sizing ───────────────────────────────────────────────────

export interface MoveSizing {
  moveUsd: number;
  /** R31: below the dust floor the firing DEFERS (stays fired, retries next pin). */
  deferred: boolean;
  reason: string;
}

export function sizeMove(args: {
  moveWeight: number;
  orchestratedTvlUsd: number;
  sourceEquityUsd: number;
  /** Margin bands of a HEDGED destination — drives the real minDepositUsd
   *  derivation; null for an unhedged destination ($50 floor). */
  destMarginBands: HlMarginBandsDerived | null;
}): MoveSizing {
  const raw = args.moveWeight * args.orchestratedTvlUsd;
  /* R33, AND THE ONE CASE IT MAY NOT SILENTLY SHRINK (G1, 2026-09-07).
     The clamp is a quarter of the source's equity per tick, the W15 reserve
     rail's own bound. Every rule inside R15 carries `moveWeight <= 0.25`
     (`MOVE_WEIGHT_CAP`, enforced by `validateOrchestrator`), so `max` below is
     the IDENTITY for all of them and no shipped derivation moves a cent.
     A rule asking for more has cleared R15 by name — today that is the demo's
     floor-pair evacuation, `lib/canvas/floor-pair.ts` — and capping it here
     would size it down to a fraction of what the rule asked for while the
     record stated the rule. This file's own doctrine is that a move the budget
     cannot fund is REFUSED, never sized down; a move the rule asked for and the
     band allows is not the place to start. */
  const perTickCap = Math.max(MOVE_WEIGHT_CAP, args.moveWeight) * args.sourceEquityUsd; // R33
  const moveUsd = Math.min(raw, perTickCap);
  const floor = Math.max(
    args.destMarginBands ? minDepositUsd(args.destMarginBands) : 0,
    MIN_HEDGED_DEPOSIT_USD, // $50
  );
  if (moveUsd < floor) {
    return { moveUsd: 0, deferred: true, reason: `move $${moveUsd.toFixed(2)} below the $${floor} floor; deferred` };
  }
  return { moveUsd: Number(moveUsd.toFixed(2)), deferred: false, reason: `move $${moveUsd.toFixed(2)} (cap 0.25 × source equity)` };
}

// ── R30 directed-edge anti-cycle lock ─────────────────────────────────────

export interface EdgeLockState {
  /** "slotA->slotB" → lockedUntilMs for the REVERSE edge. */
  reverseLockedUntilMs: Record<string, number>;
}

export function edgeKey(source: string, dest: string): string {
  return `${source}->${dest}`;
}

/**
 * After a move A→B, lock B→A for at least 2 × cooldownMs (R30) — and, when
 * the move's own payback is known, for at least that long too (D12).
 *
 * The cooldown is a FLAP guard, sized against RPC noise. The payback is an
 * ECONOMIC guard, sized against the money actually spent. They are different
 * quantities and the larger one has to win: a cross-chain move paying back
 * in 243 days behind a 6-day lock could be reversed 40 times before its
 * first leg broke even, each reversal charging the friction again.
 *
 * `paybackForMoveMs` omitted keeps the pure R30 behaviour, so the flap guard
 * is never weakened by a caller that has no economics to hand.
 */
export function lockReverseEdge(
  locks: EdgeLockState,
  source: string,
  dest: string,
  nowMs: number,
  cooldownMs: number,
  paybackForMoveMs?: number,
): EdgeLockState {
  const flapGuard = 2 * cooldownMs;
  const economicGuard = Number.isFinite(paybackForMoveMs ?? NaN)
    ? (paybackForMoveMs as number)
    : paybackForMoveMs === Infinity
      ? MAX_REVERSE_LOCK_MS
      : 0;
  return {
    reverseLockedUntilMs: {
      ...locks.reverseLockedUntilMs,
      [edgeKey(dest, source)]: nowMs + Math.min(MAX_REVERSE_LOCK_MS, Math.max(flapGuard, economicGuard)),
    },
  };
}

/** A lock is a lock, not a ban: one year is the longest one that is honest. */
export const MAX_REVERSE_LOCK_MS = YEAR_MS;

export function edgeLocked(locks: EdgeLockState, source: string, dest: string, nowMs: number): boolean {
  const until = locks.reverseLockedUntilMs[edgeKey(source, dest)];
  return typeof until === "number" && nowMs < until;
}

// ── R37 weight conservation ───────────────────────────────────────────────

/** Transfer Δw from exactly one source to exactly one destination, pre-clamped
 *  by source minWeight and dest maxWeight; all other weights unchanged. */
export function applyMove(
  weights: Record<string, number>,
  bounds: Record<string, { min: number; max: number }>,
  source: string,
  dest: string,
  dw: number,
): Record<string, number> {
  const srcRoom = (weights[source] ?? 0) - (bounds[source]?.min ?? 0);
  const dstRoom = (bounds[dest]?.max ?? 1) - (weights[dest] ?? 0);
  const move = Math.max(0, Math.min(dw, srcRoom, dstRoom));
  if (move === 0) return weights;
  return {
    ...weights,
    [source]: Number(((weights[source] ?? 0) - move).toFixed(9)),
    [dest]: Number(((weights[dest] ?? 0) + move).toFixed(9)),
  };
}

// ── Intent construction (display + log only in v1) ────────────────────────

export async function buildIntent(args: {
  rule: OrchRule;
  sourceSlotId: string;
  destSlotId: string;
  moveUsd: number;
  observedBySlot: Record<string, ObservationRef>;
  reason: string;
  emergency: boolean;
}): Promise<ReallocIntent> {
  const body = {
    ruleId: args.rule.ruleId,
    sourceSlotId: args.sourceSlotId,
    destSlotId: args.destSlotId,
    moveUsd: args.moveUsd,
    observedBySlot: Object.fromEntries(Object.entries(args.observedBySlot).sort(([a], [b]) => a.localeCompare(b))),
    emergency: args.emergency,
  };
  return {
    intentId: await sha256Hex(JSON.stringify(body)), // RSV-3 B1 content-hash pattern
    ...body,
    reason: args.reason,
  };
}

/** R34 emergency path: PAUSE the loop, bypass cooldown and turnover budget,
 *  never select a new loop destination. It does one bounded thing, and with
 *  the reserve deleted (D11) that one thing is stopping — not a transfer to
 *  a slot that never held anything. */
export async function buildEmergencyIntent(args: {
  sourceSlotId: string;
  moveUsd: number;
  observedBySlot: Record<string, ObservationRef>;
  reason: string;
}): Promise<ReallocIntent> {
  const body = {
    ruleId: `${args.sourceSlotId}:emergency`,
    sourceSlotId: args.sourceSlotId,
    destSlotId: PAUSE_DESTINATION,
    moveUsd: args.moveUsd,
    observedBySlot: Object.fromEntries(Object.entries(args.observedBySlot).sort(([a], [b]) => a.localeCompare(b))),
    emergency: true,
  };
  return { intentId: await sha256Hex(JSON.stringify(body)), ...body, reason: args.reason };
}

// ── Decode lines (R40 register; review modal + rule takeover share these) ──

/**
 * THE FORMAT CONTRACT REACHES THE RULE PROSE (wave-3 handoff, 2026-08-22).
 *
 * This file held TEN private `(x * 100).toFixed(n) + "%"` copies and one
 * hand-rolled `$…k` magnitude across the decode map, the trigger map and
 * `decodeOrchRule`. No second surface prints those numbers today, which is
 * luck, not design: `format.ts` exists precisely because five files each
 * "only" held one copy until three of them disagreed. Every number in this
 * file's prose now comes out of `pct` (the sole `%` emitter) or
 * `fmtCapacityUsd` (the sole USD magnitude, which FLOORS).
 *
 * The `k` → `K` change is not cosmetic: the old copy also ROUNDED, so a
 * $99,500 floor printed "$100k" — a bound above the one the rule enforces.
 */
const HOURS = (ms: number) => `${(ms / HOUR_MS).toFixed(0)}h`;

const METRIC_DECODE: Record<OrchRule["metric"], (r: OrchRule) => string> = {
  net_apy_floor: (r) =>
    `drains this loop after ${r.sustainPins} consecutive scans below ${pct(r.threshold, 0)} net APY; re-arms above ${pct(r.rearmLevel, 0)}`,
  /* THE ABSOLUTE LEG IS OFF AT THRESHOLD 0, AND THE PROSE SAYS SO BY NOT
     SAYING IT. `fmtCapacityUsd(0)` renders "$0", which reads as a bound the
     rule enforces; there is no such bound on an unscreened lane, only the
     shrink leg. A clause naming a floor that cannot be crossed is the same
     defect as a destination that cannot receive. */
  capacity_shrink: (r) =>
    r.threshold > 0
      ? `drains after ${r.sustainPins} consecutive scans with capacity under ${fmtCapacityUsd(r.threshold)} or under ${pct(r.shrinkFrac ?? 0, 0)} of its ${r.lookbackPins}-pin high`
      : `drains after ${r.sustainPins} consecutive scans with capacity under ${pct(r.shrinkFrac ?? 0, 0)} of its ${r.lookbackPins}-pin high`,
  funding_p25_streak: (r) =>
    `drains after ${r.sustainPins} consecutive scans with funding p25 under ${pct(r.threshold, 0)} APR; exits in order, above the account kill band`,
  gate_flip: (r) =>
    `pauses this loop after ${r.sustainPins} consecutive failing scans at distinct blocks; one failing scan never moves capital`,
  basis_early_warn: (r) =>
    `de-risks after ${r.sustainPins} consecutive scans with basis deviation over ${pct(r.threshold, 2)}`,
  better_elsewhere: (r) =>
    `shifts toward a better loop only when the risk-adjusted spread holds above ${pct(r.threshold, 1)} APY for ${r.sustainPins} scans and beats 2x the modeled move cost`,
};

/**
 * Compact policy rows for the rules matrix.
 *
 * The 2026-07-29 founder feedback ("the sentence dump was wordy; per-loop
 * duplication read as inaccurate") was answered by rendering the FIRST
 * SLOT's rules and calling them "one policy, every loop". That premise is
 * false and D5 is what it cost: class rules are per-class, so on a mixed
 * A + N1 portfolio the table showed 5 of 10 rules, and WHICH 5 depended on
 * which lane happened to be built first. Two vaults with identical policies
 * printed different rule tables.
 *
 * The feedback is still right and the answer is DE-DUPLICATION, not
 * truncation: identical rules across lanes collapse to one row (so the
 * common four still render once), and a row that does NOT hold for every
 * lane carries the scope it does hold for. Nothing is hidden and nothing
 * repeats.
 */
export interface OrchRuleRow {
  metric: OrchRule["metric"];
  name: string;
  trigger: string;
  patience: string;
  cooldown: string;
  /** The slots this exact row was derived for. */
  slotIds: string[];
  /** How many rules this one row stands for (== slotIds.length). */
  ruleCount: number;
  /** `""` when every lane carries it; otherwise the lanes that do. */
  scope: string;
}

/**
 * WHAT A RULE IS CALLED ON SCREEN, IN SENTENCE CASE.
 *
 * These were `YIELD DRIES`, `CAPACITY SHRINKS`, `BETTER LANE`. The founder read
 * the rule table's letterspaced uppercase as the house style of a machine
 * rather than of this product, and these are the only strings in the table that
 * were shouting: the triggers under them, the patience beside them and the
 * lane names above them are all sentence case. It is fixed HERE, at the one
 * owner every surface reads `row.name` from, rather than with a
 * `text-transform` on one of them, so no surface can print a different case
 * from another.
 */
const METRIC_NAME: Record<OrchRule["metric"], string> = {
  net_apy_floor: "Yield dries",
  capacity_shrink: "Capacity shrinks",
  funding_p25_streak: "Funding turns",
  gate_flip: "Gate fails",
  basis_early_warn: "Basis drifts",
  better_elsewhere: "Better lane",
};

const METRIC_TRIGGER: Record<OrchRule["metric"], (r: OrchRule) => string> = {
  net_apy_floor: (r) => `net APY below ${pct(r.threshold, 0)} (re-arms above ${pct(r.rearmLevel, 0)})`,
  capacity_shrink: (r) =>
    r.threshold > 0
      ? `capacity under ${fmtCapacityUsd(r.threshold)} or half its ${r.lookbackPins}-pin high`
      : `capacity under half its ${r.lookbackPins}-pin high`,
  funding_p25_streak: (r) => `funding p25 under ${pct(r.threshold, 0)} APR`,
  gate_flip: () => `failing scans at distinct blocks: the loop pauses`,
  basis_early_warn: (r) => `basis deviation over ${pct(r.threshold, 2)}`,
  better_elsewhere: (r) => `spread above ${pct(r.threshold, 1)} holds and beats 2x the move cost`,
};

/** Stable render order — the metric order, not derivation order. */
const METRIC_ORDER: OrchRule["metric"][] = [
  "net_apy_floor",
  "funding_p25_streak",
  "basis_early_warn",
  "capacity_shrink",
  "gate_flip",
  "better_elsewhere",
];

const slotOf = (r: OrchRule) => r.ruleId.split(":")[0];

/** Everything a row's PROSE depends on. Two rules with the same signature
 *  render identically, so they are one row; anything else is a real
 *  difference and gets its own. */
function rowSignature(r: OrchRule): string {
  return JSON.stringify([
    r.metric,
    r.threshold,
    r.rearmLevel,
    r.shrinkFrac,
    r.lookbackPins,
    r.sustainPins,
    r.cooldownMs,
  ]);
}

export interface OrchRuleTable {
  rows: OrchRuleRow[];
  maxMovePct: number;
  /** Rules the table stands for, across every lane. */
  ruleCount: number;
  /** Lanes governed. */
  slotCount: number;
}

/**
 * The DE-DUPLICATED UNION of every lane's rules (D5).
 *
 * `labels` maps slotId → the lane's display name, so a scoped row can name
 * the lane the user recognises rather than `loop_2`.
 */
export function orchRuleTable(
  rules: OrchRule[],
  labels: Record<string, string> = {},
): OrchRuleTable {
  const slotIds = [...new Set(rules.map(slotOf))].sort();
  const groups = new Map<string, { rule: OrchRule; slots: string[] }>();
  for (const r of rules) {
    const sig = rowSignature(r);
    const g = groups.get(sig);
    if (g) {
      if (!g.slots.includes(slotOf(r))) g.slots.push(slotOf(r));
    } else {
      groups.set(sig, { rule: r, slots: [slotOf(r)] });
    }
  }

  const name = (id: string) => labels[id] || id;
  const rows: OrchRuleRow[] = [...groups.values()]
    .sort((a, b) => {
      const d = METRIC_ORDER.indexOf(a.rule.metric) - METRIC_ORDER.indexOf(b.rule.metric);
      return d !== 0 ? d : a.slots[0].localeCompare(b.slots[0]);
    })
    .map(({ rule, slots }) => {
      const mine = [...slots].sort();
      const everyLane = mine.length === slotIds.length && slotIds.length > 0;
      return {
        metric: rule.metric,
        name: METRIC_NAME[rule.metric],
        trigger: METRIC_TRIGGER[rule.metric](rule),
        patience: `${rule.sustainPins} scan${rule.sustainPins === 1 ? "" : "s"}`,
        cooldown: HOURS(rule.cooldownMs),
        slotIds: mine,
        ruleCount: mine.length,
        scope: everyLane
          ? ""
          : mine.length <= 2
            ? mine.map(name).join(" + ")
            : `${mine.length} of ${slotIds.length} loops`,
      };
    });

  return {
    rows,
    maxMovePct: rules.length > 0 ? Math.max(...rules.map((r) => r.moveWeight)) * 100 : 0,
    ruleCount: rules.length,
    slotCount: slotIds.length,
  };
}

/** The table's own scope line: the real counts, never "every loop". */
export function orchRuleScopeLine(t: OrchRuleTable): string {
  /* THE NOUN IS `lane`, NOT `loop` (integration, 2026-09-07). A slot on this
     rack is a lane, and since the router lane landed one of them is a lending
     reserve with no borrow leg: `7 rules across 2 loops` printed under a rule
     table whose own rows name `USDC lending`. `lane` is true of every family
     and is the word the rack, the dock and the vault page already use. */
  if (t.slotCount === 0) return "no lanes governed";
  const rulesWord = `${t.ruleCount} rule${t.ruleCount === 1 ? "" : "s"}`;
  const lanesWord = `${t.slotCount} lane${t.slotCount === 1 ? "" : "s"}`;
  return `${rulesWord} across ${lanesWord}`;
}

export function decodeOrchRule(r: OrchRule): string {
  return `${slotOf(r)}: ${METRIC_DECODE[r.metric](r)}; at most ${pct(r.moveWeight, 0)} of the book per move, cooldown ${HOURS(r.cooldownMs)}.`;
}

/** The R40 honesty line — verbatim register, shown wherever rules render. */
export const ORCH_HONESTY_LINE =
  "Reallocation is modeled only. Every move requires the execution rail and starts Shadow.";
