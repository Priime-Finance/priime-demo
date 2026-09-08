/**
 * THE AXES — what a control's settings are allowed to be a reason about.
 *
 * ══ WHY THIS FILE EXISTS (LAW L2) ══════════════════════════════════════════
 *
 * L1 says a control may render only where its settings genuinely trade: if one
 * setting is at least as good on EVERY axis and strictly better on one, the
 * control is a trap with a friendly name and the product owes the answer
 * instead of the question.
 *
 * That rule is unfalsifiable without this file. "At least as good on every
 * axis" ranges over a set nobody had written down, so any control could be
 * defended by asserting an axis, and any control could be deleted by
 * forgetting one. L2 closes both doors with one sentence:
 *
 *   > A control may be defended against the dominance rule ONLY by an axis
 *   > that is DECLARED and RENDERED. An axis nobody can see is not a reason.
 *
 * THE CASE THAT PAYS FOR THE WHOLE FILE. Ejecting the hedge is dominated on
 * yield, on capacity and on denomination, and it is still a legitimate press,
 * because it moves an axis the product had never named: off-chain venue
 * dependency. The hedge is a Hyperliquid account, and some builders will pay
 * yield not to have one. Declared (`offChainVenues`, below) the eject key is
 * defensible; left undeclared, the dominance sweep deletes it, correctly. That
 * asymmetry is why this lands BEFORE the sweep, not beside it.
 *
 * ══ WHAT AN AXIS IS, AND WHAT IT IS NOT ════════════════════════════════════
 *
 * An axis is a quantity that (a) this file can COMPUTE for a lane, and (b) a
 * surface RENDERS beside the control that moves it. Both halves are load
 * bearing:
 *
 *   • A quantity we cannot compute is NOT an axis. It is a `blind` register
 *     entry — named, never sized (L11). The collar's missing volatility term
 *     structure and the trim's firing frequency are both of that kind: real,
 *     unmeasured, and deliberately absent from the union below. Declaring an
 *     uncomputable axis would let any control defend itself with a word.
 *
 *   • An axis that never differs is NOT an axis. `AXIS_RENDERERS` is gated by
 *     `__tests__/axes.test.ts`: every member must have produced a DIFFERING
 *     reading somewhere in the fixture catalog. A quantity constant across
 *     every market and every setting is chrome, and it cannot order anything.
 *
 * ══ `inObjective`, AND THE SAFETY CATCH (LAW L4) ═══════════════════════════
 *
 * L3 binds defaults to L1: the product may not choose a setting it would
 * refuse to offer. L4 is the catch that stops that from making the product
 * worse. A naive argmax over the priced objective sets `hedgeLeverage` to its
 * ceiling, `reserveFraction` to its floor and `rangePct` to its tightest, and
 * every one of those is a corner whose cost the objective does not carry.
 *
 * `inObjective` is the mechanical form of that distinction, and it is a
 * FACTUAL claim about the code, not a judgement: it is true iff the axis has a
 * term in the model reachable from `laneNetApy`. Exactly one axis has it.
 *
 *   • A param whose declared axes are ALL in the objective may be auto-set by
 *     the objective alone.
 *   • A param declaring an axis OUTSIDE the objective may be auto-set only if
 *     the chosen setting is weakly best on that axis TOO — dominance, not
 *     argmax. Otherwise it stays a control with its consequence rendered, or
 *     it takes the conservative bound and names the axis it is conservative
 *     on (`defaultRationale`).
 *
 * The shipped product already gets one case right and it is the teaching
 * example: `riskPreset` moves `driftBeforeTrim` and `reactionWindow` in
 * OPPOSITE directions, neither is in the objective, and the product does not
 * pick. It renders the drift and leaves the choice. That is L4 working.
 *
 * ══ ONE OWNER, ALWAYS ══════════════════════════════════════════════════════
 *
 * No renderer here derives a quantity that already has an owner. `netApy`
 * calls `laneNetApy`, `capacity` calls `laneCapacityUsd`, `cushion` and
 * `driftBeforeTrim` call `lib/canvas/liquidation.ts`, `refillsFunded` reads
 * `RESERVE_MIN_FRACTION`, the hand-authored families are priced by their own
 * `dnLpModel` / `collarModel`. Every string goes through `format.ts` or the
 * owner's own formatter. Two mirrors survive and both are named at the point
 * of the mirror with the export that would remove them.
 */

