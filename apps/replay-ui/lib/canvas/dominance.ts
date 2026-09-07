/**
 * THE DOMINANCE SWEEP — the build gate that decides whether a control is a
 * question or a trap.
 *
 * ══ THE LAW THIS RUNS (L1) ═════════════════════════════════════════════════
 *
 *   dominated(C, M) ⟺ ∃ s* : ∀ s ≠ s*, ∀ i  A_i(s*) ≥ A_i(s)
 *                                      ∧  ∃ i  A_i(s*) − A_i(s) > NOISE_i
 *   renders(C, M)   ⟹ ¬dominated(C, M)
 *
 * A control is a CLAIM: that its settings are peers, and that which one is
 * right depends on the user. When one setting is at least as good on every
 * declared axis and strictly better on one, that claim is false, and the
 * user's three outcomes are press the right cell (we gained nothing), press
 * the wrong one (we caused harm), or freeze (we spent their attention for
 * nothing). There is no branch where offering a dominated option pays.
 *
 * ══ WHY THIS FILE IS A GATE AND NOT A SURFACE ══════════════════════════════
 *
 * Nothing here renders. It answers one question per `(control, lane)` pair and
 * the answer is consumed by a test that fails the build, because the failure
 * mode this catches is invisible on a screen: a dominated control looks
 * exactly like a real one. It has a label, three keys, and a value that
 * changes when you press it. The only thing separating the two is arithmetic
 * nobody runs.
 *
 * ══ WHAT IT MAY NOT DO, AND WHY THE ORDER OF THE WAVE MATTERS ══════════════
 *
 * The quantifier `∀ i` ranges over the axes a control DECLARES (`axes.ts`,
 * L2). Before those declarations existed, this sweep was unsafe in both
 * directions at once: any control could be defended by asserting an axis
 * nobody wrote down, and any control could be deleted by forgetting one. So
 * this file NEVER invents an axis, never widens a declaration, and never
 * substitutes its own judgement for a declared direction. If a verdict here
 * is wrong, the fix is in the declaration or in the model, not here.
 *
 * ══ THE THREE THINGS THIS FILE IS CAREFUL ABOUT ════════════════════════════
 *
 * 1 · IT PRICES EVERY SETTING ITSELF, THROUGH THE OWNERS.
 *     A "setting" is not a stored number, it is a whole lane: change the
 *     leverage and the carry, the cushion and the deposit room all move, and
 *     two of those three move through `repriceAtLeverage`. A sweep that read
 *     the axes off an unrepriced row would find every leverage setting priced
 *     identically and would report a control that trades 39pp of APY as
 *     "dominated by tie". Every variant here goes through the same
 *     `repriceAtLeverage → publishedNetApy` path the lane's own hero uses, so
 *     the sweep and the screen cannot disagree. `__tests__/dominance.test.ts`
 *     pins that byte-for-byte against `laneLeverageStops`.
 *
 *     THE FRAME IS THE PRODUCT'S (C6, 2026-08-24, ruling R1). This file
 *     derives no APY of its own — it reads `readAxis("netApy", …)` — and that
 *     axis moved to `publishedNetApy` together with `leverage-stops.ts`,
 *     `axes.ts` and `tips.ts`, the family `__tests__/one-frame.test.ts`
 *     requires to share a frame, because the reclaim block this sweep feeds
 *     renders inches from the capsule's cells. Nothing here changed and
 *     nothing here may re-derive. A verdict is a SIGN, and the fee is a
 *     positive scaling on a positive lane and the identity on a non-positive
 *     one, so every verdict decided by a sign is fee-invariant. A verdict
 *     decided by a NOISE FLOOR is not: a gap of 1.1 × the floor in the venue
 *     frame is 0.9 × the floor in the product frame, and such a verdict
 *     correctly becomes `provisional`. That is the state hysteresis (3 below)
 *     exists for, and it resolves toward KEEPING the control.
 *
 * 2 · IT TAKES THE NOISE FLOORS FROM THEIR OWNERS.
 *     `NOISE_i` is not a tuning knob. pp and pct quantities use `EVEN_FLOOR`
 *     (`hedge-econ.ts`), capacity uses `MIN_DEPOSIT_USD` (`param-schema.ts`),
 *     leverage settings are separated on `LEVERAGE_GRID`. Counts and names
 *     have no ratified floor and get none invented for them: they tie when
 *     their own renderer prints the same string, which is the honest floor
 *     for a quantity whose only appearance is that string.
 *
 * 3 · IT IS HYSTERETIC (C1), AND THE DIRECTION IS L10's, NOT A PREFERENCE.
 *     Dominance is a property of a `(control, market)` PAIR measured at one
 *     block on a p25 input, so a control's existence is conditional and a
 *     control that appears and disappears as a scan moves a slope across zero
 *     is worse than either state. When the ratified floor — rather than the
 *     sign — is what decided the verdict, the verdict is `provisional` and
 *     the previous state is held. With no previous state a provisional
 *     verdict resolves toward KEEPING the control, because L10 already says
 *     it: a reclaim block that cannot prove its own arithmetic renders
 *     nothing and the control comes back.
 *
 * ══ AND THE DISTINCTION THAT DECIDES THE PRODUCT ANSWER ════════════════════
 *
 * "Dominated" is two different findings wearing one word, and conflating them
 * deletes a control that a rate move brings back:
 *
 *   • BY CONSTRUCTION — dominated on every lane in the catalog, by the same
 *     setting, with no verdict resting on a floor. `recenterTriggerPct` is
 *     this: 95 pays more and fires fewer recenters at every range, because
 *     `dnLpModel` has no term for time out of range. No rate brings it back;
 *     only a model with a cost side does. The product answer is deletion.
 *
 *   • BY THIS SCAN — dominated here, trading somewhere else in the same
 *     catalog. The leverage control is this: the slope `f_b·(cy − bo)` is
 *     negative on most rows and positive on two, and the two are not special
 *     markets, they are the same markets on a different day. The product
 *     answer is to answer the question on the rows where it has an answer and
 *     ask it on the rows where it does not. The code stays.
 *
 * `sweepControl().conditionality` is that classification, and it is computed
 * over a CATALOG rather than over one row, because one row cannot tell the two
 * apart. It refuses the "always" answer whenever the catalog holds a lane it
 * could not price, a verdict a floor decided, or a comparison that skipped a
 * declared axis — an always-claim quantifies over every market that will ever
 * exist, and incomplete evidence does not reach it.
 */

