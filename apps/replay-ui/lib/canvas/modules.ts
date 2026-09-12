/**
 * The four v1 module definitions (BC-P1).
 *
 * Params here are the STRUCTURAL v1 set with hard clamps. BC-P2 wires the
 * liquidity-source catalog to the Strategy Factory scanner KV; BC-P3 replaces
 * raw band numbers with the derived risk-dial scheme (lib/canvas/param-schema.ts)
 * — nothing outside this file assumes these exact params.
 *
 * RECETTE 2026-08-22 (build items 2/3/4, defects A4 A7 A10 A11 A12 A13):
 *
 *   Two rules govern this whole table now.
 *
 *   1. EVERY BOUND IS DERIVED. A hand-typed max is a second opinion about the
 *      market, and the second opinion is always the wrong one. `MODULE_DEFS`
 *      carries only the STRUCTURAL envelope — the widest bound any market
 *      could ever justify, itself computed from `param-schema` — and
 *      `descriptorsFor(key, ctx)` narrows it to the picked market. The flat
 *      `targetLeverage` max of 5 left 17–36% of the slider dead on every live
 *      row (A7); the flat `hedgeLeverage` max of 5 let the default of 3 open
 *      INSIDE the refill band on a coin whose admissible max is 2.88 (A12);
 *      the `reserveFraction` floor of 0.10 was smaller than the refill it has
 *      to fund, which is `restore − safetyFloor` = 0.15 exactly (A11).
 *
 *   2. EVERY PARAM IS PRICED. A dial that cannot move a number is a lie about
 *      what the machine does. `QUOTE_AFFECTING_PARAMS` is the one list of
 *      fields that enter the quote; `moduleInvalidatesQuote` is derived from
 *      it (A10, A13, E4, E7).
 *
 * SHADOW-PRICE WAVE 2026-08-22. Both rules above were applied to themselves,
 * and both had violations left in this file:
 *
 *   A2 — the leverage floor was 1.5. netApy is AFFINE in L, so the bounds are
 *        the domain an optimum is taken over; the slope is negative on 13 of
 *        15 live rows, which put the optimum OUTSIDE the control on 13 of 15
 *        rows. Floor is now `PRODUCT_MIN_LEVERAGE` (1).
 *
 *   A3 — the harvest threshold's default was derived from the module's own
 *        BREAK-EVEN, which is by construction its zero. It is now the argmax
 *        `θ* = √(2·gas·TVL)`, which does not depend on the carry at all.
 *
 *   R1 — the `deltaBandPct` dial is deleted. Rule 1 says a hand-typed bound is
 *        a second opinion about the market; a hand-typed OPTION SET is the
 *        same defect one level up. All three options were unexecutable at the
 *        launch cap and at least 4x tighter than what production runs. See
 *        `derivedDeltaBandPct`.
 *
 *   R2 — `fundingFloorApr` and `fundingWindowEpochs` left
 *        `QUOTE_AFFECTING_PARAMS`. Rule 2 is stated as an acceptance criterion
 *        further down this file, and the list failed its own criterion for
 *        them. The DIALS stay: they are real publish-time fields. A list of
 *        "fields that enter the quote" is not a list of "fields that matter".
 *
 * DERIVED-BOUNDS WAVE 2026-09-01 (D2, D3, D4). Rule 1 applied to its own
 * remaining literals:
 *
 *   D2 — `MAX_CATALOG_LT` was typed 0.95 while the committed catalog carries
 *        0.965 (morpho-blue-ethereum). Now reduced over the committed scan
 *        documents, so the structural ceiling follows the catalog (same grid
 *        cell today: both lts floor to 3.75; a 0.97 row would move it to 4).
 *
 *   D3 — `hedgeLeverageCeiling` existed but its input never arrived: the
 *        projection dropped the scan's `native_perp` gate, so every book kept
 *        the ETH-tier structural max of 5. The projection now carries
 *        `coinMaxLeverage` and `paramContextForLoop` forwards it — HYPE
 *        (venue maxLev 10) caps at 4.0x, BERA (maxLev 5) at 3.5x.
 *
 *   D4 — `fundingFloorApr` ran a typed [−0.15, 0]. The depth now mirrors the
 *        placed book's own measured funding percentiles below zero
 *        (`fundingFloorAprBounds`); the structural envelope is the identical
 *        reduction over the committed catalog. `derived-bounds.test.ts`
 *        proves all three bounds move with their market inputs.
 *
 *   X1 — (G7, 2026-09-02) a bound can be derived and still be a dead control.
 *        `fundingFloorAprBounds` answered "no measured negative" with `null`,
 *        which fell back to the catalog-wide envelope, and the swept live
 *        catalog drew a −53%-to-0 dial on 45 of 52 hedged rows. No negative
 *        evidence is now the HOUSE band; the envelope is reached only with no
 *        lane context at all.
 */

/* eslint-disable @typescript-eslint/array-type, eqeqeq --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import type { ModuleKey, ParamOption, ParamValue } from "./types";
// L2 — THE AXES ARE DECLARED HERE OR THE DOMINANCE RULE IS UNFALSIFIABLE.
// `AxisModuleDef` / `AxisParamDescriptor` are `ModuleDef` / `ParamDescriptor`
// plus the three declaration fields (`axes`, `objective`, `defaultRationale`).
// Structural supersets, so every existing consumer of the plain shapes keeps
// compiling; TYPE-ONLY, so the value import in the other direction
// (`axes.ts` reads `RESERVE_MIN_FRACTION` from here) leaves no runtime cycle.
import type { AxisModuleDef, AxisParamDescriptor } from "./axes";
import {
  deriveHlMarginBands,
  floorToGrid,
  houseMaxLeverage,
  PRODUCT_MIN_LEVERAGE,
  type RiskPreset,
} from "./param-schema";
import { HEDGE_DRIFT_REGROW_EDGE } from "@/lib/model-constants";
import snapAave from "@/lib/canvas/fixtures/aave-v3-base.json";
import snapDolomite from "@/lib/canvas/fixtures/dolomite-v1.json";
import snapHlFunding from "@/lib/canvas/fixtures/hyperliquid-funding.json";
import snapMorphoBase from "@/lib/canvas/fixtures/morpho-blue-base.json";
import snapMorphoEth from "@/lib/canvas/fixtures/morpho-blue-ethereum.json";
import snapHyperevm from "@/lib/canvas/fixtures/morpho-blue-hyperevm.json";

// ── Structural envelope (widest bound any market could justify) ───────────
//
// These are NOT market bounds — `descriptorsFor` supplies those. They are the
// outer edge of the box, derived from the same house functions the per-market
// cap uses so the two can never drift apart.
//
// DERIVED-BOUNDS RECETTE 2026-09-01 (D2, D4): the envelope's catalog-facing
// edges are REDUCED over the committed scan documents below rather than typed
// beside them. `MAX_CATALOG_LT` was a literal 0.95 claiming to be the
// catalog's loosest lt while `morpho-blue-ethereum` committed 0.965 — a
// second opinion about the market, silently stale. The committed fixtures are
// the one form of "the catalog" that exists at module scope, they are the
// same documents `opportunities-server` falls back to and the regression
// suites pin, and per-market narrowing (`descriptorsFor` with a live row's
// own lt) still overrides them row by row.

/** The committed catalog rows, both doc generations, economics as reduced
 *  here. The v1 Dolomite doc and the v2 venue docs agree on the two fields
 *  this file reads (`ltUsed`, `fundingP25Apr`/`fundingWindows`). */
interface CommittedCatalogRow {
  economics?: {
    ltUsed?: number | null;
    fundingP25Apr?: number | null;
    fundingWindows?: ReadonlyArray<{ p25Apr?: number | null } | null> | null;
  } | null;
}

const CATALOG_ROWS: readonly CommittedCatalogRow[] = (
  [snapAave, snapDolomite, snapHlFunding, snapMorphoBase, snapMorphoEth, snapHyperevm] as ReadonlyArray<{
    candidates?: readonly CommittedCatalogRow[];
  }>
).flatMap((doc) => doc.candidates ?? []);

const LEVERAGE_GRID = 0.25;
const HEDGE_LEVERAGE_GRID = 0.5;
const RESERVE_GRID = 0.05;
const FUNDING_FLOOR_GRID = 0.01;

/**
 * THE HOUSE FUNDING FLOOR — one owner, and the depth no derivation may take
 * away (recette v2, DEF-01 / QNT-R2-2, 2026-09-02).
 *
 * The guard every hedge ships with, and the floor the vault record has always
 * printed for a lane that stored nothing. It was spelled three times — as the
 * descriptor's `default` below, again in `deriveDescriptor`'s narrowing
 * fallback, and again in `pricing-params`' `defNum` fallback — which is the
 * two-spellings-of-one-number archetype. It is now a named constant the
 * descriptor reads, and it is the depth `fundingFloorAprBounds` guarantees
 * stays reachable on every book.
 */
export const HOUSE_FUNDING_FLOOR_APR = -0.05;

/** Highest liquidation threshold the committed catalog carries, reduced over
 *  the rows (morpho-blue-ethereum wstETH/WETH, 0.965 today). Guarded exactly
 *  as `leverageCeiling` guards a row's lt — only 0 < lt < 1 is a liquidation
 *  threshold. A catalog with no such row reduces to NaN, which
 *  `houseMaxLeverage` answers with its own hard cap: the envelope fails OPEN
 *  to the widest box, and per-market narrowing still binds. */
export const MAX_CATALOG_LT = (() => {
  const lts = CATALOG_ROWS.map((r) => r.economics?.ltUsed).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1,
  );
  return lts.length > 0 ? Math.max(...lts) : Number.NaN;
})();

/** The structural leverage ceiling as a FUNCTION of the catalog's loosest lt
 *  (D2): the house trim cap at that lt on the loosest preset — nothing looser
 *  is reachable on any row. A function so the derivation is provable against
 *  a moved catalog, not only against today's. */
export function structuralMaxLeverage(catalogMaxLt: number): number {
  return floorToGrid(houseMaxLeverage(catalogMaxLt, "aggressive"), LEVERAGE_GRID);
}

/** Absolute leverage ceiling: no market, no preset, can ask for more. */
export const STRUCTURAL_MAX_LEVERAGE = structuralMaxLeverage(MAX_CATALOG_LT);

/**
 * Deepest funding rate any committed book has measured BELOW ZERO, over every
 * archived percentile the rows carry (TRUMP's 365d p25 of −52.6% is the edge
 * today, and it is the edge because it is genuinely negative).
 *
 * ⚠ SIGN IS EVIDENCE, NOT NOISE (recette v2, DEF-01 / QNT-R2-2, 2026-09-02).
 * This reduced `Math.abs` over every percentile, so a book that has NEVER paid
 * a negative print counted its POSITIVE carry as if it were a measured
 * drawdown. On the whole catalog the two reductions happen to coincide — the
 * deepest magnitude IS TRUMP's negative — but the per-book narrowing they feed
 * did not, and the sign discard is what let an ETH book paying +1.4% claim a
 * measured depth of −1.4%. A funding percentile is only a statement about the
 * negative side when it IS negative.
 *
 * Degenerate guard: a catalog with no negative print at all reduces to the
 * house floor, so the envelope can never end up shallower than the guard every
 * hedge ships with.
 */
export const DEEPEST_CATALOG_NEGATIVE_FUNDING_APR = (() => {
  const negs = CATALOG_ROWS.flatMap((r) => {
    const e = r.economics;
    if (!e) return [];
    return [e.fundingP25Apr, ...(e.fundingWindows ?? []).map((w) => w?.p25Apr)].filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v) && v < 0,
    );
  });
  return negs.length > 0 ? Math.min(...negs) : HOUSE_FUNDING_FLOOR_APR;
})();

/** Structural floor of the funding-floor dial (D4): as deep below zero as any
 *  committed book's measured NEGATIVE funding reaches, snapped AWAY from zero
 *  so the measured depth stays reachable on the grid, and never shallower than
 *  the house floor — an envelope that cannot hold the shipped guard would be
 *  the retune this recette closed, one level up. */
export const STRUCTURAL_MIN_FUNDING_FLOOR = Math.min(
  HOUSE_FUNDING_FLOOR_APR,
  floorToGrid(DEEPEST_CATALOG_NEGATIVE_FUNDING_APR, FUNDING_FLOOR_GRID),
);

