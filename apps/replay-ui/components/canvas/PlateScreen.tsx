"use client";

/* eslint-disable eqeqeq --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
import { EXIT_ROUTE_OPTIONS } from "@/lib/canvas/modules";

/**
 * PlateScreen (UX_SPEC §2.1, mockup register 2026-08-20) — the 142px OLED,
 * kind-mapped per module: src / band / gauge / fill / vault-src. Every
 * number carries the modeled register pinned to the latest scan; quoting
 * dims the screen (hardware state), never a spinner or a paragraph.
 * Eligibility verdicts, gate counts and stale-scan flags are gone: the
 * mockup presents clean, current-looking data.
 */

import { useEffect, useRef, useState } from "react";
import type { ModuleKey, ParamValue } from "@/lib/canvas/types";
import { watchViewOf, type CounterpartyId } from "@/lib/canvas/exogenous";
import { NO_BORROW_BANDS_VALUE, venueLabel } from "@/lib/canvas/labels";
import { lev, MINUS, pct, pp, scanRef } from "@/lib/canvas/format";
import {
  escrowShare,
  hedgeBar,
  hedgeEconomics,
  hedgeEscrowCaption,
  hedgeHeroParts,
  hedgeSubline,
} from "@/lib/canvas/hedge-econ";
import {
  composedTerms,
  compoundDelta,
  grossCarry,
  type LaneComposition,
} from "@/lib/canvas/mock-quote";
import type { HfBands } from "@/lib/canvas/param-schema";
import { liquidationDistance } from "@/lib/canvas/liquidation";
import { familiesForCandidateId } from "@/lib/canvas/templates";
import { FAMILY_CHAINS } from "@/lib/canvas/graph-ops";
import type { RepriceData } from "./types";

export type ScreenState = "idle" | "quoting" | "ok" | "noquote";

/**
 * THE LAMP'S OWN WORD for each party. Six characters at most: the strip runs
 * three columns into a 176.6px interior, which is 47.5px a cell and eight
 * characters of IBM Plex Mono at 7.5px before the label touches its
 * neighbour's. The landing's own vocabulary where it had one.
 */
const LAMP_LABEL: Record<CounterpartyId, string> = {
  bridge: "BRIDGE",
  venue: "VENUE",
  "asset-issuer": "ISSUER",
  "price-feed": "ORACLE",
  "hedge-venue": "HEDGE",
  scan: "SCAN",
};

/**
 * THE FOUR LAMP STATES, and the ORDER OF LOUDNESS IS NOT THE ORDER OF THE
 * LIST. It looks wrong until it is said out loud:
 *
 *   crossed  >  lit  >  socket  >  off
 *
 * `socket` — a party with NO INSTRUMENT — is drawn as a hollow ring at its
 * own label's ink, never dimmed, because dimming it would be "implying
 * coverage by making the gap easy to miss", which is exactly what the honesty
 * line forbids in the same breath it demands the UI say so. The mark is not
 * invented: `.cpz-skip-nm .rail-dot`, the product's shipped glyph for a blind
 * register entry, is already a hollow ring at its own label's colour.
 *
 * `off` — a party we read and the builder chose not to answer — is the least
 * consequential thing on the plate and is correctly the faintest.
 *
 * `crossed` is a quantity that crossed a line, not a warning, so it INVERTS
 * to ink rather than turning amber. `broken` (supply above backing) would be
 * the same move one step further and does NOT ship: no field in the payload
 * can produce it, and a state the UI can render with no producer is either
 * dead code or a lie.
 *
 * ⚠ THE ANSWERED DIMENSION LIVES ON `data-answered`, NOT HERE (recette fix,
 * 2026-08-27). This function is EVIDENCE ONLY, and that is why the plate's one
 * control could not move its own strip: on the delta-neutral LP template every
 * party is a socket, so `Answered = Read` and `Answered = All` rendered five
 * byte-identical lamps. The fix is NOT a fifth lamp state — a socket that
 * lights up would claim a reading the lane does not have. The dot stays
 * evidence; the LABEL carries the response, which the CSS already did for
 * `lit` versus `off` and simply never applied to the rows the dial moves.
 */
function lampOf(row: { tier: string; state: string }, answered: boolean): string {
  if (row.state === "failing") return "crossed";
  if (row.tier !== "measured") return "socket";
  return answered ? "lit" : "off";
}