import {
  AXIS_RENDERERS,
  readAxis,
  type AxisDef,
  type AxisId,
  type AxisLane,
  type AxisReading,
} from "./axes";
import { FAMILY_CHAINS, FAMILY_REQUIRED_GROUPS, OVERLAY_KEYS, type LaneFamily } from "./graph-ops";
import { EVEN_FLOOR } from "./hedge-econ";
import { breakevenStopFor, leverageStopLevels } from "./leverage-stops";
import { MODULE_DEFS } from "./modules";
import { repriceAtLeverage, type LaneComposition } from "./mock-quote";
import { LEVERAGE_GRID, MIN_DEPOSIT_USD, PRODUCT_MIN_LEVERAGE } from "./param-schema";
import type { ModuleKey, ParamValue } from "./types";

// ── What a control is ─────────────────────────────────────────────────────

/**
 * A control, in the only two shapes the product has.
 *
 * The install key is a control like any other: two settings, and L1 binds it
 * identically. Modelling it as a separate kind rather than as a pseudo-param
 * keeps the setting enumeration honest — its settings are presence and
 * absence, not values — and it is the shape that lets the hedge's eject key
 * be swept at all.
 */
export type Control =
  | { kind: "param"; module: ModuleKey; field: string }
  | { kind: "install"; module: ModuleKey };

export function controlId(c: Control): string {
  return c.kind === "install" ? `${c.module}:install` : `${c.module}.${c.field}`;
}

/** The axes this control declares (L2). Never widened here. */
export function declaredAxes(c: Control): AxisId[] {
  if (c.kind === "install") return MODULE_DEFS[c.module].axes;
  const d = MODULE_DEFS[c.module].params.find((p) => p.field === c.field);
  return d ? d.axes : [];
}

/**
 * Every control the rack renders, in declaration order.
 *
 * Hidden descriptors are excluded because their setting set has exactly one
 * member once a market is pinned — a pinned record, not a question — and
 * non-optional modules have no install key to press.
 */
export function renderingControls(): Control[] {
  const out: Control[] = [];
  for (const key of Object.keys(MODULE_DEFS) as ModuleKey[]) {
    const def = MODULE_DEFS[key];
    if (def.optional) out.push({ kind: "install", module: key });
    for (const d of def.params) {
      if (d.hidden) continue;
      out.push({ kind: "param", module: key, field: d.field });
    }
  }
  return out;
}

// ── The noise floors, from their owners ───────────────────────────────────

/**
 * `NOISE_i`, per axis, in that axis's own unit.
 *
 * NOT A TUNING KNOB, and deliberately not a new constant. `EVEN_FLOOR` is the
 * ratified point below which a pp figure is not a measurement — the same
 * floor `notchMove` stands down on rather than narrate noise. `MIN_DEPOSIT_USD`
 * is the smallest deposit the product accepts, so a capacity difference
 * beneath it is a difference nobody can take.
 *
 * COUNTS AND NAMES GET ZERO, ON PURPOSE. No ratified floor exists for them and
 * inventing one would make this file the owner of a threshold, which is the
 * defect it exists to catch one level up. They tie through their own
 * renderer instead (`sameReading` below): two settings whose count prints the
 * same string are two settings a builder cannot tell apart at the moment of
 * choosing, and that is the only floor either quantity has ever had.
 */
function noiseFloor(def: AxisDef): number {
  switch (def.unit) {
    case "pp":
    case "pct":
      return EVEN_FLOOR;
    case "usd":
      return MIN_DEPOSIT_USD;
    default:
      return 0;
  }
}

/** One pairwise comparison on one axis, oriented so `win` means `a` is better. */
type Cmp = "win" | "loss" | "tie";