/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style, @typescript-eslint/prefer-optional-chain --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import type { ModuleDef, ModuleKey, ParamDescriptor, ParamValue } from "./types";
import type { ProjectedCandidate } from "./opportunities";
import { composedNetApy, publishedNetApy, type LaneComposition } from "./mock-quote";
import { applyComputeFee } from "./fees";
import { fmtCapacityUsd, laneCapacityUsd } from "./capacity";
import {
  adverseMoveValue,
  driftBeforeTrim as driftBeforeTrimApr,
  liquidationDistance,
} from "./liquidation";
import { pct, ppMag } from "./format";
import type { RiskPreset } from "./param-schema";
import {
  COLLAR_DEFAULT_DIALS,
  DN_LP_DEFAULT_DIALS,
  DN_LP_MODEL,
  collarModel,
  dnLpModel,
  handAuthoredTerms,
} from "./templates";
import { RESERVE_MIN_FRACTION } from "./modules";
/* ONE OWNER for the dependency set. This file computes nothing about the
   route; it reads the derivation and renders it. */
import { watchViewOf } from "./exogenous";

// ── The union ─────────────────────────────────────────────────────────────

/**
 * Every axis the product is allowed to reason on. Sixteen, and each one was
 * read off a measurement in the control verdict table rather than invented:
 * the table's evidence column names the axes, this union spells them.
 *
 * There is no `safety`, no `risk`, no `quality`. Those are grades, they are
 * ratified out, and a grade cannot be a renderer's return value.
 */
export type AxisId =
  /** Modeled net APY on deposit at this lane's composition, in the PRODUCT
   *  frame (the house's compute fee inside it). THE objective. */
  | "netApy"
  /** Deposit dollars this lane can absorb before its binding resource runs out. */
  | "capacity"
  /** Adverse collateral-vs-debt pair move that liquidates the lending leg. */
  | "cushion"
  /** How far the pair may drift before the trim automation acts. */
  | "driftBeforeTrim"
  /** Pair move left between the trim trigger and the liquidation line. */
  | "reactionWindow"
  /** The perp short's own margin ratio, 1/L_h. Its distance from its own line. */
  | "shortMargin"
  /** Refills from the defender floor back to restore that the reserve funds. */
  | "refillsFunded"
  /** Automated actions a year: recaptures, recenters or rolls. */
  | "actionCount"
  /** The unit the vault returns in. USD when hedged, the collateral otherwise. */
  | "denomination"
  /** Off-chain venues the vault depends on to hold its position. */
  | "offChainVenues"
  /** Where the written call caps the position's upside. */
  | "upsideCap"
  /** Where the held put floors the position's downside. */
  | "downsideFloor"
  /** Funding rate at which the guard unwinds the short leg. */
  | "guardTrigger"
  /** Funding epochs below the floor before the guard fires. */
  | "guardPersistence"
  /** Outside parties on this lane's capital route that carry a written
   *  response. Null on a lane with no watcher: an absence, never a zero. */
  | "dependenciesAnswered"
  /** Distinct readable quantities the answered parties are watched on. */
  | "responseTriggers"
  /**
   * How long the exit route's issuer takes to turn the position back into
   * cash, in settlement days. UNCONDITIONAL on `redemption-route`, never
   * narrowed by role: `axes.test.ts` reads `MODULE_DEFS[k].params[i].axes`
   * DIRECTLY and cannot see a `deriveDescriptor` narrowing, so an axis that
   * only exists on some lanes is an axis the gate cannot check.
   */
  | "exitCost";

/** How a reading renders. `name` is a non-numeric axis (denomination). */
export type AxisUnit = "pp" | "pct" | "usd" | "count" | "name";

/**
 * Which end of the axis a depositor wants.
 *
 * `neither` is not a hedge, it is the answer on the axes where the product
 * genuinely has no view: the funding guard's floor is a tempo claim, and a
 * denomination is a preference. An axis marked `neither` can never make a
 * setting dominated, which is exactly what saves the controls that ought to
 * survive and exactly what stops it from saving the ones that ought not.
 */
export type AxisDirection = "higher" | "lower" | "neither";

/** One axis's value on one lane. */
export interface AxisReading {
  /** The comparable value. Numeric axes compare numerically; `name` by string. */
  value: number | string;
  /** The rendered form, through the owner's own formatter. Never re-derived. */
  text: string;
}

export interface AxisDef {
  id: AxisId;
  /** What the axis is, in the product's own words. No adjectives, no grades. */
  label: string;
  unit: AxisUnit;
  direction: AxisDirection;
  /**
   * TRUE iff this axis has a term in the model reachable from
   * `laneNetApy`. A statement about the code, checked by the test that
   * walks the objective's inputs — not an opinion about importance.
   */
  inObjective: boolean;
  /** Null when this lane cannot produce the quantity. A surface that cannot
   *  prove its arithmetic prints nothing; so does an axis. */
  read(lane: AxisLane): AxisReading | null;
}

// ── The lane an axis is read against ──────────────────────────────────────