/** `restore − safetyFloor`, the refill the reserve exists to fund. Both edges
 *  are MM + a fixed offset, so the gap is coin-invariant (verified across the
 *  whole maxLeverage tier set): the reserve can never floor below it. */
export const RESERVE_MIN_FRACTION = (() => {
  const b = deriveHlMarginBands(10);
  return Number((b.restore - b.safetyFloor).toFixed(4));
})();

/** House gas assumption for a single recapture action, USD. Used only to
 *  derive the harvest threshold's default; the priced model carries its own
 *  (`mock-quote.ts` MODELED.gasPerActionUsd, same value, same source
 *  `lib/backtest/presets.ts:63`). */
const RECAPTURE_GAS_USD = 0.5;

/** HL minimum order notional (the hyperliquid types' HL_MIN_ORDER_USD). A
 *  recapture below this cannot land, so the threshold can never sit under it. */
const HL_MIN_ORDER_USD = 10;

/** The size the priced compound model evaluates at (`mock-quote.ts`
 *  MODELED.refTvlUsd, from `lib/vaults/store.ts` baseTvlUsd). The threshold's
 *  optimum is a function of TVL and NOTHING else, so this is the one input the
 *  default needs; `ParamContext.tvlUsd` overrides it when a caller knows the
 *  lane's own size. Duplicated rather than imported because `mock-quote`
 *  imports this module. */
const REFERENCE_TVL_USD = 25_000;

/** Production's hedge regrow drift edge (v4 `launch-config.ts`
 *  LAUNCH_PARAMS.HEDGE_DRIFT_REGROW_EDGE, 0.04 = 4% of target notional), read
 *  from the owner rather than copied. The tightest band the real machine runs,
 *  and therefore the floor of the derived delta band below. */
const PRODUCTION_DRIFT_EDGE = HEDGE_DRIFT_REGROW_EDGE;

/**
 * THE THIRD RULE, added by the axis wave (P0-B, 2026-08-22).
 *
 * 3. EVERY CONTROL DECLARES ITS AXES. Rules 1 and 2 govern a control's BOUNDS
 *    and whether it reaches a number. Neither says whether the control should
 *    exist. That question is L1's — a control may render only where its
 *    settings genuinely trade — and L1 cannot be run at all until the axes it
 *    quantifies over are written down (L2). So every descriptor below carries
 *    `axes`, every module carries the axes its INSTALL/EJECT decision moves,
 *    every value the product sets for the user carries `objective`, and every
 *    default deliberately off that objective's argmax carries
 *    `defaultRationale`. See `lib/canvas/axes.ts` for the union, the
 *    renderers and the obligations.
 *
 *    THE DECLARATION IS A CLAIM, NOT A LABEL. `axes` states what THIS
 *    control's settings move, measured, not what the market moves and not
 *    what the module is about. Over-declaring is the one abuse L2 exists to
 *    catch: an axis listed and not moved is a false defence against deletion,
 *    and every entry below cites the measurement it came from.
 */
/**
 * One per-party `Hold`, built rather than typed out six times.
 *
 * The six differ by exactly two strings, and a table of six near-identical
 * literals is where a seventh party gets added with the wrong axes. The
 * factory makes the declaration one claim instead of six copies of one claim.
 */
function HOLD(field: string, friendlyLabel: string): AxisParamDescriptor {
  return {
    field,
    friendlyLabel,
    type: "toggle",
    axes: ["dependenciesAnswered", "responseTriggers"],
    default: false,
    help: "Moves one party across the line. It never removes a party from the list.",
  };
}

// ── The exit routes an issuer can publish (WP-3) ──────────────────────────

/**
 * THE WAYS OUT OF A TOKENIZED-TREASURY POSITION, as the STRUCTURAL ENVELOPE —
 * the widest set of routes any issuer could publish, never a claim about which
 * routes a particular one does.
 *
 * ⚠ A NAMED MIRROR, AND THE EXPORT THAT WOULD REMOVE IT IS
 * `templates.ExitRouteId`. That union is the owner: `templates.ts` fetched the
 * six issuers' own documents and every route on every row carries one of these
 * three ids AND its own `label`, which is what a surface renders. This file
 * cannot import it — `templates.ts:72` imports `defaultValueFor` from here, so
 * the dependency runs one way only, exactly as `axes.ts` and `mock-quote.ts`
 * read `terms.hedge` and `terms.hedgelessApy` structurally for the same reason.
 * The mirror is the three IDS and nothing else, and it is only ever read where
 * no lane has been supplied.
 *
 * THE LABELS HERE ARE THE HOUSE'S, AND THEY ARE THE FALLBACK ONLY. The moment
 * a lane is supplied, `deriveDescriptor` rebuilds this list from the picked
 * issuer's own `routes`, taking each route's `label` verbatim — the row states
 * how its own routes are named, and a second naming in this file would be a
 * second opinion about the issuer. Each fallback label restates
 * `ExitRouteId`'s own comment and asserts nothing beyond it: the issuer's
 * contract pays a stablecoin atomically, a third party buys the share for a
 * stablecoin, the transfer agent redeems and wires dollars.
 *
 * WHAT IS NOT HERE, deliberately: any number. Windows, minimums, daily limits
 * and business-hour constraints are facts about a specific issuer, they live
 * on the row, and `exitDiscountFrac` in particular is refused entry to the
 * router's arithmetic until something measures it (see `exitProfileFor`'s own
 * note). This constant states which questions exist, never their answers.
 */
export const EXIT_ROUTE_OPTIONS: readonly ParamOption[] = [
  { value: "instant-usdc", label: "Instant USDC", shortLabel: "Instant" },
  { value: "stablecoin-swap", label: "Stablecoin swap", shortLabel: "Swap" },
  { value: "issuer-wire", label: "Issuer wire", shortLabel: "Wire" },
];

/**
 * The redemption facts one picked row publishes about its issuer, reduced to
 * exactly what a descriptor needs.
 *
 * THE ROW IS THE OWNER AND THIS FILE DERIVES NOTHING FROM IT. Which route is
 * fastest and how many days the record pins are both `templates.ts`'s own
 * reductions (`fastestExitRoute`, `settlementDaysOf`) over the fetched
 * documents; `param-context.paramContextForLoop` calls them and forwards the
 * answers. Nothing in this file knows which issuer settles in how many days,
 * and nothing in this file may learn it — `MODULE_DEFS` is the structural
 * envelope and `descriptorsFor(key, ctx)` is the only place a market enters.
 */
export interface IssuerRedemption {
  /**
   * Every route this issuer publishes, in the row's own order and under the
   * row's own labels. Fewer than two is a dead control and the descriptor
   * comes back hidden.
   */
  routes: readonly { id: string; label: string }[];
  /**
   * Business days from request to funds on the fastest route the issuer
   * publishes — `templates.settlementDaysOf`, which is stated there as the
   * quantity this record pins and `exitCost` reads.
   */
  settlementDays: number;
  /**
   * The route a lane leaves by unless the builder picks another —
   * `templates.fastestExitRoute().id`. A default the ROW chooses, not this
   * file: the fastest published route is the one no builder has to defend.
   */
  defaultRouteId: string;
}