/**
 * Do these two readings say the same thing?
 *
 * TWO REGIMES, and which one applies is decided by whether the axis has a
 * ratified floor at all — never by which answer is convenient.
 *
 *   • WITH a floor (pp, pct, usd): the floor decides, and `floors: false`
 *     removes it. That switch is the whole of C1's band: running the law
 *     twice, once with the ratified floors and once without, says whether the
 *     SIGN of a difference or the FLOOR is what produced the verdict.
 *
 *   • WITHOUT one (count, name): the renderer decides, in both runs. No
 *     ratified floor exists for either and this file may not become the owner
 *     of a new one — so two settings whose count prints the same string are
 *     two settings a builder cannot tell apart, which is the only resolution
 *     either quantity has ever had. Holding that rule constant across both
 *     runs is deliberate: the counterfactual asks what the FLOORS did, and a
 *     float wobble under a renderer's last digit is not a floor.
 */
function sameReading(def: AxisDef, a: AxisReading, b: AxisReading, floors: boolean): boolean {
  if (typeof a.value !== "number" || typeof b.value !== "number") return a.value === b.value;
  const floor = noiseFloor(def);
  if (floor <= 0) return a.text === b.text;
  return floors ? Math.abs(a.value - b.value) <= floor : a.value === b.value;
}

function compareOn(def: AxisDef, a: AxisReading, b: AxisReading, floors: boolean): Cmp {
  if (sameReading(def, a, b, floors)) return "tie";
  if (typeof a.value !== "number" || typeof b.value !== "number") return "tie";
  const better = def.direction === "lower" ? b.value - a.value : a.value - b.value;
  return better > 0 ? "win" : "loss";
}

// ── Building the lane a setting produces ──────────────────────────────────

/**
 * The composition a lane's modules and dials price at.
 *
 * Mirrors `pricingParamsFor`'s hedge and compound halves for the flat
 * `AxisLane` shape. It is the same two objects `mock-quote` reads and nothing
 * more: the funding guard fields are deliberately absent because they are not
 * in `QUOTE_AFFECTING_PARAMS` and putting them here would make this file
 * claim they price.
 */
function compositionOf(
  placed: readonly ModuleKey[],
  params: AxisLane["params"],
): LaneComposition {
  const h = params.hedge;
  const k = params["auto-compound"];
  const n = (v: ParamValue | undefined, fallback: number): number => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) ? x : fallback;
  };
  return {
    hedge:
      placed.includes("hedge") && h
        ? {
            hedgeLeverage: n(h.hedgeLeverage, defaultNumber("hedge", "hedgeLeverage")),
            reserveFraction: n(h.reserveFraction, defaultNumber("hedge", "reserveFraction")),
          }
        : null,
    compound:
      placed.includes("auto-compound") && k
        ? {
            cadence: String(
              k.cadence ?? MODULE_DEFS["auto-compound"].params.find((p) => p.field === "cadence")!.default,
            ) as LaneCompoundCadence,
            minActionUsd: n(k.minActionUsd, defaultNumber("auto-compound", "minActionUsd")),
          }
        : null,
  };
}

type LaneCompoundCadence = NonNullable<LaneComposition["compound"]>["cadence"];

/** The descriptor's own default as a number. No literal fallbacks. */
function defaultNumber(key: ModuleKey, field: string): number {
  const d = MODULE_DEFS[key].params.find((p) => p.field === field);
  const v = typeof d?.default === "string" ? Number(d.default) : d?.default;
  return typeof v === "number" && Number.isFinite(v) ? v : Number.NaN;
}

/** The leverage a lane's dials ask for. No leverage module means no borrow
 *  leg, which is a fact about the lane and not a missing dial. */
function requestedLeverage(placed: readonly ModuleKey[], params: AxisLane["params"]): number {
  if (!placed.includes("safety-buffer")) return PRODUCT_MIN_LEVERAGE;
  const v = params["safety-buffer"]?.targetLeverage;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : defaultNumber("safety-buffer", "targetLeverage");
}

/**
 * A whole lane, priced, from a scan row and a composition.
 *
 * ⚠ `scanRow` IS THE UNREPRICED SCAN ROW. THIS IS FRAME M, and getting it
 * wrong is silent rather than loud: `repriceAtLeverage` caps at the row's own
 * `economics.loopLeverage`, and repricing an already-repriced row makes that
 * row's current leverage the ceiling, so every setting above it collapses onto
 * it and the sweep reports a real trade as a tie. `RackCanvas` carries the
 * same warning over `laneLeverageStops` for the same reason and it was caught
 * on screen there, not in a test.
 *
 * Every caller in this file therefore threads `base.candidate` — which in the
 * fixture catalog is exactly the document `opportunities-server` serves —
 * and never a lane it has already built.
 */