/**
 * Everything an axis needs about one lane, and nothing else.
 *
 * Deliberately a flat record rather than a `LoopGraph`: the dominance sweep
 * (P0-C) must construct thousands of hypothetical lanes that differ by ONE
 * setting, and a graph would make each of those a mutation instead of a
 * literal. `placed` and `params` are the graph's two halves, flattened.
 */
export interface AxisLane {
  /** The lane's REPRICED candidate, or null before a market is pinned. */
  candidate: ProjectedCandidate | null;
  /** Module keys installed on the lane. */
  placed: readonly ModuleKey[];
  /** The lane's dials, by module. Absent module = absent key. */
  params: Partial<Record<ModuleKey, Readonly<Record<string, ParamValue>>>>;
  /** The composition the lane is priced at (`pricingParamsFor(loop)`). */
  comp: LaneComposition | null;
  /** The leverage the MODEL landed on (`economics.loopLeverage`), never the
   *  dial's request — a cushion quoted at a leverage nothing priced is a
   *  cushion for a different lane. */
  appliedLeverage: number;
  preset: RiskPreset;
  /** The size the lane is priced at. Only the action count reads it. */
  tvlUsd: number;
  /** P-H3 (2026-08-23): a published RECORD's frozen capacity. The record is
   *  the owner of its published figure, so when this is present the capacity
   *  axis prints it verbatim instead of re-deriving through `laneCapacityUsd`
   *  — whose stated/running frame recovery over a record's pseudo-candidate
   *  re-converts the stored number (x1.1125 on an HL-bound hedged record). */
  storedCapacityUsd?: number | null;
}

const has = (lane: AxisLane, key: ModuleKey): boolean => lane.placed.includes(key);