export const MODULE_DEFS: Record<ModuleKey, AxisModuleDef> = {
  "liquidity-source": {
    key: "liquidity-source",
    name: "Liquidity source",
    // Not optional and not ejectable: there is no install decision to declare
    // axes for. The market pick itself is a control, and it declares its axes
    // on `candidateId` below.
    axes: [],
    tagline: "Pick the venue and the loop market",
    description:
      "Screens live loop opportunities on the venues you select and pins the market this vault will run on.",
    rank: 0,
    optional: false,
    params: [
      {
        // UX_ITERATION_3 §1: venue is no longer a user-facing select — the
        // unified discovery list sets it from the picked row (venue = chip
        // on the row). Options stay as the clamp allowlist.
        field: "venue",
        friendlyLabel: "Venue",
        type: "select",
        // CURATION, and the largest lever in the product. Measured: 4.19pp of
        // WETH borrow rate between Aave v3 Base and Morpho Blue Base at the
        // same block on the same chain — 3.5x the entire leverage dial's
        // best-row range. It moves the carry, it moves which resource binds
        // the deposit room, and it moves the lt geometry the cushion is
        // derived from. Never auto-set: picking where to lend is the user's.
        axes: ["netApy", "capacity", "cushion"],
        default: "morpho-blue-hyperevm",
        options: [
          { value: "morpho-blue-hyperevm", label: "Morpho Blue · HyperEVM" },
          { value: "morpho-blue-base", label: "Morpho Blue · Base" },
          { value: "morpho-blue-ethereum", label: "Morpho Blue · Ethereum" },
          { value: "aave-v3-base", label: "Aave v3 · Base" },
          { value: "dolomite-berachain", label: "Dolomite · Berachain" },
          { value: "hyperliquid-funding", label: "Hyperliquid · funding" },
          // template mock venues (modeled rows, never scanned)
          { value: "aerodrome-base", label: "Aerodrome · Base" },
          { value: "options-base", label: "Options venue · Base" },
          /* ── THE SIX TREASURY ISSUER VENUES ────────────────────────────
             THIS LIST IS A CLAMP, NOT A MENU, which is why an omission here
             fails silently rather than loudly. `graph-ops.clampAgainst` reads
             a `select`'s `options` and returns `null` for any value outside
             them; `updateParam` answers `null` by returning the graph
             UNCHANGED. A treasury row offered in the discovery list, pressed,
             and seated would therefore write its venue into nothing: the pick
             evaporates, the lane keeps the venue it already had, and no
             surface reports a refusal. The dial is `hidden`, so there is not
             even a control whose position contradicts the write.

             The labels are `VENUE_LABELS`' own words (opportunities.ts) and
             not a second spelling — the same convention every row above
             follows. */
          { value: "treasury-ausdc-base", label: "Aave v3 · Base" },
          { value: "treasury-buidl-ethereum", label: "BUIDL · Ethereum" },
          { value: "treasury-usyc-ethereum", label: "USYC · Ethereum" },
          { value: "treasury-ousg-ethereum", label: "OUSG · Ethereum" },
          { value: "treasury-usdy-ethereum", label: "USDY · Ethereum" },
          { value: "treasury-ustb-ethereum", label: "USTB · Ethereum" },
          { value: "treasury-uscc-ethereum", label: "USCC · Ethereum" },
        ],
        hidden: true,
        help: "Where the loop borrows and supplies. Set from the market you pick.",
      },
      {
        field: "candidateId",
        friendlyLabel: "Market",
        type: "select",
        // CURATION, ratified 2026-08-21: choosing a market is a curation act
        // and is never automated. It moves everything the venue moves plus
        // the collateral asset itself, which is the unit an unhedged lane
        // returns in. It renders as the discovery list, not as this select.
        axes: ["netApy", "capacity", "cushion", "denomination"],
        default: "",
        options: [],
        hidden: true,
      },
      // ── Pinned records, not controls ──────────────────────────────────
      //
      // Each of these has exactly ONE legal value once the market is picked:
      // they are written from the chosen row, never chosen. A set of settings
      // with one member moves nothing, so the honest declaration is the empty
      // set, and the L2 build gate exempts non-rendering descriptors for
      // exactly this case. `hlCoin` determines the perp book and therefore the
      // margin ladder — but it is DERIVED from `candidateId`, and an axis
      // credited twice would let a pinned field defend a control it does not
      // move.
      { field: "pairLabel", friendlyLabel: "Pair", type: "select", axes: [], default: "", options: [], hidden: true },
      { field: "contentHash", friendlyLabel: "Doc pin", type: "select", axes: [], default: "", options: [], hidden: true },
      { field: "cls", friendlyLabel: "Class", type: "select", axes: [], default: "", options: [], hidden: true },
      { field: "hlCoin", friendlyLabel: "Hedge coin", type: "select", axes: [], default: "", options: [], hidden: true },
    ],
  },

  "safety-buffer": {
    key: "safety-buffer",
    name: "Dynamic leverage",
    tagline: "Levers up when safe, trims when tight",
    description:
      "Runs the loop at your target leverage: levers up when safe, trims when tight, emergency-deleverages before liquidation. Bands come from the venue's own liquidation parameters.",
    rank: 1,
    /* EJECTABLE (design ruling 2026-08-23). This was `optional: false`, and
       with it the module was absent from `Lane.EJECTABLE`, so a plate that
       THE MODULE RULING says contributes nothing on a dominated market had no
       exit once seated: the only way out was the NO DEBT cell — the founder's
       screenshot. The module is still the loop's required group's member, and
       `isRequiredInstalled` (compose-options) keeps it LOCKED wherever it is
       the only member holding that group: on `{source, safety-buffer}` the
       cross does not render; on `{source, safety-buffer, hedge}` it does. So
       `optional` here means what it means on the hedge — removable when the
       lane stays finishable — and the group predicate decides the rest.
       It also puts the install decision on the sweep's control list, which is
       where the axes below were declared for in the first place. */
    optional: true,
    // THE INSTALL DECISION. `netApy(L)` is affine with slope `f_b·(cy − bo)`,
    // so the module's whole contribution on a lane is `(L−1)·(cy − bo)·f_b`
    // and it is exactly ZERO at L = 1 — no health band, no borrow leg, no
    // capacity change. Where the slope is non-positive its optimum IS L = 1,
    // and a module whose every measured contribution is zero is a module the
    // lane does not hold. All three axes move together and in the same
    // direction on the negative-slope rows, which is why the decision is
    // decidable there rather than a preference.
    axes: ["netApy", "cushion", "capacity"],
    params: [
      {
        /**
         * ⚠ THIS DESCRIPTOR WAS NAMED "Risk profile" (renamed 2026-08-22).
         *
         * That is the exact phrase the vault page was cleaned of under the
         * ratified ban on subjective risk grades — and `PlateControls.SegKeys`
         * pipes `friendlyLabel` straight into `aria-label`, so a screen reader
         * heard "Risk profile, Std selected" on a surface that publicly banned
         * the phrase. The writer was still emitting what a patch on the reader
         * was filtering out.
         *
         * The shortLabels were worse than subjective, they were INVERTED.
         * `deriveHfBands` sets the trim trigger at `target − presetSpread`,
         * and the conservative preset runs the WIDEST spread — so it lets the
         * position deteriorate FURTHEST before trimming, while the label
         * "Wider" invited exactly the opposite reading. The cells now print
         * the measured drift (`liquidation.driftBeforeTrim`), and these
         * fallbacks state the ORDERING as a fact about behaviour rather than
         * as a grade.
         *
         * The stored VALUES are untouched: they are the compile schema's own
         * enum and the Priime band derivation reads them.
         */
        field: "riskPreset",
        friendlyLabel: "Drift before it trims",
        type: "segmented",
        /**
         * THE TEACHING EXAMPLE FOR L4, and the one control the shipped
         * product already gets right.
         *
         * `deriveHfBands` trims at `target − presetSpread`, so the preset
         * moves TWO measured quantities in OPPOSITE directions at a fixed
         * leverage, and their sum is the cushion:
         *
         *     driftBeforeTrim + reactionWindow === cushion
         *
         * Conservative runs the widest spread: the most drift tolerated
         * before the automation acts, and the least room left between the
         * trim and the line. Aggressive is the mirror. Neither end dominates,
         * neither is in the objective (same APY, same cushion at a fixed L),
         * and so the product does NOT pick. It renders the drift — 0.04pp to
         * 5.12pp across the catalog — and leaves the choice.
         *
         * What it does NOT declare: trim frequency and gap exposure. Both are
         * real, both are what the choice actually costs, and neither is
         * computable without a pair-move distribution the payload does not
         * carry. Under L11 an unmeasurable quantity is a `blind` register
         * entry, never an axis — declaring it here would let this control
         * defend itself with a word.
         */
        axes: ["driftBeforeTrim", "reactionWindow"],
        default: "standard",
        options: [
          { value: "conservative", label: "Trims latest", shortLabel: "Latest", numeric: 0.75 },
          { value: "standard", label: "Trims at the house gap", shortLabel: "House", numeric: 1.0 },
          { value: "aggressive", label: "Trims soonest", shortLabel: "Soonest", numeric: 1.25 },
        ],
        advanced: true,
        help: "How far the pair may drift before the automation trims, derived from the venue's own liquidation parameters. You never tune raw thresholds.",
      },
      {
        // A7/A3: max is the STRUCTURAL ceiling only. `descriptorsFor` narrows
        // it to floorToGrid(min(houseMaxLeverage(lt, preset), scan L)) for the
        // picked market, and the clamp FLOORS to the grid so a stored value
        // can never sit above the house trim cap.
        //
        // A2 (2026-08-22): min is `PRODUCT_MIN_LEVERAGE` (1), not 1.5. netApy
        // is affine in L; on 13 of 15 live rows its slope is negative, so the
        // optimum is the bottom corner and the bottom corner was off the
        // slider. syrupUSDC/GHO: −24.01% at Balanced, +4.31% at L = 1.
        //
        // AXES (P0-B). Three, and the verdict table names all three from one
        // measurement: the top stop loses to the bottom stop on APY AND on
        // cushion AND on capacity, on 13 of 15 live rows, by 0.54pp to
        // 39.36pp. `netApy` is affine in L; `cushion` is `1 − 1/HF(L)`;
        // capacity moves because `repriceAtLeverage` re-divides the scan's
        // bound by the lane's own escrow at the applied leverage.
        //
        // `objective: netApy` because on the non-positive-slope rows the
        // product SETS this — and it is allowed to under L4 even though two
        // of the three axes sit outside the objective, because at the bottom
        // corner the chosen setting is weakly best on ALL THREE. That is
        // dominance, not argmax, and it is the whole difference between the
        // founder's rule serving the outcome and serving itself.
        //
        // ⚠ NO `defaultRationale`, DELIBERATELY. The structural default here
        // is 3 and `descriptorsFor` narrows it to `floorToGrid(0.8 · max)` —
        // a fraction of a ceiling, which optimises no declared axis on any
        // row. Under L3 an off-argmax default MUST name the axis it optimises
        // instead, and there is none to name. That absence is not an
        // oversight to be papered over with a plausible field: it is the
        // evidence for THE MODULE RULING (the module is absent, not
        // defaulted, where the slope is non-positive). Writing a rationale
        // here would erase the finding.
        field: "targetLeverage",
        friendlyLabel: "Target leverage",
        type: "slider",
        axes: ["netApy", "cushion", "capacity"],
        objective: "netApy",
        default: 3,
        min: PRODUCT_MIN_LEVERAGE,
        max: STRUCTURAL_MAX_LEVERAGE,
        step: LEVERAGE_GRID,
        unit: "x",
        advanced: true,
        help: "The loop's steady-state leverage. Capped by the leverage whose trim trigger sits at the house health floor for this market.",
      },
    ],
  },

  hedge: {
    key: "hedge",
    name: "Dynamic hedge",
    tagline: "Delta-neutral via perp short, margin maintained",
    description:
      "Shorts the collateral's perp so price moves cancel. Maintains margin bands and a reserve that auto-refills.",
    rank: 2,
    optional: true,
    /**
     * THE INSTALL DECISION THAT L2 EXISTS FOR.
     *
     * Installing the hedge is DOMINATED ON — on 13 of 13 legal rows, with a
     * margin over breakeven of +2.13pp to +9.84pp, and it takes capacity with
     * it too (ejecting raises the escrow to 1, so each deposited dollar lands
     * on the venue whole and the borrow pool binds 32.6% sooner). On yield and
     * on room, there is no argument: the hedge goes on.
     *
     * The eject key survives anyway, and ONLY because of the two axes below
     * it. `denomination`: a hedged lane returns in USD, an unhedged one
     * returns in cbETH, and no model ranks a unit. `offChainVenues`: the
     * hedge IS a Hyperliquid account, with its own custody, its own uptime
     * and its own withdrawal path, and some builders will pay yield not to
     * have one.
     *
     * Neither of those is in the objective and neither ever will be. Declared,
     * the press is a defensible trade a builder can read. Undeclared, the
     * dominance sweep deletes it — and it would be RIGHT to, which is exactly
     * why this declaration lands before the sweep runs.
     */
    axes: ["netApy", "capacity", "denomination", "offChainVenues"],
    params: [
      {
        // A12: the admissible max is 1/(MM + restore offset) — the leverage
        // at which the short still opens OUTSIDE the refill band. On a coin
        // with HL maxLeverage 3 that is 2.88, so the old flat 5 (and the old
        // default of 3) opened inside the band the refill rail defends.
        // `descriptorsFor` derives it per coin; 5 is the loosest tier (ETH).
        //
        // AXES (P0-B). Three at once, measured: +1.13pp to +3.78pp of APY
        // across the dial, capacity −25.7%, and the short's own margin ratio
        // 66.7% → 20.0%. That last one is the axis that keeps the dial a
        // control: a naive argmax over the objective sets this to its ceiling
        // on every row, and the ceiling is where the short sits closest to
        // its own liquidation. `shortMargin` is not in the objective, so
        // under L4 this may not be auto-maximised.
        //
        // `defaultRationale: shortMargin`. The default is 3, not the ceiling,
        // and the ceiling is what `netApy` alone would pick. It is
        // deliberately conservative on the one axis the model does not carry,
        // and L3 requires that axis to be named here and rendered beside it.
        // (The default is additionally floored by `hedgeLeverageBounds` at
        // `1/restore` per coin — the leverage at which the short still OPENS
        // outside the refill band.)
        field: "hedgeLeverage",
        friendlyLabel: "Hedge leverage",
        type: "slider",
        axes: ["netApy", "capacity", "shortMargin"],
        defaultRationale: "shortMargin",
        default: 3,
        min: 1.5,
        max: 5,
        step: HEDGE_LEVERAGE_GRID,
        unit: "x",
        advanced: true,
        help: "Leverage on the perp short. Lower needs more margin; higher trims capacity headroom. Enters the escrow term, so it moves both APY and capacity.",
      },
      {
        // A11: the floor is `restore − safetyFloor`, the refill this reserve
        // exists to fund. A reserve smaller than its own refill is not a
        // reserve. Coin-invariant, so it is safe as a structural bound.
        //
        // AXES (P0-B). The cleanest control in the product, and its third
        // axis is exact rather than modeled: `RESERVE_MIN_FRACTION` IS
        // `restore − safetyFloor`, so 0.15 funds exactly 1.00 refill from the
        // defender floor back to restore and 0.30 funds 2.00. The price of
        // the second refill is measured at −0.34pp to −1.23pp of APY and
        // +10.1% of capacity. Two refills or one, for 0.81pp.
        //
        // ⚠ NO `defaultRationale`, AND THE REASON MATTERS. The default sits
        // at the floor, which IS the argmax on `netApy` and on `capacity`, so
        // L3 owes nothing. What it also is, is the BOTTOM CORNER of
        // `refillsFunded` — the corner L4 names, on an axis outside the
        // objective. That is precisely why this may not be auto-set and why
        // the control renders (and why it belongs on the plate face, not two
        // presses deep behind Advanced): the justification for a default at
        // an unpriced corner is a visible control beside it, not a field.
        field: "reserveFraction",
        friendlyLabel: "Margin reserve",
        type: "slider",
        axes: ["netApy", "capacity", "refillsFunded"],
        default: RESERVE_MIN_FRACTION,
        min: RESERVE_MIN_FRACTION,
        max: 0.3,
        step: RESERVE_GRID,
        unit: "of short",
        advanced: true,
        help: "Idle margin kept aside to absorb funding and drawdown before a refill fires. Enters the escrow term, so it moves both APY and capacity.",
      },
      // R1 (2026-08-22): the `deltaBandPct` dial is GONE. A13 was right that
      // the band was hard-coded and exposed nowhere; the fix was wrong. The
      // band is not a preference, it is the resize size the venue and the
      // watchers permit, so it is DERIVED — see `derivedDeltaBandPct`, which
      // carries the three grounds. All three options the dial offered were
      // below the smallest executable band at the launch cap AND at least 4x
      // tighter than the drift edge production actually runs.
      {
        // A13: the funding guard's floor was the house constant −0.05 with no
        // dial behind it, so the vault page restated it instead of reading it.
        //
        // AXES (P0-B). ONE, and `netApy` is NOT it. All sixteen settings
        // price identically to zero — grepped: neither funding identifier
        // reaches `repriceAtLeverage`, `composedNetApy` or the reprice route,
        // which is why R2 already removed both from `QUOTE_AFFECTING_PARAMS`.
        // What the dial does move is the rate at which the guard unwinds the
        // leg, and that is real and publishable.
        //
        // Pricing it would need `P(funding < floor for N epochs)`; the payload
        // carries `fundingP25Apr` and nothing else. So `guardTrigger` is
        // declared `direction: "neither"` — a deeper floor keeps a paying lane
        // running through a bad stretch and keeps a losing one running too.
        // An axis with no better end can never make a setting dominated,
        // which is the honest state of this dial: not a trade, a tempo.
        //
        // D4 (2026-09-01): the bounds were typed (−0.15 and 0 both). The max
        // stays 0 because it is a definition, not a market number — above
        // zero the short still pays and there is nothing to guard. The min is
        // now the committed catalog's measured funding depth
        // (`STRUCTURAL_MIN_FUNDING_FLOOR`), and `descriptorsFor` narrows it
        // to the placed book's own measured depth via
        // `fundingFloorAprBounds`.
        //
        // ⚠ RECETTE v2 (DEF-01 / QNT-R2-2, 2026-09-02): "a stop deeper than
        // the book has ever printed is dead slider" survives as the law, but
        // the narrowing was reading `|p25|` — a POSITIVE carry percentile —
        // as if it were the book's measured drawdown, so a healthy book
        // retuned this guard tighter than the house floor and published the
        // retune. `fundingFloorAprBounds` now reads the negative side only
        // and can never come up shallower than `HOUSE_FUNDING_FLOOR_APR`.
        // And the dial is now RENDERED (PlateControls, hedge branch): a
        // control that publishes into the record must be reachable by the
        // builder who publishes it.
        //
        // ⚠ X1 (G7 re-rule, 2026-09-02): THIS MIN IS THE ENVELOPE, NEVER WHAT
        // A SEATED LANE DRAWS. With the dial rendered, the "no measured
        // negative" case fell back HERE — to the catalog-wide −53% — on 45 of
        // 52 live hedged rows, 90% of the track dead by the law two paragraphs
        // up. A placed book with no measured negative now gets the house band
        // from `fundingFloorAprBounds`; this literal is reached only when no
        // lane context is supplied at all.
        field: "fundingFloorApr",
        friendlyLabel: "Funding floor",
        type: "slider",
        axes: ["guardTrigger"],
        default: HOUSE_FUNDING_FLOOR_APR,
        min: STRUCTURAL_MIN_FUNDING_FLOOR,
        max: 0,
        step: FUNDING_FLOOR_GRID,
        unit: "APR",
        advanced: true,
        help: "The funding rate at which the short stops paying for itself and the guard unwinds the leg.",
      },
      {
        // A13: the guard's N was hard-coded 3 (`fundingDeallocPeriods`). The
        // persistence window is the difference between a guard and a twitch.
        //
        // AXES (P0-B). Same shape as the floor above and the same single
        // axis: 48 combinations of the two, one number in the payload. The
        // persistence window is the difference between a guard and a twitch,
        // which is a real property of the machine and a publishable field —
        // and it is not a yield trade, so `netApy` is not declared. Nothing
        // anywhere tells a builder what 3 buys over 1, which is L5's charge
        // against it, not L1's.
        field: "fundingWindowEpochs",
        friendlyLabel: "Funding window",
        type: "segmented",
        axes: ["guardPersistence"],
        default: "3",
        options: [
          { value: "1", label: "1 epoch", shortLabel: "1" },
          { value: "3", label: "3 epochs", shortLabel: "3" },
          { value: "6", label: "6 epochs", shortLabel: "6" },
        ],
        advanced: true,
        help: "How many funding epochs must sit below the floor before the guard fires.",
      },
    ],
  },

  "auto-compound": {
    key: "auto-compound",
    name: "Auto-compound",
    tagline: "Recapture yield back into the loop",
    description:
      "When earned yield loosens the health factor, the leverage module pulls it back to target so returns compound instead of idling.",
    rank: 3,
    optional: true,
    // THE INSTALL DECISION, and its dominance is a fact about VAULT SIZE
    // rather than about the module. At the reference TVL it adds +0.042pp to
    // +0.671pp on 15 of 15 rows; below `TVL < 8·gas/r²` ($593 to $3,097
    // across the catalog) the gas outruns the lift and it turns negative.
    // Both axes it moves are declared: the signed delta, and the actions it
    // adds to the vault's year.
    axes: ["netApy", "actionCount"],
    params: [
      {
        //
        // AXES (P0-B). Measured inert on 15 of 15 at the modelled seed: the
        // firing count `n` is ACCRUAL-bound at 5.8 to 19.4 a year against
        // 121.7 permitted at the loosest setting, so all three cells produce
        // identical output to every decimal. The dial wakes with size —
        // roughly $377K (72h), $1.13M (24h), $4.5M (6h) — and above those it
        // moves both axes it declares.
        //
        // `objective: netApy`, and L4 permits the auto-set here for a reason
        // worth stating: where the cadence is inert it moves NO axis at all,
        // so the condition "every axis it moves is inside the model" is
        // satisfied vacuously. Where it wakes, it stops being inert and this
        // becomes a control again — which is why the ruling is "DEFAULT, gate
        // PRESENCE on TVL" rather than "delete".
        field: "cadence",
        friendlyLabel: "Cadence",
        type: "select",
        axes: ["netApy", "actionCount"],
        objective: "netApy",
        default: "24h",
        options: [
          { value: "6h", label: "Every 6 hours", shortLabel: "6h" },
          { value: "24h", label: "Daily", shortLabel: "24h" },
          { value: "72h", label: "Every 3 days", shortLabel: "72h" },
        ],
        help: "How often the recapture check runs. Each action costs gas, so denser is not always better.",
      },
      {
        // A10: the old default of $25 was 208 days of accrual at the $500
        // launch cap — a threshold the vault's own numbers could never reach,
        // so the rule published and never fired.
        //
        // A3 (2026-08-22): its replacement was worse in a subtler way. The
        // derivation was `2·gas/carry`, the size at which one action's gas is
        // paid back twice over — i.e. the module's own BREAK-EVEN, which is by
        // construction the zero of the thing it governs. Verified: at that
        // threshold `compoundDelta` returns −0.0019pp / −0.0002pp / +0.0066pp
        // across the live rate range, and at the $10 that actually shipped it
        // is NEGATIVE on 13 of 13 accruing rows. The default is now the
        // ARGMAX, `θ* = √(2·gas·TVL)` — see `derivedMinActionUsd`.
        //
        // The range [5, 500] spans θ* for every TVL the priced model can be
        // asked about: θ*($500 launch cap) = $20, θ*($25K) = $155, and 500 is
        // exactly θ*($250K).
        //
        // AXES (P0-B). Two, and this is the one entry in the table where the
        // two move TOGETHER rather than against each other: below θ* the lane
        // takes LESS APY and MORE actions simultaneously, on every row at
        // every TVL. The left half of a shipped slider is dominated by
        // arithmetic, not by measurement — `θ* = √(2·gas·TVL)` is an interior
        // argmax and it is carry-independent, so the same value is optimal on
        // a market paying 42% and one paying 3%.
        //
        // `objective: netApy`, and the auto-set is clean under L4: at θ* the
        // chosen value is weakly best on `actionCount` too, so there is no
        // unpriced corner being spent. Right half kept, value set.
        field: "minActionUsd",
        friendlyLabel: "Harvest threshold",
        type: "number",
        axes: ["netApy", "actionCount"],
        objective: "netApy",
        default: derivedMinActionUsd(REFERENCE_TVL_USD, HL_MIN_ORDER_USD),
        min: 5,
        max: 500,
        step: 5,
        unit: "USD",
        help: "Skip recapture below this size so fees never eat the gain.",
      },
    ],
  },
  // ── Template-family modules (TEMPLATE_DEEPLINKS 2026-08-21) ─────────────
  // Not on the loop spine: auto-center anchors the delta-neutral LP family,
  // covered-call + protective-put anchor the treasury-collar family. Ranks
  // reuse the spine columns (graph-ops FAMILY_CHAINS wires each family).

  "auto-center": {
    key: "auto-center",
    name: "Auto center",
    tagline: "Recenters the range as price walks",
    description:
      "Watches the LP position against its range. When price walks toward an edge, the range recenters so fees keep accruing instead of the position going one-sided.",
    rank: 1,
    optional: true,
    // Structural on the dn-LP family (`STRUCTURAL_MODULES.dnlp`): the range
    // IS the position, so there is no eject press to defend. The axes are
    // declared anyway, because the install press exists on the module-first
    // path and L1 binds it there.
    axes: ["netApy", "actionCount"],
    params: [
      {
        //
        // AXES (P0-B). GENUINELY NON-MONOTONE, which is rare enough in this
        // table to be worth naming: 5.37% / 4.40% / 3.05% of modeled APY
        // against 1,773 / 638 / 160 recenters a year. `dnLpFeeApr ∝ 1/range`
        // and `dnLpRecenterApr` charges σ²/d² events at a per-event cost, so
        // tightening stops paying for itself somewhere — and where depends on
        // the vault's size.
        //
        // `defaultRationale: actionCount`. The priced argmax is the tightest
        // cell (1.5% at trigger 95), which is 4.9 recenters a DAY on a
        // reference vault and is where the fee model's 1/range term runs off
        // the end of its own domain. The descriptor ships the middle cell
        // instead, and L3 requires that departure to name the axis it
        // optimises: the action count. Not in the objective — the gas of each
        // action is charged, the operational load of five a day is not — so
        // under L4 this may not be auto-set, and it renders.
        field: "rangePct",
        friendlyLabel: "Range width",
        type: "segmented",
        axes: ["netApy", "actionCount"],
        defaultRationale: "actionCount",
        default: "2.5",
        options: [
          { value: "1.5", label: "±1.5%", shortLabel: "±1.5%" },
          { value: "2.5", label: "±2.5%", shortLabel: "±2.5%" },
          { value: "5", label: "±5%", shortLabel: "±5%" },
        ],
        help: "Half-width of the concentrated range. Tighter earns more fees in range but recenters more often.",
      },
      {
        // E7: the control the strategy actually needs. Range width alone does
        // not determine realized fees; how far price may walk toward the edge
        // before the range moves is the other half, and it bounds the model.
        //
        // AXES (P0-B), AND THE DECLARATION IS THE INDICTMENT.
        //
        // Both axes are declared honestly and both point the same way: at
        // EVERY range, 95 pays more APY and fires FEWER recenters than 80 and
        // 60. There is no cell that wins on anything. That is not a market
        // fact, it is a model fact — `dnLpModel` charges σ²/d² events and a
        // per-event cost and carries NO term for time out of range with
        // skewed inventory, so one end wins because our own model has no cost
        // side for it.
        //
        // ⚠ NO `defaultRationale`, and the absence IS the finding. The
        // descriptor ships "80", which is off the argmax, and L3 demands the
        // axis that default optimises instead. There is none, because the
        // missing quantity is not measurable here. Under L11 that makes it a
        // `blind` register entry, not an axis, and under L1 it makes this
        // control a fork with a right answer. It goes, or the model gains its
        // cost side first. Do NOT relabel it, and do not invent a rationale
        // to make this line compile clean.
        field: "recenterTriggerPct",
        friendlyLabel: "Recenter trigger",
        type: "segmented",
        axes: ["netApy", "actionCount"],
        default: "80",
        options: [
          { value: "60", label: "60% of range", shortLabel: "60%" },
          { value: "80", label: "80% of range", shortLabel: "80%" },
          { value: "95", label: "95% of range", shortLabel: "95%" },
        ],
        help: "How far price walks toward the range edge before the range recenters. Earlier keeps fees flowing and pays more gas.",
      },
    ],
  },

  "covered-call": {
    key: "covered-call",
    name: "Covered call",
    tagline: "Writes calls above spot, premium is the income",
    description:
      "Writes calls a fixed distance above spot against the treasury position and rolls them on cadence. The premium is the income; upside above the strike is sold.",
    rank: 1,
    optional: true,
    // Structural on the collar family, and the axes say why it may never be
    // installed alone: writing the call moves the printed return AND sells
    // the upside above the strike. A written call with no floor prices at
    // +44.49% APR with the sold upside charged nowhere — the most seductive
    // number the module set can reach. Declaring `upsideCap` is what makes
    // the second half of that trade visible instead of free.
    axes: ["netApy", "upsideCap"],
    params: [
      {
        field: "strikePct",
        friendlyLabel: "Call strike",
        type: "segmented",
        /* ⚠ ONE OWNER (P0-9, landed in the wave audit 2026-08-22). This is the
           SOLE default for the collar's call strike. `COLLAR_DEFAULT_DIALS`
           reads it through `dialDefault`, so the value `COLLAR_CANDIDATE` is
           priced at and the value a module-first collar installs cannot
           diverge again. Moving it reprices the row and moves the template
           harness; that is the point, and it is why there is only one of it.

           It was "15" here while `COLLAR_DEFAULT_DIALS` pinned "10". Measured
           live on `/build?new=1`: a collar composed by hand seated `written
           +15%` on the rack and published `modeled 11.8%`, which is
           `collarModel` at a +10% strike. That model at +10/−12/30d is
           +12.474%; at +15/−12/30d it is −2.482%. A sign-flipped error of
           14.96pp, reachable only by the build path this wave opened, and
           invisible on every shipped surface because the template pinned the
           other value. */
        //
        // AXES (P0-B). A REAL CONTROL, and what it sets is where the cap
        // sits. The printed number spans 67.6pp across the nine strike/floor
        // combinations; under flat `COLLAR_IV` with r = 0 the EXPECTED total
        // return moves by exactly 0.00pp, because the premium is precisely
        // the compensation for the upside sold. Both facts are true at once
        // and the two axes carry both: `netApy` is the cash flow the model
        // prices, `upsideCap` is what that cash was paid for. Declaring only
        // the first is how a premium comes to read as income.
        //
        // No `defaultRationale`: "10" IS the argmax of the priced model at
        // the shipped floor and tenor. It is the one default in the option
        // legs that owes no explanation.
        axes: ["netApy", "upsideCap"],
        default: "10",
        options: [
          { value: "10", label: "+10%", shortLabel: "+10%" },
          { value: "15", label: "+15%", shortLabel: "+15%" },
          { value: "20", label: "+20%", shortLabel: "+20%" },
        ],
        help: "Strike distance above spot. Closer earns more premium but caps upside sooner.",
      },
      {
        //
        // AXES (P0-B). Two, and both are computed from the same table: at the
        // shipped strike and floor the priced model pays 13.53% / 11.83% /
        // 9.09% at 26.1 / 12.2 / 6.1 rolls a year. So the yield argmax is the
        // SHORTEST tenor and it is also the busiest, which is the trade.
        //
        // `defaultRationale: actionCount`. The descriptor ships 30d, one cell
        // off the priced argmax, and the axis it buys is half the rolls. That
        // is the honest naming; the other half of the story is not an axis at
        // all. Under flat `COLLAR_IV` with r = 0 the EXPECTED total return is
        // `−rollCost × 365/days` and nothing else, so on expectation 60d
        // dominates both — and the counter-term that would decide it is a
        // volatility term structure, which is inside the hard ban. Under L11
        // that is a `blind` register entry, named and never sized, not a
        // third axis here.
        field: "rollDays",
        friendlyLabel: "Roll cadence",
        type: "segmented",
        axes: ["netApy", "actionCount"],
        defaultRationale: "actionCount",
        default: "30",
        options: [
          { value: "14", label: "14d", shortLabel: "14d" },
          { value: "30", label: "30d", shortLabel: "30d" },
          { value: "60", label: "60d", shortLabel: "60d" },
        ],
        help: "How often the written call rolls to a fresh strike.",
      },
    ],
  },

  "protective-put": {
    key: "protective-put",
    name: "Protective put",
    tagline: "Holds a floor under the position",
    description:
      "Holds puts a fixed distance below spot, funded by the written calls. The floor pays if it breaks; between roll dates the position cannot fall past it.",
    rank: 2,
    optional: true,
    // Structural on the collar family. The install press costs premium and
    // buys the floor; both are declared, and the second is the reason a held
    // put is never dominated by ejecting it even though it is negative in all
    // nine dial combinations on its own.
    axes: ["netApy", "downsideFloor"],
    params: [
      {
        //
        // AXES (P0-B). The mirror of `strikePct`, on the other side of spot:
        // the printed model pays more the cheaper the floor, and the cheaper
        // floor is the further one.
        //
        // `defaultRationale: downsideFloor`. The priced argmax at the shipped
        // strike and tenor is the −15% cell; the descriptor ships −12%,
        // giving up modeled yield to move the floor three points closer to
        // spot. L3 requires that departure to name the axis it buys, and it
        // is a payoff envelope, not a rate — which is why the collar's own
        // register must be the envelope and not an APY.
        field: "floorPct",
        friendlyLabel: "Put floor",
        type: "segmented",
        axes: ["netApy", "downsideFloor"],
        defaultRationale: "downsideFloor",
        default: "12",
        options: [
          { value: "8", label: "-8%", shortLabel: "-8%" },
          { value: "12", label: "-12%", shortLabel: "-12%" },
          { value: "15", label: "-15%", shortLabel: "-15%" },
        ],
        help: "Floor distance below spot. Closer protects sooner but eats more of the call premium.",
      },
    ],
  },

  /**
   * THE EXOGENOUS RISK MODULE — the first OVERLAY (2026-08-26).
   *
   * It sits on no family chain (see `types.ModuleKey`), so it earns no rail
   * segment, no wire and no place in `CARRY_MODULES`. What it does is name,
   * per lane, the outside parties that lane's own capital route actually has,
   * and pair each with a written response. The derivation lives in
   * `lib/canvas/exogenous.ts` and NOTHING here duplicates it.
   *
   * THE NAME IS NOT OURS TO CHOOSE. `priime.finance` stack card 02 and the
   * `/loop` module pill both ship `Exogenous Risk` today; sentence case is the
   * canvas convention every sibling above follows. Confirmed, not invented.
   *
   * ⚠ ITS AXES ARE NOT `netApy`, AND THAT IS THE POINT. Watching a dependency
   * does not move a yield, and declaring that it did would be the
   * over-declaration L2 exists to catch. The two axes below are counts a
   * builder can check on their own lane, moving in opposite directions, which
   * is why no stop of the control dominates another and why the eject key
   * survives the sweep.
   */
  /**
   * THE REDEMPTION ROUTE — the treasury family's rank-2 anchor, where the loop
   * family seats its hedge (BASIS CARRY + TREASURY FLOOR, WP-3).
   *
   * It is the module that answers the one question a tokenized-treasury lane
   * has and a loop lane does not: how the position becomes cash again. A loop
   * lane leaves by repaying and withdrawing, which is atomic; an issuer
   * position leaves through a fund's own redemption machinery, which is not.
   * That wait is the lane's whole exit cost, and it is a MIGRATION cost — it
   * is charged when capital LEAVES, so it reaches the router's arithmetic
   * (`orchestrator/rule-schema.exitProfileFor`) and never the lane's own
   * steady-state quote. See `QUOTE_AFFECTING_PARAMS` below.
   *
   * ⚠ TWO PARAMS, AND ONLY ONE OF THEM IS A CONTROL. `settlementDays` is a
   * measurement about the issuer, written from the picked row exactly the way
   * `liquidity-source.pairLabel` and `hlCoin` are. `exitPath` is the choice:
   * which of the routes the issuer publishes this lane takes. Rendering the
   * measurement as a dial would invite a builder to tune a fund's published
   * settlement window, which is the second-opinion-about-the-market defect
   * this file's Rule 1 exists to refuse.
   *
   * THE INSTALL DECISION moves the exit window and the size the route can
   * absorb — `exitCost` and `capacity`. Both are read off the picked row.
   * Neither is asserted here, and `netApy` is deliberately NOT declared: a
   * redemption route does not move what the position earns while it is held,
   * and declaring that it did would be the over-declaration L2 catches.
   *
   * H-5 · TODO: legal. The wrapped-carry source on this family carries a
   * jurisdiction seam (a BaFin MiCAR wind-up of the EU-facing entity, not a
   * clause in a terms document anyone can point at). Recorded at the module
   * level and deliberately unresolved; cross-referenced to
   * `memory/priime-sec-peirce-play.md`.
   */
  "redemption-route": {
    key: "redemption-route",
    name: "Redemption route",
    tagline: "Turns the issuer position back into cash",
    description:
      "Carries how this lane leaves its issuer position: which of the routes the issuer publishes the redemption takes, and how many days the capital waits before it is cash again.",
    rank: 2,
    optional: true,
    axes: ["exitCost", "capacity"],
    params: [
      {
        /**
         * THE ISSUER'S OWN PUBLISHED WINDOW, PINNED.
         *
         * HIDDEN, so GATE 1's rendering obligation does not bind, and pinned
         * for the same reason `candidateId` is: it has exactly one legal value
         * once the market is picked, and a set of settings with one member
         * moves nothing.
         *
         * ⚠ NO STRUCTURAL `min`/`max`. The placeholder this replaces carried a
         * typed `min: 0, max: 30`, and Rule 1 refuses it: 30 is a second
         * opinion about how long a fund may take to settle, it is nowhere
         * measured, and it would silently CLAMP an issuer that publishes a
         * longer window down to a number the issuer never said. The bound is
         * derived instead — `deriveDescriptor` pins `min = max = default` to
         * the row's own stated window, which is what makes `reclampLoopParams`
         * re-pin the field on a market swap rather than carry the previous
         * issuer's window onto the new one.
         *
         * The structural default is 0, and it is NOT a claim of same-day
         * settlement: it is the value of a lane that has pinned no issuer, the
         * numeric twin of the `""` the four pinned records on
         * `liquidity-source` carry. The rack cannot seat this module before a
         * market (`rackItems` gates every ghost bay on `hasMarket`), so no
         * surface reads it in that state.
         *
         * H-7: the window is a `stated` reading sourced to a named issuer
         * offering document, never a measurement. A treasury row that states
         * no window must not ship — `exitCost` would then read 0 days and
         * print a fact the issuer never published.
         */
        field: "settlementDays",
        friendlyLabel: "Settlement days",
        type: "number",
        axes: ["exitCost"],
        default: 0,
        hidden: true,
        help: "Days from redemption request to cash, as published by the issuer.",
      },
      {
        /**
         * WHICH ROUTE THE REDEMPTION TAKES — the one control on this module.
         *
         * THE OPTION SET IS DERIVED, NOT TYPED. `EXIT_ROUTE_OPTIONS` above is
         * the structural envelope, the widest set any issuer could publish;
         * `deriveDescriptor` rebuilds it from the routes the PICKED issuer
         * actually published, under that issuer's own labels. A hand-typed
         * option set is the same defect as a hand-typed max, one level up —
         * that is ruling R1, and it is the ruling that deleted `deltaBandPct`.
         * The fetched rows are what make it a real narrowing rather than a
         * ceremony: the six issuers do not publish the same routes, and one of
         * them puts a $50,000 floor on the only route it offers above $5,000.
         *
         * AND A ONE-ROUTE SEGMENTED CONTROL IS A DEAD CONTROL. Where the
         * narrowing leaves a single route, the narrowed descriptor comes back
         * `hidden`, so the control is not drawn at all — the same answer the
         * rack gives a dominated bay (`rack-row`'s ghost-bay ruling): nothing
         * renders, rather than an inert key that re-announces the absence. The
         * field is still written and still clamped, so the lane keeps the one
         * route its issuer runs and the record still states it.
         *
         * AXES · `exitCost`, and one only. Which door the capital leaves by is
         * what decides how long it waits, and days are the quantity the
         * settings move.
         *
         * ⚠ KNOWN GAP, IN A FILE THIS PACKAGE DOES NOT OWN, and it is reported
         * rather than papered over. `axes.exitCost.read` (axes.ts:770) reads
         * the pinned `settlementDays` off the lane's params and nothing else,
         * while `dominance.settingLanes` changes ONE field per setting — so
         * the sweep cannot see this control move its own axis and will report
         * it `tied`. The fix belongs in the renderer: read the HELD route's
         * own window out of the picked issuer's `routes`, not only the pinned
         * fastest one. Widening this declaration or inventing a second axis to
         * escape the verdict would be precisely the over-declaration L2 exists
         * to catch, so neither is done here.
         *
         * NO `objective`, NO `defaultRationale`, and the structural default is
         * not an argmax: `issuer-wire` is the route every fund has by
         * construction — a transfer agent that redeems the share and wires
         * dollars is what makes it a fund — so it is the only value that is
         * legal on the widest set. It is a FALLBACK and nothing more: the
         * moment a lane is supplied, `deriveDescriptor` takes the row's own
         * `defaultRouteId`, which `templates.fastestExitRoute` derives from the
         * fetched documents.
         */
        field: "exitPath",
        friendlyLabel: "Exit route",
        type: "segmented",
        axes: ["exitCost"],
        default: "issuer-wire",
        options: [...EXIT_ROUTE_OPTIONS],
        help: "Which of the routes this issuer publishes the lane leaves by. Each route carries its own settlement window, minimum and daily limit, from the issuer's own document.",
      },
    ],
  },

  "exogenous-risk": {
    key: "exogenous-risk",
    name: "Exogenous risk",
    tagline: "Watches the parties this lane depends on",
    description:
      "Derives the parties this lane depends on from its own capital route, and pairs each one with a written response. Change the route and the list changes with it.",
    /* Rank 4: off the spine, drawn after the last chain bay. The overlay has
       no position ON the capital order because no capital passes through it. */
    rank: 4,
    optional: true,
    /* THE INSTALL DECISION. Installing names parties the lane's register
       currently files under one `blind` row, so `dependenciesAnswered` rises
       from nothing to the derived count and `responseTriggers` rises with it.
       Ejecting takes both back to zero. Opposed directions on the two axes is
       what makes the press a trade rather than a dominated switch. */
    axes: ["dependenciesAnswered", "responseTriggers"],
    params: [
      {
        /**
         * THE ONE ORDERED CONTROL, and its cells print COUNTS.
         *
         * `Low | Medium | High` is the ratified adjective ban wearing a new
         * coat and is refused. A stop is a THRESHOLD ON THE EVIDENCE this lane
         * actually holds about each party, so it partitions the lane's OWN
         * derived set into the parties that carry a written response and the
         * parties that carry a name only, the halves sum to the set size, and
         * the cells print the integer the choice produces. That is the
         * leverage-stop grammar applied to a different quantity, and it
         * inherits that ruling whole.
         *
         * ⚠ THE CELLS WERE THIRDS (recette fix, 2026-08-27). This comment used
         * to promise `2 | 4 | 6` and `2 | 3 | 4`; `answeredCountAt` produced
         * them as `ceil(n/3) | ceil(2n/3) | n` over the PARTY COUNT, with no
         * reference to any gate. The paragraph three below — "the default
         * answers only the parties a quantity is actually read on" — was
         * therefore FALSE on every modeled lane the product ships: on the
         * delta-neutral LP template, a hand-authored row nothing scanned, the
         * `Read` stop answered two parties. Reading is a property of a party,
         * not of how many siblings its route happens to have.
         *
         * AXES. Two, both counts, both moved by every stop, and DIFFERENT
         * INTEGERS: the venue carries five readable gates and the bridge
         * carries at most one, so a stop that admits the venue costs many more
         * triggers than one that admits the route. `direction` is opposed on
         * the two, so no stop is weakly better on both and `controlRemoved`
         * cannot fire.
         *
         * `defaultRationale: responseTriggers`. The default answers only the
         * parties a quantity is actually read on, which is the argmax on
         * triggers and the ANTI-argmax on the count answered. L3 requires that
         * departure to name the axis it buys, and this is it. The option
         * VALUES are evidence words rather than grades because the line cuts
         * through the evidence ordering, not through a severity ranking that
         * does not exist.
         */
        field: "posture",
        friendlyLabel: "Answered",
        type: "segmented",
        axes: ["dependenciesAnswered", "responseTriggers"],
        defaultRationale: "responseTriggers",
        default: "measured",
        /* THE STORED VALUES DO NOT MOVE — a canvas is URL-encoded and
           `postureOf` falls back to the narrow stop on an unknown string, so
           renaming a value would silently downgrade every saved link. Only the
           LABELS change, to the predicate each stop actually applies: `Named`
           was the one word that could not be right, because every party on
           this strip is named. */
        options: [
          { value: "measured", label: "Read", shortLabel: "Read" },
          { value: "named", label: "Readable", shortLabel: "Readable" },
          { value: "all", label: "All", shortLabel: "All" },
        ],
        help: "How far past the evidence a written response goes. Read answers the parties this lane holds a full reading of, Readable adds the ones we hold an instrument for, All adds the ones nothing reads. The rest carry a name and no more.",
      },
      /* ── THE SIX HOLDS ────────────────────────────────────────────────
         One per counterparty SLOT, fixed forever because the enumeration in
         `exogenous.ts` is closed. NEVER a list and never a joined string:
         `clampAgainst` polices a boolean exactly, so no stored value can be
         invalid, and a hold on a party the lane does not have is INERT rather
         than STALE because every renderer walks the DERIVED set. That is why
         this design does not depend on `reclampLoopParams`, which was written
         for exactly this hazard and has no callers anywhere.

         Each moves ONE party across the answered line, in either direction,
         and none can remove a party from the named set — which is what makes
         the completeness claim `skipBarLabel` refuses unreachable by
         construction rather than by convention. Same two axes as the stop
         above, and for the same reason. */
      HOLD("holdBridge", "Hold the bridge"),
      HOLD("holdVenue", "Hold the venue"),
      HOLD("holdAssetIssuer", "Hold the asset issuer"),
      HOLD("holdPriceFeed", "Hold the price feed"),
      HOLD("holdHedgeVenue", "Hold the hedge venue"),
      HOLD("holdScan", "Hold the scan"),
    ],
  },
};