function laneFrom(base: AxisLane, placed: readonly ModuleKey[], params: AxisLane["params"], preset: AxisLane["preset"]): AxisLane {
  const comp = compositionOf(placed, params);
  const wants = requestedLeverage(placed, params);
  const scan = base.candidate;
  const priced = scan ? repriceAtLeverage(scan, wants, comp) : null;
  return {
    candidate: priced,
    placed: [...placed],
    params,
    comp,
    // The leverage the MODEL landed on, never the dial's request: a cushion
    // quoted at a leverage nothing priced is a cushion for a different lane.
    appliedLeverage: priced?.economics?.loopLeverage ?? wants,
    preset,
    tvlUsd: base.tvlUsd,
  };
}

function withParam(
  params: AxisLane["params"],
  key: ModuleKey,
  field: string,
  value: ParamValue,
): AxisLane["params"] {
  return { ...params, [key]: { ...(params[key] ?? {}), [field]: value } };
}

// ── The settings a control offers on this market ──────────────────────────

/** One setting, with the lane it produces. */
export interface SettingLane {
  value: ParamValue;
  lane: AxisLane;
}

/**
 * The settings a control genuinely offers on THIS market.
 *
 * THE LEVERAGE CASE IS THE ONE THAT MATTERS AND IT READS THE ONE OWNER.
 * `targetLeverage`'s descriptor is a slider spanning a structural range, but
 * the settings the product OFFERS on a market are `leverageStopLevels` — the
 * three positions on `deriveLeverageBounds`' own bounds that `ComposePanel`
 * renders as keys, already capped at the row's scan ceiling and already
 * deduplicated on `LEVERAGE_GRID`. Sweeping the raw slider grid instead would
 * price settings the control does not offer, and would price them above a
 * ceiling `repriceAtLeverage` silently caps, producing duplicate readings that
 * read as ties. `netApy(L)` is affine, so a corner argmax over the stops is
 * the argmax over the whole grid regardless.
 *
 * Everything else is either an option list (its settings, verbatim) or a
 * numeric grid walked on the descriptor's own `step`.
 */
export function settingsOf(control: Control, lane: AxisLane): ParamValue[] {
  if (control.kind === "install") return [true, false];

  const d = MODULE_DEFS[control.module].params.find((p) => p.field === control.field);
  if (!d || d.hidden) return [];
  if (d.options && d.options.length > 0) return d.options.map((o) => o.value);
  /* A TOGGLE OFFERS TWO SETTINGS, and saying so is what keeps a boolean
     control inside the law rather than outside it (2026-08-26). Without this
     branch a toggle falls through to the numeric grid, returns [], and comes
     back `unpriceable` — evidence withheld about a control the dock renders. */
  if (d.type === "toggle") return [true, false];

  if (control.module === "safety-buffer" && control.field === "targetLeverage") {
    const lt = lane.candidate?.lt;
    if (typeof lt !== "number" || !Number.isFinite(lt) || lt <= 0) return [];
    /* THE SAME CEILING THE SHIPPED CONTROL APPLIES (S1, 2026-08-24, R4).
       `laneLeverageStops` — the control the lane actually renders — clamps to
       `breakevenStopFor`. This sweep did not, so on a negative-slope row it
       enumerated settings the control no longer offers and could report a
       lane dominated by a leverage nobody can select. Same lane, same two
       reads `composedTerms` takes for the short leg. */
    const stops = leverageStopLevels(
      lt,
      lane.preset,
      lane.candidate?.economics?.loopLeverage ?? null,
      breakevenStopFor(lane.candidate, lane.placed.includes("hedge"), lane.comp),
    );
    // Belt to `leverageStopLevels`' own braces: two stops closer than one grid
    // step are one setting, and a control with two keys and one outcome is
    // not an instrument.
    return stops.filter((v, i) => i === 0 || Math.abs(v - stops[i - 1]) >= LEVERAGE_GRID - 1e-9);
  }

  if (typeof d.min === "number" && typeof d.max === "number" && typeof d.step === "number" && d.step > 0) {
    const out: number[] = [];
    for (let v = d.min; v <= d.max + 1e-9; v += d.step) out.push(Number(v.toFixed(6)));
    return out;
  }
  return [];
}

/** Each setting, as the lane it produces. */
/**
 * ONE setting lane at an ARBITRARY value — the lane a control WOULD produce at
 * a position, whether or not that position is one the control still offers.
 *
 * S1, 2026-08-24. `reclaimHeld` claimed to do this ("off the ladder it is
 * built the same way, through `settingLanes`' own constructor") but reached it
 * by searching `settingLanes`' output, which only ever contains the ENUMERATED
 * settings. So a lane holding a leverage the ladder does not list lost its
 * `You hold` row entirely — an absence of a fact rather than a fact. R4's
 * economic ceiling made that reachable on every negative-slope row: the dial
 * stops at the breakeven, and a lane that stored a higher number before the
 * market moved is exactly the reader who needs the readout most.
 *
 * Same constructor, same params fold, same preset rule as `settingLanes`, so
 * the held lane's arithmetic is the sweep's arithmetic.
 */
