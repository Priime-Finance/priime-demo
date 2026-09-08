/**
 * Mock quote synthesis (mockup register).
 *
 * The canvas is a product mockup: every picked market prices. When the live
 * reprice rail serves a quote it wins; otherwise (non-launchable venue, rail
 * failure) the latest catalog scan row prices the lane client-side through
 * the same band-derivation functions the rail uses. No failure states ever
 * render on the canvas.
 *
 * MODEL FIXES 2026-08-21 (tips spec §A, both P0 and both shipped-product
 * bugs independent of the tip layer):
 *
 *  A1 — `composedNetApy` used to subtract only the funding term when the
 *       hedge module is absent. The model (simulate-v2.ts:259/:345) says
 *       removing the hedge does THREE things: it drops F_B·funding, it
 *       releases the 25% HL margin escrow (f_b → 1) and it drops exec drag
 *       from EXEC_DRAG_APR to EXEC_DRAG_UNHEDGED. The hedgeless branch now
 *       reproduces the model's own N1 arithmetic from the row's economics,
 *       which also makes the hedge's value SIGNED (it is worth −12.6pp on
 *       the Dolomite iBERA/oriBGT row).
 *
 *  A2 — `mockQuote` handed `hit.row` back untouched, so on every
 *       mock-priced lane the risk dial moved the leverage and the headline
 *       APY did not move at all. It now recomputes the economics affinely
 *       at the lane's applied leverage, and rescales the two
 *       leverage-dependent capacity bounds with it.
 *
 * MODEL FIXES 2026-08-22 (recette build items 1, 3, 4 — A2, A4, A10, A13,
 * A16). Three constants that were pretending to be model terms became
 * functions of the dials that name them:
 *
 *  A2/A4 — `f_b` was the flat 0.75 (`simulate.ts:28`, and the local `fb`
 *       here). It is `L_h/(L_h + 1 + r·L_h)`: both `hedgeLeverage` and
 *       `reserveFraction` are real terms of it, and both dials were dead.
 *       At the shipped default composition f_b is 0.6977, not 0.75, so
 *       every hedged lane over-advertised by ~7% relative. `fB()` below is
 *       the only definition. The early "leverage did not move, return the
 *       row untouched" bail is GONE with it: the composition can change the
 *       price at a fixed L, so the reprice is never a no-op.
 *
 *  A13 — `deltaBandPct` (the hedge's rebalance band, hard-coded 0.5 in
 *       `lib/vaults/store.ts:478` and exposed on no dial) is the dominant
 *       term inside the flat `EXEC_DRAG_APR`. `execDragApr()` splits that
 *       constant into the band-independent loop-side floor the model
 *       already ships (`EXEC_DRAG_UNHEDGED`) plus a hedge-rebalance term
 *       that scales as (1/band)², calibrated to reproduce `EXEC_DRAG_APR`
 *       EXACTLY at the shipped 0.5 band. Tightening the band now costs APY.
 *
 *  A10 — `auto-compound` had real, signed, size-dependent economics modelled
 *       as exactly zero, so both its dials were dead. `compoundDelta()`
 *       prices it: the recapture lift at N firings a year MINUS the gas
 *       those firings burn. Both signs occur. Adding a module that costs
 *       money must reprice the lane downward.
 *
 *  A16 — the direct carry form. `grossCarry(c, L) = L·cy − (L−1)·bo` is
 *       computed from `collateralYieldApy` and `borrowApyMarginal`, never
 *       backed out as `netCarry − funding + drag`. The direct form has no
 *       funding dependency, so it survives a re-basing of `fundingP25Apr`
 *       (which the template rows already abuse as a hedge-cost field).
 *
 * DIVERGENCE, DELIBERATE: the scanner's `simulate.ts` still exports
 * the constant `F_B = 0.75` and still uses it in `capacityModel` and
 * `yieldModel`. That file drives REAL vault math on the launch rail and is
 * out of scope for the canvas recette; the canvas mirror is the only place
 * `f_b` is a function of the hedge dials today. Anyone reconciling the two
 * should port `fB()` INTO `simulate.ts` rather than re-deriving it here.
 *
 * CONTRACT (one frame, 2026-08-23): a lane is priced in ONE place,
 * `repriceAtLeverage`, at the lane's composed escrow share `fB(L_h, r)`.
 * The catalog row enters through `mockQuote`; the live rail's row enters
 * through `laneQuote`. No surface reads a candidate that has not been through
 * it, and the server never prices a lane — it serves the market's row at its
 * own ceiling (see `app/api/canvas/reprice/route.ts`).
 *
 * CONTRACT (§A3): every number the tip layer prints must come out of
 * `composedNetApy` / `candidateApy` / `hedgeValue` — the same functions the
 * header calls. Tip and header must be incapable of disagreeing.
 *
 * CONTRACT (hedge quantities, 2026-08-22): `lib/canvas/hedge-econ.ts` is the
 * SOLE accessor for hedge quantities on every surface — what the hedge is
 * worth, its hero number, its subline, its sentence, its arrow. Surfaces
 * call `hedge-econ`; `hedge-econ` calls the functions below. Do not add a
 * second hedge accessor here and do not let a component reach past
 * `hedge-econ` into `hedgeValue`/`hedgelessApy` directly.
 */

import type { OpportunitiesPayload, RepriceData } from "@/components/canvas/types";
import type { ProjectedCandidate } from "./opportunities";
import { computeFeeTerm } from "./fees";
import { EXEC_DRAG_APR, EXEC_DRAG_UNHEDGED, F_B } from "@/lib/model-constants";
import { derivedDeltaBandPct, MODULE_DEFS } from "./modules";
import { isHandAuthored, type ModuleKey } from "./types";
import {
  clampLeverage,
  deriveHfBands,
  MIN_DEPOSIT_USD,
  PRODUCT_MIN_LEVERAGE,
  type RiskPreset,
} from "./param-schema";