export const SPINE_ORDER: ModuleKey[] = [
  "liquidity-source",
  "safety-buffer",
  "hedge",
  "auto-compound",
];

/** Every module key in display order (publish chips, module lists). Covers
 *  all three lane families; a lane only ever holds a subset. */
export const DISPLAY_ORDER: ModuleKey[] = [
  "liquidity-source",
  "safety-buffer",
  "auto-center",
  "covered-call",
  "protective-put",
  "hedge",
  /* Beside the hedge, because they are the same rank and the same KIND of
     decision: a lane's rank-2 anchor. `hedge-or-exit` refuses a lane holding
     both, so the two never render as a stack. */
  "redemption-route",
  "auto-compound",
  /* THE OVERLAY IS LAST, because it is the only member that is not a step on
     any lane's capital order. Everything keyed on this list — the shelf, the
     compose sort, `HOME_FAMILIES`, the rack's fallback rank — reads it as
     "after the chain", which is exactly where an overlay belongs. */
  "exogenous-risk",
];

/**
 * THE RAIL'S WORD for each module (§4C, §7A), beside `DISPLAY_ORDER` because
 * both are the module list's presentation order and vocabulary rather than its
 * economics.
 *
 * These are ABBREVIATIONS, not names: `.rail-seg-labels i` renders at Fraunces
 * 7.5 in a 210px meter, so five segments give each label 38.8px — a hard
 * ceiling of TEN characters. `Dynamic leverage` (16) and `Protective put` (14)
 * both clip there; `Leverage` and `Put` do not. Nothing outside the meter may
 * use these: a module is called by its `MODULE_DEFS[key].name` everywhere a
 * builder can read a whole line.
 *
 * `liquidity-source` is `Market` because the rail names the STEP the module
 * completes, and pinning the market is that step.
 */