export function settingLaneAt(control: Control, lane: AxisLane, value: ParamValue): SettingLane {
  if (control.kind === "install") {
    const off = lane.placed.filter((k) => k !== control.module);
    const on = value === true;
    return { value, lane: laneFrom(lane, on ? [...off, control.module] : off, lane.params, lane.preset) };
  }
  const params = withParam(lane.params, control.module, control.field, value);
  const preset =
    control.module === "safety-buffer" && control.field === "riskPreset"
      ? (String(value) as AxisLane["preset"])
      : lane.preset;
  return { value, lane: laneFrom(lane, lane.placed, params, preset) };
}

export function settingLanes(control: Control, lane: AxisLane): SettingLane[] {
  if (control.kind === "install") {
    const off = lane.placed.filter((k) => k !== control.module);
    return [
      { value: true, lane: laneFrom(lane, [...off, control.module], lane.params, lane.preset) },
      { value: false, lane: laneFrom(lane, off, lane.params, lane.preset) },
    ];
  }
  return settingsOf(control, lane).map((value) => {
    const params = withParam(lane.params, control.module, control.field, value);
    // `riskPreset` is not only a param: it is the band derivation's own input,
    // and `driftBeforeTrim` reads it off the lane rather than the dial bag.
    const preset =
      control.module === "safety-buffer" && control.field === "riskPreset"
        ? (String(value) as AxisLane["preset"])
        : lane.preset;
    return { value, lane: laneFrom(lane, lane.placed, params, preset) };
  });
}

// ── The verdict ───────────────────────────────────────────────────────────

export type DominanceKind =
  /** No setting dominates: the control earns its keep on this market. */
  | "trades"
  /** One setting is at least as good everywhere and strictly better somewhere. */
  | "dominated"
  /** Every setting reads identically on every compared axis. Not a choice at
   *  all: L5 territory, and a stronger finding than dominance. */
  | "tied"
  /** The market offers one setting. Three keys and one outcome is not an
   *  instrument, and the caller renders a single readout instead. */
  | "single"
  /** Fewer than two settings produce a reading on any declared axis. The
   *  sweep declines rather than guess; a surface that cannot prove its
   *  arithmetic prints nothing, and so does this. */
  | "unpriceable";

/** One axis, read across every setting, with the spread the verdict rests on. */
export interface AxisSpread {
  axis: AxisId;
  /** `higher` / `lower` axes order the settings; `neither` can only rescue. */
  ranked: boolean;
  /** True when at least two settings differ on this axis beyond its floor. */
  moves: boolean;
  readings: { value: ParamValue; reading: AxisReading }[];
}

export interface DominanceVerdict {
  control: Control;
  kind: DominanceKind;
  /** The setting that dominates, when one does. */
  winner: ParamValue | null;
  /**
   * The closest setting to the winner ON THE OBJECTIVE, with its signed cost.
   * L10's reclaim contract is built on this: removing a control converts a
   * question into a claim, and the runner-up is the evidence for the removal
   * and the only thing that lets a user check us.
   */
  runnerUp: { value: ParamValue; deltaNetApy: number } | null;
  /** Axes that read on EVERY setting; only these can order anything. */
  compared: AxisId[];
  /** Declared axes that failed to read somewhere. Dropped, never dashed. */
  dropped: AxisId[];
  /** `neither`-direction axes that MOVE. Each one is a trade the product has
   *  no view on, and any one of them is enough to save the control. */
  unrankable: AxisId[];
  /** Settings no other setting dominates. */
  front: ParamValue[];
  spreads: AxisSpread[];
  /**
   * TRUE when a ratified floor — rather than the sign of a difference —
   * decided this verdict. C1's band: the same scan an hour later can flip it,
   * so a caller that renders on it must hold its previous state.
   */
  provisional: boolean;
  /**
   * TRUE when a DECLARED axis failed to read on some setting, so the verdict
   * was reached over fewer axes than the control claims to move.
   *
   * Kept separate from `provisional` on purpose: they are different weaknesses
   * and a caller answers them differently. A provisional verdict is a
   * measurement too close to call and the answer is hysteresis. A partial one
   * is a comparison that never happened — the collar's own APY on a lane
   * missing its other leg, the action count on the ejected half of an install
   * press — and the answer is that no catalog-wide claim may rest on it. L2
   * says an axis must be declared AND rendered; this is the flag for the half
   * that was declared and did not render.
   */
  partial: boolean;
  /** TRUE when a previous state was adopted because this reading was
   *  provisional. The verdict below is then the PREVIOUS one. */
  held: boolean;
}

/** The part of a verdict that hysteresis carries between scans. */
export interface DominanceState {
  kind: DominanceKind;
  winner: ParamValue | null;
}

export interface DominanceOptions {
  /** What this `(control, lane)` pair last resolved to. C1: inside the band
   *  the last state is held, because a control that appears and disappears as
   *  a scan moves a slope across zero is worse than either state. */
  previous?: DominanceState | null;
}