export interface CatalogHit {
  row: ProjectedCandidate;
  blockNumber: number;
}

/**
 * The composition the lane is actually priced at: the dials of the optional
 * modules that carry economics. Structurally the `{ hedge, compound }` half
 * of `pricingParamsFor(loop)` (RackCanvas), so a caller passes that object
 * straight through. `null` on a member means the module is NOT installed.
 */
export interface LaneComposition {
  hedge: {
    hedgeLeverage: number;
    reserveFraction: number;
    /** Rebalance band, percent of notional. The descriptor is `segmented`,
     *  so its raw param value is the STRING "0.25" | "0.5" | "1.0"; both
     *  forms are accepted here so no caller has to pre-coerce. */
    deltaBandPct?: number | string;
  } | null;
  compound: {
    cadence: "6h" | "24h" | "72h";
    minActionUsd: number;
  } | null;
}

// ── Module defaults ───────────────────────────────────────────────────────
//
// Read from MODULE_DEFS, never re-typed: the descriptor's `default` IS the
// default composition, so a dial whose default moves moves the price with
// it. The `fallback` argument is only reached if a descriptor is deleted.

function moduleDefaultNumber(key: ModuleKey, field: string, fallback: number): number {
  const d = MODULE_DEFS[key]?.params.find((p) => p.field === field)?.default;
  return typeof d === "number" && Number.isFinite(d) ? d : fallback;
}

function moduleDefaultString(key: ModuleKey, field: string, fallback: string): string {
  const d = MODULE_DEFS[key]?.params.find((p) => p.field === field)?.default;
  return typeof d === "string" ? d : fallback;
}

/** Modeled house constants. Not dials; each cites its shipped source. */
const MODELED = {
  /** lib/backtest/presets.ts:63 — gas per automated action, USD. */
  gasPerActionUsd: 0.5,
  /** lib/vaults/store.ts:400 — the seed TVL every published vault gets.
   *  The compound model's only size input; below it the harvest threshold
   *  binds and above it the cadence does. */
  refTvlUsd: 25_000,
  /** lib/vaults/store.ts:478 — the delta band the product shipped before it
   *  was a dial, and therefore the band `EXEC_DRAG_APR` was measured at.
   *  The exec-drag curve is calibrated to reproduce EXEC_DRAG_APR exactly
   *  here. This is a historical fact about the constant, NOT the descriptor
   *  default: if the dial's default moves, the anchor does not. */
  calibrationBandPct: 0.5,
} as const;

const CADENCE_HOURS: Record<string, number> = { "6h": 6, "24h": 24, "72h": 72 };

// ── f_b: the share of deposit that reaches the loop ───────────────────────

/**
 * `f_b(L_h, r) = L_h / (L_h + 1 + r·L_h)` (A2).
 *
 * Every dollar of deposit splits three ways: the loop leg, the perp margin
 * it takes to short that loop's collateral at `L_h`, and the idle reserve
 * `r` held against that margin. Per dollar of loop notional the hedge costs
 * `1/L_h` of margin and `r` of reserve, so the loop's share is
 * `1 / (1 + 1/L_h + r)` = the form above.
 *
 * At the shipped default composition (3, 0.15) this is 0.6742. The constant
 * it replaces was 0.75 — `L_h/(L_h+1)` with the reserve term simply dropped,
 * which is why every hedged lane over-advertised by about 11% relative.
 */
export function fB(hedgeLeverage: number, reserveFraction: number): number {
  const lh = Number.isFinite(hedgeLeverage) && hedgeLeverage > 0 ? hedgeLeverage : 1;
  const r = Number.isFinite(reserveFraction) && reserveFraction > 0 ? reserveFraction : 0;
  return lh / (lh + 1 + r * lh);
}

/**
 * f_b at the composition the lane is actually running, defaulting to the
 * hedge descriptor's own dials when a dial was not threaded through.
 *
 * ONE DERIVATION (R5 grep, 2026-08-22). This was module-private, and
 * `hedge-econ.escrowShare` carried a second copy of the same three lines
 * with its own private `moduleDefaultNumber` — the docblock there said it
 * "mirrors" this function, and a mirror is a second derivation. The two
 * copies had already drifted: this one still defaulted `reserveFraction` to
 * the RETIRED 0.10 (f_b 0.6977) while `escrowShare` had been moved to the
 * ratified 0.15 (f_b 0.6742), so a lane whose hedge dials were not threaded
 * through was priced at one escrow and explained at another, 3.4% apart on
 * the same screen. `escrowShare` now calls this; nothing else derives f_b
 * from a composition.
 *
 * The fallback literals are only reached if a descriptor is deleted outright.
 */
export function fbForComposition(comp: LaneComposition | null | undefined): number {
  const { hedgeLeverage, reserveFraction } = hedgeDialsFor(comp);
  return fB(hedgeLeverage, reserveFraction);
}

/**
 * The two hedge dials a composition prices at — the lane's own where it has
 * them, the descriptor's defaults where it does not. The one reader of those
 * defaults; `fbForComposition` and `hedge-econ`'s escrow split both read it,
 * so the share and its decomposition cannot come from two different dials.
 */
export function hedgeDialsFor(
  comp: LaneComposition | null | undefined,
): { hedgeLeverage: number; reserveFraction: number } {
  return {
    hedgeLeverage: comp?.hedge?.hedgeLeverage ?? moduleDefaultNumber("hedge", "hedgeLeverage", 3),
    reserveFraction: comp?.hedge?.reserveFraction ?? moduleDefaultNumber("hedge", "reserveFraction", 0.15),
  };
}