export const SHORT_LABEL: Record<ModuleKey, string> = {
  "liquidity-source": "Market",
  "safety-buffer": "Leverage",
  hedge: "Hedge",
  "auto-center": "Range",
  "covered-call": "Call",
  "protective-put": "Put",
  "auto-compound": "Compound",
  /* 4 characters, well inside the ten-character meter ceiling, and REACHABLE:
     `redemption-route` is on the treasury chain, so the rail renders
     Market / Exit / Compound.

     `Exit` and not `Redeem`, because the rail names the STEP the module
     completes rather than the mechanism it completes it with, the same rule
     that makes `liquidity-source` read `Market`. Redeeming is one of the two
     routes (`EXIT_ROUTE_OPTIONS`); the step is the same either way, and a
     segment reading `Redeem` on a lane whose route is the secondary market
     would name a mechanism that lane does not use. It matches
     `graph-ops.STEP_LABEL`, which is the rail's other owner. */
  "redemption-route": "Exit",
  /* 9 characters, inside the ratified ten — and UNREACHABLE, because
     `laneSteps` walks `FAMILY_CHAINS[bound]` and an overlay is on no chain.
     The Record demands an entry; the meter will never render one. */
  "exogenous-risk": "Exogenous",
};

export function getDef(key: ModuleKey): AxisModuleDef {
  return MODULE_DEFS[key];
}