function num(lane: AxisLane, key: ModuleKey, field: string): number | null {
  const v = lane.params[key]?.[field];
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(lane: AxisLane, key: ModuleKey, field: string): string | null {
  const v = lane.params[key]?.[field];
  return typeof v === "string" && v.length > 0 ? v : null;
}

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

// ── Lane pricing, family-aware ────────────────────────────────────────────

/**
 * The lane's VENUE-frame APY at THIS composition, on any of the four families:
 * every venue cost inside it and no house cost. PRE-FEE, and private.
 *
 * Scan rows go through `composedNetApy`, the one owner. Hand-authored rows do
 * NOT: `composedNetApy` reads `netApyOnDepositApy`, which `templates.ts` baked
 * once at module load from the DEFAULT dials, so on a collar or an LP lane it
 * returns the same number at every setting of every dial. That is the ledger's
 * own finding ("the dials are dead on two of the four products"), and an axis
 * built on it would report a 33.2pp trade as a flat line — the exact shape L1
 * exists to catch, inverted.
 *
 * So a hand-authored lane is priced by the family model that authored it,
 * called with the lane's own dials. That is not a second owner: `dnLpModel`
 * and `collarModel` ARE the owners; the only thing that changes is that they
 * are finally being asked about the composition on the rack instead of about
 * the composition on the shelf.
 *
 * `composedHere` still governs the scan path, so a partial lane prints
 * nothing. The hand-authored path enforces the same thing structurally: the
 * family model is called only when the lane holds the legs the model prices.
 *
 * ⚠ NOT EXPORTED, and nothing that PRINTS or COMPARES may call it. The axis is
 * `laneNetApy` below. This exists because one consumer needs a physical
 * accrual rate rather than a depositor's return — see `compoundFirings`.
 */
function laneVenueApy(lane: AxisLane): number | null {
  const c = lane.candidate;
  if (!c) return null;
  const fam = handAuthoredTerms(c)?.family ?? null;

  if (fam === "collar") {
    if (!has(lane, "covered-call") || !has(lane, "protective-put")) return null;
    const m = collarModel({
      strikePct: str(lane, "covered-call", "strikePct") ?? COLLAR_DEFAULT_DIALS.strikePct,
      floorPct: str(lane, "protective-put", "floorPct") ?? COLLAR_DEFAULT_DIALS.floorPct,
      rollDays: str(lane, "covered-call", "rollDays") ?? COLLAR_DEFAULT_DIALS.rollDays,
    });
    return m ? m.netApy : null;
  }

  if (fam === "dn-lp") {
    if (!has(lane, "auto-center") || !has(lane, "hedge")) return null;
    const m = dnLpModel({
      rangePct: rangeFraction(lane) ?? DN_LP_DEFAULT_DIALS.rangePct,
      recenterTriggerPct: triggerFraction(lane) ?? DN_LP_DEFAULT_DIALS.recenterTriggerPct,
      hedgeLeverage: num(lane, "hedge", "hedgeLeverage") ?? DN_LP_DEFAULT_DIALS.hedgeLeverage,
      reserveFraction: num(lane, "hedge", "reserveFraction") ?? DN_LP_DEFAULT_DIALS.reserveFraction,
    });
    return m.netApy;
  }

  return composedNetApy(c, has(lane, "hedge"), lane.comp, lane.placed);
}

/**
 * ══ THE OBJECTIVE, IN THE PRODUCT FRAME (C6, 2026-08-24, planner ruling R1) ═
 *
 * The lane's modeled net APY on deposit WITH the house's own 20% compute fee
 * inside it — the number a depositor receives, and the same number the lane
 * header, the review sheet, the directory card and the published record print.
 *
 * THIS FUNCTION IS ONE MEMBER OF A FAMILY THAT SHARES A FRAME BY INVARIANT:
 * `leverage-stops.laneLeverageStops().netApy` (the capsule's cells and
 * `notchMove`'s delta), this axis, `dominance.ts` (which reads only this
 * axis), and `tips.ts` (which subtracts a stop from the lane header). They are
 * rendered on ONE surface within inches of each other and a reader subtracts
 * them, so a member on a different frame is a contradiction the reader can do
 * in their head. Moving ONE member is the defect `__tests__/one-frame.test.ts`
 * exists to prevent; the four moved together and that invariant now asserts
 * the product frame over all of them. Do not move one back.
 *
 * SCAN AND HAND-AUTHORED TAKE THE SAME FEE. `publishedNetApy` charges the scan
 * path; the hand-authored families are charged here through `applyComputeFee`,
 * the same owner, and the R1 ordering (fee, THEN compound) is satisfied
 * trivially because `collarModel` and `dnLpModel` carry no compound term —
 * `compoundFirings` is what reads auto-compound on those lanes. This is also
 * what `lib/vaults/seeds.ts` publishes for the two hand-authored samples
 * (`publishedNetApy(DN_LP_CANDIDATE, true)`), so the axis and the record agree.
 *
 * NOTHING THAT ORDERS ANYTHING CHANGES. The fee is a positive scaling on a
 * positive lane and the identity on a non-positive one, so every argmax,
 * every dominance verdict's SIGN, and every `netApy <= 0` gate are
 * fee-invariant. Only the magnitudes shrink, and they shrink to the number the
 * product actually pays.
 */
export function laneNetApy(lane: AxisLane): number | null {
  const venue = laneVenueApy(lane);
  if (venue === null) return null;
  // The scan path re-derives through the owner rather than scaling, because
  // there the compound step must be re-evaluated at the after-fee base (R1's
  // ordering; `ComposedTerms.published` owns it).
  const c = lane.candidate;
  if (c && !handAuthoredTerms(c)) {
    return publishedNetApy(c, has(lane, "hedge"), lane.comp, lane.placed);
  }
  return applyComputeFee(venue);
}

/** The `auto-center` range half-width as a fraction. The descriptor stores
 *  percent-as-string ("2.5"); `dnLpModel` reads a fraction. */
function rangeFraction(lane: AxisLane): number | null {
  const v = num(lane, "auto-center", "rangePct");
  return finite(v) && v > 0 ? v / PERCENT : null;
}

/** The recenter trigger as a fraction of the range. Descriptor stores "80". */
function triggerFraction(lane: AxisLane): number | null {
  const v = num(lane, "auto-center", "recenterTriggerPct");
  return finite(v) && v > 0 ? v / PERCENT : null;
}

/** Percent-to-fraction. The descriptors store percent strings; every model in
 *  the product reads fractions. One conversion, named, not sprinkled. */
const PERCENT = 100;

/** `collarModel` computes `rollsPerYear = 365 / days`; this is that 365, read
 *  from nowhere else because `COLLAR_MODEL` does not carry it. */
const DAYS_PER_YEAR = 365;

/** `compoundDelta` computes `byCadence = (365 * 24) / cadenceHours`; this is
 *  that constant. See the mirror note on `compoundFirings`. */
const HOURS_PER_YEAR = DAYS_PER_YEAR * 24;

// ── Action counts, per family ─────────────────────────────────────────────

/**
 * Auto-compound firings a year.
 *
 * ⚠ MIRROR, named at the mirror. `mock-quote.compoundDelta` computes exactly
 * this `n = min(8760/cadenceHours, TVL·r/threshold)` privately, and the honest
 * fix is one export from that file (`compoundFirings`), which is outside this
 * pass's allowlist. Two things keep the mirror safe until it lands: the core
 * APY `r` is obtained from `composedNetApy` itself rather than re-derived (a
 * composition with `compound: null` IS the pre-compound number, by
 * construction), and `__tests__/axes.test.ts` pins the mirror behaviourally —
 * `compoundDelta` must move between two cadences exactly when this count does.
 *
 * ⚠ AND IT IS THE ONE PLACE IN THIS FILE THAT STAYS ON THE VENUE FRAME (C6,
 * 2026-08-24). `r` here is not a depositor's return, it is the rate at which
 * dollars ACCRUE in the position and cross `minActionUsd` — the physical thing
 * that decides how often the automation fires. The compute fee is charged at
 * harvest, OUT of what accrued; it does not slow the accrual. Charging it here
 * would report fewer firings a year than the machine performs, which is a
 * claim about the automation, not about the fee. The output of this function
 * is an action COUNT on the `actionsPerYear` axis, never an APY, so it is not
 * a member of the frame family `laneNetApy` documents — and it reads
 * `laneVenueApy`, not `laneNetApy`, so both branches are one frame.
 */
function compoundFirings(lane: AxisLane): number | null {
  if (!has(lane, "auto-compound")) return null;
  const c = lane.candidate;
  if (!c) return null;

  // The pre-compound VENUE APY, from the owner: `compoundDelta(core, null) === 0`,
  // so a composition with no compound member returns exactly `core`.
  const core = handAuthoredTerms(c)
    ? laneVenueApy(lane)
    : composedNetApy(c, has(lane, "hedge"), { ...(lane.comp ?? { hedge: null, compound: null }), compound: null }, lane.placed);
  if (!finite(core) || core <= 0) return 0;

  const cadence = str(lane, "auto-compound", "cadence");
  const hours = cadence ? Number(cadence.replace("h", "")) : null;
  const threshold = num(lane, "auto-compound", "minActionUsd");
  if (!finite(hours) || hours <= 0 || !finite(threshold) || threshold <= 0) return null;
  if (!finite(lane.tvlUsd) || lane.tvlUsd <= 0) return null;

  const byCadence = HOURS_PER_YEAR / hours;
  const byAccrual = (lane.tvlUsd * core) / threshold;
  return Math.max(0, Math.min(byCadence, byAccrual));
}

/**
 * Recenters a year on a delta-neutral LP.
 *
 * ⚠ MIRROR of `dnLpRecenterApr`'s own `eventsPerYear = σ²/d²`, which that
 * function computes inline and does not return. σ is read from `DN_LP_MODEL`,
 * so there is no second constant — only a second expression, and the test pins
 * it against the three counts the range dial is specified to produce.
 */
function recentersPerYear(lane: AxisLane): number | null {
  if (!has(lane, "auto-center")) return null;
  const range = rangeFraction(lane);
  const trigger = triggerFraction(lane);
  if (!finite(range) || range <= 0 || !finite(trigger) || trigger <= 0) return null;
  const d = trigger * range;
  const sigma = DN_LP_MODEL.sigmaAnnual;
  return (sigma * sigma) / (d * d);
}

/** Option rolls a year. `collarModel`'s own `365 / days`. */
function rollsPerYear(lane: AxisLane): number | null {
  if (!has(lane, "covered-call")) return null;
  const days = num(lane, "covered-call", "rollDays");
  return finite(days) && days > 0 ? DAYS_PER_YEAR / days : null;
}

/**
 * Actions a year, whichever automation this lane runs.
 *
 * One axis and not three, because it is one question — how often does this
 * vault transact — and because a builder comparing a collar to a loop is
 * entitled to compare the answers. A lane holding two of them sums, which is
 * the honest reading and is reachable today only on a dn-LP (recenters) whose
 * hedge also compounds.
 */
function actionsPerYear(lane: AxisLane): number | null {
  const parts = [compoundFirings(lane), recentersPerYear(lane), rollsPerYear(lane)].filter(
    (v): v is number => finite(v),
  );
  return parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0);
}