/** In-module spelling of `fbForComposition`. */
const fBFor = fbForComposition;

/**
 * THE COMPOSITION A ROW IS PRICED AT BEFORE A LANE EXISTS: the hedge
 * descriptor's own dials (which `fbForComposition` reads when no dial is
 * threaded) and no compound module. `mockQuote(hit, L, preset)` with no
 * `comp` prices at exactly this, so a catalog surface that states a row's
 * deposit room beside that APY must state it at this composition too —
 * otherwise one card carries two compositions: its APY at the lane's default
 * escrow and its room at the scan's constant. Measured on the discover panel
 * before this existed: the lending kHYPE card said `$10.5K in the HYPE perp
 * book` and the funding kHYPE card said `$11.6K in the HYPE perp book`, one
 * book, one measured notional, two escrow shares (0.75 against 0.6742).
 */
export const CATALOG_COMPOSITION: LaneComposition = { hedge: null, compound: null };

// ── Execution drag: a function of the delta band (A13) ────────────────────

/**
 * `execDragApr(band)` — the hedged lane's execution drag on equity APR.
 *
 * Two terms, both anchored on constants the model already ships:
 *
 *   • a band-INDEPENDENT floor = `EXEC_DRAG_UNHEDGED` (0.40%). This is the
 *     drag the model charges a lane with no perp leg at all, i.e. the
 *     loop-side supply/borrow/rebalance cost, which no delta band touches.
 *
 *   • a hedge-rebalance term. Rebalances per unit time go as (σ/band)², so
 *     the term goes as (1/band)². It is calibrated so that at the shipped
 *     band (0.5) the total is EXACTLY `EXEC_DRAG_APR` (0.75%) — the number
 *     every current quote already carries. Nothing moves at the default;
 *     0.25 costs ~1.80% and 1.0 costs ~0.49%.
 */
export function execDragApr(deltaBandPct?: number | string | null): number {
  const raw = typeof deltaBandPct === "string" ? Number(deltaBandPct) : deltaBandPct;
  const fallback = Number(moduleDefaultString("hedge", "deltaBandPct", "0.5"));
  const band =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0
      ? raw
      : Number.isFinite(fallback) && fallback > 0
        ? fallback
        : MODELED.calibrationBandPct;
  const rebalanceTermAtCalibration = EXEC_DRAG_APR - EXEC_DRAG_UNHEDGED;
  const scale = (MODELED.calibrationBandPct / band) ** 2;
  return EXEC_DRAG_UNHEDGED + rebalanceTermAtCalibration * scale;
}

/**
 * THE DRAG A COMPOSITION IS CHARGED — the one resolver of the band (QNT-2,
 * 2026-09-01).
 *
 * The `deltaBandPct` dial is retired (modules.ts R1), so a real lane's
 * composition never carries the field, and this function used to read it,
 * miss, and fall to the calibration band — the FLAT `EXEC_DRAG_APR`. The
 * publish path then froze that flat-drag price into a record whose
 * `deltaBandPct` field states the DERIVED band (`publishedModelRecord`):
 * the flagship record stored band 4 and a 2.1013% model, while the same
 * dials recompute to 2.2900% at the band the record itself states. One
 * drag, two owners.
 *
 * So the band is resolved here, once, the same way the record states it:
 *
 *   · an EXPLICIT `deltaBandPct` on the composition wins (fixtures, and any
 *     stored record replayed as a composition);
 *   · a hedge module with no band prices at `derivedDeltaBandPct` over the
 *     composition's own f_b at the reference TVL — `MODELED.refTvlUsd`,
 *     the same 25,000 `publishedModelRecord`'s `openingTvlUsd` defaults to,
 *     so publish-time pricing and the frozen band cannot disagree;
 *   · no hedge module means no lane band exists: the catalog register keeps
 *     the calibration band, which is the scan's own flat constant. Cards
 *     stay byte-identical to the scanner that priced them.
 */
export function execDragFor(comp: LaneComposition | null | undefined): number {
  const band = laneDeltaBandPct(comp);
  return band === null ? execDragApr(null) : execDragApr(band);
}

/**
 * The band a hedged composition is PRICED at — the same resolution
 * `execDragFor` runs, exposed so a record writer can state the band its own
 * number was computed at instead of deriving a second copy (frozen-record
 * migration, 2026-09-01). Null when the composition holds no hedge module:
 * no lane band exists there, and `execDragFor` charges the calibration flat.
 */
export function laneDeltaBandPct(comp: LaneComposition | null | undefined): number | null {
  const hedge = comp?.hedge;
  if (!hedge) return null;
  const raw = typeof hedge.deltaBandPct === "string" ? Number(hedge.deltaBandPct) : hedge.deltaBandPct;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : derivedDeltaBandPct(fbForComposition(comp), MODELED.refTvlUsd);
}

// ── Auto-compound: signed, size-dependent (A10) ───────────────────────────

/**
 * `compoundDelta(r, dials)` — what auto-compound is WORTH, signed.
 *
 * Firings a year are the smaller of what the cadence permits and what the
 * accrual can actually fund at the harvest threshold:
 *
 *   n = min(8760 / cadenceHours, TVL·r / minActionUsd)
 *
 * The recapture lift is the gap between compounding n times and not
 * compounding at all, `(1 + r/n)^n − 1 − r`; the cost is the gas those n
 * firings burn, `n · gasPerAction / TVL`. At r = 8.8% and daily firing the
 * lift is +0.396pp, which is the number the recette measured.
 *
 * Returns 0 when the module is not installed, and 0 when the lane accrues
 * nothing to recapture (a negative-carry lane never fires the rule).
 */