// ── Per-market descriptor derivation (recette build item 2 and 3) ─────────
//
// `MODULE_DEFS` is the structural envelope. THIS is the market. Everything
// that reads a bound — the plate control, the dock control, the risk dial's
// snap grid, and the clamp in graph-ops — must read it from here, with the
// lane's context, or it is inventing a second opinion about the market.

export interface ParamContext {
  /** The picked market's liquidation threshold. Null before a market. */
  lt?: number | null;
  /** The scan's own leverage for the row (`economics.loopLeverage`). The dial
   *  may never ask for more than the scan itself allowed: above it the model
   *  refuses to reprice, so the slider moves and the number does not (A4). */
  scanLeverage?: number | null;
  /** The preset currently on the lane's safety-buffer. Scales the trim gap,
   *  and therefore the reachable ceiling. */
  preset?: RiskPreset;
  /** HL max leverage for the hedge coin (`hl.coins[hlCoin].maxLeverage`). */
  coinMaxLeverage?: number | null;
  /** Venue minimum viable order, USD (`coin.minViableOrderUsd`). */
  minViableOrderUsd?: number | null;
  /**
   * The lane's modelled net carry.
   *
   * A3 (2026-08-22): this NO LONGER reaches any descriptor. It was the input
   * to the harvest threshold's default, and that was the defect — θ* is
   * carry-independent, so a threshold derived from the carry is the module's
   * break-even rather than its optimum. Retained because `RackCanvas`'s
   * context literal still sets it; delete both together.
   */
  netCarryApr?: number | null;
  /**
   * The size the lane is being priced at, USD. The harvest threshold's only
   * real input (`θ* = √(2·gas·TVL)`). Absent, the reference TVL the priced
   * compound model itself evaluates at is used.
   */
  tvlUsd?: number | null;
  /**
   * Every funding percentile the placed book has measured: the row's headline
   * `economics.fundingP25Apr` plus each archived window's `p25Apr`. The
   * funding-floor dial derives its depth from these (D4, 2026-09-01).
   *
   * PRESENT-BUT-EMPTY IS A STATEMENT; ABSENT IS NOT (X1, 2026-09-02). A seated
   * lane always sets this field, `null` where the row measured nothing, and
   * that lane gets the house floor band. The field ABSENT means no lane was
   * supplied, and only then does the structural envelope stand. See
   * `deriveDescriptor`'s `fundingFloorApr` branch.
   */
  fundingP25Aprs?: readonly number[] | null;
  /**
   * The redemption routes the picked issuer publishes, and the settlement
   * window it publishes with them (WP-3).
   *
   * SAME THREE-STATE READING AS `fundingP25Aprs`, and for the same reason
   * (X1). A seated lane always sets this field: an `IssuerRedemption` on a
   * treasury row, `null` on every row that is not one. `null` is a STATEMENT —
   * this lane's market publishes no redemption machinery, so the route control
   * has nothing to be a choice between and does not render. The field ABSENT
   * is the other question entirely: no lane was supplied
   * (`descriptorFor(key, field)` with no context, the module's own
   * declaration), so the structural envelope stands.
   */
  issuerRedemption?: IssuerRedemption | null;
}