/**
 * FRAME M ON A FAMILY WITH NO LEVERAGE DIAL — the sibling of `format.scanRef`,
 * and deliberately not a branch inside it: `scanRef` owns "the market at its
 * OWN leverage", welded to that leverage, and the whole point here is that
 * there is no leverage to weld. The frame word is Discover's (`.mt-lev` reads
 * `modeled` on exactly these rows), so the two surfaces say one thing.
 *
 * Null on a missing number, exactly where `scanRef` is null, so the caller's
 * graceful-degradation branch is reached the same way on both families.
 */
function modeledRef(apr: number | null | undefined): string | null {
  return typeof apr === "number" && Number.isFinite(apr) ? `${pct(apr)} modeled` : null;
}

/**
 * THE SOURCE PLATE'S SUB-LINE, as a pure function so the family branch below
 * is provable by moving the pin rather than by reading the JSX.
 *
 * D-MTX-2 (2026-09-02) — FRAME M IS ONLY WELDED TO A LEVERAGE WHERE ONE
 * EXISTS. This line read `Options venue · Base · 11.8% at 1.00x` on the collar
 * and `Aerodrome · Base · 6.8% at 1.00x` on the delta-neutral LP, advertising
 * a dial neither family has: `FAMILY_CHAINS` seats `safety-buffer` on the loop
 * and nowhere else, and both hand-authored rows carry `loopLeverage: 1` by
 * construction. Discover already ruled on this exact row — its `.mt-lev` slot,
 * the one welded to the headline, reads `modeled` where a scan row reads
 * `at 2.75x` — so this reuses that word rather than inventing a third
 * spelling, and the ladder's first rung in `ComposePanel` reuses it too.
 *
 * The family comes from the PINNED ID, not from the quote, so the plate does
 * not print `at 1.00x` for the frames between mount and first fill. 36
 * characters at the longest, inside the 38 `.hm-sb` allows and one shorter
 * than the string it replaces.
 */
export function sourceSubline({
  pair,
  venueId,
  candidateId,
  scan,
  laneLev,
}: {
  pair: string;
  venueId: string;
  candidateId: string;
  scan: { apr: number | null; lev: number | null } | null;
  laneLev: number | null;
}): string {
  const levered = familiesForCandidateId(candidateId).some((f) =>
    FAMILY_CHAINS[f].includes("safety-buffer"),
  );
  const ref = levered ? scanRef(scan?.apr, scan?.lev) : modeledRef(scan?.apr);
  if (!pair) return "pick a market";
  if (ref) return `${venueLabel(venueId)} · ${ref}`;
  /* GRACEFUL DEGRADATION: no scan row behind the lane (template venue, catalog
     miss) prints the venue and the lane's leverage and NO percentage. An
     invented number is worse than a missing one — and on an unlevered family
     there is no leverage to fall back to either, so the venue stands alone. */
  return `${venueLabel(venueId)}${levered && laneLev ? ` · ${lev(laneLev)}` : ""}`;
}

export interface PlateScreenProps {
  moduleKey: ModuleKey;
  params: Record<string, ParamValue>;
  reprice: RepriceData | null;
  state: ScreenState;
  /**
   * FRAME M — the UNREPRICED scan row behind this lane. `reprice.candidate`
   * is ALREADY repriced (mockQuote calls repriceAtLeverage), so the market's
   * own headline at its own leverage is not reachable from here without it.
   * Null degrades the sub-line to a percentage-free `venue · Lx`.
   */
  scan?: { apr: number | null; lev: number | null } | null;
  /**
   * Whether the LANE runs the short leg. Only the auto-compound plate reads
   * it: the recapture delta compounds the lane's own accrual, and on a
   * class-A row with the hedge ejected that accrual is the hedgeless one.
   * Undefined (the caller does not know yet) prices the row as it was
   * repriced, which is the pre-thread behaviour — never a guess.
   */
  hasHedge?: boolean;
  /**
   * The lane's composition (`pricingParamsFor(loop)`). Every hedge quantity on
   * the screen reads `escrowShare` / `hedgeEconomics` WITH it, so the plate
   * prints the dials the lane was priced at. Undefined falls back to the
   * candidate's own implied ratio, which is the same number on a candidate
   * priced through `repriceAtLeverage`, and blanks (by the identity assert)
   * on one that was not — loudly, never a constant.
   */
  comp?: LaneComposition | null;
}

