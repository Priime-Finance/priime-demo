"use client";

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/non-nullable-type-assertion-style, react-hooks/exhaustive-deps --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive.
 *
 * `@typescript-eslint/prefer-nullish-coalescing` LEFT THIS LIST when WP-2
 * rewrote `loadRun`'s error path: the `j.error || "…"` that needed it is
 * gone, and eslint reports an unused directive as a warning, which this
 * package's gate counts. It returns the moment a kit idiom needs it again. */
/**
 * LanePanel (IT4_DOCK_SPEC §5, mockup register 2026-08-20) — the dock's
 * PORTFOLIO mode, plus the shared lane view type and allocation editor.
 *
 * Portfolio variant: allocation bars, the three orchestrator dials via the
 * shared OrchDial renderer, and the Rules decode.
 *
 * 2026-08-22 — the lane variant is RETIRED (COMPOSE_PANEL_SPEC rank 12). Its whole
 * job moved into ComposePanel: Install defaults, the market key, Remove lane,
 * the capacity line, the family checklist (now the collapsed lane card's dot
 * row) and — critically — the Composition control the capacity work shipped
 * here, whose two numbers now ride the add bay's triple and the eject cross's
 * reversed pair.
 *
 * The hand-rolled compatibility expression that used to gate that block
 * (`hedgedClass && !hasHedge && (hasSafety || family === "dnlp")`) is DELETED
 * rather than moved: it was a THIRD opinion about what a lane can take,
 * alongside FAMILY_CHAINS and validateGraph, and a third opinion is how the
 * next drift starts. lib/canvas/compose-options.ts is now the only one.
 *
 * ══ 2026-09-03 · THIS FILE IS ALSO THE ROUTER'S DRAWING BOARD (spec F) ═════
 *
 * Section F asks for six drawings, and the contract on top of them is that
 * THE DESTINATION IS DRAWN ON BOTH ROUTER PLACEMENTS — the plate on the
 * canvas and this panel in the dock — "or one describes a machine the other
 * does not have". Two placements sharing one drawing means the drawing has to
 * live in a file both of them already reach.
 *
 * That file is this one. `OrchestratorPlate` has imported `AllocShareInput`
 * from here since the allocation editor was made shared, so the edge
 * plate → panel already exists and carries no cycle; the reverse edge would
 * create one. So the router's drawings are declared below and the plate
 * imports them, exactly as it already imports the allocation input.
 *
 * The alternative was a fourth component file. It was refused for a smaller
 * reason and a larger one: the smaller is that a new file is outside the work
 * package's named ownership, and the larger is that this file is ALREADY the
 * home of the one widget both router surfaces share, so a second such home
 * would be the beginning of the drift the docblock above spends four
 * paragraphs describing.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { LoopGraph, LoopId, ParamValue, PortfolioGraph } from "@/lib/canvas/types";
import { laneFamily, nodeFor } from "@/lib/canvas/graph-ops";
import { pricingParamsFor } from "@/lib/canvas/pricing-params";
import { fmtCapacityUsd, vaultCapacity } from "@/lib/canvas/capacity";
import { blockStamp, MINUS, pct, pp, ppMag, usd } from "@/lib/canvas/format";
import { LiveNumber } from "@/components/atoms/LiveNumber";
import {
  allocCommitBps,
  allocationPercents,
  clampConcentrationPct,
  exitProfileFor,
  orchRuleTable,
  orchRuleScopeLine,
  deriveAllOrchRules,
  deriveLaneSignals,
  deriveOrchRules,
  dialsFromParams,
  orchDialDefs,
  ORCH_HONESTY_LINE,
  ORCHESTRATOR_DEF,
  PAUSE_DESTINATION,
  PAYBACK_HORIZON_DAYS,
  paybackMs,
  riskAdjUnified,
  selectDestination,
  slotsFromPortfolio,
  upgradeThreshold,
  type AttestedDecision,
  type AttestedReceipt,
  type LaneSignal,
  type LoopSlot,
  type OrchBudgetState,
  type SettlementLeg,
  type SlotLiveState,
} from "@/lib/canvas/orchestrator";
/* THE REGIME LIST, FROM THE ONE IMPORT-FREE FILE IN THAT PACKAGE. Every other
   module under `lib/canvas/scenario` reaches the committed scan fixture or
   `strategy-factory/venues/hyperliquid-funding`, whose graph pulls
   `node:crypto` through `hl-scan`; `regime-ids.ts` is deliberately import-free
   so a client control can name the six regimes without dragging any of that
   into the browser bundle. WP-4 wrote that instruction for this switcher. */
import {
  DEFAULT_REGIME,
  isRegimeId,
  REGIME_IDS,
  REGIME_LABEL,
  REGIME_MECHANISM,
  type RegimeId,
} from "@/lib/canvas/scenario/regime-ids";
import type { LeverageStopView } from "@/lib/canvas/leverage-stops";
import type { ParamContext } from "@/lib/canvas/modules";
import OrchDial from "./OrchDial";
import type { RepriceData } from "../types";

export interface DockLaneView {
  loop: LoopGraph;
  /** The effective quote (live rail or catalog-modeled); never a failure. */
  reprice: RepriceData | null;
  repricing: boolean;
  netApy: number | null;
  graphOk: boolean;
  laneReviewable: boolean;
  /** Borrow above yield at the margin (P1-4 narration). */
  leverageYieldNegative: boolean;
  /**
   * FRAME M — the UNREPRICED scan row behind this lane: the market's own
   * headline at the market's own leverage. Never `repriceAtLeverage(...)`.
   * Null when no scan row backs the lane (template venue, catalog miss), and
   * every surface degrades to a percentage-free sub-line rather than
   * inventing one.
   */
  scan: { apr: number | null; lev: number | null } | null;
  /** The market's own reported liquidation threshold. Null until a market is
   *  pinned, and the risk control does not render without it: there is no
   *  ceiling, no cushion and no APY before then. */
  lt: number | null;
  /** The leverage stops this market offers, from `laneLeverageStops` — the
   *  ONE owner. Each carries the adverse pair move it survives and the
   *  modeled net APY at it. Empty on a non-loop lane or an unpinned market. */
  stops: LeverageStopView[];
  /** The leverage the MODEL landed on (`economics.loopLeverage`), which
   *  `repriceAtLeverage` may have capped at the scan's own L0. */
  appliedLeverage: number | null;
  /** The leverage the lane STORES and publishes. The control reads its
   *  position from this, never from a second piece of state. */
  storedLeverage: number;
  /**
   * The lane's market as `paramContextFor(...)` reads it (D3, 2026-08-24).
   *
   * The dock's Module panel renders the SAME `PlateControls` the plate does,
   * so it needs the same narrowing argument or the mirrored dial draws the
   * STRUCTURAL envelope while the plate draws the market's own bound. It is
   * also the object `RackCanvas` clamps this lane's `param` dispatches with,
   * which is what makes a published `max` the bound the control enforces.
   */
  paramCtx: ParamContext;
}

/**
 * ActionKey — a REAL button.
 *
 * §6 live bug, fixed rather than propagated: this was a
 * `<div role="button" tabIndex={0}>` whose onKeyDown fired on `" "` WITHOUT
 * `e.preventDefault()`, so pressing Space on a focused key scrolled
 * `.dock-scroll` AND fired the action. A native button gets Enter and Space
 * semantics from the platform and cannot drift.
 */
function ActionKey({ label, lit, warn, onClick }: { label: string; lit?: boolean; warn?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`hm-key${lit ? " lit" : ""}${warn ? " pc-eject" : ""}`}
      data-key={label.toLowerCase().replace(/\s+/g, "-")}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <span className="hm-led" />
      {label}
    </button>
  );
}

/**
 * Allocation share editor (recette P1-6): a real percent input. Commits on
 * blur/Enter through setAllocation (largest-remainder rebalances the other
 * lanes to Σ=10000). Shared by the dock's portfolio panel and the canvas
 * orchestrator plate.
 *
 * ── D1: A BLUR IS NOT AN EDIT ─────────────────────────────────────────────
 * This committed on EVERY blur. The rendered string is the rounded percent,
 * so on a 3-lane vault at {3333, 3333, 3334} the field showed `33`, and
 * tabbing through it — typing nothing — parsed `33`, multiplied to 3300,
 * compared 3300 ≠ 3333 and fired a real allocation rewrite. Three fields
 * focused and blurred walked the split three times and every downstream
 * number moved: the hero APY, the capacity, the printed shares. The user
 * changed nothing and watched the vault change.
 *
 * The fix is to compare against what was RENDERED, not against the
 * underlying bps: `pct` is not injective on bps, so `parse(render(x)) === x`
 * is false for almost every real split and can never be the commit test. The
 * ref holds the exact string this input last put on screen; a value equal to
 * it is, by definition, an untouched field.
 *
 * The `key={bps}` remount is kept — it is how an EXTERNAL rebalance reaches
 * a mounted field — and the ref is re-seeded on every such render.
 */