/** Actions a year, rendered. Sub-hundred counts carry a decimal because the
 *  live spread there is 5.8 to 19.4 and a whole number collapses it; above a
 *  hundred the decimal is false precision on a σ² input. */
function fmtActions(n: number): string {
  const body = n < PERCENT ? n.toFixed(1) : Math.round(n).toLocaleString("en-US");
  return `${body} actions/yr`;
}

// ── The registry ──────────────────────────────────────────────────────────

export const AXIS_RENDERERS: Record<AxisId, AxisDef> = {
  netApy: {
    id: "netApy",
    label: "Modeled net APY on deposit",
    unit: "pct",
    direction: "higher",
    // THE objective, by definition. Every other axis is measured against it.
    inObjective: true,
    read(lane) {
      const v = laneNetApy(lane);
      return finite(v) ? { value: v, text: pct(v, 1) } : null;
    },
  },

  capacity: {
    id: "capacity",
    label: "Deposit room",
    unit: "usd",
    direction: "higher",
    // Capacity is a bound, not a term: nothing in `laneNetApy` reads it.
    // That is why every dial moving it stays a control.
    inObjective: false,
    read(lane) {
      // P-H3: a record projection lands back on its own frozen figure,
      // derived at render, never re-converted through the lane arithmetic.
      if (finite(lane.storedCapacityUsd)) {
        return { value: lane.storedCapacityUsd, text: fmtCapacityUsd(lane.storedCapacityUsd) };
      }
      const c = lane.candidate;
      if (!c) return null;
      const v = laneCapacityUsd(c, has(lane, "hedge"), lane.comp);
      return finite(v) ? { value: v, text: fmtCapacityUsd(v) } : null;
    },
  },

  cushion: {
    id: "cushion",
    label: "Adverse pair move to the liquidation line",
    unit: "pct",
    direction: "higher",
    inObjective: false,
    read(lane) {
      const x = liquidationDistance(lane.candidate?.lt, lane.appliedLeverage);
      if (!x) return null;
      const text = adverseMoveValue(x);
      if (text === null) return null;
      // An unlevered lane sits at the TOP of this axis: there is no borrow
      // leg, so no pair move liquidates it. The value is the domain's ceiling
      // and the text says so in words — never as "100%", which would read as
      // a measured cushion rather than an absent mechanism.
      return { value: x.unlevered ? 1 : (x.d as number), text };
    },
  },

  driftBeforeTrim: {
    id: "driftBeforeTrim",
    label: "Drift before the trim acts",
    unit: "pp",
    direction: "neither",
    inObjective: false,
    read(lane) {
      const v = driftBeforeTrimApr(lane.preset, lane.appliedLeverage, lane.candidate?.lt);
      return finite(v) ? { value: v, text: ppMag(v, 2) } : null;
    },
  },

  reactionWindow: {
    id: "reactionWindow",
    label: "Pair move left between the trim and the line",
    unit: "pp",
    direction: "higher",
    inObjective: false,
    read(lane) {
      // A DIFFERENCE OF TWO OWNED VALUES, never a third derivation of the HF
      // ladder: the cushion is the whole distance, the drift is the part the
      // automation tolerates, and what is left is the room the reaction has
      // to work in. `driftBeforeTrim + reactionWindow === cushion` holds by
      // construction, which is the identity the test asserts.
      const x = liquidationDistance(lane.candidate?.lt, lane.appliedLeverage);
      if (!x || x.d === null) return null;
      const drift = driftBeforeTrimApr(lane.preset, lane.appliedLeverage, lane.candidate?.lt);
      if (!finite(drift)) return null;
      const v = x.d - drift;
      return v > 0 ? { value: v, text: ppMag(v, 2) } : null;
    },
  },

  shortMargin: {
    id: "shortMargin",
    label: "The short's own margin ratio",
    unit: "pct",
    direction: "higher",
    inObjective: false,
    read(lane) {
      if (!has(lane, "hedge")) return null;
      const lh = lane.comp?.hedge?.hedgeLeverage ?? num(lane, "hedge", "hedgeLeverage");
      if (!finite(lh) || lh <= 0) return null;
      // The unified HL account holds `1/L_h` of the short's notional as
      // margin. This is the quantity `hedgeLeverage` spends, and it is the
      // reason the dial is not auto-set to its ceiling.
      const v = 1 / lh;
      return { value: v, text: pct(v, 1) };
    },
  },

  refillsFunded: {
    id: "refillsFunded",
    label: "Refills the reserve funds",
    unit: "count",
    direction: "higher",
    inObjective: false,
    read(lane) {
      if (!has(lane, "hedge")) return null;
      const r = lane.comp?.hedge?.reserveFraction ?? num(lane, "hedge", "reserveFraction");
      if (!finite(r) || r < 0) return null;
      // ONE OWNER: `RESERVE_MIN_FRACTION` IS `restore − safetyFloor`, the
      // refill this reserve exists to fund, and it is coin-invariant across
      // the whole maxLeverage tier set. So the reserve is denominated in
      // refills by one divide, with no second band derivation here.
      const v = r / RESERVE_MIN_FRACTION;
      return { value: v, text: v.toFixed(2) };
    },
  },

  actionCount: {
    id: "actionCount",
    label: "Automated actions a year",
    unit: "count",
    direction: "lower",
    // The gas of each action IS priced. The count is not: nothing in the
    // objective carries execution at 4.9 recenters a day, and `dnLpFeeApr`'s
    // 1/range term runs off the end of its own domain exactly there. This is
    // the axis that keeps `rangePct` a control instead of an argmax.
    inObjective: false,
    read(lane) {
      const v = actionsPerYear(lane);
      return finite(v) ? { value: v, text: fmtActions(v) } : null;
    },
  },

  denomination: {
    id: "denomination",
    label: "The unit the vault returns in",
    unit: "name",
    // A denomination is a preference, not a ranking. Marking it `neither` is
    // what stops the sweep from "proving" that USD beats cbETH.
    direction: "neither",
    inObjective: false,
    read(lane) {
      const c = lane.candidate;
      if (!c) return null;
      // A hedged lane's price exposure is cancelled, so it returns in USD. An
      // unhedged lane returns in the asset it holds. This is the second axis
      // the hedge eject key moves, and it is why the key survives L1.
      const v = has(lane, "hedge") ? "USD" : c.collateralSymbol;
      return v ? { value: v, text: v } : null;
    },
  },

  offChainVenues: {
    id: "offChainVenues",
    label: "Off-chain venues the vault depends on",
    unit: "count",
    direction: "lower",
    inObjective: false,
    read(lane) {
      // THE AXIS THAT SAVES THE EJECT KEY. A hedged lane holds a Hyperliquid
      // account: an off-chain venue, with its own custody, its own uptime and
      // its own withdrawal path, none of which the yield model prices. An
      // unhedged lane holds none. Declared here, the press is defensible;
      // undeclared, the sweep deletes it and it would be right to.
      const n = has(lane, "hedge") ? 1 : 0;
      return { value: n, text: n === 0 ? "none" : "Hyperliquid" };
    },
  },

  upsideCap: {
    id: "upsideCap",
    label: "Where the written call caps the position",
    unit: "pct",
    direction: "higher",
    inObjective: false,
    read(lane) {
      if (!has(lane, "covered-call")) return null;
      const v = num(lane, "covered-call", "strikePct");
      if (!finite(v)) return null;
      const f = v / PERCENT;
      return { value: f, text: `+${pct(f, 0)}` };
    },
  },

  downsideFloor: {
    id: "downsideFloor",
    label: "Where the held put floors the position",
    unit: "pct",
    direction: "higher",
    inObjective: false,
    read(lane) {
      if (!has(lane, "protective-put")) return null;
      const v = num(lane, "protective-put", "floorPct");
      if (!finite(v)) return null;
      // Signed, because a floor is below spot and the sign is the whole
      // meaning. A higher (less negative) floor protects sooner, which is why
      // the direction is `higher` on a negative quantity.
      const f = -v / PERCENT;
      return { value: f, text: pct(f, 0) };
    },
  },

  guardTrigger: {
    id: "guardTrigger",
    label: "Funding rate that unwinds the short",
    unit: "pct",
    direction: "neither",
    inObjective: false,
    read(lane) {
      if (!has(lane, "hedge")) return null;
      const v = num(lane, "hedge", "fundingFloorApr");
      if (!finite(v)) return null;
      // Neither end is better and that is the measurement, not a hedge: a
      // deeper floor keeps a paying lane running through a bad stretch and
      // keeps a losing one running too. Pricing it needs P(funding < floor
      // for N epochs) and the payload carries `fundingP25Apr` and nothing
      // else, so the fork renders and the product does not pick.
      return { value: v, text: pct(v, 0) };
    },
  },

  /**
   * ══ THE TWO WATCHER AXES (2026-08-26) ═══════════════════════════════════
   *
   * They are DIFFERENT INTEGERS with different per-market ratios, not a
   * tautological pair, and that is what makes them a real defence rather than
   * one axis counted twice. The venue carries five independently-firing
   * readable gates; the bridge carries at most one. So a stop that admits the
   * venue costs many more triggers than a stop that admits the route, both
   * counts are monotone in the same direction, and their DECLARED directions
   * are opposed — which is why no stop of the posture control dominates
   * another and why the eject key survives L1. The same shape that saves the
   * hedge's eject key on `offChainVenues` against `netApy`.
   *
   * Neither is in the objective and neither ever will be: watching a party
   * does not move a yield. The cost of a response IS measured per event
   * (`economics.executionDragApr`); annualising it needs an incident frequency
   * the payload does not carry, so it is named and never sized (L11).
   */
  dependenciesAnswered: {
    id: "dependenciesAnswered",
    label: "Parties on this lane with a written response",
    unit: "count",
    direction: "higher",
    inObjective: false,
    read(lane) {
      if (!has(lane, "exogenous-risk")) return null;
      const v = watchViewOf(lane);
      if (v.named === 0) return null;
      return { value: v.answeredCount, text: `${v.answeredCount} of ${v.named}` };
    },
  },

  responseTriggers: {
    id: "responseTriggers",
    label: "Readable quantities those responses fire on",
    unit: "count",
    // Lower is fewer things that can fire, and every firing costs gas and
    // slippage and adds no return. The watcher is a drawdown tool, not a
    // yield tool, and this axis is where the product says so in a number.
    direction: "lower",
    inObjective: false,
    read(lane) {
      if (!has(lane, "exogenous-risk")) return null;
      const v = watchViewOf(lane);
      if (v.named === 0) return null;
      return { value: v.triggers, text: `${v.triggers} triggers` };
    },
  },

  /**
   * THE FIRST TIME-VALUED AXIS. The quantity is days, and the direction is
   * `lower` without a hedge in it: capital in settlement earns nothing, so a
   * longer wait is strictly worse at every size. That is what makes the exit
   * route a real control rather than a disclosure — two issuers with the same
   * published rate and different settlement windows are not the same lane.
   *
   * NOT in the objective, and the reason is arithmetic rather than modesty:
   * the wait's cost is `sourceApy * settleDays / 365`, which enters a MOVE's
   * payback test, not the lane's steady-state `netApy`. Naming it here and
   * pricing it there is the same split `guardTrigger` already carries.
   */
  exitCost: {
    id: "exitCost",
    label: "Days from redemption request to cash",
    unit: "count",
    direction: "lower",
    inObjective: false,
    read(lane) {
      if (!has(lane, "redemption-route")) return null;
      const v = num(lane, "redemption-route", "settlementDays");
      if (!finite(v)) return null;
      return { value: v, text: `${v} ${v === 1 ? "day" : "days"}` };
    },
  },

  guardPersistence: {
    id: "guardPersistence",
    label: "Epochs below the floor before the guard fires",
    unit: "count",
    direction: "neither",
    inObjective: false,
    read(lane) {
      if (!has(lane, "hedge")) return null;
      const v = num(lane, "hedge", "fundingWindowEpochs");
      return finite(v) ? { value: v, text: `${v}` } : null;
    },
  },
};