/**
 * THE HF STRIP (recette item 14) — zone geometry in HEALTH-FACTOR space.
 *
 * The strip used to be four equal zones with a marker positioned by
 * LEVERAGE, so lowering the risk dial walked the marker LEFT into the amber
 * zone: the instrument said "more dangerous" for the one action that is
 * unambiguously safer. Both halves are now the same quantity.
 *
 * THE AXIS is HF from LIQUIDATION to one trim-gap above the position:
 *
 *     lo = 1.00      hi = target + gap      gap = target − trim
 *
 * Anchoring the left edge at 1.00 is what keeps the instrument alive. A
 * window drawn around the bands instead (`floor − gap` to `target + gap`)
 * is exactly 25/25/50 with the marker at 75% on EVERY market, every preset
 * and every leverage, because `deriveHfBands` builds both lower edges as
 * fixed offsets from the target: the band structure has one degree of
 * freedom, so a band-relative window normalises it away and prints a
 * constant. That is the pinned-dot defect (shadow-price R4) rebuilt in a
 * second instrument, and it is why the axis reaches down to liquidation.
 *
 * THE ZONES are the derived edges, and the amber sits on the TRIM band —
 * the interval where the machine is actually acting — not on the whole
 * region below the floor. Filling everything under the floor would make the
 * strip flood amber as the builder DELEVERS (a safer position holds its
 * emergency line higher, so more of the axis lies below it): alarm colour
 * growing on the safe action is the same backwards reading in a new coat.
 * Below the floor is base dark, and the amber slab travels with the
 * position, widening as leverage rises.
 *
 * THE GUARANTEE, structural rather than tested-into: the marker sits at
 * `target`, the amber slab ends at `trim`, and `deleverage = target −
 * spread` with `spread > 0` for every preset. So the marker is right of the
 * amber for every preset, every leverage and every lt, and turning the dial
 * down moves it further right.
 */
export interface HfZone {
  key: "emergency" | "trim" | "open";
  label: string;
  /** Width as a percentage of the strip. */
  widthPct: number;
  /** Centre of the zone, where its label is anchored. */
  centerPct: number;
  /** A label needs a zone wide enough to sit in without touching its
   *  neighbour's. `Open` always carries one: it holds the marker. */
  labelled: boolean;
}

/** Below this share of the strip a zone cannot carry its own label without
 *  colliding with the next one. Measured: `.hm-brow` is 6.5px uppercase, so
 *  `Emergency` is ~36px on a 199px strip. */
const LABEL_MIN_PCT = 12;

export function hfZones(hf: HfBands | null): { zones: HfZone[]; markerPct: number } | null {
  if (!hf) return null;
  const target = hf.hfTargetBps / 1e4;
  const trim = hf.hfDeleverageBps / 1e4;
  const floor = hf.hfFloorBps / 1e4;
  if (!(target > trim) || !(target > 1)) return null;
  const gap = target - trim;
  const lo = 1;
  const hi = target + gap;
  const span = hi - lo;
  if (!(span > 0)) return null;
  const at = (v: number) => ((Math.min(hi, Math.max(lo, v)) - lo) / span) * 100;
  // `min(floor, trim)`: on a market whose emergency line clamps at the house
  // 1.10 the two edges can invert, and an amber slab that reached past the
  // trim line would swallow the marker.
  const eEnd = Math.min(at(floor), at(trim));
  const tEnd = at(trim);
  const markerPct = at(target);
  const centre = (a: number, b: number) => Math.min(92, Math.max(8, (a + b) / 2));
  const zone = (key: HfZone["key"], label: string, a: number, b: number): HfZone => ({
    key,
    label,
    widthPct: b - a,
    centerPct: centre(a, b),
    labelled: key === "open" || b - a >= LABEL_MIN_PCT,
  });
  return {
    zones: [
      zone("emergency", "Emergency", 0, eEnd),
      zone("trim", "Trim", eEnd, tEnd),
      zone("open", "Open", tEnd, 100),
    ],
    markerPct,
  };
}

/**
 * rAF count-up tween for the vault Net APY (UX §3.2 hero moment).
 *
 * THREE fixes, 2026-08-22 (COMPOSE_PANEL_SPEC §5.7 / §5.4):
 *
 *  1. REDUCED MOTION. There was no bail at all, and this hook feeds the
 *     header hero AND every vault plate — the single largest reduced-motion
 *     hole on the canvas. Under reduce it returns the target immediately.
 *
 *  2. INTERRUPTED TWEENS. `fromRef.current = target` was assigned BEFORE the
 *     tween ran, so a tween interrupted mid-flight restarted from a number
 *     that was never rendered and the digits visibly jumped backwards. The
 *     ref is now seeded from the value actually on screen.
 *
 *  3. A NUMBER APPEARING IS NOT A NUMBER CHANGING. When the previous value is
 *     null there is no count-up: counting 0% → 6.1% is a slot machine AND a
 *     lie, because the lane was never at 0%. The hook already handled
 *     target→null; null→number now gets the same bail.
 */