export function compoundDelta(
  netApr: number,
  dials: LaneComposition["compound"] | null | undefined,
  tvlUsd: number = MODELED.refTvlUsd,
): number {
  if (!dials) return 0;
  const r = netApr;
  if (!Number.isFinite(r) || r <= 0) return 0;
  const tvl = Number.isFinite(tvlUsd) && tvlUsd > 0 ? tvlUsd : MODELED.refTvlUsd;

  const cadenceKey = dials.cadence ?? moduleDefaultString("auto-compound", "cadence", "24h");
  const cadenceH = CADENCE_HOURS[cadenceKey] ?? 24;
  const threshold =
    Number.isFinite(dials.minActionUsd) && dials.minActionUsd > 0
      ? dials.minActionUsd
      : moduleDefaultNumber("auto-compound", "minActionUsd", 25);

  const byCadence = (365 * 24) / cadenceH;
  const byAccrual = (tvl * r) / threshold;
  const n = Math.max(0, Math.min(byCadence, byAccrual));

  // Below one firing a year nothing is compounded inside the horizon; the
  // partial expectation of the gas still lands.
  const lift = n >= 1 ? (1 + r / n) ** n - 1 - r : 0;
  const gas = (n * MODELED.gasPerActionUsd) / tvl;
  return lift - gas;
}

/** Find a candidate row (and its venue's block pin) in the lifted catalog. */
export function catalogRow(opp: OpportunitiesPayload | null, candidateId: string): CatalogHit | null {
  if (!opp || !candidateId) return null;
  for (const v of opp.venues) {
    const row = v.hedged.concat(v.unhedged).find((c) => c.id === candidateId);
    if (row) return { row, blockNumber: v.blockNumber };
  }
  return null;
}

/**
 * The DIRECT gross carry on equity at leverage L (A16).
 *
 * `L·cy − (L−1)·bo`, straight off `collateralYieldApy` and
 * `borrowApyMarginal`. Never reconstructed as `netCarry − funding + drag`:
 * that indirect form silently depends on `fundingP25Apr`, a field the
 * template rows already repurpose as an all-in hedge cost (E3), so the
 * reconstruction breaks the moment that field is re-based. Returns null when
 * the row carries no economics or no usable leverage.
 */
export function grossCarry(c: ProjectedCandidate | null | undefined, leverage: number): number | null {
  const e = c?.economics;
  if (!e) return null;
  const L = leverage;
  if (!Number.isFinite(L) || L <= 0) return null;
  return L * e.collateralYieldApy - (L - 1) * e.borrowApyMarginal;
}

/**
 * Reprice a catalog row's economics at a different leverage AND a different
 * composition (A2, A4, A13).
 *
 * The carry is AFFINE in L, so this is the model's own arithmetic, not a new
 * one: class A keeps the funding leg and multiplies through the f_b escrow,
 * class N1 runs f_b = 1 against the unhedged drag. Capacity's two
 * leverage-dependent bounds (debt borrow liquidity ∝ 1/(L−1), collateral cap
 * ∝ 1/L) rescale from the row's own binding value; the two HL bounds (OI,
 * book depth) are leverage-INDEPENDENT and are left exactly where the scan
 * put them — but they DO move with f_b, which is capacity.ts's call, not
 * this function's.
 *
 * `comp` carries the hedge dials. Omitted, it falls back to the module
 * descriptor defaults, which is what the scan itself assumed.
 */