export const ALL_AXIS_IDS = Object.keys(AXIS_RENDERERS) as AxisId[];

/** Read one axis, by id. Null when this lane cannot produce the quantity. */
export function readAxis(id: AxisId, lane: AxisLane): AxisReading | null {
  return AXIS_RENDERERS[id].read(lane);
}

/** Every declared axis of a control, read on one lane. Absent readings are
 *  DROPPED, never rendered as a dash: an axis this lane cannot produce is not
 *  an axis this lane trades on, and a dash beside three numbers invites a
 *  comparison between a value and an absence. */
export function readAxes(
  ids: readonly AxisId[],
  lane: AxisLane,
): { id: AxisId; def: AxisDef; reading: AxisReading }[] {
  const out: { id: AxisId; def: AxisDef; reading: AxisReading }[] = [];
  for (const id of ids) {
    const def = AXIS_RENDERERS[id];
    const reading = def.read(lane);
    if (reading !== null) out.push({ id, def, reading });
  }
  return out;
}

/** True when every axis this control declares has a term in the objective, so
 *  the objective alone may set it (L4). False means the setting must also be
 *  weakly best on the outside axes before the product may choose it. */
export function axesAllPriced(ids: readonly AxisId[]): boolean {
  return ids.every((id) => AXIS_RENDERERS[id].inObjective);
}