export function useCountUp(target: number | null, ms = 500): number | null {
  const [value, setValue] = useState<number | null>(target);
  const fromRef = useRef<number | null>(target);
  const shownRef = useRef<number | null>(target);
  shownRef.current = value;
  const reduce = usePrefersReduce();
  useEffect(() => {
    if (target === null) {
      setValue(null);
      fromRef.current = null;
      return;
    }
    // ARRIVAL, not a change: the plate fades in beside the number.
    if (fromRef.current === null || reduce) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    // Seed from what is RENDERED, not from the last requested target.
    const from = shownRef.current ?? fromRef.current;
    fromRef.current = target;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      // k clamps at 0: a rAF timestamp can precede the effect's own
      // `performance.now()`, and an unclamped negative k pushes the eased
      // value OUTSIDE [from, target] — the vaults hero printed invented
      // negatives from the same shape (see useCountUp.ts, cleanup 2026-08-24).
      const k = Math.min(1, Math.max(0, (t - t0) / ms));
      const eased = 1 - (1 - k) * (1 - k);
      setValue(from + (target - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduce]);
  return value;
}

/** SSR-safe reduced-motion read (mirrors useTips' own hook, no import cycle). */
function usePrefersReduce(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

export default function PlateScreen({
  moduleKey,
  params,
  reprice,
  state,
  scan,
  hasHedge,
  comp,
}: PlateScreenProps) {
  const ok = reprice?.ok === true ? reprice : null;

  const badge = (text: string, good: boolean) => (
    <span className={`hm-bdg${good ? " ok" : ""}`} data-badge>
      {text}
    </span>
  );
  const statusBadge = (idleText: string, okText: string, good = true) => {
    if (state === "quoting") return badge("…", false);
    if (state === "ok") return badge(okText, good);
    return badge(idleText, false);
  };

  if (moduleKey === "liquidity-source") {
    /* ══ THE CHIMERA DIES HERE (COMPOSE_PANEL_SPEC §0 / §2 conflict A) ══════
       This line used to read:
         `${cls === "N1" ? "unhedged" : "hedged"} · ${pct(econ.netApyOnDepositApy)} modeled`
       The WORD came from the MARKET's class, pinned at pick time by
       DiscoverPanel.pick() and permanent — unaffected by ejecting the hedge.
       The NUMBER came from the market's hedged arithmetic repriced at THE
       LANE's leverage. The result belonged to no object that exists: the
       lane's leverage running the market's hedge. It could not be built from
       anything on the canvas, and it sat ~200px from a lane header printing
       the composition-honest number for the same lane.

       WHAT REPLACES IT, by frame:
         `.hm-st` badge  `modeled` → `scan`. Four characters stamp the frame
                         permanently on the OLED.
         `.hm-src-val`   the PAIR. No percentage on this plate, ever.
         `.hm-sb`        FRAME M — the market at ITS OWN leverage, welded to
                         that leverage: `MORPHO BLUE · BASE · 6.1% AT 4.10X`.
         the class word  DELETED. Class is a property of the MARKET, not of
                         the composition, and that conflation was the defect.

       `econ.netApyOnDepositApy` is never read on this plate again. The
       composed number lives on the vault plate, the lane header and the
       header hero, and those three are byte-identical.
       ═══════════════════════════════════════════════════════════════════ */
    const pair = String(params.pairLabel ?? "");
    const sub = sourceSubline({
      pair,
      venueId: String(params.venue ?? ""),
      candidateId: String(params.candidateId ?? ""),
      scan: scan ?? null,
      laneLev: ok?.candidate?.economics?.loopLeverage ?? null,
    });
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Market</span>
          {statusBadge(pair ? "pinned" : "empty", "scan")}
        </div>
        <div className="hm-mid hm-mid-src">
          <div className="hm-src-val">{pair || "NO MARKET"}</div>
          <div className="hm-sb">{sub}</div>
        </div>
      </div>
    );
  }

  if (moduleKey === "safety-buffer") {
    const hf = ok?.bands.hf ?? null;
    /* THE SECOND FRAME BUG (§4.5 / rank 5). `mockQuote` sets
       `appliedLeverage = clampLeverage(target, lt)`, but the ECONOMICS run
       through `repriceAtLeverage`, which independently caps at
       `Math.min(applied, L0)`. When L0 < houseMaxLeverage(lt) the two
       diverge — syrupUSDC/USDC at lt 0.92 gives houseMax 3.787 against an L0
       of 3.000 — and the plate printed 3.79x beside an APY computed at
       3.00x. Print the leverage the MODEL ACTUALLY USED. DockReadouts and the
       compose Installed row read the same field, so all three land together
       or a new pair of surfaces disagrees. */
    const modelLev =
      ok?.candidate?.economics?.loopLeverage ??
      ok?.appliedLeverage ??
      (typeof params.targetLeverage === "number" ? params.targetLeverage : 3);
    /* THE STRIP IS HF SPACE (recette 14). It used to be four equal zones with
       a LEVERAGE-positioned marker, which painted the amber zone whenever the
       builder turned the risk dial DOWN. `hfZones` sizes the zones from the
       derived edges and puts the marker at the target, so the two halves of
       the instrument are finally the same quantity. The leverage ceiling tick
       left with it: a leverage cap has no position on an HF axis. */
    /* ⚠ WITHHELD AT NO DEBT (G7 nit, 2026-08-24 — the plate's half of the
       DockReadouts fix). At 1.00x `deriveHfBands` clamps to its sentinel and
       this face printed `HF 10.00` over a full zone strip on a lane that
       borrows nothing, while the dock's HF row on the same screen answered
       "no borrow leg to trim". Same object, same grammar: `liquidationDistance`
       is the derivation the dock, the lane header and the compose control
       read, and where it says `unlevered` there is no band to draw. */
    /* A pinned market with no lending leg (funding/spot rows carry `lt:
       null`, `debtSymbol: ""`) has no borrow leg at ANY leverage — the same
       rule `liquidationLinesOfLane` counts legs by — so the sentinel band
       is withheld there too, not only at 1.00x. */
    const cand = ok?.candidate ?? null;
    const spotOnly = cand != null && (cand.lt == null || !cand.debtSymbol);
    const unlevered = spotOnly || liquidationDistance(cand?.lt, modelLev)?.unlevered === true;
    const strip = unlevered ? null : hfZones(hf);
    /* THE SIGNED LEVERAGE CONTRIBUTION, f_b·(L−1)·s (recette 14) — what the
       levered turns are worth after the escrow, and NEGATIVE on most live
       rows. Composed from the owners rather than re-derived: `grossCarry` is
       L·cy − (L−1)·bo, so G(L) − G(1) is exactly (L−1)·(cy − bo), and f_b
       comes from `escrowShare`, the sole accessor. No component reads a
       carry field. */
    /* f_b = 1 where the lane holds no short — the same branch `notchMove`,
       `composedTerms` and `laneCapacityUsd` take: with no perp margin and no
       reserve every deposited dollar reaches the loop. */
    const fb = hasHedge === false ? 1 : (escrowShare(ok?.candidate, comp)?.fb ?? null);
    const gAtL = grossCarry(ok?.candidate, modelLev);
    const gAt1 = grossCarry(ok?.candidate, 1);
    const leverPp = fb !== null && gAtL !== null && gAt1 !== null ? fb * (gAtL - gAt1) : null;
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>HF band</span>
          {statusBadge(
            "derive",
            unlevered ? "no borrow leg" : hf ? `HF ${(hf.hfTargetBps / 1e4).toFixed(2)}` : "derived",
          )}
        </div>
        <div className="hm-mid">
          <div className="hm-bandw">
            {strip
              ? strip.zones.map((z) => (
                  <span
                    key={z.key}
                    className={`hm-bz${z.key === "trim" ? " warn" : z.key === "open" ? " act" : ""}`}
                    style={{ flex: `0 0 ${z.widthPct}%` }}
                  />
                ))
              : null}
            {strip ? <span className="hm-bmk" data-marker style={{ left: `${strip.markerPct}%` }} /> : null}
          </div>
          <div className="hm-brow hm-brow-hf">
            {(strip?.zones ?? [])
              .filter((z) => z.labelled)
              .map((z) => (
                <span key={z.key} className="hm-bl" style={{ left: `${z.centerPct}%` }}>
                  {z.label}
                </span>
              ))}
          </div>
          <div className="hm-val" data-val>
            {lev(modelLev)}
          </div>
        </div>
        <div className="hm-sb">
          {unlevered
            ? NO_BORROW_BANDS_VALUE
            : leverPp !== null
              ? `${pp(leverPp)} from the levered turns`
              : "hf band derived from leverage"}
        </div>
      </div>
    );
  }

  if (moduleKey === "hedge") {
    /* ⚠ SOLE ACCESSOR. This branch read the raw p25 funding rate straight off
       the compile economics block and applied its own earns/costs verb — the
       call site in the screenshot where one
       hedge "earned 8.7%" on the plate while a tip on the same screen said it
       "cost 7.7pp". Both were true; they were different quantities under one
       verb. The hero is now the NET, character-identical to the tip title,
       which is the only structural guarantee that bug cannot recur here.

       `earns` is banned from this branch, and after this refactor the branch
       has no access to a funding rate to earn anything with: every string
       comes out of one `HedgeEconomics` object.

       The margin gauge left with it (shadow-price R4): `bands.margin` is null
       on 12 of the 15 depositable rows, so its dot was the literal constant
       50 — a 142px instrument whose only moving part was a constant, drawn as
       a green glow in a register where green is semantic. `hedgeBar` takes
       the slot: escrow-plus-drag grows left of zero, funding grows right,
       both in the same neutral ink, and the tick is the plate's whole blue
       budget. A degenerate or unpriced row has no bar and the slot COLLAPSES
       — absence is a mode, never a flat instrument. */
    const h = hedgeEconomics(ok?.candidate, comp);
    const hero = hedgeHeroParts(h);
    const bar = hedgeBar(h);
    /* The escrow figure as the CAPTION, from the owner (`hedgeEscrowCaption`).
       It was rejected as the hero on the ground that it printed the same
       twelve characters on every lane forever; it stopped being a global
       constant when f_b became a function of the hedge dials — and then went
       on printing `25%` anyway, because this branch read the candidate without
       the composition and the live rail's candidate carried the scan's flat
       `F_B`. It reads the lane's dials now, and names both of them. Degenerate
       rows say nothing about the hedge in EITHER direction, so no caption. */
    const caption = hedgeEscrowCaption(h);
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Protection</span>
          {/* Badge stays `neutral` in every state, degenerate included: the
              module is armed and is removing delta, so nothing failed. */}
          {statusBadge("arm", "neutral")}
        </div>
        <div className={`hm-mid${bar ? "" : " hm-mid-src"}`}>
          {bar ? (
            <div className="hm-gauge hx-bar">
              <span className="hx-seg hx-cost" style={{ width: `${bar.costPct}%` }} />
              <span className="hx-seg hx-rev" style={{ width: `${bar.revPct}%` }} />
              <span className="hm-hz" />
              <span className="hx-tick" data-marker style={{ left: `${bar.tickPct}%` }} />
            </div>
          ) : null}
          {/* TWO SPANS: the verb cell is a fixed 5ch so the digits do not
              slide 4.7px sideways when the sign flips between `costs` and
              `pays`. Wordless heroes (`about even`, `—`) take no cell. */}
          <div className="hm-val" data-val>
            {hero.verb ? <i className="hm-verb">{hero.verb}</i> : null}
            <span className="hm-num">{hero.value}</span>
          </div>
          {caption ? <div className="hm-cap">{caption}</div> : null}
        </div>
        {/* ACTUAL first, REQUIRED second: `funding 10.9% p25 · needs 0.7%`. */}
        <div className="hm-sb">{hedgeSubline(h)}</div>
      </div>
    );
  }

  if (moduleKey === "exogenous-risk") {
    /* ══ THE LAMP STRIP — A TRANSPLANT, NOT A DESIGN FROM ZERO ═════════════
       The plate this screen fills is already drawn and already shipped: the
       landing's `data-kind="deps"` hardware module, whose `.hm-deps` /
       `.hm-dep` CSS was extracted into `app/build/hm.css` months ago and has
       never mounted (grep `hm-dep` across the components: zero hits until
       now). Six lamps on the landing, six counterparties from the derivation.
       The artwork predicted the enumeration.

       FOUR THINGS WERE SUBTRACTED FROM IT, each with the law that kills it:

        · the `all clear` badge and its green. `skipBarLabel` already refuses
          that exact sentence, "because a bar stating that we measure
          everything is a completeness claim", and green is strictly semantic
          on this surface. Doubly dead.
        · the `De-risk` key. An action verb claiming a running actuator, on a
          surface whose own `armingState` renders `Automations compile in
          shadow · not armed`.
        · the sub-line `watched as one stack`. It implies we watch all of
          them. We watch some of them, and the strip says WHICH.
        · the landing's infinite lamp walk. A second ambient loop, and worse,
          an animation depicting a scan we do not run.

       NO `.hm-val`, EVER. Every other plate centres a 16px hero; this one's
       loudest resting mark is a 7px dot, which is what makes it subordinate
       by type scale rather than by opacity. There is no scalar it could
       honestly print, and the moment one lands it competes with the spine. */
    const view = watchViewOf({
      candidate: ok?.candidate ?? null,
      placed: hasHedge ? ["hedge", "exogenous-risk"] : ["exogenous-risk"],
      params: { "exogenous-risk": params },
    });
    /* COLUMNS FROM THE MEMBER COUNT, never from the plate width. Six labels
       and five gaps measure 189.9px into a 176.6px interior at IBM Plex Mono
       6.5px, so the landing's flex-wrap widows the sixth onto its own row —
       and a one-item widow does not read as a set. n<=3 is one row; above
       that it is two, and the enumeration is closed at six so it is never
       three. The count does not change on focus: at 340px the plate gains
       SIZE, not a new arrangement. */
    const cols = view.rows.length <= 3 ? Math.max(1, view.rows.length) : Math.ceil(view.rows.length / 2);
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Depends on</span>
          {/* NEVER `.ok`: the badge states whether the parties are NAMED, and
              naming is not an all-clear. */}
          {statusBadge("blind", "named", false)}
        </div>
        <div className="hm-mid">
          <div
            className="hm-deps"
            style={{ "--dep-cols": cols } as React.CSSProperties}
          >
            {view.rows.map((r) => {
              const answered = view.answered.has(r.id);
              return (
                <span
                  key={r.id}
                  className="hm-dep"
                  data-dep
                  data-lamp={lampOf(r, answered)}
                  /* THE DIMENSION THE DIAL MOVES. Separate from `data-lamp` on
                     purpose: the dot says what we read, this says what we
                     answer, and collapsing the two is what froze the strip. */
                  data-answered={answered ? "true" : "false"}
                  title={`${r.party}. ${r.because}`}
                >
                  <i />
                  {LAMP_LABEL[r.id]}
                </span>
              );
            })}
          </div>
        </div>
        {/* The plate names the parties; the register names what would have to
            break. One voice, two altitudes — this line is the hinge. */}
        <div className="hm-sb">what each one has to break</div>
      </div>
    );
  }

  if (moduleKey === "auto-compound") {
    const cadence = String(params.cadence ?? "24h");
    const min = typeof params.minActionUsd === "number" ? params.minActionUsd : 25;
    /* THE ONLY RESULT SLOT PRINTS A RESULT (shadow-price surface 4/5). It
       printed `$10 min` — the harvest threshold, an INPUT, which the builder
       is at that moment holding a number field for two inches below. And the
       sub-line promised a benefit the model scores NEGATIVE on 13 of 13
       accruing rows. `compoundDelta` is signed and both signs occur: the
       recapture lift at n firings a year minus the gas those firings burn.

       The fill bar left with it (R3): `statusBadge` prints the cadence 30px
       above, and the bar re-encoded that same three-valued input as a width.
       Two glyphs for one fact, and neither was a result. */
    const dials = { cadence: cadence as "6h" | "24h" | "72h", minActionUsd: min };
    /* ── THE SEAM IS CLOSED (QNT-R2-1, 2026-09-02) ────────────────────────
       This plate compounded the VENUE core, and the line that stood here
       conceded it verbatim: "R1 compounds the AFTER-FEE base for the PUBLISHED
       number, so this plate's recapture figure is ~20% larger than the
       depositor's". It sized the seam 3-5x too small — `compoundDelta` is
       quadratic in the rate, so scaling the base by 0.8 costs the lift ~36%
       while the gas term is unchanged, and the measured overstatement is
       60-80% on the shipped families (the collar printed +0.65pp against the
       +0.40pp actually inside its published number).

       The hero is the module's WORTH TO THE DEPOSITOR, and only the
       depositor's remainder is ever re-deposited, so it is evaluated at
       `terms.afterFee`. That field, not a local subtraction: `applyComputeFee`
       is forbidden to every reader of the hedge object (`hedge-one-frame`),
       and for the reason that generalizes — the fee reaches an APY once,
       inside `composedTerms`. This hero and the Compose ladder's
       auto-compound rung are now one quantity read from one field, and the
       ladder's fee rung is finally the schedule's own 20%.

       AND THE BASE COMES FROM THE SAME OWNER. The private branch that stood
       here (`hedgeEconomics(...).venue.withoutApy` on an ejected hedge)
       reproduced `composedTerms`' own `core` — one derivation, two spellings,
       and the plate's copy could not see the fee at all. `composedTerms` is
       the owner of both the hedge branch and the fee ordering, so the plate
       asks it. `hasHedge` undefined means the caller does not know yet, and
       `true` is what prices the row as it was repriced — the pre-thread
       behaviour, unchanged.

       `comp?.compound ?? dials`: the lane's composition when the caller passed
       one (it is built from THIS module's params, so the two agree), and this
       plate's own live dials when it did not — never a silent zero. */
    const terms = composedTerms(ok?.candidate, hasHedge !== false, comp);
    // A lane that accrues nothing recaptures nothing; `—`, never a signed
    // zero, which would read as a measurement.
    const delta =
      terms && terms.core > 0 ? compoundDelta(terms.afterFee, comp?.compound ?? dials) : null;
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Recapture</span>
          {statusBadge(cadence, cadence)}
        </div>
        <div className="hm-mid hm-mid-src">
          {/* 2 dp for the same reason the ledger's drag term takes 2 dp: at
              1 dp a −0.07pp result prints −0.1pp, a 43% overstatement of the
              one number whose job is to be visibly small. */}
          <div className="hm-val" data-val>
            {pp(delta, 2)}
          </div>
        </div>
        <div className="hm-sb">net of gas · harvests above ${min}</div>
      </div>
    );
  }

  if (moduleKey === "auto-center") {
    // The range instrument: a track with the position dot held at center
    // (modeled register — the recenter keeps it there).
    const range = String(params.rangePct ?? "2.5");
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Range</span>
          {statusBadge("derive", "in range")}
        </div>
        <div className="hm-mid">
          <div className="hm-gauge">
            <span className="hm-hz" />
            <span className="hm-hdot" data-marker style={{ left: "50%" }} />
          </div>
          <div className="hm-val" data-val>
            ±{range}%
          </div>
        </div>
        <div className="hm-sb">position vs range</div>
      </div>
    );
  }

  if (moduleKey === "covered-call") {
    const strike = String(params.strikePct ?? "15");
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Strike</span>
          {statusBadge("write", "written")}
        </div>
        <div className="hm-mid">
          <div className="hm-gauge">
            <span className="hm-hz" />
            <span className="hm-hdot" data-marker style={{ left: "78%" }} />
          </div>
          <div className="hm-val" data-val>
            +{strike}%
          </div>
        </div>
        <div className="hm-sb">premium is the income</div>
      </div>
    );
  }

  if (moduleKey === "protective-put") {
    const floor = String(params.floorPct ?? "12");
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Floor</span>
          {statusBadge("hold", "held")}
        </div>
        <div className="hm-mid">
          <div className="hm-gauge">
            <span className="hm-hz" />
            <span className="hm-hdot" data-marker style={{ left: "22%" }} />
          </div>
          {/* U+2212, not a hyphen: mono digits and a hyphen misalign in a
              tabular column, and this plate sits in one. */}
          <div className="hm-val" data-val>
            {MINUS}
            {floor}%
          </div>
        </div>
        <div className="hm-sb">the floor pays if it breaks</div>
      </div>
    );
  }

  if (moduleKey === "redemption-route") {
    /* THE WAIT IS THE RESULT. The route is the input the builder just chose;
       what the lane gains from choosing it is the number of days its capital
       is not cash, which is exactly what `windowCost` prices and what the
       router nets a move against. `stated` and never `measured`: it is the
       issuer's own published window (H-7), not a reading of ours. */
    const days = typeof params.settlementDays === "number" ? params.settlementDays : 0;
    const route = String(params.exitPath ?? "issuer-wire");
    const label = EXIT_ROUTE_OPTIONS.find((o) => o.value === route)?.label ?? route;
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Exit</span>
          {statusBadge("stated", label)}
        </div>
        <div className="hm-mid">
          <div className="hm-val" data-val>
            {days === 1 ? "1 day" : `${days} days`}
          </div>
        </div>
        <div className="hm-sb">request to cash</div>
      </div>
    );
  }

  return null;
}