function finiteOr(v: number | null | undefined, fallback: number | null): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * The harvest threshold that MAXIMIZES what auto-compound is worth (A3).
 *
 * The objective is `max_θ [ lift(n(θ)) − gas(n(θ)) ]` where the threshold binds
 * the firing count at `n = TVL·r/θ`. In that regime the lift is `≈ r²/2·(…)`
 * and the gas is `r·g/θ`, and differentiating gives
 *
 *     θ*  =  √(2 · gasPerActionUsd · TVL)          floored at the min order
 *     the module pays at all iff  TVL  >  8 · gasPerActionUsd / r²
 *
 * Two properties of θ* matter more than its value.
 *
 *  1. IT DOES NOT DEPEND ON THE CARRY. The previous derivation was
 *     `2·gas/carry` and was anchored to `REFERENCE_NET_CARRY_APR = 0.117`, a
 *     rate no live row reaches (the catalog tops out at 8.01%). That was not
 *     mis-tuning, it was the wrong variable: a threshold set from the carry
 *     cancels the carry out of the objective and lands on the break-even.
 *
 *  2. IT IS AN ARGMAX, NOT A BREAK-EVEN. `2·gas/carry` is exactly the θ at
 *     which lift and gas are equal, so the dial's default WAS the zero of the
 *     module it governs — a dial that contributes nothing by construction. At
 *     θ* the same model pays +0.277pp on kHYPE at $25K.
 *
 * θ* is snapped DOWN to the descriptor's $5 grid (the objective is flat near
 * its max and a lower threshold fires more often), then raised to the venue's
 * minimum viable order, which is a hard executability floor and so is snapped
 * UP. Verified against a brute-force grid search: $50 at $2.5K, $155 at $25K,
 * $500 at $250K — the grid optimum at every size tested.
 */
export function derivedMinActionUsd(tvlUsd: number, minViableOrderUsd: number): number {
  const tvl = Number.isFinite(tvlUsd) && tvlUsd > 0 ? tvlUsd : REFERENCE_TVL_USD;
  const minOrder = Number.isFinite(minViableOrderUsd) && minViableOrderUsd > 0
    ? minViableOrderUsd
    : HL_MIN_ORDER_USD;
  const thetaStar = Math.sqrt(2 * RECAPTURE_GAS_USD * tvl);
  const onGrid = Math.floor(thetaStar / 5) * 5;
  const floor = Math.ceil(minOrder / 5) * 5;
  return Math.min(500, Math.max(5, floor, onGrid));
}

/**
 * The delta band the machine can actually hold, derived (R1, 2026-08-22).
 *
 * This replaces a three-option dial (±25 bp / ±50 bp / ±100 bp) that failed on
 * three independent grounds, any one sufficient:
 *
 *  • PHYSICALLY UNREACHABLE. A resize places `band · f_b · TVL` of notional
 *    against the venue's $10 minimum order. At the $500 launch cap the
 *    smallest EXECUTABLE band is 2.97%; all three options sat below it. The
 *    tightest option only becomes executable above $5,733 of TVL.
 *
 *  • OUTSIDE THE RAIL'S OPERATING RANGE. Production runs
 *    `HEDGE_DRIFT_REGROW_EDGE = 0.04` and `HEDGE_DRIFT_TRIM_EDGE = 0.08`. The
 *    dial's LOOSEST option was 4x tighter than the tightest thing the real
 *    machine runs, so every option was a promise about behaviour the watchers
 *    do not implement.
 *
 *  • THE COST CURVE HAD THE WRONG EXPONENT, which inflated the dial's own
 *    on-paper span. See the handoff note on `mock-quote.execDragApr`:
 *    rebalance COUNT goes as (σ/band)², but each rebalance trades notional
 *    PROPORTIONAL to band, so cost per unit time goes as 1/band, not 1/band².
 *
 * `escrowFraction` is f_b — pass `fbForComposition(comp)` from `mock-quote`,
 * which is its sole owner. This module cannot derive f_b (mock-quote imports
 * it, so the dependency only runs one way), and must not hold a second copy.
 *
 * Returns PERCENT, matching the units every existing consumer already prints
 * (`±${v.toFixed(1)}%`).
 */
export function derivedDeltaBandPct(escrowFraction: number, tvlUsd: number): number {
  const fb = Number.isFinite(escrowFraction) && escrowFraction > 0 && escrowFraction <= 1
    ? escrowFraction
    : 1;
  const tvl = Number.isFinite(tvlUsd) && tvlUsd > 0 ? tvlUsd : REFERENCE_TVL_USD;
  const executableFloor = HL_MIN_ORDER_USD / (fb * tvl);
  return Number((100 * Math.max(executableFloor, PRODUCTION_DRIFT_EDGE)).toFixed(2));
}

/**
 * The reachable leverage ceiling for a market: the house trim cap, and never
 * past what the scan itself priced.
 *
 * Founder ruling 2026-08-22: THE HOUSE MAXIMUM IS THE TRIM TRIGGER, not the
 * opening leverage. A ceiling the automation immediately trims back from is
 * not a maximum, it is a number on a slider. That drops the reachable top
 * from 4.17x to 3.50x at lt 0.95, and every surface that says "maximum" now
 * means it.
 */
export function leverageCeiling(ctx: ParamContext): number | null {
  const lt = finiteOr(ctx.lt, null);
  if (lt === null || lt <= 0 || lt >= 1) return null;
  const house = houseMaxLeverage(lt, ctx.preset ?? "standard");
  const scan = finiteOr(ctx.scanLeverage, null);
  const cap = scan !== null && scan > 1 ? Math.min(house, scan) : house;
  const floor =
    MODULE_DEFS["safety-buffer"].params.find((p) => p.field === "targetLeverage")?.min ??
    PRODUCT_MIN_LEVERAGE;
  return Math.max(floor, floorToGrid(cap, LEVERAGE_GRID));
}

/** The admissible hedge-leverage ceiling: the short must open OUTSIDE the
 *  refill band, i.e. at margin ≥ restore, so L_h ≤ 1/restore. D3
 *  (2026-09-01): the input finally arrives — the projection now carries the
 *  scan's own `native_perp` limit as `row.coinMaxLeverage` and
 *  `paramContextForLoop` forwards it, so this stops returning null on every
 *  real book. HYPE (venue maxLev 10) caps the dial at 4.0x and BERA (maxLev
 *  5) at 3.5x; the flat 5 was the ETH-tier (maxLev 25) bound only. */
export function hedgeLeverageCeiling(ctx: ParamContext): number | null {
  const cml = finiteOr(ctx.coinMaxLeverage, null);
  if (cml === null || cml <= 0) return null;
  const bands = deriveHlMarginBands(cml);
  const structural = MODULE_DEFS.hedge.params.find((p) => p.field === "hedgeLeverage");
  const lo = structural?.min ?? 1.5;
  const hi = structural?.max ?? 5;
  return Math.max(lo, Math.min(hi, floorToGrid(1 / bands.restore, HEDGE_LEVERAGE_GRID)));
}

/**
 * `fundingFloorApr` admissible range for a placed book (D4, 2026-09-01;
 * REDERIVED by recette v2, DEF-01 + QNT-R2-2, 2026-09-02).
 *
 * The max is 0 by definition — above zero the short still pays and the guard
 * has nothing to unwind. The DEPTH is the book's own measured NEGATIVE side.
 *
 * ══ WHAT WAS WRONG, AND WHY IT WAS INVISIBLE ══════════════════════════════
 *
 * This read `|p25|` over every archived percentile and mirrored the largest
 * magnitude below zero, on the stated law that "a stop deeper than the book
 * has ever printed is a dead slider". A p25 is the CONSERVATIVE CARRY
 * estimate, and on a book worth shorting it is POSITIVE — so the law's input
 * was never the quantity the law is about. Discarding the sign turned an ETH
 * book paying +1.43% into a claim that it had measured a −1.43% drawdown, the
 * band narrowed to [−0.02, 0], and the house −5% guard was silently retuned to
 * −2% on every ETH-collateral loop (−1% on LBTC/cbBTC), published to the vault
 * record as "Funding floor", with no control on the rack for the builder to
 * see it. The payload falsifies the claim in the same object: every window
 * ships `fractionNegative`, and ETH's 180d window prints 0.213 — a fifth of
 * its hours are negative, so "never printed" was never true.
 *
 * ══ WHAT IS ADMISSIBLE EVIDENCE ═══════════════════════════════════════════
 *
 *  · A NEGATIVE percentile is a measurement of the negative side: a quarter of
 *    that window's prints sat at or below it. It can only DEEPEN the band,
 *    because a percentile bounds the tail from one side only — the prints
 *    below it are, by construction, unmeasured and deeper still.
 *  · A POSITIVE percentile says nothing about the negative side. `fractionNegative`
 *    says negative prints EXIST; nothing in the payload says how deep they go.
 *    So the honest answer there is the house floor, not a tighter one.
 *
 * Hence: never shallower than `HOUSE_FUNDING_FLOOR_APR`, never deeper than the
 * structural envelope, and snapped AWAY from zero so the measured depth stays
 * reachable on the grid.
 *
 * ══ NO MEASURED NEGATIVE IS THE HOUSE BAND, NOT `null` ═════════════════════
 *
 * ⚠ G7 RE-RULE (recette v2, X1, 2026-09-02). The re-derivation above returned
 * `null` for a book with no measured negative, which handed the caller back to
 * the STRUCTURAL envelope — the catalog-wide deepest negative, TRUMP's −53% —
 * and the same wave made that descriptor render as a live dial. SWEPT over the
 * live catalog: 45 of 52 hedged rows drew a funding-floor slider running −53%
 * APR to 0 on books whose only measured funding is POSITIVE (cbETH/WETH
 * +1.46%, kHYPE/WHYPE +10.95%, the whole Dolomite Berachain set +9.85%), so 48
 * of the 53 grid cells were dead by this file's own law and a builder could
 * drag to −50% and publish "Funding floor −50.0% APR" beside a guard that can
 * never fire. Arithmetically right, useless as a control.
 *
 * So the answer with no negative evidence is EXACTLY the depth the house guard
 * ships at and nothing deeper. The default stays reachable, which is the only
 * thing the `null` branch was protecting, and every book that DOES carry a
 * measured negative is bit-identical to before.
 *
 * TOTAL, deliberately: an empty measurement set and an all-positive one are
 * the same epistemic state — no evidence of a negative — so they get the same
 * answer, and there is no longer a return value that means "ask someone else".
 * "No lane at all" is a DIFFERENT question and it is answered at the call site
 * (`deriveDescriptor`), which keeps the structural envelope when the context
 * states no measurement set at all.
 */
export function fundingFloorAprBounds(
  measuredP25Aprs: readonly number[] | null | undefined,
): { min: number; max: number; step: number } {
  const negatives = (measuredP25Aprs ?? []).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v < 0,
  );
  if (negatives.length === 0) {
    return { min: HOUSE_FUNDING_FLOOR_APR, max: 0, step: FUNDING_FLOOR_GRID };
  }
  const depth = floorToGrid(Math.min(...negatives), FUNDING_FLOOR_GRID);
  const min = Math.max(STRUCTURAL_MIN_FUNDING_FLOOR, Math.min(HOUSE_FUNDING_FLOOR_APR, depth));
  return { min, max: 0, step: FUNDING_FLOOR_GRID };
}

function withBand(
  d: AxisParamDescriptor,
  min: number,
  max: number,
  def: number,
): AxisParamDescriptor {
  return { ...d, min, max, default: Math.min(max, Math.max(min, def)) };
}