/** One pass of the law, at a given floor setting. */
function decide(
  settings: SettingLane[],
  axes: AxisId[],
  floors: boolean,
): {
  kind: DominanceKind;
  winner: ParamValue | null;
  compared: AxisId[];
  dropped: AxisId[];
  unrankable: AxisId[];
  front: ParamValue[];
  spreads: AxisSpread[];
} {
  const read = new Map<AxisId, (AxisReading | null)[]>();
  for (const id of axes) read.set(id, settings.map((s) => readAxis(id, s.lane)));

  const compared: AxisId[] = [];
  const dropped: AxisId[] = [];
  for (const id of axes) {
    (read.get(id)!.every((r) => r !== null) ? compared : dropped).push(id);
  }

  const spreads: AxisSpread[] = [];
  const unrankable: AxisId[] = [];
  for (const id of compared) {
    const def = AXIS_RENDERERS[id];
    const rs = read.get(id)! as AxisReading[];
    let moves = false;
    for (let i = 1; i < rs.length && !moves; i++) {
      for (let j = 0; j < i; j++) {
        if (!sameReading(def, rs[i], rs[j], floors)) {
          moves = true;
          break;
        }
      }
    }
    const ranked = def.direction !== "neither";
    if (!ranked && moves) unrankable.push(id);
    spreads.push({
      axis: id,
      ranked,
      moves,
      readings: settings.map((s, i) => ({ value: s.value, reading: rs[i] })),
    });
  }

  if (settings.length < 2) {
    return { kind: "single", winner: settings[0]?.value ?? null, compared, dropped, unrankable, front: settings.map((s) => s.value), spreads };
  }
  if (compared.length === 0) {
    return { kind: "unpriceable", winner: null, compared, dropped, unrankable, front: [], spreads };
  }

  const ranked = compared.filter((id) => AXIS_RENDERERS[id].direction !== "neither");

  /* THE RESCUE, AND IT IS THE HALF THAT SAVES THE RIGHT CONTROLS.
     An axis the product has no view on cannot make a setting worse, so it can
     never condemn a control — but a setting set that MOVES one is a genuine
     trade nobody can rank, and offering the fork is then the only honest act.
     This is what keeps `riskPreset` (drift before the trim moves and neither
     end is better) and the hedge's eject key (a denomination is a preference)
     out of the deletion list, and it is exactly the door L2 makes checkable:
     a `neither` axis has to be DECLARED and has to RENDER before it rescues
     anything. */
  if (unrankable.length > 0) {
    return { kind: "trades", winner: null, compared, dropped, unrankable, front: settings.map((s) => s.value), spreads };
  }

  const beats = (a: number, b: number): { weak: boolean; strict: boolean } => {
    let weak = true;
    let strict = false;
    for (const id of ranked) {
      const def = AXIS_RENDERERS[id];
      const rs = read.get(id)! as AxisReading[];
      const c = compareOn(def, rs[a], rs[b], floors);
      if (c === "loss") weak = false;
      if (c === "win") strict = true;
    }
    return { weak, strict };
  };

  const front: ParamValue[] = [];
  for (let i = 0; i < settings.length; i++) {
    let beaten = false;
    for (let j = 0; j < settings.length && !beaten; j++) {
      if (i === j) continue;
      const r = beats(j, i);
      if (r.weak && r.strict) beaten = true;
    }
    if (!beaten) front.push(settings[i].value);
  }

  // The law's own quantifier: ONE setting that beats every other outright.
  let winner: ParamValue | null = null;
  for (let i = 0; i < settings.length; i++) {
    let all = true;
    for (let j = 0; j < settings.length && all; j++) {
      if (i === j) continue;
      const r = beats(i, j);
      if (!(r.weak && r.strict)) all = false;
    }
    if (all) {
      winner = settings[i].value;
      break;
    }
  }
  if (winner !== null) {
    return { kind: "dominated", winner, compared, dropped, unrankable, front, spreads };
  }

  const anyMove = spreads.some((s) => s.moves);
  return {
    kind: anyMove ? "trades" : "tied",
    winner: null,
    compared,
    dropped,
    unrankable,
    front,
    spreads,
  };
}

/**
 * Does this control's setting set collapse to one answer on this market?
 *
 * ⚠ `lane.candidate` MUST be the unrepriced scan row (see `laneFrom`).
 */
export function dominates(
  control: Control,
  lane: AxisLane,
  opts: DominanceOptions = {},
): DominanceVerdict {
  const axes = declaredAxes(control);
  const settings = settingLanes(control, lane);

  if (axes.length === 0 || settings.length === 0) {
    return {
      control,
      kind: "unpriceable",
      winner: null,
      runnerUp: null,
      compared: [],
      dropped: [...axes],
      unrankable: [],
      front: [],
      spreads: [],
      provisional: false,
      partial: axes.length > 0,
      held: false,
    };
  }

  const floored = decide(settings, axes, true);
  /* THE COUNTERFACTUAL THAT DEFINES C1's BAND, and it needs no second
     threshold to do it: run the same law again with the floors removed. If
     the answer is the same, the SIGN decided it and the verdict is stable
     under any scan that does not change a sign. If the answer moves, the
     FLOOR decided it — the two settings are separated by less than a
     measurement — and the verdict is exactly the flickering kind C1 names. */
  const bare = decide(settings, axes, false);
  const provisional = floored.kind !== bare.kind || !Object.is(floored.winner, bare.winner);

  const runnerUp = runnerUpOn(settings, floored.winner);

  if (provisional && opts.previous) {
    return {
      control,
      kind: opts.previous.kind,
      winner: opts.previous.winner,
      runnerUp,
      compared: floored.compared,
      dropped: floored.dropped,
      unrankable: floored.unrankable,
      front: floored.front,
      spreads: floored.spreads,
      provisional: true,
      partial: floored.dropped.length > 0,
      held: true,
    };
  }

  return {
    control,
    kind: floored.kind,
    winner: floored.winner,
    runnerUp,
    compared: floored.compared,
    dropped: floored.dropped,
    unrankable: floored.unrankable,
    front: floored.front,
    spreads: floored.spreads,
    provisional,
    partial: floored.dropped.length > 0,
    held: false,
  };
}