export function AllocShareInput({
  bps,
  pctValue,
  dark,
  onCommit,
}: {
  bps: number;
  /**
   * The integer this row PRINTS, from the one largest-remainder pass (D10).
   * Omitted, the field falls back to its own rounding, which is exactly the
   * per-lane rounding that made 3 lanes print 99%.
   */
  pctValue?: number;
  dark?: boolean;
  onCommit: (bps: number) => void;
}) {
  const shown = String(typeof pctValue === "number" ? pctValue : Math.round(bps / 100));
  const renderedRef = useRef(shown);
  // An external rebalance re-renders with a new `shown`; the ref must follow
  // it, or the next blur would measure against a string that is off screen.
  if (renderedRef.current !== shown) renderedRef.current = shown;

  /* THE BAIL lives in `allocCommitBps` (lib/canvas/orchestrator), because
     the node test environment cannot mount an input and this rule has to be
     provable. `null` means the field was not edited: commit nothing, and do
     not rewrite the field either — rewriting it is what made the non-event
     look like an event. */
  const commit = (el: HTMLInputElement) => {
    const next = allocCommitBps(el.value, renderedRef.current);
    if (next === null) {
      if (el.value.trim() !== renderedRef.current) el.value = renderedRef.current;
      return;
    }
    onCommit(next);
  };
  return (
    <span className={`rk-allocedit${dark ? " dark" : ""}`} onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        key={shown}
        defaultValue={shown}
        aria-label="allocation percent"
        onBlur={(e) => commit(e.target)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <b>%</b>
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   § THE ROUTER, DRAWN (spec F)
   ══════════════════════════════════════════════════════════════════════════

   Six drawings, and the honesty is in the geometry rather than in a sentence
   beside it. There is no disclaimer anywhere below, and none is needed:

     F.1  ONE AXIS, ZERO AS A DRAWN LINE. Both lanes plot on a single
          published-frame APY axis and zero sits at its true position on that
          scale, never at the floor of the frame. `LaneBands`.
     F.2  THE SIGNED NUMBER. A return renders its sign, and a negative renders
          in the same type, the same weight and the same colour as a positive.
          `SignedApy`. No colour anywhere in this section grades anything.
     F.3  THE FLOOR, DRAWN AS A FLOOR. The measured band is 2.94% to 4.34% and
          the compute fee applies at the lane, so a treasury lane publishes
          near 2.75% against a best carry row at 7.696% market frame. The two
          bands do not cross in the base case and do cross on an inversion,
          and the DRAWING makes that true by plotting both rather than
          claiming it in prose. The allocation track carries a tick at the
          derived `minWeight` — the floor the router cannot drain past.
     F.4  MIGRATION COST, NETTED AND LEGIBLE. A move is a notch of
          `oneShotFrac + windowCost` on the destination's line, and the
          payback bracket underneath turns `upgradeThreshold` into a DISTANCE.
          A forced exit draws no bracket, because a forced exit is not gated
          on payback (`evaluate.ts` gates only `better_elsewhere`).
     F.5  THE ALLOCATION TRACK, THREE STATES. Solid is settled, hatched is in
          flight and labelled with its settlement ref, empty is headroom to
          the lane's own max. No countdown: a timer is a promise about a rail
          that does not exist.
     F.6  THE SUSTAIN METER AND THE TURNOVER METER, both in the SOURCE's own
          unit. A pin is not a scan on a lane whose source publishes a NAV.

   ── WHAT DRAWS FROM WHAT, because the two are different questions ─────────

   THE COMPOSED PORTFOLIO (`composedRoute`) answers "where would the router
   send capital, out of the lanes YOU racked". It is derived here, from the
   shipped owners — `selectDestination`, `exitProfileFor`, `upgradeThreshold`,
   `paybackMs`, `riskAdjUnified` — and it is what both router placements draw.

   THE RUN (`useRouterRun`) is `/api/canvas/orchestrate`, which folds a seeded
   scenario through the evaluator and answers with `AttestedDecision[]`. Its
   lanes are ITS OWN two slots, not yours, so it is drawn as what it is: a
   modeled replay, named, with its own regime and its own seed. Reading the
   run's weights onto your plate would put a destination on your rack that
   your rack did not compose, which is INV-3 wearing a UI hat.
   ══════════════════════════════════════════════════════════════════════════ */

/** A day in milliseconds. A unit, not a bound: `paybackMs` answers in ms and
 *  every bracket in section F is drawn in days. */
const DAY_MS = 86_400_000;

/**
 * THE SIGN GLYPH, WELDED TO `pct`'S OWN DIGITS (F.2).
 *
 * `pct` is the single owner of a rate's digits and its minus glyph, and it
 * does not sign a positive because nothing before this asked it to. F.2 does:
 * "Net APY (as composed) always renders an explicit sign, including `+`", and
 * the reason is structural rather than decorative. A number that only ever
 * wears a sign when it is negative teaches the reader that the sign IS the
 * warning; a number that always wears one makes a negative an ordinary
 * position on an axis they can already see.
 *
 * This function computes NOTHING. It reads `pct`'s output and prepends one
 * glyph, so the digits, the rounding and the U+2212 keep exactly one owner
 * and this can never disagree with the number beside it.
 *
 * A ROUNDED ZERO TAKES NO SIGN, which is `pct`'s own ratified law one step
 * on: `+0.0%` claims a gain the model does not state, exactly as `−0.0%`
 * claims a loss it does not state.
 */
function signedPct(v: number | null | undefined, dp = 1): string {
  const s = pct(v, dp);
  if (!s.startsWith(MINUS) && Number((v ?? 0) * 100).toFixed(dp) !== (0).toFixed(dp)) {
    return `+${s}`;
  }
  return s;
}

/**
 * F.2, as an element. Same type, same weight, same colour, whatever the sign.
 *
 * The `title` is the frame, and it is not optional: an unlabelled signed
 * number on a screen that also carries a venue-frame figure is the recorded
 * two-frames defect. Every caller passes the published frame (INV-11).
 */
function SignedApy({
  value,
  size = 13,
  title,
}: {
  value: number | null;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        fontFamily: "var(--fm)",
        fontVariantNumeric: "tabular-nums",
        fontSize: size,
        fontWeight: 600,
        letterSpacing: ".01em",
        color: "inherit",
      }}
    >
      {signedPct(value)}
    </span>
  );
}

/**
 * THE ROUTER'S BADGE, ONE OWNER, BOTH PLACEMENTS.
 *
 * D9's ruling on the plate was that green is SEMANTIC: `ok` is earned only
 * when every lane has a live quote and none of them is drying. The plate
 * derived it. The dock printed `hm-bdg ok` as a literal, so the same router
 * wore an amber DRYING state on the canvas and an unearned green nameplate in
 * the dock at the same instant, over the same two lanes.
 *
 * A badge is a claim about the machine, so two placements stating two of them
 * is the disagreement this work package's contract exists to close, in the
 * same shape as the destination. One derivation, called twice.
 *
 * `quoting` OUTRANKS `noQuote` and neither outranks `drying`, which is
 * `deriveLaneSignals`'s own precedence restated as a render: a lane mid-quote
 * has no gap yet, and a lane whose gate has already failed is still failing
 * while the next quote loads.
 */
export interface RouterBadge {
  state: "quoting" | "gap" | "drying" | "ok";
  text: string;
}

export function routerBadge(signals: readonly LaneSignal[]): RouterBadge {
  const quoting = signals.some((s) => s.quoting === true);
  const noQuote = signals.some((s) => s.noQuote);
  const drying = signals.some((s) => s.drying);
  if (quoting) return { state: "quoting", text: "QUOTING" };
  if (noQuote) return { state: "gap", text: "QUOTE GAP" };
  if (drying) return { state: "drying", text: "DRYING" };
  return { state: "ok", text: ORCHESTRATOR_DEF.policyName };
}

// ── The composed portfolio's own destination ──────────────────────────────

/** One lane, as the destination derivation reads it. Both placements build
 *  this from what they already hold, so neither invents a second lane fact. */
export interface RouteLaneInput {
  loopId: string;
  label: string;
  /** The lane's PUBLISHED return: after `composedTerms` and the compute fee.
   *  The frame the chart draws and the frame the ranking uses are the same
   *  function, which is INV-11 stated as a field. */
  publishedNetApy: number | null;
  /** The leverage the MODEL landed on. Inert in `riskAdjUnified` today,
   *  because no client row carries a basis deviation, and passed anyway
   *  because it is the argument the owner asks for. */
  appliedLeverage: number | null;
  capacityUsd: number | null;
  /** `candidate.eligible` at the latest pin; null when unknown. */
  eligible: boolean | null;
  /** The issuer's own published redemption window, from the lane's seated
   *  `redemption-route`. 0 on an atomic rail, and 0 is a measurement there. */
  settlementDays: number;
  /** The block this lane's quote was read at, 0 when it has no chain pin. */
  blockNumber: number;
  venue: string;
}

/** Where the router would send capital right now, and what the move would
 *  have to beat. Not a prediction that a rule WILL fire: a rule fires on a
 *  sustained streak this surface does not hold. */
export interface ComposedRoute {
  sourceSlotId: string | null;
  sourceLabel: string | null;
  /** A peer slotId, or `PAUSE_DESTINATION`. */
  destSlotId: string;
  destLabel: string | null;
  /** dest riskAdj − source riskAdj, published frame. */
  improvement: number | null;
  /** `upgradeThreshold(exitProfileFor(source, dest))`: the bar the pair has to
   *  clear before an upgrade is allowed to spend the rail. */
  bar: number | null;
  oneShotFrac: number | null;
  windowCost: number | null;
  /** Null when the move buys nothing, which is `paybackMs`'s `Infinity`. */
  paybackDays: number | null;
  clears: boolean;
  alternative: AttestedDecision["alternative"] | null;
  /** Candidate slots outside the composed universe. Non-zero refuses the
   *  whole ranking, and the count is drawn rather than swallowed. */
  refused: number;
}

const NO_ROUTE: ComposedRoute = {
  sourceSlotId: null,
  sourceLabel: null,
  destSlotId: PAUSE_DESTINATION,
  destLabel: null,
  improvement: null,
  bar: null,
  oneShotFrac: null,
  windowCost: null,
  paybackDays: null,
  clears: false,
  alternative: null,
  refused: 0,
};

/**
 * THE DESTINATION, DERIVED FROM THE COMPOSED LANES AND NOTHING ELSE.
 *
 * Every quantity comes from a shipped owner. This function ranks, prices and
 * compares; it holds no rule state, counts no streak and decides no firing,
 * so it is not a second evaluator and cannot drift into one.
 *
 * ── THREE ARGUMENTS THAT ARE STATED RATHER THAN MEASURED, each named ──────
 *
 * `moveUsd: 0`. A composed portfolio holds no deposits, so there is no book
 * to size a move from. Zero makes the headroom filter ask the only question a
 * rack can answer — WHICH PEERS COULD RECEIVE AT ALL — and any other number
 * would be a book size this surface invented, deciding the destination
 * silently.
 *
 * `statusLive: true` and `emergency: false`. R5 emergency state comes from
 * live watchers and the registry by ruling, and a rack governs no deployed
 * vault, so there is nothing to read. That is an ABSENCE, stated.
 *
 * `evacuationBreaching: false`. No rule has ever been evaluated against a
 * portfolio that has not run, so no evacuation rule of its own is breaching.
 *
 * `SlotLiveState.observed` is required by the type and read by NOTHING in
 * `selectDestination`. It carries the lane's own chain pin through
 * `blockStamp`, the single owner of that string, rather than a placeholder
 * label; the hash is empty because this object never leaves the component and
 * a fabricated sha-256 is the defect the register exists to refuse.
 */
export function composedRoute(slots: readonly LoopSlot[], lanes: readonly RouteLaneInput[]): ComposedRoute {
  const byId = new Map(lanes.map((l) => [l.loopId, l]));
  const priced = slots.filter((s) => {
    const l = byId.get(s.slotId);
    return !!l && typeof l.publishedNetApy === "number";
  });
  if (priced.length < 2) return NO_ROUTE;

  const riskAdj = (l: RouteLaneInput) =>
    riskAdjUnified(l.publishedNetApy as number, l.appliedLeverage ?? 1, null);
  const endpoint = (l: RouteLaneInput) => ({
    venue: l.venue,
    publishedNetApy: l.publishedNetApy as number,
    settlementDays: l.settlementDays,
    /* 0 IS THE TYPE'S OWN VALUE FOR "no cadence measured". Nothing on a rack
       measures how often a lane's source publishes, so `settleSeqs` reports
       nothing rather than reporting a cadence this surface made up. The wait
       itself still prices, through `settlementDays`, into `windowCost`. */
    observationsPerDay: 0,
  });

  const live: SlotLiveState[] = slots.map((s) => {
    const l = byId.get(s.slotId);
    return {
      slotId: s.slotId,
      candidateId: s.candidateId,
      eligible: l?.eligible === true,
      statusLive: true,
      emergency: false,
      evacuationBreaching: false,
      riskAdjUnified: l && typeof l.publishedNetApy === "number" ? riskAdj(l) : null,
      capacityUsd: l?.capacityUsd ?? null,
      allocatedUsd: 0,
      observed: {
        kind: (l?.blockNumber ?? 0) > 0 ? ("block" as const) : ("print" as const),
        seq: l?.blockNumber ?? 0,
        hash: "",
        label: blockStamp(l?.blockNumber ?? 0) ?? "no pinned document",
      },
    };
  });
  const allowed = slots.map((s) => s.slotId);

  let best: ComposedRoute | null = null;
  let bestMargin = -Infinity;
  let refusedTotal = 0;
  for (const s of priced) {
    const source = byId.get(s.slotId) as RouteLaneInput;
    const ranking = selectDestination(live, s.slotId, 0, "best_eligible", allowed);
    refusedTotal += ranking.refused;
    if (ranking.destination === PAUSE_DESTINATION) continue;
    const dest = byId.get(ranking.destination);
    if (!dest || typeof dest.publishedNetApy !== "number") continue;
    const exit = exitProfileFor(endpoint(source), endpoint(dest));
    const improvement = riskAdj(dest) - riskAdj(source);
    const bar = upgradeThreshold(exit);
    const pb = paybackMs(exit, improvement) / DAY_MS;
    const margin = improvement - bar;
    if (margin <= bestMargin) continue;
    bestMargin = margin;
    best = {
      sourceSlotId: s.slotId,
      sourceLabel: source.label,
      destSlotId: ranking.destination,
      destLabel: dest.label,
      improvement,
      bar,
      oneShotFrac: exit.oneShotFrac,
      windowCost: exit.windowCost,
      paybackDays: Number.isFinite(pb) ? pb : null,
      clears: margin >= 0,
      alternative: ranking.alternative,
      refused: ranking.refused,
    };
  }
  if (!best) return { ...NO_ROUTE, refused: refusedTotal };
  return { ...best, refused: refusedTotal };
}

// ── F.5 / F.3 · the allocation track ──────────────────────────────────────

/**
 * The hatch, and the one rule that keeps it honest under reduced motion.
 *
 * The stripes run in the DIRECTION OF TRAVEL, which is the only thing on this
 * surface that moves, and it moves because weight in flight is the one state
 * that is genuinely mid-something. Everything else on the plate is static.
 *
 * Declared as a plain `<style>` rather than in `build.css`, which this work
 * package does not own. Duplicate identical rules are inert, so mounting the
 * track more than once costs nothing.
 */
const TRACK_STYLE = `
@keyframes rk-inflight { from { background-position: 0 0 } to { background-position: 12px 0 } }
.rk-track-flight { animation: rk-inflight 900ms linear infinite }
@media (prefers-reduced-motion: reduce) { .rk-track-flight { animation: none } }
`;

/** The hardware palette. `.bc-root .rk-orchbar` is declared OUTSIDE both theme
 *  blocks in `build.css`, so an allocation bar is navy in light and in dark: a
 *  plate is the same object in both modes and only the room changes. The track
 *  below therefore carries one palette and the two placements are identical by
 *  construction rather than by two sets of tokens agreeing. */
const HW = {
  well: "#0A0E2A",
  bezel: "#1B2350",
  rail: "#2A3566",
  lit: "#4D8BFF",
  litSoft: "rgba(77,139,255,.45)",
  bright: "#B8D9FF",
  label: "#a5a5a0",
  ink: "#e9e9e6",
} as const;

export function AllocationTrack({
  targetPct,
  floorPct = null,
  maxPct = null,
  inFlightPct = 0,
  settlesAt = null,
  height = 8,
}: {
  /** The settled share of the book, 0 to 100. */
  targetPct: number;
  /**
   * The DERIVED floor, `max(0, 1 − (N−1)·maxWeight)` as a percent. The router
   * may not drain a lane past it, and drawing it is what stops the bar from
   * advertising that a floor lane can be emptied.
   *
   * NULL WHERE NO OWNER PUBLISHES ONE, and the tick is then absent rather
   * than drawn at zero. `/api/canvas/orchestrate` does not publish its slots'
   * bands, and re-deriving B.5's formula in a component to fill the gap would
   * be a fifth spelling of it.
   */
  floorPct?: number | null;
  /** The lane's own ceiling, from the clamped concentration dial. Null where
   *  no owner publishes one, and the headroom lift is then absent. */
  maxPct?: number | null;
  /** Committed to this lane and not yet arrived. Earns nothing until it
   *  lands, which is why it is drawn separately rather than added in. */
  inFlightPct?: number;
  /** The observation that closes the leg, rendered VERBATIM. Never a
   *  countdown: a timer is a promise about a rail that does not exist. */
  settlesAt?: string | null;
  height?: number;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const settled = clamp(targetPct);
  const flight = clamp(inFlightPct);
  const head = maxPct === null ? null : clamp(maxPct);
  const floor = floorPct === null ? null : clamp(floorPct);
  return (
    <span style={{ flex: 1, minWidth: 0, margin: "0 8px", display: "block" }}>
      {/* The keyframes mount with the hatch and not before: an animation
          declared where nothing is animated is a compositor layer for a
          state the lane is not in. */}
      {flight > 0 ? <style>{TRACK_STYLE}</style> : null}
      <span
        style={{
          position: "relative",
          display: "block",
          height,
          borderRadius: 4,
          background: HW.well,
          border: `1px solid ${HW.bezel}`,
          overflow: "hidden",
        }}
      >
        {/* HEADROOM: everything up to this lane's own max, at a lift the eye
            reads as room rather than as fill. */}
        {head === null ? null : (
          <i
            style={{
              position: "absolute",
              inset: 0,
              width: `${head}%`,
              background: HW.bezel,
              borderRadius: 4,
            }}
          />
        )}
        {/* SETTLED. */}
        <i
          style={{
            position: "absolute",
            inset: 0,
            width: `${settled}%`,
            background: HW.lit,
            boxShadow: `0 0 8px ${HW.litSoft}`,
            borderRadius: 4,
            transition: "width .35s cubic-bezier(.4,0,.2,1)",
          }}
        />
        {/* IN FLIGHT, hatched, running in the direction of travel. */}
        {flight > 0 ? (
          <i
            className="rk-track-flight"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${settled}%`,
              width: `${flight}%`,
              backgroundImage: `repeating-linear-gradient(115deg, ${HW.lit} 0 3px, rgba(77,139,255,.16) 3px 6px)`,
              backgroundSize: "12px 100%",
            }}
          />
        ) : null}
        {/* THE FLOOR TICK. */}
        {floor === null ? null : (
          <i
            style={{
              position: "absolute",
              top: -1,
              bottom: -1,
              left: `${floor}%`,
              width: 1,
              background: HW.bright,
            }}
          />
        )}
      </span>
      {settlesAt ? (
        <span
          style={{
            display: "block",
            marginTop: 3,
            fontFamily: "var(--fm)",
            fontSize: 8,
            letterSpacing: ".06em",
            /* THE REF IS RENDERED VERBATIM, and `.rk-orchrow` sets
               `text-transform:uppercase` on everything inside it. A label the
               type contracts as verbatim must not be re-cased by a stylesheet
               that has no idea what it is looking at. */
            textTransform: "none",
            color: HW.bright,
          }}
        >
          {`settles at ${settlesAt}`}
        </span>
      ) : null}
    </span>
  );
}

/** The floor tick's own caption, so a mark on a bar is never unexplained.
 *  One string, both placements. */
export function floorCaption(floorPct: number): string {
  return `floor ${pct(floorPct / 100, 0)} of the book, the router does not drain past it`;
}

// ── The destination, drawn. Both router placements render THIS. ────────────

/**
 * Where the router would send capital, and what the move has to beat.
 *
 * `variant` is the only thing that differs between the two placements: the
 * plate has a 150px screen and the dock has 319px, so the plate draws the
 * pair and the bar while the dock draws the pair, the bar, the cost and the
 * runner-up. Both read ONE `ComposedRoute`, so they cannot describe two
 * machines.
 */
export function DestinationLine({
  route,
  variant,
}: {
  route: ComposedRoute;
  variant: "plate" | "panel";
}) {
  const plate = variant === "plate";
  const mono: React.CSSProperties = {
    fontFamily: "var(--fm)",
    fontSize: plate ? 8 : 9,
    letterSpacing: ".06em",
    color: plate ? HW.label : "var(--bc-muted)",
    lineHeight: 1.5,
    overflowWrap: "anywhere",
  };
  if (route.refused > 0) {
    return (
      <div style={mono}>
        {`${route.refused} candidate slots outside this portfolio, the whole ranking is refused`}
      </div>
    );
  }
  if (!route.sourceSlotId || route.destSlotId === PAUSE_DESTINATION) {
    return <div style={mono}>no peer can receive, capital stays where it is</div>;
  }
  const strong: React.CSSProperties = {
    color: plate ? HW.ink : "var(--bc-ink)",
    fontWeight: 600,
  };
  return (
    <div style={mono}>
      <div>
        <span style={strong}>{route.sourceLabel}</span>
        {" → "}
        <span style={strong}>{route.destLabel}</span>
      </div>
      {/* THE UNIT LAW, BOTH HALVES. An improvement and the bar it has to
          clear are rate DIFFERENCES, so they wear `pp` and never `%`; the cost
          is a fraction of the capital moved, which is what `pct` is for. And
          the improvement is SIGNED while the bar is a MAGNITUDE: the word
          `bar` already states which side of it a move has to be on, so it
          takes `ppMag`, the after-a-verb form. Three formatters, three owners,
          none of them spelled here. */}
      <div>
        {route.clears
          ? `${pp(route.improvement)} on the move, over the ${ppMag(route.bar)} bar`
          : `${pp(route.improvement)} on the move, under the ${ppMag(route.bar)} bar, capital holds`}
      </div>
      {plate ? null : (
        <div>
          {`the move costs ${pct((route.oneShotFrac ?? 0) + (route.windowCost ?? 0), 2)} of the capital moved`}
          {route.paybackDays === null
            ? ", so it never pays back"
            : `, back in ${Math.round(route.paybackDays)} days`}
        </div>
      )}
      {/* THE RUNNER-UP RENDERS ONLY WHEN ONE WAS MEASURED. At two lanes there
          is exactly one peer and the ranking's honest answer is
          `{reason:"no legal peer"}`; printing that under a destination the
          reader can already see would state an absence as a finding. */}
      {plate || !route.alternative || !("slotId" in route.alternative) ? null : (
        <div>
          {`runner up ${route.alternative.slotId}, lost by ${ppMag(route.alternative.lostBy)}`}
        </div>
      )}
    </div>
  );
}

// ── F.6 · the turnover meter ──────────────────────────────────────────────

/**
 * A week strip: spent, in flight, remaining, all as fractions of the
 * orchestrated book.
 *
 * It is drawable at all only because the evaluator now HOLDS a turnover
 * accumulator. Before it, `turnoverBudgetPctWeek` was a dial that could refuse
 * nothing and 11 of its 19 stops collapsed to one move weight. On a composed
 * portfolio that has never run, `realized` and `inFlight` are zero and the
 * whole ceiling is remaining, which is true and is what makes the dial's
 * effect visible on the rack.
 */
export function TurnoverStrip({
  realized,
  inFlight,
  ceiling,
  variant,
}: {
  realized: number;
  inFlight: number;
  ceiling: number;
  variant: "plate" | "panel";
}) {
  const plate = variant === "plate";
  const w = (v: number) => `${ceiling > 0 ? Math.max(0, Math.min(100, (v / ceiling) * 100)) : 0}%`;
  return (
    <div style={{ display: "block" }}>
      {inFlight > 0 ? <style>{TRACK_STYLE}</style> : null}
      {/* THE SAME METER GEOMETRY THE ALLOCATION BARS USE. At 5px and 3px
          radius an unspent week drew as a hairline the full width of the
          panel, which reads as a divider rather than as an empty meter, and
          an empty meter that reads as a rule is a quantity the reader never
          sees. `.rk-orchbar` is 7px at radius 4 on the same navy well, and it
          sits directly above this strip on both placements: matching it means
          an unspent week looks exactly like an unfilled allocation bar, which
          is a shape every reader of this screen has already learned. */}
      <span
        style={{
          position: "relative",
          display: "block",
          height: 7,
          borderRadius: 4,
          background: HW.well,
          border: `1px solid ${HW.bezel}`,
          overflow: "hidden",
        }}
      >
        <i
          style={{
            position: "absolute",
            inset: 0,
            width: w(realized),
            background: HW.lit,
            boxShadow: `0 0 8px ${HW.litSoft}`,
            borderRadius: 4,
          }}
        />
        {inFlight > 0 ? (
          <i
            className="rk-track-flight"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: w(realized),
              width: w(inFlight),
              backgroundImage: `repeating-linear-gradient(115deg, ${HW.lit} 0 3px, rgba(77,139,255,.16) 3px 6px)`,
              backgroundSize: "12px 100%",
            }}
          />
        ) : null}
      </span>
      {/* THE PLATE'S SCREEN IS 150px WIDE and the panel's is 319, so the plate
          states the SUM and the panel states the three terms. One is a
          summary of the other, never a second reading: both come from the one
          `OrchBudgetState` and neither rounds the other's numbers. */}
      <div
        style={{
          marginTop: 3,
          fontFamily: "var(--fm)",
          fontSize: plate ? 8 : 9,
          letterSpacing: ".06em",
          lineHeight: 1.45,
          overflowWrap: "anywhere",
          /* THE PLATE PLACEMENT DRAWS ON THE PLATE'S CREAM FACE, not on its
             black screen, so its caption takes the face's own label ink
             (`.hm-sb`'s #6c6c68) rather than the screen's #a5a5a0. The face is
             cream in both themes by ruling, which is why this is a literal
             and not a token: a themed token would read at 1.9:1 in dark. */
          color: plate ? "#6c6c68" : "var(--bc-muted)",
        }}
      >
        {plate
          ? `${pct(realized + inFlight, 1)} of ${pct(ceiling, 0)} used this week`
          : `${pct(realized, 1)} spent · ${pct(inFlight, 1)} in flight · ${pct(Math.max(0, ceiling - realized - inFlight), 1)} of ${pct(ceiling, 0)} left this week`}
      </div>
    </div>
  );
}

// ── F.6 · the sustain meter, in the SOURCE's own unit ─────────────────────

/**
 * WHAT A PIN IS ON THIS LANE.
 *
 * `orchRuleTable.patience` renders `"6 scans"` for every rule on every lane,
 * and a treasury lane has no scanner: its source publishes a NAV. Two objects
 * on one screen must not disagree about what a pin is, so the unit is derived
 * from the lane's own source and the noun travels with the count.
 *
 * ⚠ THIS IS A RENDER-SIDE DERIVATION AND IT SHOULD NOT STAY ONE. Spec B.6
 * item 5 puts the unit on `orchRuleTable`, whose owner (`rule-schema.ts`) is
 * not this package's file and whose signature carries no `ObservationKind`
 * per slot. WP-1 declined to add a parameter nobody passes and handed the
 * render here. The two facts below are read from EXISTING owners rather than
 * re-spelled: `LoopSlot.metrics.funding` is `fundingClassCandidateId`'s own
 * answer, and `laneFamily` is the graph's own word for the lane.
 */
function sourceUnit(slot: LoopSlot | undefined, loop: LoopGraph | undefined, blockNumber: number): string {
  if (slot?.metrics.funding) return "funding prints";
  if (loop && laneFamily(loop.nodes) === "treasury") return "NAV publications";
  return blockNumber > 0 ? "blocks" : "scan prints";
}

/** `6 funding prints` / `6 NAV publications` / `6 blocks`. Singular is a real
 *  case: `gate_flip` sustains on 2 and a reactive tempo can reach 1. */
function patienceIn(count: number, unit: string): string {
  return `${count} ${count === 1 ? unit.replace(/s$/, "") : unit}`;
}

function SustainMeter({
  filled,
  of,
  unit,
}: {
  filled: number;
  of: number;
  unit: string;
}) {
  const cells = Math.max(1, Math.min(24, of));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {/* THE ONE INSTRUMENT THAT IS THE FOUNDER'S RULE, so a pin landing
          mid-replay crossfades the ONE cell that changed rather than the
          whole meter hard-swapping. The stagger is capped at eight cells:
          past that the delay would outrun the beat it belongs to. The colour
          is set by the background value, so reduced motion simply snaps. */}
      <span className="rk-sustain" style={{ display: "inline-flex", gap: 1 }}>
        {Array.from({ length: cells }, (_, i) => (
          <i
            key={i}
            style={
              {
                width: 3,
                height: 8,
                borderRadius: 1,
                background: i < filled ? HW.lit : HW.rail,
                "--i": i,
              } as CSSProperties
            }
          />
        ))}
      </span>
      <span style={{ fontFamily: "var(--fm)", fontSize: 9, color: "var(--bc-muted)" }}>
        {`${filled} of ${patienceIn(of, unit)}`}
      </span>
    </span>
  );
}

// ── THE RUN · /api/canvas/orchestrate, fetched once, shared by both surfaces ─

/** One lane of the run, as the route publishes it. */
interface RouterRunLane {
  slotId: string;
  candidateId: string;
  venue: string;
  book: string;
  capacityUsd: number;
  settlementDays: number;
  sourceEligible: boolean;
}

/**
 * The run, as this client consumes it.
 *
 * A PROJECTION of the route's answer, not a second declaration of it: every
 * member below is either a type the orchestrator package exports or a scalar
 * the route computes. Two hand-written copies of one wire shape is the same
 * defect class as two derivations of one number.
 *
 * ⚠ `laneSeries` deliberately omits the route's trailing funding percentile.
 * `single-owner.test.ts` refuses any component that so much as SPELLS that
 * field, because three surfaces each holding the raw percentile is how three
 * of them came to pick three different glyphs for it. This surface draws
 * published APYs and nothing else, so it never needs it.
 *
 * ⚠ `cost.paybackDays` arrives as `null` where the evaluator produced
 * `Infinity`, because JSON has no infinity. Null here means "never pays
 * back", which is exactly what `paybackMs` returns for a move that buys
 * nothing, and F.4 draws it by omitting the bracket.
 */
interface RouterRun {
  regime: RegimeId;
  regimeLabel: string;
  scenario: { hash: string; seed: number; ticks: number; calibratedTo: string };
  rulesHash: string;
  orchestratedTvlUsd: number;
  carryOnly: boolean;
  /** The run's own dials, server-re-clamped. Read for the concentration
   *  ceiling only, through `clampConcentrationPct`, which is the same owner
   *  the route and both slot builders call. */
  dials: { maxConcentrationPct: number; turnoverBudgetPctWeek: number };
  lanes: RouterRunLane[];
  laneSeries: {
    carryPublishedApy: number[];
    floorPublishedApy: number[];
    carryCapacityUsd: number[];
  };
  decisions: AttestedDecision[];
  receipts: AttestedReceipt[];
  legs: SettlementLeg[];
  refusals: {
    tickIndex: number;
    ruleId: string;
    slotId: string;
    destSlotId: string | null;
    code: string;
    reason: string;
  }[];
  weights: Record<string, number>;
  weightSumByTick: number[];
  earningWeightByTick: Record<string, number[]>;
  budgetByTick: OrchBudgetState[];
  moves: number;
  firings: number;
}

/** THE ONE STRING A READER MAY SEE WHEN THE RUN DOES NOT ARRIVE. Owned here
 *  because this is the surface that renders it; the route's own authored
 *  `error` is the only other sentence allowed through, and a parser's message
 *  is never one of the two. */
const RUN_ERROR_FALLBACK = "the router run did not answer";

type RunPhase = "idle" | "loading" | "ready" | "error";

interface RunState {
  regime: RegimeId;
  run: RouterRun | null;
  phase: RunPhase;
  error: string | null;
}

/**
 * ONE REGIME, ONE FETCH, TWO PLACEMENTS.
 *
 * The switcher lives in the dock and the plate reads the same run, so the
 * regime has to be one piece of state and it cannot be a React context: the
 * plate mounts inside the pan/zoom viewport and the panel inside the dock, and
 * the nearest common ancestor is `RackCanvas`, which would then have to thread
 * a prop through `ContextDock` — a file this work package does not own.
 *
 * A module-scope store with `useSyncExternalStore` is the smaller answer, and
 * it also gives the fetch a natural cache: a regime already fetched re-renders
 * from memory, so scrubbing back and forth costs nothing and the run a
 * screenshot reproduces is byte-identical to the one on screen.
 */
const runCache = new Map<RegimeId, RouterRun>();
const runListeners = new Set<() => void>();
let runState: RunState = { regime: DEFAULT_REGIME, run: null, phase: "idle", error: null };
let runInFlight: RegimeId | null = null;

function emitRun(next: RunState) {
  runState = next;
  for (const l of runListeners) l();
}

function subscribeRun(fn: () => void) {
  runListeners.add(fn);
  return () => {
    runListeners.delete(fn);
  };
}

function snapshotRun(): RunState {
  return runState;
}

async function loadRun(regime: RegimeId) {
  const cached = runCache.get(regime);
  if (cached) {
    emitRun({ regime, run: cached, phase: "ready", error: null });
    return;
  }
  if (runInFlight === regime) return;
  runInFlight = regime;
  emitRun({ regime, run: null, phase: "loading", error: null });
  try {
    /* NO `ticks`: the run length a demo wants is one payback horizon, and the
       route already owns that number. Passing it here would be a second
       spelling of `PAYBACK_HORIZON_DAYS`. */
    const res = await fetch(`/api/canvas/orchestrate?regime=${encodeURIComponent(regime)}`);
    /* THE STATUS IS READ BEFORE THE BODY, and the parse happens inside its own
       try. Reading `res.json()` first meant that on the route's absence, where
       Next answers a 404 carrying an HTML document, the parser threw and the
       panel rendered a JavaScript SyntaxError to the user in the same mono, at
       the same size and at the same offset as the loading line: a reader could
       not tell working from broken. Every non-ok and every non-JSON answer now
       collapses to ONE owned string, and the only alternative a reader can see
       is the route's own authored `error`, which is a sentence this product
       wrote. */
    let body: ({ ok?: boolean; error?: string } & RouterRun) | null = null;
    try {
      body = (await res.json()) as { ok?: boolean; error?: string } & RouterRun;
    } catch {
      body = null;
    }
    const routeError = typeof body?.error === "string" ? body.error : "";
    if (!res.ok || body?.ok !== true) {
      throw new Error(routeError.length > 0 ? routeError : RUN_ERROR_FALLBACK);
    }
    const j = body;
    runCache.set(regime, j);
    if (runState.regime === regime) emitRun({ regime, run: j, phase: "ready", error: null });
  } catch (e) {
    if (runState.regime === regime) {
      emitRun({ regime, run: null, phase: "error", error: e instanceof Error ? e.message : RUN_ERROR_FALLBACK });
    }
  } finally {
    if (runInFlight === regime) runInFlight = null;
  }
}

/** The switcher's only writer. */
function setRouterRegime(regime: RegimeId) {
  if (!isRegimeId(regime)) return;
  const cached = runCache.get(regime);
  emitRun(
    cached
      ? { regime, run: cached, phase: "ready", error: null }
      : { regime, run: null, phase: "loading", error: null },
  );
  void loadRun(regime);
}

/** Both router placements read this. The fetch starts on the first mount. */
function useRouterRun(): RunState {
  const s = useSyncExternalStore(subscribeRun, snapshotRun, snapshotRun);
  useEffect(() => {
    if (runState.phase === "idle") void loadRun(runState.regime);
  }, []);
  return s;
}

// ── F.1 to F.4 · the band chart ───────────────────────────────────────────

interface BandGeom {
  ticks: number;
  yOf: (v: number) => number;
  xOf: (t: number) => number;
  zeroY: number;
  lo: number;
  hi: number;
}

const CHART_W = 320;
const CHART_H = 152;
const PAD = { l: 36, r: 8, t: 10, b: 22 };

function bandGeom(series: number[][], ticks: number): BandGeom {
  const flat = series.flat().filter((v) => Number.isFinite(v));
  /* ZERO IS ALWAYS INSIDE THE DOMAIN, which is the whole of F.1: a chart whose
     floor is the minimum of the data draws a negative return as "the bottom"
     and a positive one as "the bottom" too, so the reader learns nothing from
     where the line sits. Including 0 makes the axis a scale rather than a
     ranking. */
  const rawLo = Math.min(0, ...flat);
  const rawHi = Math.max(0, ...flat);
  const span = Math.max(rawHi - rawLo, 0.01);
  const lo = rawLo - span * 0.08;
  const hi = rawHi + span * 0.08;
  const yOf = (v: number) =>
    PAD.t + (CHART_H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo));
  const xOf = (t: number) =>
    PAD.l + (CHART_W - PAD.l - PAD.r) * (ticks <= 1 ? 0 : t / (ticks - 1));
  return { ticks, yOf, xOf, zeroY: yOf(0), lo, hi };
}

function linePath(g: BandGeom, vals: number[]): string {
  return vals
    .map((v, i) => `${i === 0 ? "M" : "L"}${g.xOf(i).toFixed(2)} ${g.yOf(v).toFixed(2)}`)
    .join(" ");
}

/** The area between a lane's line and ZERO, not between the line and the
 *  frame. Below zero it is the same path shape on the other side of the rule,
 *  which is why one path serves both and the fill only changes value. */
function areaPath(g: BandGeom, vals: number[]): string {
  if (vals.length === 0) return "";
  return `${linePath(g, vals)} L${g.xOf(vals.length - 1).toFixed(2)} ${g.zeroY.toFixed(2)} L${g.xOf(0).toFixed(2)} ${g.zeroY.toFixed(2)} Z`;
}

/** The run's lane series, keyed by the slot the run actually composed. */
function runSeries(run: RouterRun): { slotId: string; label: string; apy: number[] }[] {
  const out: { slotId: string; label: string; apy: number[] }[] = [];
  const [carry, floor] = run.lanes;
  if (carry) out.push({ slotId: carry.slotId, label: carry.book, apy: run.laneSeries.carryPublishedApy });
  if (floor) out.push({ slotId: floor.slotId, label: floor.book, apy: run.laneSeries.floorPublishedApy });
  return out;
}

/** The vault's return: each lane's published APY weighted by the weight that
 *  is actually EARNING. Weight on an open settlement leg is zero here and full
 *  in `weights`, so the blended line steps up when the leg SETTLES and not
 *  when the move is decided. That is F.5's claim, drawn instead of stated. */
function blendedSeries(run: RouterRun): number[] {
  const series = runSeries(run);
  const T = series[0]?.apy.length ?? 0;
  const out: number[] = [];
  for (let t = 0; t < T; t++) {
    let v = 0;
    for (const s of series) v += (run.earningWeightByTick[s.slotId]?.[t] ?? 0) * (s.apy[t] ?? 0);
    out.push(v);
  }
  return out;
}

function LaneBands({
  run,
  tick,
  onScrub,
  hoverId,
  onHover,
}: {
  run: RouterRun;
  tick: number;
  onScrub: (t: number) => void;
  /** The decision under the hand, from EITHER end of the binding: a notch on
   *  the chart or a marker in the list below it. Ink only, never geometry. */
  hoverId: string | null;
  onHover: (id: string | null) => void;
}) {
  const series = runSeries(run);
  const blended = useMemo(() => blendedSeries(run), [run]);
  const T = series[0]?.apy.length ?? 0;
  const g = useMemo(
    () => bandGeom([...series.map((s) => s.apy), blended], T),
    [run, blended],
  );
  if (T === 0) return null;
  const at = Math.max(0, Math.min(T - 1, tick));
  const carry = series[0];
  const floor = series[1];

  /* F.4 — every decision draws its notch on the DESTINATION's line. A firing
     that moved nothing (`pause`) has no destination and no notch. */
  const notches = run.decisions
    .map((d) => {
      const dest = series.find((s) => s.slotId === d.moved.destSlotId);
      if (!dest) return null;
      const t = d.scenarioRef.tick;
      const cost = d.cost.oneShotFrac + d.cost.windowCost;
      return { d, dest, t, cost };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);

  return (
    <div>
      {/* THE FRAME, NAMED ON THE AXIS RATHER THAN IN A TOOLTIP (INV-11).
          Both lane lines and the vault line go through `composedTerms` to
          `publishedNetApy`, and so does the number `selectDestination` ranks
          on. That agreement is the whole of the recorded two-frames defect,
          and it was legible here only by hovering a readout. An axis label is
          not a caveat: it is the unit, and a chart that does not state its
          unit is asking the reader to assume one. */}
      <div
        style={{
          fontFamily: "var(--fm)",
          fontSize: 9,
          letterSpacing: ".06em",
          color: "var(--bc-faint)",
          marginBottom: 2,
        }}
      >
        published net APY, as composed
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        height={CHART_H}
        role="img"
        aria-label="published net APY per lane and for the vault, on one axis"
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <clipPath id="rk-band-up">
            <rect x={0} y={0} width={CHART_W} height={Math.max(0, g.zeroY)} />
          </clipPath>
          <clipPath id="rk-band-dn">
            <rect x={0} y={g.zeroY} width={CHART_W} height={Math.max(0, CHART_H - g.zeroY)} />
          </clipPath>
          {/* THE FILL FADES TOWARD ZERO, and that is a legibility decision
              rather than a decorative one. Two lanes both above zero fill two
              overlapping regions all the way down to the rule, and at any flat
              opacity the pair composites into one slab: the reader sees a
              block where the drawing is supposed to show two bands and the
              distance between them. Fading to nothing at the rule keeps the
              area (F.1 asks for it) and gives the LINE back to the eye.
              Anchored in user space at the zero rule, so the gradient's own
              zero is the axis's zero. */}
          {(
            [
              ["carry", "var(--bc-accent-text)"],
              ["floor", "var(--bc-muted)"],
            ] as const
          ).map(([key, colour]) => (
            <g key={key}>
              <linearGradient
                id={`rk-fill-${key}-up`}
                x1="0"
                y1={PAD.t}
                x2="0"
                y2={g.zeroY}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor={colour} stopOpacity={0.26} />
                <stop offset="1" stopColor={colour} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient
                id={`rk-fill-${key}-dn`}
                x1="0"
                y1={g.zeroY}
                x2="0"
                y2={CHART_H - PAD.b}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor={colour} stopOpacity={0.04} />
                <stop offset="1" stopColor={colour} stopOpacity={0.34} />
              </linearGradient>
            </g>
          ))}
        </defs>

        {/* THE ZERO RULE, at its true position on the scale. */}
        <line
          x1={PAD.l}
          x2={CHART_W - PAD.r}
          y1={g.zeroY}
          y2={g.zeroY}
          stroke="var(--bc-line-strong)"
          strokeWidth={1}
        />
        <text x={PAD.l - 5} y={g.zeroY + 3} textAnchor="end" fontSize={8} fill="var(--bc-faint)" fontFamily="var(--fm)">
          {pct(0, 0)}
        </text>
        <text x={PAD.l - 5} y={PAD.t + 4} textAnchor="end" fontSize={8} fill="var(--bc-faint)" fontFamily="var(--fm)">
          {pct(g.hi, 0)}
        </text>
        {/* The bottom of the scale renders only when it is far enough from
            zero to be a second reading rather than a second copy of it. */}
        {CHART_H - PAD.b - g.zeroY > 12 ? (
          <text x={PAD.l - 5} y={CHART_H - PAD.b} textAnchor="end" fontSize={8} fill="var(--bc-faint)" fontFamily="var(--fm)">
            {pct(g.lo, 0)}
          </text>
        ) : null}

        {/* EVERY AREA FIRST, THEN EVERY LINE. Drawn lane by lane, the second
            lane's fill paints over the first lane's LINE, and two lanes on one
            axis stop being two lanes. One hue per lane and two VALUES of that
            hue per lane: the area above zero, and the area below it at a
            heavier value. A colour never grades anything here. */}
        {carry ? (
          <>
            <path className="rk-band-area" d={areaPath(g, carry.apy)} fill="url(#rk-fill-carry-up)" clipPath="url(#rk-band-up)" />
            <path className="rk-band-area" d={areaPath(g, carry.apy)} fill="url(#rk-fill-carry-dn)" clipPath="url(#rk-band-dn)" />
          </>
        ) : null}
        {floor ? (
          <>
            <path className="rk-band-area" d={areaPath(g, floor.apy)} fill="url(#rk-fill-floor-up)" clipPath="url(#rk-band-up)" />
            <path className="rk-band-area" d={areaPath(g, floor.apy)} fill="url(#rk-fill-floor-dn)" clipPath="url(#rk-band-dn)" />
          </>
        ) : null}
        {/* THE DRAW-IN, IN THE ORDER THE ARGUMENT IS MADE: the floor arrives
            first, because it is the thing the loop has to beat, then the loop,
            then the vault the two compose into. `pathLength="1"` normalises
            the three, whose real lengths differ by more than 2x, so one
            dasharray serves all of them. */}
        {floor ? (
          <path
            className="rk-band-line"
            pathLength="1"
            style={{ animationDelay: "0s" }}
            d={linePath(g, floor.apy)}
            fill="none"
            stroke="var(--bc-muted)"
            strokeWidth={1.5}
          />
        ) : null}
        {carry ? (
          <path
            className="rk-band-line"
            pathLength="1"
            style={{ animationDelay: ".07s" }}
            d={linePath(g, carry.apy)}
            fill="none"
            stroke="var(--bc-accent-text)"
            strokeWidth={1.5}
          />
        ) : null}

        {/* THE VAULT. Heavier, and it rides above the floor line at all times
            in the base case, which is what makes the floor a floor. */}
        <path
          className="rk-band-line"
          pathLength="1"
          style={{ animationDelay: ".14s" }}
          d={linePath(g, blended)}
          fill="none"
          stroke="var(--bc-ink)"
          strokeWidth={2.4}
          strokeLinejoin="round"
        />

        {/* F.4 — the notch and the payback bracket. */}
        {notches.map(({ d, dest, t, cost }) => {
          const x = g.xOf(t);
          const top = g.yOf(dest.apy[t] ?? 0);
          const bottom = g.yOf((dest.apy[t] ?? 0) - cost);
          const upgrade = d.rule.metric === "better_elsewhere";
          const pb = d.cost.paybackDays;
          const bracketEnd = upgrade && pb !== null ? g.xOf(Math.min(T - 1, t + pb)) : null;
          const by = CHART_H - PAD.b + 6;
          const lit = hoverId === d.decisionId;
          const w = lit ? 2.2 : 1.4;
          return (
            <g
              key={d.decisionId}
              className="rk-band-mark rk-notch"
              data-decision={d.decisionId}
              onMouseEnter={() => onHover(d.decisionId)}
              onMouseLeave={() => onHover(null)}
            >
              {/* THE HIT AREA, transparent and 10px wide, spanning the plot.
                  A 1.4px line is not a target a hand can find, and widening
                  the ink to make it one would light the notch at rest. */}
              <rect
                x={x - 5}
                y={PAD.t}
                width={10}
                height={Math.max(0, CHART_H - PAD.b - PAD.t)}
                fill="transparent"
              />
              <line x1={x} x2={x} y1={top} y2={bottom} stroke="var(--bc-ink)" strokeWidth={w} />
              <line x1={x - 3} x2={x + 3} y1={bottom} y2={bottom} stroke="var(--bc-ink)" strokeWidth={w} />
              {bracketEnd !== null ? (
                <>
                  <line x1={x} x2={bracketEnd} y1={by} y2={by} stroke="var(--bc-ink)" strokeWidth={1} />
                  <line x1={x} x2={x} y1={by - 3} y2={by + 3} stroke="var(--bc-ink)" strokeWidth={1} />
                  <line x1={bracketEnd} x2={bracketEnd} y1={by - 3} y2={by + 3} stroke="var(--bc-ink)" strokeWidth={1} />
                  {/* F.4 asks the bracket to RENDER the payback, and a bracket
                      with no number is a distance the reader has to guess at.
                      It is the decision's own `cost.paybackDays`, the same
                      field the receipt states, rounded to whole days because
                      the tick IS a day and a fraction of one claims a
                      resolution the run does not have. */}
                  <text
                    x={(x + bracketEnd) / 2}
                    y={by - 4}
                    textAnchor="middle"
                    fontSize={8}
                    fill={lit ? "var(--bc-ink)" : "var(--bc-muted)"}
                    fontFamily="var(--fm)"
                  >
                    {`${Math.round(pb as number)} days to pay back`}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}

        {/* F.4 — a REFUSED move draws its bracket in outline, open at the
            right, because what it states is that the payback runs past the
            frame. The reason is the only text on it. */}
        {run.refusals
          .filter((r) => r.code === "payback")
          .map((r) => {
            const x = g.xOf(r.tickIndex);
            const by = CHART_H - PAD.b + 6;
            return (
              <g className="rk-band-mark" key={`${r.ruleId}:${r.tickIndex}`}>
                <line x1={x} x2={CHART_W - PAD.r} y1={by} y2={by} stroke="var(--bc-ink)" strokeWidth={1} strokeDasharray="2 2" />
                <line x1={x} x2={x} y1={by - 3} y2={by + 3} stroke="var(--bc-ink)" strokeWidth={1} />
              </g>
            );
          })}

        {/* THE PLAYHEAD. */}
        <line
          x1={g.xOf(at)}
          x2={g.xOf(at)}
          y1={PAD.t}
          y2={CHART_H - PAD.b}
          stroke="var(--bc-ink)"
          strokeWidth={1}
          strokeDasharray="1 3"
        />
        <text x={PAD.l} y={CHART_H - 4} fontSize={8} fill="var(--bc-faint)" fontFamily="var(--fm)">
          tick 0
        </text>
        <text x={CHART_W - PAD.r} y={CHART_H - 4} textAnchor="end" fontSize={8} fill="var(--bc-faint)" fontFamily="var(--fm)">
          {`tick ${T - 1}`}
        </text>
      </svg>

      <input
        type="range"
        min={0}
        max={Math.max(0, T - 1)}
        step={1}
        value={at}
        aria-label="scenario tick"
        onChange={(e) => onScrub(Number(e.target.value))}
        style={{ width: "100%", marginTop: 6, accentColor: "#2B5CFF" }}
      />

      {/* THE READOUT AT THE PLAYHEAD. Every number here is the published
          frame, which is the frame the axis above is labelled with. */}
      <div style={{ display: "grid", gap: 3, marginTop: 4 }}>
        {carry ? (
          <BandKey swatch="var(--bc-accent-text)" label={carry.label} value={carry.apy[at] ?? null} />
        ) : null}
        {floor ? (
          <BandKey swatch="var(--bc-muted)" label={floor.label} value={floor.apy[at] ?? null} />
        ) : null}
        <BandKey swatch="var(--bc-ink)" label="Vault, as composed" value={blended[at] ?? null} strong />
      </div>
      {/* EVERY REFUSAL STATES ITS OWN REASON, not only the one with a bracket.
          The outline bracket above is specific to `payback`, because what it
          draws is a distance running past the frame; a budget refusal has no
          distance and had no rendering at all, so the dial that produced it
          moved a number nobody could see. Deduplicated by the reason itself:
          one rule flapping across a threshold refuses the same way many
          times, and a list that repeats a sentence twelve times is a count
          wearing prose. */}
      {[...new Map(run.refusals.map((r) => [r.reason, r])).values()].map((r) => (
        <div
          key={`${r.ruleId}:${r.code}:${r.tickIndex}`}
          style={{ marginTop: 4, fontFamily: "var(--fm)", fontSize: 9, color: "var(--bc-muted)" }}
        >
          {`tick ${r.tickIndex} · ${r.reason}`}
        </div>
      ))}
    </div>
  );
}

function BandKey({
  swatch,
  label,
  value,
  strong,
}: {
  swatch: string;
  label: string;
  value: number | null;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--fm)",
        fontSize: 9.5,
        letterSpacing: ".04em",
        color: strong ? "var(--bc-ink)" : "var(--bc-body)",
      }}
    >
      <i style={{ width: 10, height: strong ? 3 : 2, background: swatch, borderRadius: 2, flex: "0 0 auto" }} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ flex: "0 0 auto" }}>
        <SignedApy value={value} size={strong ? 12 : 11} title="published net APY, as composed" />
      </span>
    </div>
  );
}

// ── The regime switcher ───────────────────────────────────────────────────

/**
 * THE DOCK ALREADY SHIPS A CAPSULE FOR EXACTLY THIS JOB, so this control is
 * that one and not a third invention: `.mt-filters` with `.hm-key` and its
 * LED is what a reader has already learned one panel away, picking one and
 * watching the panel below re-render. It also carries the press for free
 * (`hm.css:191`, reduced-motion guarded there), which the inline capsule this
 * replaced did not: a regime chip was the only capsule on the canvas that
 * returned nothing under the hand.
 *
 * TWO COLUMNS, NOT A WRAPPING ROW. At the dock's measured 327px interior four
 * keys in a flex row clear by about three pixels, so one extra character in
 * one label widows a key. A 2x2 grid cannot widow.
 */
function RegimeSwitcher({ regime, degraded }: { regime: RegimeId; degraded: boolean }) {
  return (
    <div>
      <div
        className="mt-filters"
        style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4 }}
      >
        {REGIME_IDS.map((id) => {
          const on = id === regime;
          return (
            <div
              key={id}
              className={"hm-key" + (on ? " lit" : "")}
              role="button"
              tabIndex={0}
              /* Dimmed while the run is broken: an unpressed key that cannot
                 produce a run should not read as available. The pressed one
                 keeps its ink, because it names what failed. */
              style={degraded && !on ? { opacity: 0.45 } : undefined}
              onClick={() => setRouterRegime(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setRouterRegime(id);
                }
              }}
            >
              <span className="hm-led" />
              {REGIME_LABEL[id]}
            </div>
          );
        })}
      </div>
      {/* SUPPRESSED WHILE THE RUN IS BROKEN. The sentence describes a
          scenario that did not run, and printing it under a failed fetch
          states a transform nothing performed. */}
      {degraded ? null : (
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--fm)",
            fontSize: 9,
            lineHeight: 1.5,
            color: "var(--bc-muted)",
          }}
        >
          {REGIME_MECHANISM[regime]}
        </div>
      )}
    </div>
  );
}

// ── The receipt ───────────────────────────────────────────────────────────

function ReceiptRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", justifyContent: "space-between" }}>
      <span style={{ color: "var(--bc-faint)", flex: "0 0 auto" }}>{k}</span>
      <span
        style={{
          color: "var(--bc-ink)",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          wordBreak: "break-all",
        }}
      >
        {v}
      </span>
    </div>
  );
}

const short = (h: string) => (h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h);

/**
 * THE UNIT A PIN IS COUNTED IN, TAKEN FROM THE OBSERVATION ITSELF.
 *
 * `ObservationKind` alone cannot answer this, and the reason is a measured
 * disagreement rather than a hypothetical. A funding lane's ref carries
 * `kind: "modeled"` (a generated series is not a scan document, and the
 * scenario package refuses to call it one) and labels its pins
 * `funding print #50`. A meter keyed on the kind therefore printed
 * `13 of 13 prints` directly above a row reading `funding print #50`: two
 * objects on one card disagreeing about what a pin is, which is the exact
 * defect B.6 item 5 exists to stop.
 *
 * So `kind` answers it wherever the kind IS the unit, and where it is not the
 * ref's own `label` is the only field that names one. The label is contracted
 * as rendered verbatim, so the noun is READ off it rather than invented, and
 * a label that does not carry the `<noun> #<ordinal>` shape falls back to the
 * kind rather than to a guess.
 */
function unitFromRef(ref: { kind: string; label: string }): string {
  if (ref.kind === "nav") return "NAV publications";
  if (ref.kind === "block") return "blocks";
  if (ref.kind === "print") return "scan prints";
  const noun = /^(.+?)\s+#\d+$/.exec(ref.label.trim());
  return noun ? `${noun[1]}s` : "modeled prints";
}

/**
 * WHAT WAS OBSERVED, ON WHICH CLOCK, UNDER WHICH POLICY, AND WHAT IT COST.
 *
 * Every field is read straight off the `AttestedDecision`. Nothing here is
 * recomputed beside the record, which is the whole point of carrying the
 * alternative and the observation refs on the decision itself: a record that
 * reconstructs its own alternative afterwards was written beside the decision
 * rather than derived from it.
 *
 * The two observation rows are the demo's own proof that the pin problem is
 * solved: one lane's label reads in funding prints and the other's in NAV
 * publications, both verbatim from the ref, and the two ordinals do not agree
 * because they are two clocks.
 */
function AttestationCard({
  decision,
  receipt,
  labels,
  units,
}: {
  decision: AttestedDecision;
  receipt: AttestedReceipt | null;
  labels: Record<string, string>;
  units: Record<string, string>;
}) {
  const d = decision;
  const name = (id: string) => labels[id] ?? id;
  const cost = d.cost.oneShotFrac + d.cost.windowCost;
  return (
    <div
      style={{
        border: "1px solid var(--bc-line)",
        borderRadius: 8,
        padding: 10,
        background: "var(--bc-panel)",
        display: "grid",
        gap: 4,
        fontFamily: "var(--fm)",
        fontSize: 9.5,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b style={{ letterSpacing: ".06em", fontSize: 10, color: "var(--bc-ink)" }}>
          {`${name(d.moved.sourceSlotId)} → ${d.moved.destSlotId === PAUSE_DESTINATION ? "pause" : name(d.moved.destSlotId)}`}
        </b>
        <SustainMeter
          filled={d.rule.streakAtFire}
          of={d.rule.sustainPins}
          unit={units[d.moved.sourceSlotId] ?? "pins"}
        />
      </div>
      <ReceiptRow k="rule" v={d.rule.metric} />
      <ReceiptRow k="policy" v={short(d.rulesHash)} />
      <ReceiptRow k="decision" v={short(d.decisionId)} />
      {Object.entries(d.observed).map(([slotId, ref]) => (
        <ReceiptRow key={slotId} k={name(slotId)} v={ref.label} />
      ))}
      <ReceiptRow
        k="source weight"
        v={`${pct(d.moved.weightBefore, 0)} → ${pct(d.moved.weightAfter, 0)} of the book`}
      />
      <ReceiptRow k="size" v={usd(d.moved.moveUsd)} />
      <ReceiptRow k="cost" v={`${usd(d.cost.oneShotUsd)}, ${pct(cost, 2)} of the move`} />
      <ReceiptRow
        k="payback"
        v={
          d.cost.paybackDays === null
            ? "the move buys no improvement, so it never pays back"
            : `${Math.round(d.cost.paybackDays)} days of the ${PAYBACK_HORIZON_DAYS} day horizon`
        }
      />
      <ReceiptRow
        k="alternative"
        v={
          "slotId" in d.alternative
            ? `${name(d.alternative.slotId)}, lost by ${ppMag(d.alternative.lostBy)}`
            : "no legal peer"
        }
      />
      <ReceiptRow
        k="turnover"
        v={`${pct(d.budget.realized + d.budget.inFlight, 1)} of ${pct(d.budget.ceiling, 0)} this week`}
      />
      <ReceiptRow k="scenario" v={`${d.scenarioRef.regime}, seed ${d.scenarioRef.seed}, tick ${d.scenarioRef.tick}`} />
      {receipt ? (
        <ReceiptRow
          k="settled"
          v={`${receipt.settledAtRef.label}, ${pct(receipt.realizedWeight, 1)} arrived, ${usd(receipt.realizedCostUsd)} paid`}
        />
      ) : (
        <ReceiptRow k="settled" v="in flight, earning nothing until it lands" />
      )}
      <div style={{ color: "var(--bc-faint)", fontSize: 9, marginTop: 2 }}>{ORCH_HONESTY_LINE}</div>
    </div>
  );
}

export function PortfolioVariant({
  portfolio,
  lanes,
  onOrchParam,
  onAlloc,
}: {
  portfolio: PortfolioGraph;
  lanes: DockLaneView[];
  onOrchParam: (field: string, value: ParamValue) => void;
  /** One lane's target share in bps; the rest rebalance to Σ=10000 (P1-6). */
  onAlloc: (loopId: LoopId, bps: number) => void;
}) {
  const [rulesOpen, setRulesOpen] = useState(true); // default open — it is why the user focused the orchestrator
  const alloc = portfolio.orchestrator.allocationsBps;

  /* §4.4 — one CLAUSE on the existing status line, no new element and no
     second card. It sits directly beneath the allocation sliders, so when
     the user drags an allocation and the number does NOT move (a shared
     binding) the non-event happens exactly where they expect movement.
     That silence is the lesson. Same vaultCapacity call the Review card
     makes, over the same repriced candidates. */
  const cap = useMemo(
    () =>
      vaultCapacity(
        lanes.map((l) => ({
          candidate: l.reprice?.ok === true ? l.reprice.candidate : null,
          hasHedge: !!nodeFor(l.loop, "hedge"),
          allocationBps: lanes.length === 1 ? 10000 : (alloc[l.loop.id] ?? 0),
          // The same composition RackCanvas's own `vaultCap` passes, so the
          // two calls cannot state one vault at two escrow shares.
          comp: pricingParamsFor(l.loop),
        })),
      ),
    [lanes, alloc],
  );
  const capStr = cap === null ? null : fmtCapacityUsd(cap.usd);
  /* M5 — HELD STILL. When an allocation commits and the recomputed capacity
     is byte-identical while the binding group holds 2+ lanes, sweep a rule
     under the shared clause once. The number does NOT flash: flashing a
     number that did not change is a lie about what happened, and silence
     alone teaches "broken". */
  const [sweep, setSweep] = useState(0);
  const prevCap = useRef<string | null>(null);
  const prevAlloc = useRef<string | null>(null);
  useEffect(() => {
    const allocSig = JSON.stringify(alloc);
    const allocMoved = prevAlloc.current !== null && prevAlloc.current !== allocSig;
    if (allocMoved && capStr !== null && prevCap.current === capStr && (cap?.sharedCount ?? 0) >= 2) {
      setSweep((s) => s + 1);
    }
    prevAlloc.current = allocSig;
    prevCap.current = capStr;
  }, [alloc, capStr, cap]);

  /* D10 — the printed integers, computed ONCE for every lane in one
     largest-remainder pass. Per-lane rounding at four call sites is what
     made 3 lanes print 99% and 6 print 101% beside bars that summed
     correctly. The bar WIDTHS keep the unrounded share; only the printed
     integer is quantised, and it is quantised here. */
  const pcts = useMemo(
    () => allocationPercents(lanes.map((l) => l.loop.id), lanes.length === 1 ? { [lanes[0]?.loop.id ?? ""]: 10000 } : alloc),
    [lanes, alloc],
  );

  const dials = useMemo(() => dialsFromParams(portfolio.orchestrator.params), [portfolio.orchestrator.params]);
  const slots = useMemo(() => slotsFromPortfolio(portfolio), [portfolio]);
  const rules = useMemo(() => deriveAllOrchRules(dials, slots), [dials, slots]);

  /* D5 — the table renders the DE-DUPLICATED UNION, with lane labels so a
     scoped row can name the lane the user recognises. */
  const table = useMemo(
    () =>
      orchRuleTable(
        rules,
        Object.fromEntries(portfolio.loops.map((l) => [l.id, l.label])),
      ),
    [rules, portfolio.loops],
  );

  /* B.6 item 5 — the sustain count PER SLOT PER METRIC, so a row can print its
     patience in the source's own unit. `deriveOrchRules` is the same pure
     function `deriveAllOrchRules` flat-maps, called with the same sorted peer
     array, so this is one owner asked a narrower question rather than a second
     derivation of the rule set. */
  const sustainOf = useMemo(() => {
    const m = new Map<string, number>();
    const sorted = [...slots].sort((a, b) => a.slotId.localeCompare(b.slotId));
    for (const s of sorted) {
      for (const r of deriveOrchRules(dials, s, sorted)) m.set(`${s.slotId}:${r.metric}`, r.sustainPins);
    }
    return m;
  }, [dials, slots]);

  /** What a pin IS, per lane. See `sourceUnit`. */
  const unitOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of slots) {
      const view = lanes.find((l) => l.loop.id === s.slotId);
      const block = view?.reprice?.ok === true ? view.reprice.blockNumber : 0;
      m.set(s.slotId, sourceUnit(s, view?.loop, block));
    }
    return m;
  }, [slots, lanes]);

  /* THE DESTINATION, over the lanes THIS user composed (INV-3). The plate on
     the canvas draws the same object from the same function, so the two
     router placements cannot describe two machines. */
  const route = useMemo(
    () =>
      composedRoute(
        slots,
        lanes.map((l) => {
          const ok = l.reprice?.ok === true ? l.reprice : null;
          return {
            loopId: l.loop.id,
            label: l.loop.label,
            publishedNetApy: l.netApy,
            appliedLeverage: l.appliedLeverage,
            capacityUsd: ok?.candidate?.economics?.capacityUsd ?? null,
            eligible: ok?.candidate?.eligible ?? null,
            settlementDays: Number(nodeFor(l.loop, "redemption-route")?.data.params.settlementDays ?? 0),
            blockNumber: ok?.blockNumber ?? 0,
            venue: pricingParamsFor(l.loop).venue,
          };
        }),
      ),
    [slots, lanes],
  );

  const dialDefs = useMemo(() => orchDialDefs(portfolio.loops.length), [portfolio.loops.length]);

  const bySlot = useMemo(() => new Map(slots.map((s) => [s.slotId, s])), [slots]);

  /* THE BADGE'S OWN FACTS, read off the same lane the plate reads. Every
     input is already on `DockLaneView`, so this is one derivation asked
     twice rather than a second opinion about the same two lanes. */
  const badge = useMemo(
    () =>
      routerBadge(
        deriveLaneSignals(
          lanes.map((l) => ({
            loopId: l.loop.id,
            label: l.loop.label,
            eligible: l.reprice?.ok === true ? (l.reprice.candidate?.eligible ?? null) : null,
            netApy: l.netApy,
            /* `pricingParamsFor` is the one owner of "which market is this
               lane pinned to", and it is the same accessor `RackCanvas` uses
               to build the plate's copy of these inputs. */
            hasMarket: !!pricingParamsFor(l.loop).candidateId,
            repricing: l.repricing,
          })),
          alloc,
        ),
      ),
    [lanes, alloc],
  );

  return (
    <div className="dock-portfolio" onClick={(e) => e.stopPropagation()}>
      <div className="dock-lane-head">
        <b>{ORCHESTRATOR_DEF.name}</b>
        {/* ONE BADGE DERIVATION, BOTH PLACEMENTS. This was the literal
            `hm-bdg ok` with the policy name inside it, so the dock wore an
            earned-green nameplate over lanes the plate was drawing amber.

            ⚠ THE NON-OK STATES CARRY THEIR OWN INK, and it is not decoration.
            `.bc-root .hm-bdg` paints #E6F4FF, which is correct on the plate's
            black screen and INVISIBLE on this cream panel; only the `.ok`
            variant sets a themed colour, so the moment this badge could say
            anything but the policy name it could also say it in white on
            near-white. `.dock-readouts .hm-bdg` is the shipped themed
            treatment and this mirrors its two values, because a stylesheet
            this work package does not own cannot be given the selector.
            Cross-package request filed against `build.css:805`. */}
        <span
          className={`hm-bdg${badge.state === "ok" ? " ok" : ""}`}
          data-badge
          data-badge-state={badge.state}
          style={
            badge.state === "ok"
              ? undefined
              : { color: "var(--bc-ink)", borderColor: "var(--bc-line-strong)" }
          }
        >
          {badge.text}
        </span>
      </div>

      <div className="dock-allocs">
        {lanes.map((l) => {
          const s = bySlot.get(l.loop.id);
          return (
            <div key={l.loop.id} className="rk-orchrow">
              <span>{l.loop.label.length > 10 ? `${l.loop.label.slice(0, 9)}…` : l.loop.label}</span>
              {/* F.3 / F.5 — the SAME track the plate draws. The tick is the
                  derived floor; the lift behind the fill is headroom to this
                  lane's own ceiling. A composed portfolio holds no weight in
                  flight, so the hatch is absent rather than empty. */}
              <AllocationTrack
                targetPct={(lanes.length === 1 ? 10000 : (alloc[l.loop.id] ?? 0)) / 100}
                /* A lane with no market is not a slot, so it carries no band.
                   Null draws no tick and no headroom, which is the honest
                   answer; 0 and 1 would draw a floor at nothing and a ceiling
                   at everything, both of them invented. */
                floorPct={s ? s.minWeight * 100 : null}
                maxPct={s ? s.maxWeight * 100 : null}
              />
              <AllocShareInput
                bps={alloc[l.loop.id] ?? 0}
                pctValue={pcts[l.loop.id] ?? 0}
                dark
                onCommit={(bps) => onAlloc(l.loop.id, bps)}
              />
            </div>
          );
        })}
      </div>
      {slots.length > 0 ? (
        <div className="dock-orch-status" style={{ marginTop: 4 }}>
          {floorCaption((slots[0].minWeight ?? 0) * 100)}
        </div>
      ) : null}
      <div className="dock-orch-status">
        {`governs ${portfolio.loops.length} loop${portfolio.loops.length === 1 ? "" : "s"}`}
        {capStr !== null ? (
          <>
            {" · capacity "}
            <LiveNumber value={capStr}>
              <b>{capStr}</b>
            </LiveNumber>
            {(cap?.sharedCount ?? 0) >= 2 ? (
              <span key={sweep} className={`dk-shared${sweep ? " swept" : ""}`}>
                {` · shared by ${cap?.sharedCount} loops`}
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      {/* THE DESTINATION, DRAWN. This is the object the contract requires on
          both router placements, and both read one `ComposedRoute`. */}
      <div style={{ marginTop: 10 }}>
        <div
          style={{
            fontFamily: "var(--fm)",
            fontSize: 9,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--bc-faint)",
            marginBottom: 3,
          }}
        >
          Destination
        </div>
        <DestinationLine route={route} variant="panel" />
      </div>

      {/* F.6 — the week strip. On a rack that has never run, everything is
          remaining, and the strip is how the turnover dial stops being a
          number with nothing behind it. */}
      <div style={{ marginTop: 10 }}>
        <TurnoverStrip
          realized={0}
          inFlight={0}
          ceiling={dials.turnoverBudgetPctWeek / 100}
          variant="panel"
        />
      </div>

      <div className="pc dock-orch-dials">
        {dialDefs.map((d) => (
          <OrchDial
            key={d.field}
            desc={d}
            value={portfolio.orchestrator.params[d.field]}
            onChange={(v) => onOrchParam(d.field, v)}
          />
        ))}
      </div>

      <div className="hm-keys">
        <ActionKey label="Rules" lit={rulesOpen} onClick={() => setRulesOpen((v) => !v)} />
      </div>
      {rulesOpen ? (
        <div className="dock-rules">
          <div className="rt-policy">
            {ORCHESTRATOR_DEF.policyName} · {orchRuleScopeLine(table)}
          </div>
          <span className="rt-modeled">modeled · no execution rail</span>
          {table.rows.map((row) => (
            <div
              key={`${row.metric}:${row.slotIds.join(",")}`}
              className="rt-rule"
              style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 10px", alignItems: "baseline" }}
            >
              <b style={{ letterSpacing: ".06em", fontSize: "10px" }}>
                {row.name}
                {row.scope ? (
                  <span
                    className="rt-scope"
                    style={{ marginLeft: 6, fontSize: "8.5px", letterSpacing: ".06em", opacity: 0.65, fontWeight: 500 }}
                  >
                    {row.scope}
                  </span>
                ) : null}
              </b>
              {/* B.6 item 5 — THE PATIENCE, IN THE SOURCE'S OWN UNIT.
                  `orchRuleTable.patience` renders "6 scans" for every rule on
                  every lane, and a treasury lane has no scanner: its source
                  publishes a NAV. A de-duplicated row spanning two lanes on
                  two clocks prints BOTH, side by side, because that is what is
                  true of it and collapsing them would pick one lane's clock
                  for the other lane's rule. */}
              <span style={{ fontSize: "9.5px", opacity: 0.7, textAlign: "right", maxWidth: "62%" }}>
                {[...new Set(row.slotIds.map((id) => unitOf.get(id) ?? "observations"))]
                  .map((u) => patienceIn(sustainOf.get(`${row.slotIds[0]}:${row.metric}`) ?? 0, u))
                  .join(" · ")}{" "}
                · cooldown {row.cooldown}
              </span>
              <span style={{ gridColumn: "1 / -1", opacity: 0.85 }}>{row.trigger}</span>
            </div>
          ))}
          <div className="rt-floor">
            Every rule: at most {table.maxMovePct.toFixed(0)}% of the book per move · one failing
            observation never moves capital · an emergency pauses the loop, bypassing cooldowns.{" "}
            {ORCH_HONESTY_LINE}
          </div>
        </div>
      ) : null}

      {/* THE REPLAY BELONGS TO A PORTFOLIO THAT HAS A ROUTER. Below two lanes
          there is nothing to route between, and a two-lane replay under a
          one-lane rack would be a demonstration of a machine the reader has
          not built. It also keeps the run's fetch off a panel that has no use
          for it. */}
      {portfolio.loops.length >= 2 ? <RouterRunSection /> : null}
    </div>
  );
}

/**
 * THE RUN PANEL'S OWN MOTION, AND ITS OWN REDUCED-MOTION FALLBACK.
 *
 * MANDATORY, not belt and braces: `build.css:2710` animates `.dock-scroll > *`
 * with a DIRECT-CHILD combinator and its fallback at `:2806` names the same
 * selector, and `RouterRunSection` is nested two levels deeper than that. So
 * neither the arrival nor its guard reaches anything below, and an animation
 * declared here without a local `prefers-reduced-motion` block would be the
 * exact failure `build.css:2799-2803` warns about: a `both` fill plus a delay
 * holds the element at opacity 0 under a shortened but still delayed
 * animation.
 *
 * Declared as a plain `<style>` because this package does not own `build.css`.
 * Duplicate identical rules are inert, so mounting twice costs nothing.
 */
const RUN_STYLE = `
@keyframes rkdraw { to { stroke-dashoffset: 0 } }
@keyframes rkfade { to { opacity: 1 } }
@keyframes rktrackland {
  0% { box-shadow: 0 0 0 0 rgba(77,139,255,.5) }
  100% { box-shadow: 0 0 0 7px rgba(77,139,255,0) }
}
.rk-band-line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: rkdraw .62s cubic-bezier(.4,0,.2,1) both }
.rk-band-area { opacity: 0; animation: rkfade .3s ease-out .5s forwards }
.rk-band-mark { opacity: 0; animation: rkfade .28s ease-out .68s forwards }
.rk-notch line, .rk-notch text { transition: stroke-width 120ms ease-out, fill 120ms ease-out }
.rk-runstate { animation: dockswapin 160ms cubic-bezier(.4,0,.2,1) 40ms both }
.rk-sustain i { transition: background 180ms ease-out; transition-delay: calc(min(var(--i,0),8) * 28ms) }
.rk-track--moved { animation: rktrackland 420ms cubic-bezier(.3,1.2,.4,1) 1 }
@media (prefers-reduced-motion: reduce) {
  .rk-band-line { stroke-dasharray: none; stroke-dashoffset: 0; animation: none }
  .rk-band-area, .rk-band-mark { opacity: 1; animation: none }
  .rk-notch line, .rk-notch text { transition: none }
  .rk-runstate { animation: none; opacity: 1; transform: none }
  .rk-sustain i { transition: none; transition-delay: 0s }
  .rk-track--moved { animation: none }
}
`;

/**
 * THE ROUTER, RUN (spec G, beats 1:40 to 5:00).
 *
 * Named as what it is. Its two lanes are the RUN's own slots, not the ones on
 * the rack above, so nothing here is presented as a statement about the
 * composed portfolio: reading a seeded replay's weights onto the user's own
 * plate would name a destination the user did not compose, which is INV-3
 * wearing a UI hat.
 *
 * What it is FOR is the half of the machine the rack cannot show. A rack draws
 * a rule table; only a run can draw a rule FIRING, a wait being priced, and a
 * record derived from the observation rather than written beside it.
 */
function RouterRunSection() {
  const { regime, run, phase, error } = useRouterRun();
  const [tick, setTick] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  /* ONE hoverId, set from either end of the binding and cleared from either.
     Ink only: no fill, no scale, no glow, because a notch 200px away is not
     under the hand. */
  const [hoverId, setHoverId] = useState<string | null>(null);
  /* THE LANE WHOSE TRACK JUST RECEIVED WEIGHT, and only on the tick
     TRANSITION that landed it. Never on mount and never on a scrub landing
     where the weight was already there. */
  const [landed, setLanded] = useState<string | null>(null);
  const prevTick = useRef<number | null>(null);
  const T = run?.laneSeries.carryPublishedApy.length ?? 0;
  const at = Math.max(0, Math.min(Math.max(0, T - 1), tick));

  const labels = useMemo(
    () => Object.fromEntries((run?.lanes ?? []).map((l) => [l.slotId, l.book])),
    [run],
  );

  /* The decision the card shows: the most recent one at or before the
     playhead, unless the reader pinned one by clicking its marker. */
  const shown = useMemo(() => {
    if (!run) return null;
    if (pinned) return run.decisions.find((d) => d.decisionId === pinned) ?? null;
    const before = run.decisions.filter((d) => d.scenarioRef.tick <= at);
    return before.length > 0 ? before[before.length - 1] : null;
  }, [run, at, pinned]);

  const units = useMemo(() => {
    const m: Record<string, string> = {};
    if (shown) for (const [slotId, ref] of Object.entries(shown.observed)) m[slotId] = unitFromRef(ref);
    return m;
  }, [shown]);

  /* THE PLAYHEAD COMES HOME WITH THE REDRAW. Without it a regime change
     leaves the scrub where it was and indexes a series of a different length,
     which the `min(max(0, T - 1), tick)` clamp hides rather than fixes. */
  useEffect(() => {
    setTick(0);
    setPinned(null);
    setHoverId(null);
    setLanded(null);
    prevTick.current = null;
  }, [regime]);

  /* THE RELOCATION BEAT, on the DESTINATION only: blooming both ends would
     claim two events where the mechanism performed one. Blue, not green: a
     protection mechanism firing is not a confirmation. */
  useEffect(() => {
    if (!run) return;
    const from = prevTick.current;
    prevTick.current = at;
    if (from === null || from === at) return;
    const d = run.decisions.find(
      (x) => x.scenarioRef.tick === at && x.moved.destSlotId !== PAUSE_DESTINATION,
    );
    setLanded(d ? d.moved.destSlotId : null);
  }, [run, at]);

  const budget = run?.budgetByTick[at] ?? null;

  /* F.5 — WHICH LANE IS WAITING, AND FOR WHICH OBSERVATION. The amount is the
     gap between Σ target (INV-1's own per-tick evidence, which stays 1 while a
     leg is open) and Σ earning (which zeroes weight that has not arrived). The
     lane is the destination of the last move at or before the playhead: no
     other slot can be waiting for one. The label is the leg's own settlement
     ref, rendered verbatim, and never a countdown. */
  const lastMove = useMemo(() => {
    if (!run) return null;
    const moved = run.decisions.filter(
      (d) => d.scenarioRef.tick <= at && d.moved.destSlotId !== PAUSE_DESTINATION,
    );
    return moved.length > 0 ? moved[moved.length - 1] : null;
  }, [run, at]);
  const inFlightTotal = run
    ? Math.max(
        0,
        (run.weightSumByTick[at] ?? 1) -
          run.lanes.reduce((s, l) => s + (run.earningWeightByTick[l.slotId]?.[at] ?? 0), 0),
      )
    : 0;
  const waitingSlot = inFlightTotal > 1e-9 ? (lastMove?.moved.destSlotId ?? null) : null;
  const settlesAtLabel =
    run && lastMove
      ? (run.legs.find((g) => g.decisionId === lastMove.decisionId)?.settledAt?.label ?? null)
      : null;

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--bc-line)", paddingTop: 12 }}>
      <style>{RUN_STYLE}</style>
      {/* The head the three siblings in this dock already render: Fraunces
          italic, sentence case, no tracking. The letterspaced-uppercase
          register it replaced was an inline style the retiring block in
          build.css could not reach. */}
      <div className="mt-sec-h">The router, run</div>

      <RegimeSwitcher regime={regime} degraded={phase === "error"} />

      {phase === "loading" ? (
        <div
          className="rk-runstate"
          style={{ marginTop: 10, fontFamily: "var(--fm)", fontSize: 9.5, color: "var(--bc-faint)" }}
        >
          folding the scenario through the evaluator
        </div>
      ) : null}
      {/* THE TWO REGISTERS ARE SEPARATED, and the slot is held. Waiting and
          broken used to print in the same ink at the same offset, and the
          panel collapsed from about 300px to 60px on failure, so the dock
          jumped under the reader at the moment it had the least to say. */}
      {phase === "error" ? (
        <div
          className="rk-runstate"
          style={{
            marginTop: 10,
            minHeight: 44,
            padding: 10,
            border: "1px dashed var(--bc-line)",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            fontFamily: "var(--fm)",
            fontSize: 9.5,
            color: "var(--bc-warn)",
          }}
        >
          <span>{error}</span>
          <div
            className="hm-key"
            role="button"
            tabIndex={0}
            style={{ flex: "0 0 auto", height: 26, padding: "0 10px", fontSize: 7.5 }}
            onClick={() => setRouterRegime(regime)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setRouterRegime(regime);
              }
            }}
          >
            <span className="hm-led" />
            Retry
          </div>
        </div>
      ) : null}

      {run ? (
        <>
          {/* KEYED ON THE REGIME so the whole chart remounts and the draw-in
              replays. Without it three lines, N markers, both tracks and the
              receipt hard-swap with no transition at all. */}
          <div key={regime} style={{ marginTop: 10 }}>
            <LaneBands
              run={run}
              tick={at}
              onScrub={(t) => {
                setTick(t);
                setPinned(null);
              }}
              hoverId={hoverId}
              onHover={setHoverId}
            />
          </div>

          {/* F.5 — the run's own allocation, at the playhead. Settled weight is
              solid, weight on an open leg is hatched and carries the
              observation that closes it. */}
          <div style={{ marginTop: 12, display: "grid", gap: 7 }}>
            {run.lanes.map((l) => {
              const earning = run.earningWeightByTick[l.slotId]?.[at] ?? 0;
              /* WEIGHT IN FLIGHT IS THE GAP BETWEEN Σ TARGET AND Σ EARNING,
                 and both halves are the evaluator's own per-tick evidence
                 rather than anything reconstructed here: `weightSumByTick` is
                 INV-1's proof that Σ target stays 1 while a leg is open, and
                 `earningWeightByTick` zeroes the weight that has not arrived.
                 The gap belongs to the destination of the last move, which is
                 the only slot that can be waiting for one. */
              const inFlight = l.slotId === waitingSlot ? inFlightTotal : 0;
              return (
                <div
                  key={l.slotId}
                  className={"rk-orchrow" + (landed === l.slotId ? " rk-track--moved" : "")}
                >
                  <span>{l.book}</span>
                  {/* NO FLOOR TICK: the route publishes no band per slot, and
                      re-deriving B.5's formula here to draw one would be a
                      fifth spelling of it. The ceiling IS drawable, through
                      the same `clampConcentrationPct` the route clamps with. */}
                  <AllocationTrack
                    targetPct={earning * 100}
                    maxPct={clampConcentrationPct(run.dials.maxConcentrationPct, run.lanes.length)}
                    inFlightPct={inFlight * 100}
                    settlesAt={inFlight > 0 ? settlesAtLabel : null}
                  />
                  <span
                    style={{
                      fontFamily: "var(--fm)",
                      fontSize: 9.5,
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--bc-ink)",
                    }}
                  >
                    {pct(earning, 0)}
                  </span>
                </div>
              );
            })}
          </div>

          {budget ? (
            <div style={{ marginTop: 10 }}>
              <TurnoverStrip
                realized={budget.realized}
                inFlight={budget.inFlight}
                ceiling={budget.ceiling}
                variant="panel"
              />
            </div>
          ) : null}

          {/* THE TIMELINE. One marker per decision; clicking one pins its
              receipt, which is beat 4:30. */}
          {run.decisions.length > 0 ? (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {run.decisions.map((d) => {
                const lit = hoverId === d.decisionId;
                return (
                  <button
                    key={d.decisionId}
                    type="button"
                    data-decision={d.decisionId}
                    onClick={() => {
                      setPinned(d.decisionId);
                      setTick(d.scenarioRef.tick);
                    }}
                    /* Both ends of the binding, and focus as well as hover, so
                       a keyboard reader gets the same correspondence: in the
                       whipsaw regime the markers and the notches are otherwise
                       two unlabelled sets of the same size. */
                    onMouseEnter={() => setHoverId(d.decisionId)}
                    onMouseLeave={() => setHoverId(null)}
                    onFocus={() => setHoverId(d.decisionId)}
                    onBlur={() => setHoverId(null)}
                    style={{
                      fontFamily: "var(--fm)",
                      fontSize: 9,
                      padding: "2px 6px",
                      borderRadius: 4,
                      cursor: "pointer",
                      transition: "border-color 120ms ease-out, color 120ms ease-out",
                      border: `1px solid ${
                        lit || shown?.decisionId === d.decisionId
                          ? "var(--bc-accent-edge)"
                          : "var(--bc-line)"
                      }`,
                      background: "transparent",
                      color: lit ? "var(--bc-ink)" : "var(--bc-muted)",
                    }}
                  >
                    {`tick ${d.scenarioRef.tick} · ${d.rule.metric}`}
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ marginTop: 10, fontFamily: "var(--fm)", fontSize: 9.5, color: "var(--bc-muted)" }}>
              {`${run.firings} rules fired over ${T} ticks, so nothing moved`}
            </div>
          )}

          {shown ? (
            <div style={{ marginTop: 10 }}>
              <AttestationCard
                decision={shown}
                receipt={run.receipts.find((r) => r.decisionId === shown.decisionId) ?? null}
                labels={labels}
                units={units}
              />
            </div>
          ) : null}

          <div
            style={{
              marginTop: 8,
              fontFamily: "var(--fm)",
              fontSize: 9,
              color: "var(--bc-faint)",
              wordBreak: "break-all",
            }}
          >
            {/* NOT `seed N`. This replay is measured history, not a generated
                scenario, so there is no seed to print and `scenario.seed` is
                zero as a stated absence. What identifies the run is the
                capture it replays, which is the field the route fills. */}
            {`calibrated to ${run.scenario.calibratedTo} · ${run.scenario.ticks} ticks · scenario ${short(run.scenario.hash)} · policy ${short(run.rulesHash)}`}
          </div>
        </>
      ) : null}
    </div>
  );
}