export function repriceAtLeverage(
  row: ProjectedCandidate,
  appliedLeverage: number,
  comp?: LaneComposition | null,
): ProjectedCandidate {
  const e = row.economics;
  /**
   * A2 WAS HALF-LANDED HERE (found 2026-08-22, flagged by the discover wave).
   *
   * This guard read `appliedLeverage <= 1`. Every other owner moved to
   * `PRODUCT_MIN_LEVERAGE = 1` — `clampLeverage`, `deriveLeverageBounds`, the
   * `targetLeverage` descriptor, `hfTargetBpsFor` — so the dial offered 1.00x
   * and this function silently REFUSED it, returning the row un-repriced at
   * the scan's own leverage. Silently is the operative word: it did not throw
   * and it did not blank, it answered a different question.
   *
   * Measured on the live catalog, syrupUSDC/GHO (scan L0 = 3):
   *     asked 1.00x -> applied 3.00x, −44.7%     ← the top of the range
   *     asked 1.05x -> applied 1.05x, +3.1%
   *     asked 1.25x -> applied 1.25x, −1.8%
   * The affine slope is −24.5pp per 1.0x, so the true value at 1.00x is about
   * +4.3%. The dial's floor stop printed the WORST number on the curve while
   * standing on the best one, and it was the exact number the max stop
   * printed — the two ends of the dial reading identically is the visible
   * symptom anyone would have reported.
   *
   * The real reason a guard was here at all is the capacity branch below:
   * at L = 1 the debt-borrow-liquidity denominator `(L−1)·f_b` is zero. That
   * is handled where it happens, not by refusing the whole reprice.
   */
  if (!e || !Number.isFinite(appliedLeverage) || appliedLeverage < PRODUCT_MIN_LEVERAGE) return row;
  const L0 = e.loopLeverage;
  if (!Number.isFinite(L0)) return row;
  if (L0 <= 1) {
    /* A FUNDING-CLASS SCAN ROW REPRICES AT THE LANE'S OWN DRAG (QNT-2,
       2026-09-01). This bail used to be total, which was right for the two
       hand-authored template rows (one figure at one composition, no
       arithmetic to re-run) and WRONG for the funding venue's rows: class A,
       borrows nothing, L0 = 1, and every economic term raw on the row. A
       rack-composed funding lane therefore kept the SCANNER's flat drag
       while `publishedModelRecord` froze the derived band beside it — the
       same two-owner defect as the loop path, one venue over.

       The recompute is the class-A identity at L = 1 (no borrow leg):
       netCarry = cy + f − drag, netApy = f_b · netCarry. Only the two rates
       and the drag field move; capacity is a venue-frame bound
       (`laneCapacityUsd` owns its conversion) and stays verbatim.

       Gated on `comp?.hedge`: a card surface passes no composition and keeps
       the scanner's row byte-identical — the catalog register — and a
       hedge-ejected lane prices on `hedgelessApy`, never through here. */
    if (isHandAuthored(e) || row.cls !== "A" || !comp?.hedge) return row;
    const drag = execDragFor(comp);
    const carry = e.collateralYieldApy + (e.fundingP25Apr ?? 0) - drag;
    const apy = fBFor(comp) * carry;
    return {
      ...row,
      headlineApr: typeof row.headlineApr === "number" ? apy : row.headlineApr,
      economics: {
        ...e,
        executionDragApr: drag,
        netCarryOnEquityApy: carry,
        netApyOnDepositApy: apy,
      },
    };
  }
  // The scan's own L IS the house ceiling for this row: class A opens at
  // houseMaxLeverage(lt), class N1 at n1Leverage() with the basis-sizing
  // term baked in (simulate-v2.ts:345 — `Math.min(targetLeverage, houseL)`).
  // The dial may only ever go SAFER than what the scan already allowed, and
  // the N1 basis cap is not projected, so it can only come from L0.
  const L = Math.min(appliedLeverage, L0);
  // NOTE: no "L unchanged, bail" shortcut. f_b and the exec drag are now
  // functions of the hedge dials, so the composition can move the price at a
  // fixed L. Bailing here is what made both hedge dials dead (A2).

  const funding = e.fundingP25Apr ?? 0;
  const hedged = row.cls === "A";
  const fb = hedged ? fBFor(comp) : 1;
  const gross = L * e.collateralYieldApy - (L - 1) * e.borrowApyMarginal;
  const netCarry = hedged
    ? gross + funding - execDragFor(comp)
    : gross - EXEC_DRAG_UNHEDGED;
  const netApy = fb * netCarry;

  // Capacity: invert the row's binding bound back to its numerator, then
  // re-divide at the new L. Only the two venue-side bounds move with L.
  // The scan divided by the constant 0.75, so the numerator is recovered
  // with the scan's own f_b and re-divided with the lane's.
  let capacityUsd = e.capacityUsd;
  const binding = e.capacityBinding;
  // simulate.ts:28 — the flat 0.75 the scan itself divided by (capacityModel
  // bounds A and B). Recovering the numerator must use the scan's constant,
  // NOT the lane's f_b, or the composition would cancel out of capacity.
  const fbScan = hedged ? F_B : 1;
  if (binding === "debt borrow liquidity") {
    // L = 1 BORROWS NOTHING, so this bound is vacuous and its denominator is
    // zero. Dividing would advertise Infinity — the single worst answer a
    // capacity can give. What actually limits an unlevered deposit is the
    // collateral side, and this row's scan never measured it (that is what
    // "binding = debt borrow liquidity" means). So the reprice keeps the
    // scan's own conservative FLOOR — the L0 denominator — for a borrow-bound
    // row, capacity at L = 1 is strictly HIGHER than at L0 > 1, so holding
    // that floor UNDERSTATES the room. Understating is the safe direction and
    // the one `fmtCapacityUsd`'s flooring law already commits the product to.
    //
    // BUT THE FLOOR IS RESTATED AT THE LANE'S f_b (recette W2-04, 2026-08-23).
    // This branch used to keep `e.capacityUsd` VERBATIM at L = 1 — a number
    // divided by the scan's 0.75 — while the rates three lines up were being
    // re-denominated at the lane's f_b. `capacity.ts`'s `statedFb` recovers a
    // venue-side bound's frame from those REPRICED rates, so it read 0.6742
    // off a 0.75-stated capacity and `laneCapacityUsd` multiplied the wrong
    // frame through: a hedge-ejected kHYPE lane at 1.00x printed $286,378
    // where the intended floor is $318,596 — exactly −10.1%, a number that
    // traces to NO formula. One denominator choice below (`L0 − 1` where the
    // real one is vacuous), one frame everywhere: the repriced object is now
    // self-consistent, and every downstream conversion goes through the one
    // capacity owner.
    const availBorrow = e.capacityUsd * ((L0 - 1) * fbScan);
    capacityUsd = availBorrow / ((L > 1 ? L - 1 : L0 - 1) * fb);
  } else if (binding === "collateral cap/concentration" || binding === "collateral supply cap") {
    const headroom = e.capacityUsd * (L0 * fbScan);
    capacityUsd = headroom / (L * fb);
  }

  const targetLtv = 1 - 1 / L;
  return {
    ...row,
    headlineApr: row.cls === "N1" ? row.headlineApr : netApy,
    economics: {
      ...e,
      loopLeverage: L,
      targetLtv,
      netCarryOnEquityApy: netCarry,
      netApyOnDepositApy: netApy,
      capacityUsd: Math.max(0, Math.round(capacityUsd)),
    },
  };
}