/**
 * The best setting other than the winner, ON THE OBJECTIVE, and what it costs.
 *
 * The objective and nothing else, because the reclaim readout states one
 * number and a runner-up chosen on a different axis than the one whose delta
 * is printed would be two claims wearing one row. Null when the objective
 * does not read, which is also when the reclaim block renders nothing.
 */
function runnerUpOn(
  settings: SettingLane[],
  winner: ParamValue | null,
): { value: ParamValue; deltaNetApy: number } | null {
  if (winner === null) return null;
  const netApy = (s: SettingLane): number | null => {
    const r = readAxis("netApy", s.lane);
    return r && typeof r.value === "number" ? r.value : null;
  };
  const best = settings.find((s) => Object.is(s.value, winner));
  const bestApy = best ? netApy(best) : null;
  if (bestApy === null) return null;
  let up: { value: ParamValue; deltaNetApy: number } | null = null;
  for (const s of settings) {
    if (Object.is(s.value, winner)) continue;
    const v = netApy(s);
    if (v === null) continue;
    if (up === null || v > bestApy - up.deltaNetApy) up = { value: s.value, deltaNetApy: bestApy - v };
  }
  return up;
}

// ── The catalog sweep, and C1's second half ───────────────────────────────

/** Where a control's existence is decided: on one row, or everywhere. */
export type Conditionality =
  /**
   * COLLAPSED EVERYWHERE, AND PROVABLY. Dominated or tied on every lane it
   * renders on, by one setting, with every lane priceable, no verdict resting
   * on a floor and no declared axis left uncompared. No rate move brings this
   * control back; only a model that grows the missing term does. The product
   * answer is deletion, and it is safe to take.
   */
  | "by-construction"
  /**
   * COLLAPSED HERE. Dominated somewhere and trading, unpriceable, floor-decided
   * or partly compared somewhere else in the same catalog. The product answers
   * the question on the rows where it has an answer and asks it on the rows
   * where it does not, and the CODE STAYS — this is the state a rate move
   * walks back out of.
   *
   * It is deliberately also the answer when the evidence is merely
   * incomplete. "Always" is a claim about every market that will ever exist
   * and a catalog with a lane we could not price does not support it.
   */
  | "by-this-scan"
  /** Dominated nowhere. */
  | "never";

export interface SweptLane {
  /** Whatever the caller uses to name the lane. Carried, never parsed. */
  rowId: string;
  variant: string;
  verdict: DominanceVerdict;
}

export interface ControlSweep {
  control: Control;
  /** Only lanes the control actually renders on. */
  lanes: SweptLane[];
  dominatedOn: number;
  tradesOn: number;
  tiedOn: number;
  provisionalOn: number;
  /** Lanes whose verdict was reached over fewer axes than the control declares. */
  partialOn: number;
  /** The winning setting when every dominated lane agrees on one. */
  winnerEverywhere: ParamValue | null;
  conditionality: Conditionality;
}

/**
 * The families this module set is a FINISHED lane of.
 *
 * Both halves come from their owners and neither is re-derived: `laneFamilies`'
 * own test (every placed key is on the chain) says which families survive, and
 * `FAMILY_REQUIRED_GROUPS` says which of those are finished. Empty means the
 * key set is not a lane the product would build.
 */
function completeFamilies(placed: readonly ModuleKey[]): LaneFamily[] {
  const seen = new Set(placed);
  /* OVERLAYS ARE NOT CHAIN MEMBERS (2026-08-26), and this filter is not
     cosmetic: without it a lane holding an overlay returns NO complete family,
     `rendersOn` then answers false for every control on that lane, and the
     sweep quietly loses its evidence about controls that are demonstrably on
     screen. Same one-line fix, same reason, as `graph-ops.laneFamilies`. */
  const chain = placed.filter((k) => !OVERLAY_KEYS.has(k));
  return (Object.keys(FAMILY_CHAINS) as LaneFamily[]).filter(
    (f) =>
      chain.every((k) => FAMILY_CHAINS[f].includes(k)) &&
      FAMILY_REQUIRED_GROUPS[f].every((group) => group.some((k) => seen.has(k))),
  );
}