// ── The declaration shapes MODULE_DEFS carries ────────────────────────────

/**
 * The L2/L3/L4 declaration a descriptor carries.
 *
 * These three fields live here rather than in `types.ts` so the law and its
 * vocabulary have one home: a reviewer reading `axes.ts` sees the union, the
 * renderers and the obligations together, and `MODULE_DEFS` reads as a table
 * of claims against them.
 */
export interface AxisDeclaration {
  /**
   * The axes THIS control's settings move. L2: non-empty on every rendering
   * control, and every member must resolve in `AXIS_RENDERERS`.
   *
   * Declare what the settings move, never what the market moves. An
   * over-declared axis is a false defence against L1, and L2 exists precisely
   * to make that abuse checkable.
   */
  axes: AxisId[];
  /**
   * Set on a param the PRODUCT auto-sets. Names the axis it optimised, which
   * is what the reclaim readout publishes beside the runner-up (L10).
   * `objective ∈ axes` is a build assert.
   */
  objective?: AxisId;
  /**
   * Set on a default deliberately OFF the objective's argmax (L3). Names the
   * declared axis the default optimises instead, and that axis must render
   * beside it. Without this field an off-argmax default is indistinguishable
   * from an accident.
   */
  defaultRationale?: AxisId;
}

/** A descriptor that has declared its axes. */
export type AxisParamDescriptor = ParamDescriptor & AxisDeclaration;

/**
 * A module whose INSTALL/EJECT decision has declared its axes.
 *
 * The install key is a control like any other — it has two settings, and L1
 * binds it identically. The hedge is the case that proves the point: it is
 * dominated ON, on every legal row, and its eject key survives on
 * `denomination` and `offChainVenues` alone.
 */
export interface AxisModuleDef extends Omit<ModuleDef, "params"> {
  axes: AxisId[];
  params: AxisParamDescriptor[];
}