/** Synthesize an ok-shaped quote from a catalog row (client-side, modeled). */
export function mockQuote(
  hit: CatalogHit,
  targetLeverage: number,
  riskPreset: RiskPreset,
  comp?: LaneComposition | null,
): RepriceData {
  const lt = typeof hit.row.lt === "number" && hit.row.lt > 0 ? hit.row.lt : 0.86;
  // The house cap is preset-aware since the founder ruling of 2026-08-21 (the
  // preset sets the trim gap, and the cap is the leverage whose trim trigger
  // sits at HF 1.25). Clamping with the default preset while deriving the band
  // with the lane's would let a conservative lane hold a leverage its own
  // ceiling forbids.
  const applied = clampLeverage(targetLeverage, lt, riskPreset);
  return {
    ok: true,
    repricedAtMs: Date.now(),
    blockNumber: hit.blockNumber,
    // A2: the dial is a live economic instrument on mock-priced lanes too,
    // and so are both hedge dials.
    candidate: repriceAtLeverage(hit.row, applied, comp),
    requestedLeverage: targetLeverage,
    appliedLeverage: applied,
    // A1 (build item 1): the band is derived FROM the position it describes,
    // never from the preset alone. hfTarget = lt·L/(L−1).
    bands: { hf: deriveHfBands(riskPreset, applied, lt), margin: null },
    // B10: one minimum deposit, owned by param-schema.
    minDepositUsd: MIN_DEPOSIT_USD,
    violations: [],
  };
}

/**
 * THE LIVE RAIL'S ANSWER, PRICED AS THIS LANE (2026-08-23).
 *
 * `/api/canvas/reprice` serves the market's ROW — the live pair evaluated
 * exactly as the catalog scan evaluates it, at the market's own ceiling, in
 * the scan frame (`F_B`). It is the same kind of object `mockQuote` prices
 * from, one block fresher, and it goes through the same door: this function
 * is `mockQuote` for a quote that arrived with its bands already validated.
 *
 * WHAT THIS REPLACED. The route used to evaluate at the lane's leverage and
 * the client printed `candidate.economics.netApyOnDepositApy` as the header,
 * bridge end and hedge plate — the scan's flat `F_B = 0.75` — while every
 * other surface priced the lane here at the composed `fB(L_h, r)` (0.6742 at
 * the shipped dials). Measured: kHYPE/WHYPE at 1.00x, header 9.1% over a
 * capsule lit cell of 8.2%, ratio 1.1125 = 0.75 / 0.6742 exactly; wstETH/WETH
 * at 2.75x, 5.2% over 4.6%. The server's number was the market at a constant
 * nobody on the lane had dialled.
 *
 * Now there is ONE place a lane is priced — `repriceAtLeverage` — and the
 * live rail and the catalog both feed it rows. `appliedLeverage` is the
 * server's own statement of the position its bands were validated at, so the
 * candidate is priced at exactly that leverage and the band and the number
 * describe one position.
 */
export function laneQuote(
  server: Extract<RepriceData, { ok: true }>,
  comp?: LaneComposition | null,
): RepriceData {
  const row = server.candidate;
  if (!row) return server;
  const L = server.appliedLeverage ?? row.economics?.loopLeverage ?? PRODUCT_MIN_LEVERAGE;
  return { ...server, candidate: repriceAtLeverage(row, L, comp) };
}

/** The lane-displayable modeled APY from an ok quote's candidate. */
export function candidateApy(c: ProjectedCandidate | null | undefined): number | null {
  if (!c) return null;
  return c.economics?.netApyOnDepositApy ?? c.headlineApr ?? null;
}

/**
 * The same lane WITHOUT the short leg (A1).
 *
 * Ejecting the hedge removes the funding carry, releases the HL margin
 * escrow (f_b → 1) and drops exec drag to EXEC_DRAG_UNHEDGED — the model's
 * class-N1 branch, evaluated at the row's own applied leverage. Null when
 * the row carries no economics to evaluate.
 */
export function hedgelessApy(c: ProjectedCandidate | null | undefined): number | null {
  const e = c?.economics;
  if (!e || !c) return null;
  // A hand-authored row (templates.ts) has no borrow leg, no HL escrow and no
  // exec drag behind its numbers, so none of the loop arithmetic below means
  // anything on it. Its family model states the hedgeless figure outright and
  // that number is the answer.
  //
  // TWO CHANGES HERE (R5 grep, 2026-08-22), both closing wave-2b handoff #1:
  //
  //  1. The branch is taken on the ECONOMICS MODEL FLAG, not on a venue-name
  //     match. `isTemplateVenue` was the last venue-name test on this path,
  //     and it decides arithmetic, so a new hand-authored venue would have
  //     silently fallen into the loop branch.
  //
  //  2. It reads `terms.hedgelessApy` instead of subtracting `fundingP25Apr`.
  //     Wave 2b correctly moved the dn-lp hedge cost OUT of `fundingP25Apr`
  //     (it is a leg on `lpDeltaShare` of notional, not a loop's p25 funding)
  //     and left the field null — at which point this branch returned
  //     `netApyOnDepositApy` UNCHANGED, i.e. it priced ejecting the hedge at
  //     exactly zero. The model says the hedge is worth +0.64pp on that row.
  //     A surface offering "remove the hedge, +0.0pp" is the same defect as
  //     "remove the hedge, +9.5pp" one order quieter: it still fails to say
  //     that deletion costs something.
  if (isHandAuthored(e)) {
    const stated = (e as { terms?: { hedgelessApy?: number | null } }).terms?.hedgelessApy;
    if (typeof stated === "number" && Number.isFinite(stated)) return stated;
    // No stated hedgeless figure: the funding field is the whole hedge story.
    const f = e.fundingP25Apr;
    return f === null || f === 0 ? e.netApyOnDepositApy : e.netApyOnDepositApy - f;
  }
  const gross = grossCarry(c, e.loopLeverage);
  if (gross === null) return null;
  return gross - EXEC_DRAG_UNHEDGED;
}