// THE AXES SURVIVE THE NARROWING. Every branch below spreads the structural
// descriptor, so `axes` / `objective` / `defaultRationale` ride through to the
// per-market shape a control actually renders from. A narrowing that returned
// the plain `ParamDescriptor` would strip the declaration exactly where the
// dominance sweep needs to read it.
function deriveDescriptor(
  key: ModuleKey,
  d: AxisParamDescriptor,
  ctx: ParamContext,
): AxisParamDescriptor {
  if (key === "safety-buffer" && d.field === "targetLeverage") {
    const max = leverageCeiling(ctx);
    if (max === null) return d;
    const min = d.min ?? PRODUCT_MIN_LEVERAGE;
    const grid = d.step ?? LEVERAGE_GRID;
    // Recommended band, derived: never the lt-blind hard-coded 2 to 3.5.
    const recMin = Math.max(min, floorToGrid(0.5 * max, grid));
    const recMax = Math.min(max, Math.max(recMin, floorToGrid(0.85 * max, grid)));
    return {
      ...withBand(d, min, max, floorToGrid(0.8 * max, grid)),
      recommendedMin: recMin,
      recommendedMax: recMax,
    };
  }
  if (key === "hedge" && d.field === "hedgeLeverage") {
    const max = hedgeLeverageCeiling(ctx);
    if (max === null) return d;
    return withBand(d, d.min ?? 1.5, max, Math.min(3, max));
  }
  if (key === "hedge" && d.field === "reserveFraction") {
    const cml = finiteOr(ctx.coinMaxLeverage, null);
    if (cml === null || cml <= 0) return d;
    const b = deriveHlMarginBands(cml);
    const min = Number((b.restore - b.safetyFloor).toFixed(4));
    const max = Math.max(min, d.max ?? 0.3);
    return withBand(d, min, max, min);
  }
  if (key === "hedge" && d.field === "fundingFloorApr") {
    /* A SEATED LANE STATES ITS MEASUREMENT SET EVEN WHEN THE BOOK MEASURED
       NOTHING. `paramContextForLoop` always sets `fundingP25Aprs` — `null` on
       the live rows that carry no funding percentile at all (WBERA/iBGT,
       iBERA/iBGT, sWBERA/iBGT, PONS) and `null` again before the payload
       resolves — so every lane narrows, and "no measured negative" resolves to
       the house band rather than to the catalog-wide envelope.

       THE FIELD ABSENT is the other question: no lane was supplied at all
       (`descriptorFor(key, field)` with no context, the module's own
       declaration). There is no book to narrow to, so the structural envelope
       stands — it is the widest bound any market could justify, and it is what
       the flat descriptor means.

       X1 (G7, 2026-09-02): these two were one branch, because the bounds
       function used to answer "no measured negative" with `null` and the
       structural fallback caught both. That is what put a −53% dial on 45 of
       52 hedged rows. One question per branch now. */
    if (!("fundingP25Aprs" in ctx)) return d;
    const b = fundingFloorAprBounds(ctx.fundingP25Aprs);
    return withBand(
      d,
      b.min,
      b.max,
      typeof d.default === "number" ? d.default : HOUSE_FUNDING_FLOOR_APR,
    );
  }
  if (key === "auto-compound" && d.field === "minActionUsd") {
    const tvl = finiteOr(ctx.tvlUsd, null);
    const minOrder = finiteOr(ctx.minViableOrderUsd, HL_MIN_ORDER_USD) ?? HL_MIN_ORDER_USD;
    if (tvl === null && ctx.minViableOrderUsd == null) return d;
    return { ...d, default: derivedMinActionUsd(tvl ?? REFERENCE_TVL_USD, minOrder) };
  }
  if (key === "redemption-route" && d.field === "settlementDays") {
    /* THE WINDOW IS THE ISSUER'S, AND THE PIN IS WHAT KEEPS IT THAT WAY.
       `min = max = default` is not a bound on a control — this descriptor is
       hidden and there is no control — it is the mechanism that makes the
       field a RECORD. `clampNumeric` collapses any stored value onto the
       row's own window, so `reclampLoopParams` re-pins the field on a market
       swap instead of carrying the previous issuer's number onto the new one,
       and `defaultParams(key, ctx)` writes it on install.

       WHICH WINDOW: `templates.settlementDaysOf`, the fastest route the issuer
       publishes, computed by `templates.ts` over the fetched documents and
       forwarded through the context. This file does not reduce over routes —
       `fastestExitRoute` is the one owner of that reduction, and a second
       `Math.min` here would be a second opinion about which door is quickest.

       X1 · one question per branch. The field ABSENT means no lane was
       supplied at all, so there is no issuer to narrow to and the structural
       descriptor stands. PRESENT-BUT-NULL means a lane WAS supplied and its
       market publishes no redemption machinery — a row that is not an issuer
       position — and the honest answer there is also the structural
       descriptor, reached through its own test rather than by falling through
       this one. A third test guards the number itself: a row that somehow
       carries no finite window keeps the structural default rather than
       pinning a fabricated one, because pinning 0 would print "0 days" on the
       exit axis and attribute it to the fund. */
    if (!("issuerRedemption" in ctx)) return d;
    const r = ctx.issuerRedemption;
    if (!r) return d;
    const days = finiteOr(r.settlementDays, null);
    if (days === null || days < 0) return d;
    return { ...d, min: days, max: days, default: days };
  }
  if (key === "redemption-route" && d.field === "exitPath") {
    /* THE OPTION SET IS THE ISSUER'S TOO (R1 applied to a segmented control).
       `EXIT_ROUTE_OPTIONS` is the widest set any issuer could publish; this
       replaces it with the routes the picked one DID publish, in the row's own
       order and under the row's own labels, so a lane is never offered a route
       its issuer does not run and the clamp can never accept one. The labels
       come from the row rather than from the mirror above because the issuer's
       document is what names its own doors.

       AND FEWER THAN TWO ROUTES IS NOT A CONTROL. A segmented control with one
       key is three of the rack's own findings in one object: it renders a
       question with one answer, it invites a press that changes nothing, and
       it announces a choice the market does not offer. It comes back HIDDEN —
       the same answer the rack gives a dominated bay: nothing renders, rather
       than an inert key that re-announces the absence. The field is still
       written and still clamped, so the lane keeps the one route its issuer
       runs and the record still states it.

       THE DEFAULT IS THE ROW'S. `defaultRouteId` is
       `templates.fastestExitRoute().id`, derived over the fetched documents by
       their owner. This file only checks that it is one of the routes on
       offer, and falls back to the first offered route rather than leaving a
       default the clamp would refuse.

       X1 · the three states are kept apart exactly as in the branch above: the
       field ABSENT is the module's own declaration (the full mirror, visible,
       the pre-pick state a control with no context draws); PRESENT-BUT-NULL is
       a lane whose market publishes no routes at all, which is a dead control
       rather than a wide one. */
    if (!("issuerRedemption" in ctx)) return d;
    const r = ctx.issuerRedemption;
    if (!r) return { ...d, hidden: true };
    const offered = r.routes
      .filter((x) => typeof x?.id === "string" && x.id.length > 0)
      .map((x) => ({ value: x.id, label: x.label || x.id }));
    if (offered.length === 0) return { ...d, hidden: true };
    const def = offered.some((o) => o.value === r.defaultRouteId)
      ? r.defaultRouteId
      : offered[0].value;
    return { ...d, options: offered, default: def, hidden: offered.length < 2 };
  }
  return d;
}

/** Every descriptor for a module, narrowed to the lane's market. */
export function descriptorsFor(key: ModuleKey, ctx: ParamContext = {}): AxisParamDescriptor[] {
  return getDef(key).params.map((d) => deriveDescriptor(key, d, ctx));
}

/** One descriptor, narrowed to the lane's market. */
export function descriptorFor(
  key: ModuleKey,
  field: string,
  ctx: ParamContext = {},
): AxisParamDescriptor | undefined {
  const d = getDef(key).params.find((p) => p.field === field);
  return d ? deriveDescriptor(key, d, ctx) : undefined;
}

// ── Which params reach the quote (recette build item 4) ───────────────────
//
// A dial that cannot move a number is a lie about what the machine does. This
// is the ONE list of fields that enter the priced model; `invalidatesQuote`
// is derived from it, so a param added here reprices without anyone
// remembering to also edit the reprice state machine.
//
// ACCEPTANCE (item 4): every field listed must change at least one of
// {netApy, capacity, appliedLeverage, bands} at at least one grid position.

export const QUOTE_AFFECTING_PARAMS: Record<ModuleKey, readonly string[]> = {
  // The market itself, and the capacity ceiling the deposit cap derives from.
  "liquidity-source": ["venue", "candidateId", "cls", "hlCoin"],
  // Leverage moves the carry; the preset moves the reachable ceiling AND the
  // bands, so both are priced.
  "safety-buffer": ["riskPreset", "targetLeverage"],
  // A2: both dials enter f_b = Lh/(Lh + 1 + r·Lh), so they move net APY and
  // capacity together.
  //
  // R2 (2026-08-22): `fundingFloorApr` and `fundingWindowEpochs` were REMOVED
  // from this list, and `deltaBandPct` left with its dial (R1). The acceptance
  // criterion stated four lines above is a test, and the list failed it:
  // grepped, neither funding identifier appears anywhere in `lib/canvas`
  // outside this file — not in `repriceAtLeverage`, not in `composedNetApy`,
  // not in the reprice route. Listing them fired a debounced network round
  // trip on every keystroke that returned a byte-identical quote. THE DIALS
  // STAY: they are real publish-time fields (`store.ts`,
  // `AutomationsSection`), and this list is not "fields that matter", it is
  // "fields that move the quote".
  hedge: ["hedgeLeverage", "reserveFraction"],
  // A10: compounding has real, signed, size-dependent economics. Cadence sets
  // the firing count, the threshold gates it; both enter compoundDelta.
  "auto-compound": ["cadence", "minActionUsd"],
  // E4/E7: range width sets capital efficiency, the trigger sets realized
  // fees and recentering cost.
  "auto-center": ["rangePct", "recenterTriggerPct"],
  "covered-call": ["strikePct", "rollDays"],
  "protective-put": ["floorPct"],
  /* EMPTY, AND IT MUST STAY EMPTY (2026-08-26).
     The per-event cost of a response is measured — `economics.executionDragApr`
     — but a quote is ANNUAL, and annualising it needs an incident frequency
     the payload does not carry. Listing a field here fires a debounced network
     round trip that returns a byte-identical quote, which is exactly the defect
     R2 removed the two funding identifiers for. The dials are real publish-time
     fields; this list is "fields that move the quote", not "fields that
     matter". `moduleInvalidatesQuote` derives from this, so installing or
     ejecting the watcher correctly leaves the shown quote standing. */
  "exogenous-risk": [],
  /* EMPTY, AND IT MUST STAY EMPTY (R2 justification, written by WP-3).

     THE CRITERION IS THE ACCEPTANCE TEST STATED SIX LINES ABOVE — "does this
     field change one of {netApy, capacity, appliedLeverage, bands} at at least
     one grid position" — and NOT "is this a real field". Both params on this
     module are real, both are published, and neither reaches the quote.

     WHY NOT: they move a MIGRATION cost, not a holding cost. The window a
     redemption waits is charged when capital LEAVES a lane, so it is priced by
     `orchestrator/rule-schema.exitProfileFor` (whose `ExitEndpoint`
     .settlementDays docblock names this module as its source) and consumed by
     `upgradeThreshold` / `paybackMs` — the router's arithmetic about whether
     to move, not the lane's arithmetic about what it earns while held. A lane
     that never moves never pays it, and a quote is what the lane earns while
     held.

     THE GREPS, run 2026-09-03 from `autoloop-frontend/`:

       grep -rn "settlementDays\|exitPath" lib/canvas app/api/canvas \
         | grep -v "lib/canvas/modules.ts"

     Five hits, and not one of them is a pricing path: `axes.ts:770` (the
     `exitCost` renderer), `opportunities.ts:53` (a comment), and three in
     `orchestrator/rule-schema.ts` (`ExitEndpoint.settlementDays` and
     `exitProfileFor`'s two reads of it) — the migration arithmetic named
     above. And, narrowed to the two owners the criterion is about:

       grep -c "settlementDays\|exitPath" lib/canvas/mock-quote.ts   -> 0
       grep -rn "settlementDays\|exitPath" app/api/canvas/reprice/   -> 0

     `mock-quote.ts` is the single owner of `composedNetApy`,
     `repriceAtLeverage` and `publishedNetApy`; `app/api/canvas/reprice/` is
     the reprice route. Zero in both.

     Listing either field here would fire a debounced network round trip on
     every write that returns a byte-identical quote — exactly the defect R2
     removed the two funding identifiers for, and the same one the watcher's
     empty list above was written for.

     `moduleInvalidatesQuote` derives from this, so installing or ejecting the
     exit route correctly leaves the shown quote standing. The dials are still
     real publish-time fields: `pricing-params.pricingParamsFor` names this
     module, so the published record carries the route and the window. This
     list is "fields that move the quote", never "fields that matter". */
  "redemption-route": [],
};

/** Does changing this param invalidate a shown quote? */
export function paramInvalidatesQuote(key: ModuleKey, field: string): boolean {
  return QUOTE_AFFECTING_PARAMS[key].includes(field);
}

/**
 * Does adding or ejecting this module invalidate a shown quote? True for
 * every module now: auto-compound used to be exempt on the grounds that it
 * was "cadence-only and never priced", which was true and was the bug (A10).
 */
export function moduleInvalidatesQuote(key: ModuleKey): boolean {
  return QUOTE_AFFECTING_PARAMS[key].length > 0;
}

/** Default value for a field, narrowed to the lane's market. */
export function defaultValueFor(key: ModuleKey, field: string, ctx: ParamContext = {}): ParamValue | undefined {
  return descriptorFor(key, field, ctx)?.default;
}