/**
 * Does this control render on this lane at all?
 *
 * TWO THINGS THIS REFUSES, AND BOTH WERE MEASURED PRODUCING FALSE VERDICTS.
 *
 * A LANE THE PRODUCT WOULD NOT BUILD IS NOT A MARKET. A collar holding one
 * option leg validates false and publishes nothing, and on it `collarModel`
 * declines to price — so `netApy` drops out and the strike keys collapse onto
 * the payoff axis alone, reading as `dominated` when nothing was compared.
 * Sweeping it would have put a real control on the deletion list on the
 * strength of a composition no user can reach.
 *
 * AND AN INSTALL KEY IS ONLY A CONTROL WHERE BOTH ITS SETTINGS ARE LEGAL.
 * `optional` is a property of the module, not of the lane: the hedge is
 * optional on a loop and STRUCTURAL on a delta-neutral LP, and the range
 * module is not on the loop chain at all. Pressing either produces a lane the
 * validator refuses, and both readings then tie or drop — evidence about a
 * press nobody can make. So the key renders only where installing leaves a
 * finished lane AND ejecting leaves a finished lane.
 */
export function rendersOn(control: Control, lane: AxisLane): boolean {
  if (control.kind === "install") {
    if (!MODULE_DEFS[control.module].optional) return false;
    const off = lane.placed.filter((k) => k !== control.module);
    return (
      completeFamilies([...off, control.module]).length > 0 && completeFamilies(off).length > 0
    );
  }
  if (!lane.placed.includes(control.module)) return false;
  if (completeFamilies(lane.placed).length === 0) return false;
  const d = MODULE_DEFS[control.module].params.find((p) => p.field === control.field);
  return !!d && !d.hidden;
}

export interface SweepLaneInput {
  rowId: string;
  variant: string;
  lane: AxisLane;
  previous?: DominanceState | null;
}

/**
 * One control, over a catalog.
 *
 * The classification at the end is the whole reason this takes a catalog: one
 * row cannot tell "dominated because the model has no cost side" from
 * "dominated because borrowing costs more than the collateral pays today",
 * and those two findings demand opposite product answers. A catalog of four
 * venues on three chains IS the sample of rate environments, so a control that
 * trades on none of them is not waiting for a rate.
 */
export function sweepControl(control: Control, lanes: SweepLaneInput[]): ControlSweep {
  const swept: SweptLane[] = [];
  for (const l of lanes) {
    if (!rendersOn(control, l.lane)) continue;
    swept.push({
      rowId: l.rowId,
      variant: l.variant,
      verdict: dominates(control, l.lane, { previous: l.previous ?? null }),
    });
  }

  const dominated = swept.filter((s) => s.verdict.kind === "dominated");
  const trades = swept.filter((s) => s.verdict.kind === "trades");
  const tied = swept.filter((s) => s.verdict.kind === "tied");
  const provisional = swept.filter((s) => s.verdict.provisional);
  const partial = swept.filter((s) => s.verdict.partial);

  const winners = new Set(dominated.map((s) => String(s.verdict.winner)));
  const winnerEverywhere =
    winners.size === 1 && dominated.length > 0 ? dominated[0].verdict.winner : null;

  /* WHAT "ALWAYS" HAS TO CLEAR, and every clause is one way the claim has
     been wrong before:

       • a `tied` lane COUNTS toward it. Every setting reading the same on
         every axis is a stronger collapse than dominance, not a weaker one,
         so a control tied here and dominated there has still never been a
         question anywhere;
       • one lane the sweep could not price REFUSES it. "Always" quantifies
         over every market that will ever exist and a catalog with an
         unpriceable lane in it does not support that. `single` counts as
         unpriceable here for the same reason: it is a fact about the market's
         ceiling, not about the settings;
       • one floor-decided verdict refuses it, because a floor-decided verdict
         is precisely the one the next scan flips;
       • one PARTIAL verdict refuses it, because a comparison over two of a
         control's three declared axes has not tested the claim it makes. This
         is the clause that keeps the collar's option keys out: on a lane
         holding one leg the family model prices nothing, so the verdict rests
         on the payoff axis alone and reads as a collapse. */
  const priceable = swept.filter(
    (s) => s.verdict.kind === "dominated" || s.verdict.kind === "trades" || s.verdict.kind === "tied",
  );
  const collapsedEverywhere =
    priceable.length > 0 &&
    priceable.length === swept.length &&
    trades.length === 0 &&
    provisional.length === 0 &&
    partial.length === 0 &&
    (dominated.length === 0 || winnerEverywhere !== null);
  let conditionality: Conditionality;
  if (dominated.length + tied.length === 0) conditionality = "never";
  else if (collapsedEverywhere) conditionality = "by-construction";
  else conditionality = "by-this-scan";

  return {
    control,
    lanes: swept,
    dominatedOn: dominated.length,
    tradesOn: trades.length,
    tiedOn: tied.length,
    provisionalOn: provisional.length,
    partialOn: partial.length,
    winnerEverywhere,
    conditionality,
  };
}

/** Every rendering control, over a catalog. The build gate's own input. */
export function sweepAll(lanes: SweepLaneInput[]): ControlSweep[] {
  return renderingControls().map((c) => sweepControl(c, lanes));
}