/**
 * What the hedge is WORTH on this lane, signed (A1). Positive means the
 * funding leg pays for its escrow and drag; negative means it does not —
 * true on three Dolomite rows today, which is why tip B7 is bidirectional.
 * Null when either side has no honest number.
 *
 * Surfaces do not call this directly: `lib/canvas/hedge-econ.ts` is the sole
 * accessor for hedge quantities.
 */
export function hedgeValue(c: ProjectedCandidate | null | undefined): number | null {
  const withHedge = candidateApy(c);
  const without = hedgelessApy(c);
  if (withHedge === null || without === null) return null;
  return withHedge - without;
}

// ── The hand-authored composition gate (P0-8) ─────────────────────────────

/**
 * Is the row's number true of the lane the caller is holding?
 *
 * A SCAN row is a market, and its arithmetic is re-derived from the market's
 * own terms at whatever leverage and composition the lane runs — every branch
 * above does exactly that, which is why a partial loop lane already prices
 * honestly. A HAND-AUTHORED row is not a market: it is one figure computed
 * once, at one composition, by `collarModel` or `dnLpModel`. There is no
 * arithmetic to re-run when a leg is missing, only a number that was true of a
 * different machine.
 *
 * So the row states the composition it was priced at (`terms.requires`) and
 * this checks the lane against it. Measured, before the gate: all three
 * partial collar states printed **+11.826%**, the figure for a collar that has
 * both option legs, and `{liquidity-source, auto-center}` printed **+3.229%**
 * for a position that is fully long ETH with no short anywhere on it.
 *
 * `placed` is what the caller knows about the rack. **Absent means unchecked**,
 * which is what keeps every current caller (the catalog card previews, the
 * seed checks, `unified-list`) pricing the whole row exactly as before — those
 * callers are describing the template row itself, not a lane. Every caller
 * that IS describing a lane must pass the lane's module keys; see the handoff
 * note on `composedNetApy`.
 */
function composedHere(
  c: ProjectedCandidate | null | undefined,
  placed: readonly ModuleKey[] | null | undefined,
): boolean {
  const e = c?.economics;
  if (!e || !isHandAuthored(e)) return true; // a scan row re-derives; not this gate's business
  if (!placed) return true; // the caller did not state a lane
  const groups = (e as { terms?: { requires?: readonly (readonly ModuleKey[])[] } }).terms?.requires;
  // A hand-authored row that does not state its own composition cannot prove
  // the number belongs to this lane, and a surface that cannot prove its
  // arithmetic prints nothing.
  if (!Array.isArray(groups) || groups.length === 0) return false;
  const have = new Set<ModuleKey>(placed);
  return (groups as readonly (readonly ModuleKey[])[]).every((group) =>
    group.some((k) => have.has(k)),
  );
}

/**
 * Composition-honest lane APY. Hedged catalog rows price the short leg's
 * funding INTO netApyOnDepositApy AND run the whole position through the HL
 * margin escrow. If the hedge module is not installed on the lane, all three
 * of those leave with the leg, so the lane reprices on the model's unhedged
 * branch — never a bare funding subtraction (A1).
 *
 * `comp` adds the modules that are priced but not baked into the row: today
 * that is auto-compound, whose delta is signed and size-dependent (A10). A
 * caller that passes no composition gets exactly the pre-2026-08-22
 * behaviour, since an absent module contributes zero.
 *
 * `placed` is the lane's module set (P0-8). On a hand-authored row it is the
 * only thing that can tell a finished machine from half of one, and the lane
 * prints nothing until it holds the composition the row's number was computed
 * at. Optional, and absent means unchecked: see `composedHere`.
 *
 * HANDOFF — every caller that is describing A LANE rather than the template
 * row itself must pass the lane's placed module keys, or the partial-collar
 * and naked-LP numbers stay live on that surface:
 *   • `components/canvas/RackCanvas.tsx:1005` (the lane header) and `:1695`
 *   • `components/canvas/dock/ComposePanel.tsx:145, :823`
 *   • `lib/canvas/leverage-stops.ts:159`
 *   • `lib/canvas/contributions.ts:178` (its own guard moves to
 *     `committedFamilies` under P1-2; this gate is the second half)
 * The card previews (`DiscoverPanel.tsx:155, :399`), `unified-list.ts:336` and
 * `lib/vaults/seeds.ts` are describing the row and correctly pass nothing.
 */
/**
 * THE COMPOSED NUMBER, AND THE TWO STEPS THAT BUILD IT (2026-08-22).
 *
 * `composedNetApy` returns only the total, so a surface wanting to SHOW how
 * the total was reached had to subtract its way back to the steps. The dock's
 * bridge ladder did exactly that, took `total − base` as one quantity, and
 * labelled it `no hedge installed`. That difference is TWO steps, not one:
 * the hedge decision and the compounding delta. On every hedged market the
 * hedge step is identically zero, so the row printed the compounding delta
 * under the hedge's label, on the same panel that named the hedge three more
 * times. It only became visible when the dock started passing the composition
 * (before that `compoundDelta(core, null)` was 0 and the row was suppressed by
 * the materiality floor), which is the precise shape of a latent contradiction
 * waiting for an unrelated fix to expose it.
 *
 * So the steps are named here, once, and `composedNetApy` is derived FROM
 * them rather than beside them.
 */
export interface ComposedTerms {
  /** The row as scanned, at the lane's leverage. Hedged when the row is class A. */
  base: number;
  /**
   * After the hedge DECISION. Equal to `base` when the hedge is installed or
   * the row never carried a leg; the hedgeless reading when it is ejected.
   * `core − base` IS the hedge step, and it is zero by construction wherever
   * the hedge is present.
   *
   * THIS IS `venueNet` IN THE R1 IDENTITY: every venue cost is inside it and
   * the house's own fee is not. It is the last honest place to stop if what
   * you are describing is a MARKET rather than a product.
   */
  core: number;
  /** `core + compoundDelta(core, comp.compound)`. `total − core` IS the compound step. */
  total: number;
  /**
   * ── THE HOUSE FEE, ADDED 2026-08-24 (planner ruling R1) ─────────────────
   *
   * The house compute fee on this lane, as a POSITIVE MAGNITUDE, from
   * `fees.computeFeeTerm(core)`. `core` is `venueNet` in the R1 identity:
   * every venue cost is inside it and no house cost is, which is exactly what
   * makes it the point the fee is defined at.
   *
   * Zero on a non-positive lane — the fee is charged on yield at harvest, and
   * a lane that harvests nothing is not softened by a fifth of its own loss.
   */
  fee: number;
  /**
   * `core − fee` — R1's `afterFee`, the yield the depositor's capital actually
   * re-deposits and therefore the ONLY base the compound step may be evaluated
   * at.
   *
   * NAMED HERE 2026-09-02 (QNT-R2-1). It was computed inside this function and
   * thrown away, so the two surfaces that had to show the compound step — the
   * auto-compound plate hero and the Compose ladder — reached it by compounding
   * `core` instead, which is the PRE-fee lift and 60-80% larger than the one
   * inside `published`. Both now read this field. They may not re-derive it:
   * `applyComputeFee` is forbidden to every reader of `hedgeEconomics` by
   * `hedge-one-frame.test.ts`, and the reason generalizes — the fee reaches an
   * APY once, here.
   *
   *     total     = core     + compoundDelta(core)      ← the VENUE ladder
   *     published = afterFee + compoundDelta(afterFee)  ← the PRODUCT ladder
   *
   * so `published − afterFee` IS the compound step a depositor gets, exactly
   * as `total − core` is the one the venue would have got.
   */
  afterFee: number;
  /**
   * THE PRODUCT NUMBER. `afterFee + compoundDelta(afterFee, comp.compound)`
   * where `afterFee = core − fee`, i.e. R1's identity, evaluated once.
   *
   * ⚠ `published` is NOT `total − fee`. The compound step is re-evaluated at
   * the AFTER-fee base, because only the depositor's remainder is
   * re-deposited; compounding the pre-fee number and subtracting the fee
   * afterwards would credit them with the compound of a dollar the house
   * already took. The gap is small and it is real, and this is the field that
   * owns it so no caller has to reason about it.
   */
  published: number;
}

export function composedTerms(
  c: ProjectedCandidate | null | undefined,
  hasHedge: boolean,
  comp?: LaneComposition | null,
  placed?: readonly ModuleKey[] | null,
): ComposedTerms | null {
  if (!composedHere(c, placed)) return null;
  const base = candidateApy(c);
  if (base === null) return null;
  const core =
    hasHedge || c?.cls !== "A" // an unhedged-class row never carried a leg
      ? base
      : (hedgelessApy(c) ?? base);
  const compound = comp?.compound ?? null;
  /* THE FEE, BETWEEN THE VENUE TERMS AND THE COMPOUND STEP (R1). The ordering
     is the ruling's, not a preference. */
  const fee = computeFeeTerm(core);
  const afterFee = core - fee;
  return {
    base,
    core,
    total: core + compoundDelta(core, compound),
    fee,
    afterFee,
    published: afterFee + compoundDelta(afterFee, compound),
  };
}

/**
 * THE VENUE FACT — this composition priced with venue costs only, no house
 * fee. It is the answer to "what does this market pay at these dials", a
 * question about Aave and Hyperliquid rather than about Priime, and it is what
 * a Browse-markets card and the funding card's reconciling revenue line print
 * (R1's boundary rule: the fee applies at the LANE, never at the MARKET row).
 *
 * ⚠ IF YOU ARE PRINTING A PRODUCT NUMBER — a lane header, a review sheet, a
 * directory card, a published record — read `publishedNetApy` instead. This
 * one is a venue fact wearing no house cost, and labelling it "net, after
 * costs" on a product surface is the defect R1 exists to close.
 */
export function composedNetApy(
  c: ProjectedCandidate | null | undefined,
  hasHedge: boolean,
  comp?: LaneComposition | null,
  placed?: readonly ModuleKey[] | null,
): number | null {
  return composedTerms(c, hasHedge, comp, placed)?.total ?? null;
}

/**
 * THE PUBLISHED NUMBER — the same composition with the house's own 20% compute
 * fee inside it, per R1. ONE call, so no surface re-derives the ordering.
 *
 *     afterFee  = venueNet > 0 ? venueNet * 0.8 : venueNet
 *     published = afterFee + compoundDelta(afterFee, comp.compound)
 *
 * Every product surface reads this: the lane header on the canvas, the review
 * sheet, the directory card, the published record. A caller that wants to SHOW
 * the fee as a term takes `composedTerms` once and prints `.fee` beside
 * `.published`, rather than pricing the lane twice.
 *
 * SIGN-SAFE BY CONSTRUCTION. A positive lane times 0.8 stays positive and a
 * non-positive lane is untouched, so no `netApy <= 0` gate downstream can
 * newly trip on the fee, and breakeven leverage is fee-invariant.
 */
export function publishedNetApy(
  c: ProjectedCandidate | null | undefined,
  hasHedge: boolean,
  comp?: LaneComposition | null,
  placed?: readonly ModuleKey[] | null,
): number | null {
  return composedTerms(c, hasHedge, comp, placed)?.published ?? null;
}
