/**
 * Template registry (TEMPLATE_DEEPLINKS 2026-08-21).
 *
 * The landing page's four template cards deep-link to
 * /build?template=<id>; this file is the single source of truth for what
 * each id means: display name, canvas header, publish strategy kind, the
 * target canvas, and the seeding recipe. Adding template #5 is a new entry
 * here — the /build router, the RackCanvas seeder, the mock-quote fallback
 * and the publish flow all read this registry.
 *
 * Honesty rules: every mock number is modeled and deterministic (no
 * Math.random anywhere); the dn-lp and collar candidates are clearly mock
 * venues (Aerodrome LP, options venue) that never enter the discovery
 * catalog and never reach the live reprice rail.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MODEL REWRITE 2026-08-22 (recette build item 22 — E1, E2, E3, E6, E7, E9).
 *
 * Both mock rows used to be three asserted decimals with no machine behind
 * them. Concretely, what was wrong:
 *
 *  E3 — the dn-lp row carried its ALL-IN HEDGE COST in `fundingP25Apr`
 *       (−0.026). That field means "the p25 funding the short leg earns", and
 *       the live ETH catalog says +4.26%, so the product printed two signs
 *       for the same rate one query-param apart.
 *
 *  E2 — because the cost hid in that field, `hedgelessApy` (which subtracts
 *       it) repriced a hedge-ejected delta-neutral LP UPWARD, 10.2% → 12.8%.
 *       The model paid the user to delete the delta-neutrality. There was
 *       also no LVR term at all, so "hedgeless" was gross fee APR: an LP that
 *       collects fees and never pays the arbitrageur.
 *
 *  E6 — the collar's net premium sat in `collateralYieldApy`, a field the
 *       loop arithmetic multiplies by L, and there was no IV, no tenor and no
 *       strike anywhere in `lib/canvas`, so all nine strike/floor
 *       combinations produced one number.
 *
 *  E9 — `capacityBinding: "modeled"` rendered as "limited by modeled".
 *
 * What replaces them: two small deterministic FAMILY MODELS, below, each
 * taking the lane's own dials and returning every leg it charges. The
 * candidate rows are now BUILT by those models at the composition the seed
 * installs, so the advertised number and the canvas describe the same
 * machine by construction rather than by an author remembering to update two
 * places. `economics.model = "hand-authored"` is the ONE flag that tells the
 * consumers (mock-quote, hedge-econ, capacity) not to run loop arithmetic on
 * these rows — replacing the venue-name string match in three files.
 */

/* eslint-disable @typescript-eslint/array-type, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/non-nullable-type-assertion-style --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { isHandAuthored, type LoopGraph, type ModuleKey, type PortfolioGraph } from "./types";
import { pct } from "./format";
import {
  isTemplateVenue,
  projectVenueDocV2,
  type CanvasVenueId,
  type ProjectedCandidate,
  type ProjectedVenue,
} from "./opportunities";
import {
  composedNetApy,
  repriceAtLeverage,
  type CatalogHit,
  type LaneComposition,
} from "./mock-quote";
import { acceptsDeposits } from "./capacity";
import { breakevenStopFor, landingLeverage } from "./leverage-stops";
import { PRODUCT_MIN_LEVERAGE } from "./param-schema";
import {
  addLoop,
  addModule,
  emptyPortfolio,
  nodeFor,
  removeModule,
  renameLoop,
  updateParam,
  type LaneFamily,
} from "./graph-ops";
import { defaultValueFor } from "./modules";
import { leverageModuleInstalls } from "./leverage-module";
import { nodeId } from "./ids";
import { buildUnifiedList, type UnifiedRow } from "./unified-list";
import { buildPortfolioFromProposal, proposalLoopComposition } from "./copilot/apply";
import type { ProposalLoopSnapshot } from "./copilot/tools";
import type { StrategyKind } from "@/lib/vaults/store";
/* THE FIFTH TEMPLATE'S CARRY ROW COMES FROM THE COMMITTED FUNDING SCAN, and
   this is the import that lets it. Two facts make it cheap rather than a new
   dependency: `modules.ts` already imports the same six fixture snapshots and
   this file already imports `modules.ts`, so the bytes are in the graph
   either way; and `opportunities.ts` imports nothing from here, so the value
   import above closes no cycle. See `BASIS_FLOOR_CARRY` in the registry
   block for why the row is read rather than transcribed. */
import snapHlFunding from "@/lib/canvas/fixtures/hyperliquid-funding.json";
import type { VenueDocV2 } from "@/lib/strategy-factory/venues/types";

export type TemplateId =
  | "leveraged-loop"
  | "funding-carry"
  | "dn-lp"
  | "treasury-collar"
  /* THE FIFTH ID (founder ruling H-1), and it is a TEMPLATE rather than a
     `?seed=` registry because a seed registry is a template by another name:
     a second spelling of the fact this file already owns, with a second set
     of ids to keep true. Its acceptance is that no existing template's sha
     moves, which `template-regression.test.ts` proves per id over an explicit
     tuple that an addition never joins. */
  | "basis-floor";

/** Seed the loop canvas from the live catalog (deterministic pick). */
interface CatalogSeed {
  kind: "catalog-pick";
  /** Preferred market when present: [pair, venue]. */
  prefer: { pair: string; venue: string };
}

/**
 * ONE LANE OF A MOCK-CANDIDATE SEED.
 *
 * Extracted out of `MockSeed` for the fifth template, whose subject is a PAIR
 * of lanes rather than one: a carry lane and the treasury lane that floors
 * it. Every field keeps its name and its meaning, and `MockSeed` still
 * carries them at its own top level, so the two readers of `seed.candidate`
 * and `seed.params` outside this file — `copilot/apply.ts`'s
 * `templateSeedParams` and `hand-authored-gate.test.ts` — are untouched.
 */
interface MockLane {
  candidate: ProjectedCandidate;
  /** Modules placed after the liquidity source, in chain order. */
  modules: ModuleKey[];
  laneLabel: string;
  /**
   * Dial values the template pins on its own modules, applied after the
   * modules are placed.
   *
   * This is not decoration. The candidate row's economics are computed BY the
   * family model at a named composition; if the seed then installed the
   * module's own generic default instead, the advertised number and the lane
   * on screen would describe different positions again — which is the bug
   * (E1) this whole file was rewritten to close. Every dial the family model
   * reads is pinned here, explicitly, including the ones that happen to equal
   * the module default today.
   */
  params?: Partial<Record<ModuleKey, ReadonlyArray<readonly [string, string]>>>;
  /**
   * THE DOCUMENT THIS LANE'S ROW WAS READ FROM, written into the hidden
   * `contentHash` pin on `liquidity-source`.
   *
   * Defaults to `"template"`, which is what every mock lane has always
   * carried and is the truthful answer for a HAND-AUTHORED row: those rows
   * are built by a family model in this file and no scan document backs them.
   *
   * It exists because the fifth template's carry lane is not hand-authored.
   * It pins a row of the committed funding scan, and stamping that lane
   * `"template"` would say this file priced a market the scanner priced.
   */
  docPin?: string;
}

/** Seed the loop canvas with registry-shipped mock candidates. */
interface MockSeed extends MockLane {
  kind: "mock-candidate";
  /**
   * Further lanes racked after the first, in order.
   *
   * Absent on the three single-lane templates, so the builder's loop runs
   * exactly once for them and produces byte-identical output to the branch it
   * replaced. That is the mechanism behind H-1's acceptance: an addition is
   * never visited by an existing template's hash.
   */
  peers?: readonly MockLane[];
}

/** Route to the funding canvas with its existing demo seeding. */
interface FundingSeed {
  kind: "funding-demo";
}

export type TemplateSeed = CatalogSeed | MockSeed | FundingSeed;

export interface CanvasTemplate {
  id: TemplateId;
  /** Display name ("Leveraged loop"). */
  name: string;
  /** Canvas header line ("Leveraged loop · template"). */
  header: string;
  /**
   * Publish strategy kind for a single-lane publish of this template's FIRST
   * lane.
   *
   * The "first lane" clause is new with the fifth template and it is a
   * narrowing, not a widening: four templates rack one lane, so the field
   * answered the same question before. A template that racks a pair has no
   * single strategy, and the honest reading of one `StrategyKind` is the lane
   * the deep link opens on. Nothing in production reads it today (grepped:
   * every consumer of `CANVAS_TEMPLATES` reads `seed`, `canvas`, `id` or
   * `name`), so it is a declaration the regression harness pins.
   */
  strategy: StrategyKind;
  /** Which canvas the deep link opens. */
  canvas: "loop" | "funding";
  seed: TemplateSeed;
}

// ══════════════════════════════════════════════════════════════════════════
// Hand-authored family models
// ══════════════════════════════════════════════════════════════════════════
//
// Both models are COARSE ON PURPOSE. The product cannot support a live
// options surface or a live pool-state feed on a mockup row, and pretending
// otherwise is the failure mode this rewrite exists to end. What they must be
// is: deterministic, inspectable, signed correctly, and moved by the dials
// that name them. Every constant below cites where its value comes from.

/** A named leg of a hand-authored lane's return, on deposit, annualized. */
export interface ModelLeg {
  label: string;
  apr: number;
}

/**
 * The hedge decomposition a hand-authored row states for itself (FB-1,
 * 2026-09-01).
 *
 * `hedge-econ.hedgeEconomics` derives a LOOP hedge's three venue terms from
 * the row's generic fields. A hand-authored hedge has no such derivation —
 * its funding rides `lpDeltaShare` of the position and its escrow forfeits
 * LP carry, not loop carry — so before this existed the dn-lp lane's hedge
 * plate printed the idle `—` while the market card beside it advertised
 * `priced with Auto center and Dynamic hedge`. The family model that prices
 * the lane total states the decomposition too, from the same inputs, and
 * `hedge-econ` reads it rather than re-deriving it.
 *
 * The three `Pp` terms are venue-frame contributions on DEPOSIT (rate
 * fractions, hedge-econ's unit law) and sum to `netApy − hedgelessApy`
 * exactly: hedge-econ's identity assert proves that on every read and
 * blanks the plate when it cannot.
 */
export interface AuthoredHedgeTerms {
  /** p25 funding the short leg earns, annualized on its own notional — the
   *  rate a surface prints beside `p25`. */
  fundingP25Apr: number;
  /** Funding income on deposit, signed (+ when longs pay shorts). */
  fundingPp: number;
  /** Carry forfeited by the capital held out as perp margin + reserve. */
  escrowPp: number;
  /** Cost of keeping the short matched to the position's delta. */
  dragPp: number;
}

/** The shape every hand-authored family model returns. */
interface FamilyModel {
  /* `treasury` is the third member (BASIS CARRY + TREASURY FLOOR). It names a
     LANE SHAPE, never a claim about what a fund holds: an issuer position and
     the route back out of it. What each issuer holds is stated on its row. */
  family: "dn-lp" | "collar" | "treasury";
  /** Net APY on deposit at this composition. */
  netApy: number;
  /** Return on deployed capital, before the escrow split. */
  netCarry: number;
  /**
   * The lane WITHOUT its structural leg (the perp short / the option pair).
   * Null when removing it is not a defined position for the family.
   *
   * On a dn-lp this is NOT gross fee APR (E2): an unhedged LP still pays LVR
   * and still pays to recenter. It only stops paying for perp margin and
   * stops collecting funding, and it takes on the price leg, which is not an
   * APR at all.
   */
  hedgelessApy: number | null;
  /** Every charge and credit, in display order. Sums to netApy. */
  legs: ModelLeg[];
  /** The structural perp hedge's own venue terms, on deposit. Null when the
   *  family's protection is not a perp short (the collar's option pair is
   *  priced in `legs`, and removing it has no APY at all). */
  hedgeTerms: AuthoredHedgeTerms | null;
  capacityUsd: number;
  capacityBinding: string;
}

// ── Delta-neutral LP ──────────────────────────────────────────────────────

/**
 * Modeled inputs for WETH/USDC concentrated liquidity on Aerodrome, Base.
 * Pool-shaped facts (E7: the row had no TVL, no volume, no fee tier, so its
 * number was unfalsifiable). These are modeled, not fetched — the row never
 * touches a live rail. The pool DEPTH is the exception: it lives in
 * `DN_LP_POOL_DEPTH` below, measured and dated, and reaches the model only
 * through `dnLpPoolTvlUsd`.
 */
export const DN_LP_MODEL = {
  /** 24h volume, USD. */
  volume24hUsd: 28_000_000,
  /** Fee tier, bps of notional. */
  feeTierBps: 5,
  /** Annualized ETH volatility used by both the LVR and recenter terms. */
  sigmaAnnual: 0.6,
  /** The range half-width the pool-level fee APR is quoted at (the
   *  auto-center descriptor's own default, "2.5" → ±2.5%). */
  refRangePct: 0.025,
  /**
   * LVR as a SHARE of gross fee revenue.
   *
   * Not a level, a ratio, and that is the point: loss-versus-rebalancing and
   * fees both scale with the position's virtual liquidity, so concentration
   * cancels out of the ratio and one constant covers every range the dial
   * offers. 0.55 is the modeled 5bps-tier share; published measurements of
   * ETH/USDC put it HIGHER (near parity on the 30bps tier), so this is the
   * optimistic end of the range and the row is not flattering itself further.
   */
  lvrShareOfFees: 0.55,
  /** All-in cost of one recenter swap, bps of the notional it moves (pool
   *  fee + slippage). */
  recenterSwapCostBps: 8,
  /** lib/backtest/presets.ts:63 — gas per automated action, USD. Same
   *  constant `mock-quote.MODELED` charges auto-compound. */
  gasPerRecenterUsd: 0.5,
  /** lib/vaults/store.ts:400 — the seed TVL every published vault gets. The
   *  gas leg is the only size-dependent term, and this is its denominator. */
  modeledTvlUsd: 25_000,
  /** ETH delta of a centered two-sided LP position, as a share of its
   *  notional. Half the position is the volatile leg at the center. */
  lpDeltaShare: 0.5,
  /**
   * p25 funding the SHORT leg earns on ETH perps, annualized.
   *
   * This is the live catalog's own ETH number and it is POSITIVE: longs pay
   * shorts. E3 was the product printing +4.26% on one surface and −2.6% on
   * another for the same rate, because this row was using the field as a
   * hedge-cost slot. The hedge's costs now have their own legs and this field
   * means what its name says.
   */
  perpFundingP25Apr: 0.0426,
  /** Cost of keeping the short matched to a moving LP delta, APR on hedge
   *  notional. Modeled at a 1% delta band; the loop hedge's own exec drag
   *  (EXEC_DRAG_APR, 0.75%) is the floor and an LP delta moves more. */
  hedgeExecApr: 0.015,
  /** The share of the pool past which your own size is what sets your fee
   *  APR, so the modeled number stops describing you. */
  maxPoolSharePct: 0.05,
} as const;

/**
 * Pool depth for the dn-lp row, DERIVED — the one input above that was not
 * merely coarse but wrong (quant ledger 2026-08-27, fixed 2026-09-01). The
 * old `poolTvlUsd: 40_000_000` named a pool 4.4x deeper than the measured
 * one, which understated the fee share a dollar of liquidity earns and
 * overstated the capacity row in the same stroke — both scale off this
 * denominator, in opposite directions.
 *
 * The catalog API carries no measured Aerodrome pool TVL today:
 * `aerodrome-base` is a mock venue the scanners never touch
 * (opportunities-server.ts serves the six real venues and nothing else, and
 * no `ProjectedCandidate` field holds an LP pool TVL). So the measured
 * reading is seeded here as the fallback, labeled with its as-of date, and
 * `dnLpPoolTvlUsd` prefers a measured figure the moment a caller carries one
 * — the day an Aerodrome scanner ships a pool TVL on the row, threading it
 * through that one function moves every consumer at once.
 */
export const DN_LP_POOL_DEPTH = {
  /** All nine Aerodrome WETH/USDC pools summed, USD; the largest single pool
   *  is $9.10M of it. Measured, not modeled — the as-of date is the label. */
  measuredPoolTvlUsd: 24_990_000,
  /** When the fallback was measured (quant ledger read-only run). */
  asOf: "2026-08-27",
} as const;

/**
 * The pool depth every dn-lp consumer prices against: a measured pool TVL
 * when the caller carries one (the catalog row, once the API ships it), else
 * the seeded measured fallback above. Zero and non-finite readings fall back
 * — a dead scan must not price the pool as empty.
 */
export function dnLpPoolTvlUsd(measuredUsd?: number | null): number {
  return typeof measuredUsd === "number" && Number.isFinite(measuredUsd) && measuredUsd > 0
    ? measuredUsd
    : DN_LP_POOL_DEPTH.measuredPoolTvlUsd;
}

/** The dials the dn-lp model reads. */
export interface DnLpDials {
  /** auto-center `rangePct`, as a fraction (the descriptor ships "2.5"). */
  rangePct: number;
  /** auto-center `recenterTriggerPct`, as a fraction (ships "80"). */
  recenterTriggerPct: number;
  /** hedge `hedgeLeverage`. */
  hedgeLeverage: number;
  /** hedge `reserveFraction`. */
  reserveFraction: number;
}

/** The composition the shipped DN_LP_CANDIDATE is priced at, and the one the
 *  seed pins on the canvas. Kept in one place so they cannot drift. */
export const DN_LP_DEFAULT_DIALS: DnLpDials = {
  rangePct: 0.025,
  recenterTriggerPct: 0.8,
  hedgeLeverage: 3,
  reserveFraction: 0.15,
};

/** Gross fee APR at a range half-width. Concentrated liquidity depth goes as
 *  1/range, and fee share goes with depth, so the pool-level number scales
 *  inversely with the half-width. The pool depth is the derived input
 *  (`dnLpPoolTvlUsd`): fee share goes as 1/depth, capacity as depth. */
export function dnLpFeeApr(rangePct: number, poolTvlUsd: number = dnLpPoolTvlUsd()): number {
  const m = DN_LP_MODEL;
  const p = rangePct > 0 ? rangePct : m.refRangePct;
  const poolFeeApr = (m.volume24hUsd * (m.feeTierBps / 10_000) * 365) / poolTvlUsd;
  return poolFeeApr * (m.refRangePct / p);
}

/**
 * Recenter cost APR.
 *
 * Two terms with different exponents, which is what gives the range dial a
 * real shape instead of a proportional one:
 *
 *   events/yr  = σ² / d²      where d = trigger · range (the walk that fires it)
 *   per event  = (d/2)·swapCost   the notional the swap moves, ∝ d
 *              + gas/TVL          fixed dollars, ∝ d⁰
 *
 * so the swap term goes as 1/d and the GAS term as 1/d². Tightening the range
 * therefore stops paying for itself at some point rather than improving
 * forever, and where that point sits depends on the vault's size.
 */
export function dnLpRecenterApr(
  rangePct: number,
  recenterTriggerPct: number,
  tvlUsd: number = DN_LP_MODEL.modeledTvlUsd,
): number {
  const m = DN_LP_MODEL;
  const p = rangePct > 0 ? rangePct : m.refRangePct;
  const trig = recenterTriggerPct > 0 ? recenterTriggerPct : 0.8;
  const tvl = tvlUsd > 0 ? tvlUsd : m.modeledTvlUsd;
  const d = trig * p;
  const eventsPerYear = (m.sigmaAnnual * m.sigmaAnnual) / (d * d);
  const perEvent = (d / 2) * (m.recenterSwapCostBps / 10_000) + m.gasPerRecenterUsd / tvl;
  return eventsPerYear * perEvent;
}

/**
 * The share of a deposited dollar that reaches the LP.
 *
 * The rest is perp margin for the short (delta/L_h per LP dollar) plus the
 * reserve held against that margin. Same shape as `mock-quote.fB`, but the
 * hedge notional here is `lpDeltaShare` of the position, not all of it — an
 * LP is half exposed, a loop is fully exposed, and using the loop's f_b on
 * this row would overstate the escrow by a factor of two.
 */
export function dnLpDeployedShare(hedgeLeverage: number, reserveFraction: number): number {
  const lh = hedgeLeverage > 0 ? hedgeLeverage : 1;
  const r = reserveFraction > 0 ? reserveFraction : 0;
  const marginPerLpDollar = (DN_LP_MODEL.lpDeltaShare / lh) * (1 + r);
  return 1 / (1 + marginPerLpDollar);
}

/** The full delta-neutral LP model at one composition. `poolTvlUsd` is the
 *  derived pool depth (`dnLpPoolTvlUsd`); the fee share and the capacity row
 *  both follow it, in opposite directions. */
export function dnLpModel(
  dials: DnLpDials = DN_LP_DEFAULT_DIALS,
  poolTvlUsd: number = dnLpPoolTvlUsd(),
): FamilyModel {
  const m = DN_LP_MODEL;
  const fee = dnLpFeeApr(dials.rangePct, poolTvlUsd);
  const lvr = m.lvrShareOfFees * fee;
  const recenter = dnLpRecenterApr(dials.rangePct, dials.recenterTriggerPct);
  const lpNet = fee - lvr - recenter;

  const deployed = dnLpDeployedShare(dials.hedgeLeverage, dials.reserveFraction);
  const shortNotional = m.lpDeltaShare; // per LP dollar
  const funding = shortNotional * m.perpFundingP25Apr;
  const hedgeExec = shortNotional * m.hedgeExecApr;

  const netCarry = lpNet + funding - hedgeExec;
  const netApy = deployed * netCarry;

  // The hedge's two own legs, on deposit — spelled once, used by `legs` and
  // by `hedgeTerms` below, so the ledger and the plate cannot drift.
  const fundingLegApr = deployed * funding;
  const hedgeExecLegApr = deployed * hedgeExec;

  return {
    family: "dn-lp",
    netApy,
    netCarry,
    // No perp leg: every dollar is in the LP, and the ETH price leg is naked.
    // The LP still pays LVR and still pays to recenter, so this is nowhere
    // near gross fee APR — and it is BELOW the hedged number, so ejecting the
    // hedge can never read as a gain (E2).
    hedgelessApy: lpNet,
    legs: [
      { label: "LP fees", apr: deployed * fee },
      { label: "Loss versus rebalancing", apr: -deployed * lvr },
      { label: "Recentering", apr: -deployed * recenter },
      { label: "Short funding", apr: fundingLegApr },
      { label: "Hedge execution", apr: -hedgeExecLegApr },
    ],
    // What the hedge is worth, decomposed (FB-1): funding earned on the
    // short, LP carry the escrowed margin forfeits, execution paid to track
    // the LP's delta. Sums to `netApy − hedgelessApy` exactly:
    //   deployed·f − (1−deployed)·lpNet − deployed·x
    //     = deployed·(lpNet + f − x) − lpNet.
    hedgeTerms: {
      fundingP25Apr: m.perpFundingP25Apr,
      fundingPp: fundingLegApr,
      escrowPp: -(1 - deployed) * lpNet,
      dragPp: -hedgeExecLegApr,
    },
    capacityUsd: Math.round((poolTvlUsd * m.maxPoolSharePct) / deployed),
    // E9. `capacityBindingLabel` renders this as "limited by <binding>", so
    // the binding has to be a NOUN PHRASE NAMING A RESOURCE. "modeled" named
    // the provenance of the number instead of the thing that runs out, which
    // is how the publish surface came to read "limited by modeled". The word
    // stays out of the label entirely: how a figure was produced is
    // `economics.model`'s job, not the capacity line's.
    capacityBinding: "share of pool liquidity in range",
  };
}

// ── Treasury collar ───────────────────────────────────────────────────────

/**
 * ONE modeled implied volatility, flat across strike and tenor.
 *
 * Deliberately flat. A skew surface is precision this product cannot support
 * on a mock row, and a wrong skew is worse than none: it decides the sign of
 * the collar's income, and at the shipped strikes an invented put skew turns
 * eight of the nine combinations negative. Flat IV reproduces the textbook
 * result instead — a collar near the money is close to costless, and the
 * income comes from selling upside nearer than the floor you buy.
 */
export const COLLAR_IV = 0.65;

/**
 * Premium as a fraction of spot, at COLLAR_IV, r = 0, per tenor and strike.
 *
 * A TABLE, not a pricer: the nine strike/floor combinations the two option
 * descriptors offer need eighteen cells and no more. Each cell is a
 * flat-IV Black-Scholes value evaluated once, offline, at COLLAR_IV — quoting
 * a table keeps the shipped numbers auditable by reading them, and keeps a
 * pricing library, a rate curve and a skew surface out of the canvas bundle.
 *
 * Keys are the descriptor's own option `value` strings (`covered-call`
 * strikePct, `protective-put` floorPct, `covered-call` rollDays), so a
 * strike the product does not offer cannot be priced by accident.
 */
export const CALL_PREMIUM_FRAC: Record<string, Record<string, number>> = {
  // rollDays → strikePct (above spot)
  "14": { "10": 0.01757, "15": 0.0094, "20": 0.00484 },
  "30": { "10": 0.03782, "15": 0.02606, "20": 0.0176 },
  "60": { "10": 0.06722, "15": 0.05312, "20": 0.0417 },
};

export const PUT_PREMIUM_FRAC: Record<string, Record<string, number>> = {
  // rollDays → floorPct (below spot)
  "14": { "8": 0.01882, "12": 0.00988, "15": 0.00561 },
  "30": { "8": 0.03827, "12": 0.0256, "15": 0.0181 },
  "60": { "8": 0.06566, "12": 0.04977, "15": 0.03963 },
};

/**
 * The collar's capacity binding, as ONE string. `COLLAR_MODEL.
 * optionOpenInterestUsd` is an assumed book, not a scan reading, so every
 * surface that prints this noun must carry it in the modeled register —
 * `capacityBindingLabel` keys on this exact string to do that (QNT-3).
 */
export const COLLAR_CAPACITY_BINDING = "options venue open interest";

export const COLLAR_MODEL = {
  /** Both legs crossed once per roll, as a fraction of spot. Options quotes
   *  are wide; at these premiums 25bps is roughly a 4% relative half-spread
   *  on each leg. */
  rollCostFracOfSpot: 0.0025,
  /** Open interest the mock venue carries, USD. */
  optionOpenInterestUsd: 10_000_000,
  /** Share of that book one vault may hold before it IS the book. */
  maxOiSharePct: 0.1,
  /** A bare governance token pays nothing. The collar's income is the
   *  premium, and it is a premium, not a collateral yield (E6). */
  underlyingYieldApy: 0,
} as const;

/** The dials the collar model reads. Strings, exactly as the descriptors
 *  store them, so an off-grid value fails loudly instead of interpolating. */
export interface CollarDials {
  /** covered-call `strikePct`: "10" | "15" | "20". */
  strikePct: string;
  /** protective-put `floorPct`: "8" | "12" | "15". */
  floorPct: string;
  /** covered-call `rollDays`: "14" | "30" | "60". The put's tenor is bound to
   *  it — E6: `protective-put` had no tenor of its own, which left its
   *  premium undefined by construction. The two legs roll together or the
   *  collar is not a collar. */
  rollDays: string;
}

/**
 * The descriptor's own default for a segmented dial, as the string it stores.
 *
 * `defaultValueFor` is `modules.ts`'s own accessor, so this reads the owner
 * rather than re-typing it. The fallback is only reached if a descriptor is
 * deleted outright, and it is deliberately off-grid: `collarModel` returns
 * null on a strike its table cannot price, which fails loudly instead of
 * quietly pricing a position nobody asked for.
 */
function dialDefault(key: ModuleKey, field: string): string {
  const d = defaultValueFor(key, field);
  return typeof d === "string" ? d : "";
}

/**
 * P0-9 — ONE OWNER for the collar's dials: the module descriptors.
 *
 * `COLLAR_DEFAULT_DIALS` is what `COLLAR_CANDIDATE` is priced at AND what the
 * `treasury-collar` seed installs, so any value it carries that the descriptor
 * does not is a second owner: a collar composed module-first installs the
 * descriptor's value, the template installs this one, and both print the same
 * APY. `floorPct` and `rollDays` now read the descriptor, so a default that
 * moves moves the priced row and the seed together.
 *
 * CLOSED 2026-08-22 in the wave audit: all three dials now read the descriptor
 * and THIS FILE OWNS NOTHING. `strikePct` was the last pinned value here — the
 * descriptor said "15" while this said "10", so a collar composed module-first
 * seated a +15% call on the rack and published the +10% model's number. Both
 * halves landed together: the `covered-call` descriptor default moved to "10",
 * which makes the read below return exactly the value that was pinned, so
 * `COLLAR_CANDIDATE` reprices to nothing, the seed installs what it always
 * installed, and the three pinned hashes in the template harness do not move.
 * What changed is the only thing that was wrong: the by-hand collar now seats
 * the dial its number was computed at.
 */
export const COLLAR_DEFAULT_DIALS: CollarDials = {
  strikePct: dialDefault("covered-call", "strikePct"),
  floorPct: dialDefault("protective-put", "floorPct"),
  rollDays: dialDefault("covered-call", "rollDays"),
};

/** The full treasury-collar model at one composition. Null on an off-grid
 *  dial: a strike this table cannot price is a number this file will not
 *  invent. */
export function collarModel(dials: CollarDials = COLLAR_DEFAULT_DIALS): FamilyModel | null {
  const m = COLLAR_MODEL;
  const call = CALL_PREMIUM_FRAC[dials.rollDays]?.[dials.strikePct];
  const put = PUT_PREMIUM_FRAC[dials.rollDays]?.[dials.floorPct];
  const days = Number(dials.rollDays);
  if (typeof call !== "number" || typeof put !== "number" || !Number.isFinite(days) || days <= 0) {
    return null;
  }
  const rollsPerYear = 365 / days;
  const callApr = call * rollsPerYear;
  const putApr = put * rollsPerYear;
  const rollApr = m.rollCostFracOfSpot * rollsPerYear;
  const net = callApr - putApr - rollApr + m.underlyingYieldApy;

  return {
    family: "collar",
    netApy: net,
    netCarry: net, // unlevered, no escrow: deployed share is 1
    // Removing the option pair leaves a bare treasury position: no premium,
    // no floor, no cap, and no APY at all. There is no "hedgeless collar"
    // number to state, so this family states none.
    hedgelessApy: null,
    legs: [
      { label: `Calls written +${dials.strikePct}%`, apr: callApr },
      { label: `Puts held -${dials.floorPct}%`, apr: -putApr },
      { label: "Roll execution", apr: -rollApr },
    ],
    // The option pair is the protection here, priced in the legs above; there
    // is no perp short and therefore no hedge decomposition to state.
    hedgeTerms: null,
    capacityUsd: Math.round(m.optionOpenInterestUsd * m.maxOiSharePct),
    capacityBinding: COLLAR_CAPACITY_BINDING,
  };
}

/**
 * QNT-3 — the quant ledger's collar ruling (2026-08-27): the premium is the
 * PRICE of the upside sold above the strike, so the cash flow must be printed
 * with the forgone upside beside it or it lies by omission.
 *
 * Under the flat-IV table the two are one number: the table is risk-neutral
 * (r = 0), so the expected payoff surrendered above the strike equals the
 * call premium collected — the `Calls written` leg's own APR. ONE derivation
 * here, read by every surface that prints the collar's figure, because a
 * hand-typed 46.0% anywhere would be the omission's twin defect.
 */
export interface CollarForfeit {
  /** The strike the upside is sold above, the dial's own string ("10"). */
  strikePct: string;
  /** Modeled value of the upside forfeited above the strike, APR fraction. */
  apr: number;
}

/** Null on an off-grid dial, exactly as `collarModel` is. */
export function collarForfeit(dials: CollarDials = COLLAR_DEFAULT_DIALS): CollarForfeit | null {
  const call = collarModel(dials)?.legs.find((l) => l.label.startsWith("Calls written"));
  if (!call) return null;
  return { strikePct: dials.strikePct, apr: call.apr };
}

/** The companion sentence, printed beside the collar's modeled figure. */
export function collarForfeitLine(f: CollarForfeit): string {
  return `forfeits upside above +${f.strikePct}%, modeled ${pct(f.apr)} APR`;
}

/** The same fact as a param-row value, under an `Upside forfeited` label. */
export function collarForfeitValue(f: CollarForfeit): string {
  return `above +${f.strikePct}%, modeled ${pct(f.apr)} APR`;
}

/**
 * The same fact for the vault plate's screen, split in two: `.hm-sb` is
 * nowrap by law (hm.css budgets 34 characters a line and calls an ellipsis a
 * test failure), and the one-line sentence is 44. Longest reachable strings
 * over the nine-cell table: `forfeits upside above +20%` (26) and
 * `modeled 46.0% APR` (17).
 */
export function collarForfeitPlateLines(f: CollarForfeit): readonly [string, string] {
  return [`forfeits upside above +${f.strikePct}%`, `modeled ${pct(f.apr)} APR`];
}

/**
 * THE SAME FACT FOR ONE LANE ON THE RACK (QNT-R2-3).
 *
 * MOVED HERE FROM `dock/ComposePanel.tsx` (G7, 2026-09-02) and unchanged in
 * body. It lived in a `"use client"` component, which put it out of reach of
 * the one surface that still printed the collar's figure bare: the copilot,
 * whose context and lane frame are server modules. The choice was a second
 * graph read in `lib/canvas/copilot/**` or one owner here beside
 * `collarForfeit`, and a second read of "which nodes hold the collar's dials"
 * is exactly the shape of every defect this ruling closed. ComposePanel
 * re-exports it, so the dock's import path and its tests are unchanged.
 *
 * It has to be the GRAPH read and not the candidate row's own legs:
 * `repriceAtLeverage` returns a hand-authored row untouched, so the row's legs
 * are frozen at the template's dials while the header's line follows the dial
 * the builder just moved — reading the row would put two different strikes on
 * one screen.
 *
 * Null off the collar family and null on a partial rack, exactly where
 * `collarForfeit` and `collarModel` refuse.
 */
export function laneCollarForfeit(loop: LoopGraph): CollarForfeit | null {
  const call = nodeFor(loop, "covered-call")?.data.params;
  const put = nodeFor(loop, "protective-put")?.data.params;
  if (!call || !put) return null;
  return collarForfeit({
    strikePct: String(call.strikePct ?? ""),
    floorPct: String(put.floorPct ?? ""),
    rollDays: String(call.rollDays ?? ""),
  });
}

// ── What a lane family may not eject ──────────────────────────────────────

/**
 * Modules that are the strategy rather than an option on it (E2).
 *
 * On a delta-neutral LP the hedge is not a module you may take off: take it
 * off and what remains is a directional LP, which is a different product with
 * a different name and a different risk. The old surface offered the eject
 * control and the old model rewarded pressing it. Both halves are closed:
 * the model prices the hedge as a gain, and the hedge is not ejectable.
 *
 * The loop family is unchanged — the 2026-08-20 ruling that a hedged-class
 * loop MAY run unhedged stands, and `unhedged-class-forbids-hedge` is the
 * only class rule left.
 *
 * MOVED ABOVE THE CANDIDATE ROWS (P0-8). The rows now state the composition
 * their number was computed at, and this is that composition: on both
 * hand-authored families the set a lane may not eject IS the set the model
 * priced. Declaring it here rather than importing `FAMILY_REQUIRED_GROUPS`
 * keeps the graph-ops ↔ templates cycle free of any top-level read (this
 * file's body can evaluate before graph-ops' does, which would put that
 * constant in TDZ). The two are held identical by a test rather than by an
 * import: see `__tests__/hand-authored-gate.test.ts`.
 */
export const STRUCTURAL_MODULES: Record<LaneFamily, ReadonlySet<ModuleKey>> = {
  loop: new Set<ModuleKey>(["liquidity-source"]),
  dnlp: new Set<ModuleKey>(["liquidity-source", "auto-center", "hedge"]),
  collar: new Set<ModuleKey>(["liquidity-source", "covered-call", "protective-put"]),
  /* ⚠ WP-0 COMPILE ROW — WP-2 OWNS THIS FILE AND MUST CONFIRM IT.
     `Record<LaneFamily, …>` demanded a member the moment the fourth family
     landed. The value is not a guess: `hand-authored-gate.test.ts` holds this
     constant identical to `FAMILY_REQUIRED_GROUPS`, and the treasury family
     requires exactly these two by name. What WP-2 owns is the ROWS this set
     is a claim about. */
  treasury: new Set<ModuleKey>(["liquidity-source", "redemption-route"]),
};

/** True when this lane family allows the module to be ejected. */
export function isEjectable(family: LaneFamily, key: ModuleKey): boolean {
  return !STRUCTURAL_MODULES[family].has(key);
}

/**
 * `STRUCTURAL_MODULES` in the OR-group shape `validateGraph` reads (P0-8).
 *
 * Every group here is a singleton, because on these two families every
 * required module is required by name — there is no "leverage or a hedge"
 * choice of anchors the way the loop family has one. The shape is carried
 * anyway so a family that grows an alternative anchor states it on the row
 * instead of silently over-requiring.
 */
function requiresFor(family: LaneFamily): readonly (readonly ModuleKey[])[] {
  return [...STRUCTURAL_MODULES[family]].map((k) => [k] as readonly ModuleKey[]);
}

// ── The candidate rows, BUILT by the models above ─────────────────────────

const DN_LP_FIT = dnLpModel(DN_LP_DEFAULT_DIALS);
const COLLAR_FIT = collarModel(COLLAR_DEFAULT_DIALS);

/** Terms carried on a hand-authored row so a surface can print the legs and
 *  recover the hedgeless number without re-deriving either. */
export interface HandAuthoredTerms {
  family: FamilyModel["family"];
  hedgelessApy: number | null;
  legs: ModelLeg[];
  /**
   * The structural hedge's own decomposition (FB-1); null when the family
   * holds no perp leg. Read STRUCTURALLY by `hedge-econ` — the way
   * `mock-quote.hedgelessApy` reads `hedgelessApy` above — because importing
   * this file there would close the templates → capacity → hedge-econ
   * import cycle.
   */
  hedge: AuthoredHedgeTerms | null;
  /**
   * WHAT THE ISSUER PUBLISHES ABOUT GETTING OUT, and what it does not
   * (founder ruling H-7). Null on every family whose position is not an
   * issuer share, exactly as `hedge` is null on every family whose
   * protection is not a perp short.
   *
   * It travels ON THE ROW for the same reason `hedge` and `requires` do: the
   * row that carries the number carries the terms the number is true under,
   * so `risk-table` and the exit dial read one owner rather than each
   * deriving a settlement window from a venue name.
   */
  redemption: IssuerRedemptionTerms | null;
  /**
   * THE COMPOSITION THIS ROW'S NUMBER WAS COMPUTED AT (P0-8), as OR-groups a
   * lane must satisfy before the number describes what is on the rack.
   *
   * A hand-authored row carries one figure for one machine: `collarModel`
   * priced a written call AND a held put, `dnLpModel` priced a centered LP
   * AND its perp short. A lane holding half of that is a different machine
   * with no number, so `composedNetApy` refuses rather than printing the
   * whole family's APY under a partial rack. Before this field the three
   * partial collar states all printed +11.826% and the naked LP printed
   * +3.229% for a fully long position.
   *
   * It travels ON THE ROW so `mock-quote` needs no import to check it: the
   * row that carries the number carries the terms the number is true under.
   */
  requires: readonly (readonly ModuleKey[])[];
}

type HandAuthoredEconomics = NonNullable<ProjectedCandidate["economics"]> & {
  model: "hand-authored";
  terms: HandAuthoredTerms;
};

/** A candidate whose economics carry the hand-authored tag. Structurally a
 *  ProjectedCandidate everywhere else, so no consumer needs to know. */
export type HandAuthoredCandidate = Omit<ProjectedCandidate, "economics"> & {
  economics: HandAuthoredEconomics;
};

/**
 * Delta-neutral LP: WETH/USDC concentrated liquidity on Aerodrome, Base.
 *
 * `fundingP25Apr` is deliberately NULL, not the +4.26% the model charges the
 * short leg. The field means "the p25 funding of the LOOP's short leg" and
 * this row has no loop; the funding it does earn is on `lpDeltaShare` of the
 * position and lives in the legs and in `terms.hedge` (FB-1), which is where
 * hedge-econ reads it. Leaving the generic field null keeps every consumer
 * that subtracts it (mock-quote's template branch) at a truthful "this row
 * carries no such number" rather than at a wrong one.
 *
 * `collateralYieldApy` is the LP's own accrual net of LVR and recentering —
 * what a dollar in the position actually earns — so `grossCarry(row, 1)`
 * lands on the honest hedgeless figure instead of on gross fee APR.
 */
export const DN_LP_CANDIDATE: HandAuthoredCandidate = {
  id: "template:dn-lp:aerodrome-base:weth-usdc",
  venue: "aerodrome-base",
  cls: "A",
  pair: "WETH/USDC LP",
  collateralSymbol: "WETH",
  debtSymbol: "USDC",
  hlCoin: "ETH",
  eligible: true,
  eligibleWithRewards: null,
  lt: null,
  headlineApr: DN_LP_FIT.netApy,
  score: null,
  scoreN1: null,
  apyRiskAdj: null,
  economics: {
    model: "hand-authored",
    terms: {
      family: DN_LP_FIT.family,
      hedgelessApy: DN_LP_FIT.hedgelessApy,
      legs: DN_LP_FIT.legs,
      hedge: DN_LP_FIT.hedgeTerms,
      // An LP position is not an issuer share; there is no transfer agent to
      // publish a window and no route table to state.
      redemption: null,
      // The LP and its short. `dnLpModel` charges the hedge's funding and its
      // execution in the legs above, so a lane holding the range and no short
      // is not this row's machine and has no number here.
      requires: requiresFor("dnlp"),
    },
    netApyOnDepositApy: DN_LP_FIT.netApy,
    netCarryOnEquityApy: DN_LP_FIT.netCarry,
    // An LP is not levered. The loop dial does not belong on this family and
    // `repriceAtLeverage` correctly refuses to move a row whose L is 1.
    loopLeverage: 1,
    targetLtv: 0,
    capacityUsd: DN_LP_FIT.capacityUsd,
    capacityBinding: DN_LP_FIT.capacityBinding,
    fundingP25Apr: null,
    collateralYieldApy: DN_LP_FIT.hedgelessApy ?? 0,
    borrowApyMarginal: 0,
  },
  firstFailedGate: null,
  failedGates: [],
  gatesPassed: 0,
  gatesTotal: 0,
  launchable: false,
};

/**
 * Treasury collar: a DAO treasury token at a mock options venue on Base.
 *
 * cls N1 — no perp hedge belongs here; the option pair IS the protection, and
 * `unhedged-class-forbids-hedge` is what keeps a perp leg off the lane.
 *
 * `collateralYieldApy` is 0, which is TRUE: a bare governance token pays
 * nothing. The premium used to sit in that field (E6), where the loop
 * arithmetic would have multiplied it by L the moment anything levered the
 * lane. It is a premium and it lives in the legs.
 */
export const COLLAR_CANDIDATE: HandAuthoredCandidate = {
  id: "template:treasury-collar:options-base:dao",
  venue: "options-base",
  cls: "N1",
  pair: "DAO token",
  collateralSymbol: "DAO",
  debtSymbol: "USDC",
  hlCoin: null,
  eligible: true,
  eligibleWithRewards: null,
  lt: null,
  headlineApr: COLLAR_FIT?.netApy ?? 0,
  score: null,
  scoreN1: null,
  apyRiskAdj: COLLAR_FIT?.netApy ?? 0,
  economics: {
    model: "hand-authored",
    terms: {
      family: "collar",
      hedgelessApy: COLLAR_FIT?.hedgelessApy ?? null,
      legs: COLLAR_FIT?.legs ?? [],
      hedge: COLLAR_FIT?.hedgeTerms ?? null,
      // A governance token is not an issuer share; nobody publishes a
      // redemption window for it.
      redemption: null,
      // Both option legs. A written call alone prices at +44.49% APR with the
      // sold upside not charged anywhere — the most seductive number in the
      // product and the one composition that could actively harm a depositor.
      // A held put alone is negative at all nine dial combinations. Neither
      // half has a number, so neither half prints one.
      requires: requiresFor("collar"),
    },
    netApyOnDepositApy: COLLAR_FIT?.netApy ?? 0,
    netCarryOnEquityApy: COLLAR_FIT?.netApy ?? 0,
    loopLeverage: 1,
    targetLtv: 0,
    capacityUsd: COLLAR_FIT?.capacityUsd ?? 0,
    capacityBinding: COLLAR_FIT?.capacityBinding ?? COLLAR_CAPACITY_BINDING,
    fundingP25Apr: null,
    collateralYieldApy: COLLAR_MODEL.underlyingYieldApy,
    borrowApyMarginal: 0,
  },
  firstFailedGate: null,
  failedGates: [],
  gatesPassed: 0,
  gatesTotal: 0,
  launchable: false,
};


// ══════════════════════════════════════════════════════════════════════════
// THE TREASURY FLOOR — six issuer rows and one model
// ══════════════════════════════════════════════════════════════════════════
//
// SIX ROWS, ONE PER ISSUER (founder ruling H-6). One row would have meant
// Priime picked the issuer in the catalog rather than the builder picking it
// on the rack, and it would have left `exitPath` a one-option control, which
// is a dead control: a single issuer publishes a single set of routes.
//
// WHAT IS MEASURED AND WHAT IS MODELED, said once so nobody has to guess:
//
//   MEASURED, from `priime/brand/vaults-data.json` — every fund's TVL, its
//     30-day mean APY, its 30-day realized volatility and its deepest
//     drawdown. Provenance and derivation in `TREASURY_SOURCE`.
//   MEASURED, from each ISSUER'S OWN documents — every route out, its
//     settlement, its minimum, its published limit, its business-hours
//     window, and the transfer restriction on the token. Each route names
//     the document it was read from.
//   MODELED — exactly one constant, `TREASURY_MODEL.maxFundSharePct`, whose
//     justification is written beside it.
//
// There is nothing else, and that is deliberate. An issuer publishes ONE
// rate, already net of the fund's own fee, so a second leg here would be a
// number nobody measured.

/**
 * THE SOURCE, AND WHY IT IS A SEEDED CONSTANT RATHER THAN A FILE READ.
 *
 * `vaults-data.json` lives OUTSIDE this repository, at the path below. A
 * module that read that path would compile on one laptop and fail on every CI
 * runner and every Vercel build, so the readings are extracted at authoring
 * time and seeded here with the file's own timestamp — exactly as
 * `DN_LP_POOL_DEPTH` seeds the measured Aerodrome pool depth one family over.
 * Nothing below is rounded, smoothed or averaged over a window the file does
 * not carry.
 *
 * ⚠ ONE DEVIATION FROM THE WORK ORDER, RECORDED. It says to read "the
 * `protocols` array". Two of the six products, OUSG and USDY, are ONE
 * protocol row (`ondo-yield-assets`), so that array cannot separate them and
 * the split is taken from `vaults` by fund name. The same name filter is what
 * the CLO ruling asks for: `centrifuge-protocol` mixes a treasury fund with
 * three CLO funds, and its protocol row reads 4.3415% whole against 3.5922%
 * for its treasury fund alone.
 */
export const TREASURY_SOURCE = {
  path: "/Users/antonipalazzolooffice/Desktop/priime/brand/vaults-data.json",
  /** The file's own `generated_at`. */
  generatedAt: "2026-09-02T05:34:50Z",
  /** The same instant as a date, which is the grain a footer stamp reads in
   *  and the grain `DN_LP_POOL_DEPTH.asOf` already uses. */
  asOf: "2026-09-02",
  /** How each reading below was produced from that file. */
  derivation:
    "tvlUsd and apyMean30d from protocols[] where an issuer ships one fund; summed and TVL-weighted over vaults[] filtered by fund name where one protocol ships more than one",
} as const;

/**
 * THE ONE MODELED CONSTANT ON THIS FAMILY.
 *
 * Past some share of a fund's outstanding tokenized shares, your redemption
 * IS that fund's bill selling for the day, and the settlement window the
 * issuer publishes stops describing you: you are the queue. That is the same
 * mechanism `DN_LP_MODEL.maxPoolSharePct` names one family over ("the share
 * of the pool past which your own size is what sets your fee APR"), at the
 * same 5%, and it is why `capacityBinding` on every treasury row is the
 * fund's own shares rather than anything an issuer promises.
 */
export const TREASURY_MODEL = {
  maxFundSharePct: 0.05,
} as const;

/**
 * The capacity binding every treasury row states, as ONE string.
 *
 * `capacityBindingLabel` renders `limited by <binding>`, so this is written
 * as a noun phrase naming the resource that runs out — the E9 rule, which the
 * dn-LP row learned the hard way. It needs no branch in `capacity.ts`: the
 * forward-compatible arm prints it verbatim and the sentence reads.
 *
 * It is deliberately NOT in `isModeledBinding`. The denominator is a measured
 * fund TVL with a date on it, not an assumed book like the collar's option
 * open interest, and calling it modeled would put the word beside a figure
 * that was read rather than invented.
 */
export const TREASURY_CAPACITY_BINDING = "the fund's outstanding tokenized shares";

/** How a reading was obtained. `measured` quotes a named document or a chain
 *  read; `stated` means the fact is on the record but the issuer's own
 *  document could not be reached to quote a figure from it. */
export type ReadingProvenance = "measured" | "stated";

/** The routes out of a tokenized position this product knows how to name. */
export type ExitRouteId =
  /** The issuer's own contract pays a stablecoin against the share,
   *  atomically. */
  | "instant-usdc"
  /** A third party buys the share for a stablecoin (Circle's BUIDL contract,
   *  a teller). */
  | "stablecoin-swap"
  /** The transfer agent redeems the share and wires dollars. */
  | "issuer-wire";

/**
 * ONE ROUTE OUT, AS THE ISSUER PUBLISHES IT.
 *
 * Every field is either a figure an issuer document states or `null`. A null
 * is a MEASURED ABSENCE — the issuer publishes no such figure — and it is
 * never a zero, never a default, and never a pending measurement. `source`
 * names the document, so a reader can go and disagree with it.
 */
export interface ExitRoute {
  id: ExitRouteId;
  /** Rendered verbatim wherever the route is offered. */
  label: string;
  /** Business days from request to funds. 0 is atomic or same-day. */
  settlementDays: number;
  /** Smallest size the issuer accepts on this route, USD, or null where it
   *  publishes none. */
  minUsd: number | null;
  /** Largest size this route clears in 24 hours, USD, where the issuer
   *  publishes a limit. Null where it publishes none. */
  limitUsd: number | null;
  /** The business-day or business-hours constraint in the issuer's own
   *  terms. Null where the route runs continuously. */
  window: string | null;
  reading: ReadingProvenance;
  /** The document, named. */
  source: string;
}

/** What an issuer publishes about getting out, and what it does not. */
export interface IssuerRedemptionTerms {
  /** Every published route, fastest first. Never empty: a position with no
   *  route out is not a position this product will price. */
  routes: readonly ExitRoute[];
  /** The transfer restriction the token itself carries. */
  transferRestriction: string;
  /**
   * WHAT THE ISSUER DOES NOT PUBLISH, named one at a time (founder ruling
   * H-7). Each entry says what was looked for and where.
   *
   * These are measured absences, and they are the honest half of the fetch.
   * An empty array is the claim that nothing was missing, so it is only ever
   * written where that is true.
   */
  notPublished: readonly string[];
}

/** The measured facts one issuer's own fund data carries. */
export interface TreasuryIssuerFacts {
  /** The fund's name. */
  fundName: string;
  /** What the fund holds, from the issuer's own description. */
  holds: string;
  /** Total value of the fund's tokenized shares, USD. */
  fundTvlUsd: number;
  /** The fund's 30-day mean APY, as a fraction. */
  apyMean30d: number;
  /**
   * 30-day realized volatility of the fund's own return series, and the
   * deepest drawdown in it.
   *
   * These two carry the whole difference between a bill fund and a carry
   * fund without anyone grading either: BUIDL reads 0.0022 and 0, USCC reads
   * 0.6033 and −0.0899, on the same file on the same day.
   */
  volatility30d: number;
  maxDrawdown: number;
  /** Smallest size the issuer accepts into the fund, USD, or null where none
   *  was found in the documents named in `minSubscriptionSource`. */
  minSubscriptionUsd: number | null;
  /** The document the subscription minimum was read from, or where it was
   *  looked for and not found. */
  minSubscriptionSource: string;
}

/**
 * THE THREE STRINGS A NON-FUND ISSUER HAS TO SPELL FOR ITSELF.
 *
 * Five of the six rows on this family ARE tokenized funds, so the family's
 * own nouns are true of them and this block is absent. The Aave v3 Base USDC
 * reserve is not a fund: it issues no shares, publishes no NAV and holds no
 * bills. Left on the family's defaults it printed `$938K in the fund's
 * outstanding tokenized shares`, `Unwinding aUSDC through the fund's
 * outstanding tokenized shares` and `Issuer rate, 30-day mean` over a spot
 * daily supply read, three claims about a lending pool that are simply false.
 *
 * It is a per-issuer OVERRIDE rather than a branch in the family's model, so
 * the five funds keep byte for byte the register they shipped with and the
 * seventh issuer added tomorrow inherits the default by saying nothing.
 */
interface TreasuryIssuerRegister {
  /** The noun `limited by <binding>` names: the resource that runs out. */
  readonly capacityBinding: string;
  /** What the row's one leg IS, where `Issuer rate, 30-day mean` is wrong. */
  readonly legLabel: string;
  /** The vintage stamp, where the family's fund-file date does not apply. */
  readonly asOfNote: string;
}

interface TreasuryIssuer {
  venue: CanvasVenueId;
  /** The share token's symbol, which is also the collateral symbol. */
  token: string;
  facts: TreasuryIssuerFacts;
  redemption: IssuerRedemptionTerms;
  /** Absent on every issuer the family's own nouns describe correctly. */
  register?: TreasuryIssuerRegister;
}

/**
 * THE SIX ISSUERS, AND EVERY REDEMPTION FACT FETCHED FROM THEIR OWN
 * DOCUMENTS (founder ruling H-7, closed 2026-09-03).
 *
 * H-7 exists because the exit picker's entire justification is that issuers
 * differ in how you get out, and no agent had ever fetched a single one of
 * those terms. They are fetched now, and they do differ: same-day atomic
 * USDC on four of the six, next-business-day at best on one, and a $50,000
 * floor on the only route one issuer offers above $5,000.
 *
 * ⚠ USCC IS NOT A BILL FUND AND MUST NOT BE SOLD AS THE FLOOR. Superstate's
 * own document says it "pursues crypto basis and carry strategies" across
 * bitcoin and ether alongside US Treasury securities. Its return is FUNDING,
 * which is the quantity the router leaves a carry lane because of, so a move
 * from a carry lane into USCC lands in the same exposure it left. The
 * measured separation is in the row: 0.6033 volatility against BUIDL's
 * 0.0022, and −8.99% drawdown against 0. It ships because H-6 rules six rows
 * and `CanvasVenueId` (owned by WP-0) mints exactly these six ids; the swap
 * to JTRSY, the Janus Henderson Anemoy Treasury Fund, is filed as a
 * cross-package request.
 */
const TREASURY_ISSUERS: readonly TreasuryIssuer[] = [
  {
    /* USDC LENDING ON AAVE, and it is the floor `basis-floor` opens on.
       -------------------------------------------------------------------
       The carry lane dies when funding turns negative, so its fallback has to
       earn a rate that funding cannot touch. Supplying USDC to a lending pool
       is the shortest honest form of that, and it is what the product brief
       asked for. It rides the same hand-authored, UNLEVERED family the six
       tokenized funds use: one leg, no perp, no borrow, so there is no
       liquidation distance to defend on the lane the router evacuates into.
       Withdrawal from a lending pool is atomic while liquidity is available,
       so the route settles same-block and the exit picker states that rather
       than inventing a window. */
    venue: "treasury-ausdc-base",
    token: "aUSDC",
    facts: {
      fundName: "Aave v3 Base, USDC reserve",
      holds: "USDC supplied to the Aave v3 Base lending pool",
      fundTvlUsd: 18_760_507,
      apyMean30d: 0.0370119,
      volatility30d: 0,
      maxDrawdown: 0,
      minSubscriptionUsd: null,
      minSubscriptionSource:
        "None. A lending pool accepts any size; the six tokenized funds beside it do not, which is the row's real advantage as a floor.",
    },
    redemption: {
      routes: [
        {
          id: "instant-usdc",
          label: "Withdraw to USDC",
          settlementDays: 0,
          minUsd: null,
          limitUsd: null,
          window: null,
          reading: "stated",
          source:
            "Aave v3 withdraw is atomic while the reserve holds unborrowed liquidity. DefiLlama yields, aave-v3 Base USDC pool, supply APY 3.70119% on $18,760,507 supplied, fetched 2026-09-03.",
        },
      ],
      transferRestriction: "None. USDC is freely transferable and the aToken is not permissioned.",
      notPublished: [],
    },
    /* NOT A FUND, so it does not borrow the family's fund nouns. The
       denominator under `capacityUsd` is the same 5% of the same measured
       figure the five funds use, and on this row that figure is the reserve's
       SUPPLIED balance ($18,760,507 on 2026-09-03, in the route source
       above), so the binding names the supply rather than shares nobody
       issued. The leg is a spot daily supply read on the day the row is
       priced, not a 30-day mean: the router serves this row from the
       2026-09-07 capture (`floorRowForRate`) and the label has to survive
       that. The stamp names its own fact, which is why it says supply depth
       and not `fund readings`: the RATE beside it is measured on a later day
       and says so itself. */
    register: {
      capacityBinding: "the reserve's supplied liquidity",
      legLabel: "Reserve supply rate, measured",
      asOfNote: "Supply depth measured 2026-09-03. No block pinned.",
    },
  },
  {
    venue: "treasury-buidl-ethereum",
    token: "BUIDL",
    facts: {
      fundName: "BlackRock USD Institutional Digital Liquidity Fund",
      holds: "US Treasury bills, repurchase agreements and cash",
      fundTvlUsd: 3_557_546_098,
      apyMean30d: 0.034373,
      volatility30d: 0.0022,
      maxDrawdown: 0,
      minSubscriptionUsd: 100_000,
      minSubscriptionSource:
        "SEC Form D/A for BlackRock USD Institutional Digital Liquidity Fund Ltd, CIK 0002013810, filed 2026-07-27, minimum investment accepted",
    },
    redemption: {
      routes: [
        {
          id: "stablecoin-swap",
          label: "Circle USDC contract",
          settlementDays: 0,
          minUsd: null,
          limitUsd: null,
          window: null,
          reading: "measured",
          source:
            "Circle pressroom, USDC smart contract for BUIDL fund investors: a near-instant, 24/7 BUIDL off-ramp",
        },
        {
          id: "issuer-wire",
          label: "Transfer agent wire",
          settlementDays: 1,
          minUsd: 250_000,
          limitUsd: null,
          window:
            "tokens must reach the transfer agent's redemption wallet before 3:00 PM ET",
          reading: "stated",
          source:
            "Securitize primary-market terms for BUIDL: daily redemption frequency, 250,000 USDC minimum, 3:00 PM ET cut-off",
        },
      ],
      transferRestriction:
        "a permissioned share token; transfers only between wallets the transfer agent has onboarded to the fund's allowlist",
      notPublished: [
        "an explicit day count for the transfer agent wire; the reading above is stated from the fund's daily dealing and its 3:00 PM ET cut-off",
        "any per-investor or fund-wide size limit on the Circle USDC route, in Circle's own announcement of it",
      ],
    },
  },
  {
    venue: "treasury-usyc-ethereum",
    token: "USYC",
    facts: {
      fundName: "Hashnote US Yield Coin",
      holds: "short-duration US Treasury bills and overnight reverse repo",
      fundTvlUsd: 2_706_436_976,
      apyMean30d: 0.031908,
      volatility30d: 0.0073,
      maxDrawdown: 0,
      minSubscriptionUsd: null,
      minSubscriptionSource:
        "looked for in Circle's USYC overview and the Hashnote subscription and redemption page; neither states one",
    },
    redemption: {
      routes: [
        {
          id: "instant-usdc",
          label: "USYC Teller",
          settlementDays: 0,
          minUsd: null,
          limitUsd: null,
          window: null,
          reading: "measured",
          source:
            "Circle developer documentation, USYC overview: subscriptions and redemptions are available 24/7/365 and settle atomically in real time (T+0)",
        },
      ],
      transferRestriction:
        "onboarded investors only, and only entities that are not US Persons as defined in Regulation S under the Securities Act of 1933",
      notPublished: [
        "a minimum subscription or redemption size, in either the Circle overview or the Hashnote teller page",
        "the fee charged for the Private Liquidity Teller, which the same page says carries additional fees",
      ],
    },
  },
  {
    venue: "treasury-ousg-ethereum",
    token: "OUSG",
    facts: {
      fundName: "Ondo Short-Term US Government Treasuries",
      holds: "short-term US government securities",
      fundTvlUsd: 336_036_655,
      apyMean30d: 0.03464,
      volatility30d: 0.0191,
      maxDrawdown: 0,
      minSubscriptionUsd: null,
      minSubscriptionSource:
        "looked for in Ondo's OUSG redeeming and instant-limits pages; both state redemption minimums and neither states a subscription minimum",
    },
    redemption: {
      routes: [
        {
          id: "instant-usdc",
          label: "Instant redemption",
          settlementDays: 0,
          minUsd: 5_000,
          limitUsd: 25_000_000,
          window: null,
          reading: "measured",
          source:
            "Ondo documentation, OUSG redeeming and instant limits: $5K minimum, atomic, and a $25M per-investor limit resetting every 24 hours inside a $50M global limit",
        },
        {
          id: "issuer-wire",
          label: "Standard redemption",
          settlementDays: 1,
          minUsd: 50_000,
          limitUsd: null,
          window:
            "requests after 4pm ET are treated as submitted the following day and settle a day later",
          reading: "measured",
          source:
            "Ondo documentation, OUSG redeeming: $50K minimum, 4pm ET cut-off, typically T+1 before it and T+2 after",
        },
      ],
      transferRestriction:
        "a qualified-access product; transfers only between addresses Ondo has onboarded",
      notPublished: [],
    },
  },
  {
    venue: "treasury-usdy-ethereum",
    token: "USDY",
    facts: {
      fundName: "Ondo US Dollar Yield",
      holds: "short-term US Treasuries and bank demand deposits",
      fundTvlUsd: 2_192_798_250,
      apyMean30d: 0.0355,
      volatility30d: 0.0019,
      maxDrawdown: 0,
      minSubscriptionUsd: 500,
      minSubscriptionSource:
        "Ondo documentation, USDY investing and redeeming: the minimum for investment or redemption is currently $500",
    },
    redemption: {
      routes: [
        {
          id: "instant-usdc",
          label: "Instant redemption",
          settlementDays: 0,
          minUsd: 500,
          limitUsd: null,
          window: null,
          reading: "stated",
          source:
            "Ondo documentation, USDY basics and the USDY_InstantManager integration guide: mint and redeem against USDC at any time",
        },
        {
          id: "issuer-wire",
          label: "Wire to a non-US bank",
          settlementDays: 5,
          minUsd: 100_000,
          limitUsd: null,
          window:
            "processed within five Business Days of the request and valid wire instructions",
          reading: "stated",
          source:
            "Ondo documentation, USDY investing and redeeming: USD bank wires for $100,000 or more, processed within five Business Days",
        },
      ],
      transferRestriction:
        "accessible to qualifying non-US individual and institutional investors",
      notPublished: [
        "the USDY_InstantManager's configured minimum size and its per-user and global rate limits, which its own integration guide names without values",
      ],
    },
  },
  {
    venue: "treasury-ustb-ethereum",
    token: "USTB",
    facts: {
      fundName: "Invesco Short Duration US Government Securities Fund",
      holds: "short-duration US government securities",
      fundTvlUsd: 637_750_233,
      apyMean30d: 0.035205,
      volatility30d: 0.1826,
      maxDrawdown: 0,
      minSubscriptionUsd: 100_000,
      minSubscriptionSource:
        "Superstate documentation, Invesco USTB: the minimum initial investment is $100,000 unless waived by Superstate",
    },
    redemption: {
      routes: [
        {
          id: "instant-usdc",
          label: "USDC payout",
          settlementDays: 0,
          minUsd: null,
          limitUsd: null,
          window:
            "delivered immediately including non-business days, subject to available liquidity; on US market holidays no Treasury bills are bought or sold",
          reading: "measured",
          source: "Superstate documentation, Invesco USTB: subscriptions and redemptions",
        },
        {
          id: "issuer-wire",
          label: "USD wire",
          settlementDays: 0,
          minUsd: null,
          limitUsd: null,
          window: "same-day for USD if the request is received before 1pm ET",
          reading: "measured",
          source: "Superstate documentation, Invesco USTB: subscriptions and redemptions",
        },
      ],
      transferRestriction:
        "freely transferable between wallet addresses on the Allowlist",
      notPublished: [
        "a minimum redemption size, in the same page that states the $100,000 subscription minimum",
      ],
    },
  },
  {
    venue: "treasury-uscc-ethereum",
    token: "USCC",
    facts: {
      fundName: "Bitwise Crypto Carry Fund",
      holds:
        "crypto basis and carry positions in bitcoin and ether, staking, and US Treasury securities",
      fundTvlUsd: 84_372_387,
      apyMean30d: 0.038852,
      volatility30d: 0.6033,
      maxDrawdown: -0.0899,
      minSubscriptionUsd: 100_000,
      minSubscriptionSource:
        "Superstate documentation, Bitwise USCC: the minimum initial investment is $100,000 unless waived by Superstate",
    },
    redemption: {
      routes: [
        {
          id: "issuer-wire",
          label: "Redemption at daily NAV",
          settlementDays: 1,
          minUsd: null,
          limitUsd: null,
          window:
            "priced once per market day at 5pm ET; proceeds delivered T+1 for requests received before 5pm ET and T+2 after",
          reading: "measured",
          source:
            "Superstate documentation, Bitwise USCC: pricing, subscriptions and redemptions",
        },
      ],
      transferRestriction:
        "freely transferable between wallet addresses on the Allowlist",
      notPublished: [
        "a minimum redemption size, in the same page that states the $100,000 subscription minimum",
      ],
    },
  },
];

/**
 * The treasury family model at one issuer.
 *
 * ONE LEG, and that is the honest shape rather than a thin one. The issuer
 * publishes a single number and it is already net of the fund's own fee, so
 * every additional leg would be a figure this file invented. The exit is not
 * a leg either: a settlement window is a cost paid PER EXIT, in days of
 * forgone carry, which is `exitProfileFor`'s `windowCost` and belongs on the
 * move rather than on the rate.
 *
 * `hedgelessApy` equals `netApy`, stated rather than left null, and both
 * halves of that are deliberate. It is TRUE: the structural leg on this
 * family is the redemption route, and a route changes what leaving COSTS,
 * never what holding EARNS. It is STATED because `mock-quote.hedgelessApy`
 * falls through to `netApyOnDepositApy − fundingP25Apr` on a hand-authored
 * row that states nothing, and with `fundingP25Apr` null that path returns
 * the net APY while claiming to have priced a deletion. The family also
 * cannot seat `hedge` at all, so no surface has anywhere to print it.
 */
export function treasuryModel(issuer: TreasuryIssuer): FamilyModel {
  const rate = issuer.facts.apyMean30d;
  return {
    family: "treasury",
    netApy: rate,
    // Unlevered, and nothing is escrowed: the deployed share is 1, so the
    // return on deployed capital and the return on deposit are one number.
    netCarry: rate,
    hedgelessApy: rate,
    legs: [{ label: issuer.register?.legLabel ?? "Issuer rate, 30-day mean", apr: rate }],
    // No perp short on this family, so there is no hedge decomposition to
    // state (the collar answers the same question the same way).
    hedgeTerms: null,
    capacityUsd: Math.round(issuer.facts.fundTvlUsd * TREASURY_MODEL.maxFundSharePct),
    capacityBinding: issuer.register?.capacityBinding ?? TREASURY_CAPACITY_BINDING,
  };
}

/** One issuer row, BUILT by the model above at that issuer's own readings. */
function treasuryCandidate(issuer: TreasuryIssuer): HandAuthoredCandidate {
  const fit = treasuryModel(issuer);
  return {
    id: `template:treasury-floor:${issuer.venue}:${issuer.token.toLowerCase()}`,
    venue: issuer.venue,
    // N1: there is no perp leg on this family and none may be seated, which
    // is what `unhedged-class-forbids-hedge` already enforces for the collar.
    cls: "N1",
    pair: issuer.token,
    collateralSymbol: issuer.token,
    // Every one of the six subscribes and redeems against USDC, so the
    // settlement leg is a fact about the row rather than a placeholder.
    debtSymbol: "USDC",
    hlCoin: null,
    // The DN_LP_CANDIDATE precedent: a hand-authored row is eligible because
    // it was priced, not because it cleared a scan gate it never entered.
    eligible: true,
    eligibleWithRewards: null,
    lt: null,
    headlineApr: fit.netApy,
    score: null,
    scoreN1: null,
    apyRiskAdj: fit.netApy,
    economics: {
      model: "hand-authored",
      terms: {
        family: "treasury",
        hedgelessApy: fit.hedgelessApy,
        legs: fit.legs,
        hedge: null,
        redemption: issuer.redemption,
        // The issuer position and the route out of it. A lane holding the
        // position with no route is a position you cannot leave, and this
        // family will not print a number for one.
        requires: requiresFor("treasury"),
      },
      netApyOnDepositApy: fit.netApy,
      netCarryOnEquityApy: fit.netCarry,
      loopLeverage: 1,
      targetLtv: 0,
      capacityUsd: fit.capacityUsd,
      capacityBinding: fit.capacityBinding,
      // The field means "the p25 funding of the loop's short leg". This lane
      // has no loop and no short, so the truthful value is that it carries
      // no such number (the dn-LP row's own E3 ruling, applied).
      fundingP25Apr: null,
      // What a dollar in the position earns, which on this family IS the
      // whole return: `grossCarry(row, 1)` lands on the issuer rate.
      collateralYieldApy: fit.netApy,
      borrowApyMarginal: 0,
    },
    firstFailedGate: null,
    failedGates: [],
    gatesPassed: 0,
    gatesTotal: 0,
    // No rail: `compile.ts` has no shape for a transfer agent.
    launchable: false,
  };
}

/** The six issuer rows, in descending fund TVL — which is the order the
 *  source file already carries and therefore not an opinion. */
export const TREASURY_CANDIDATES: readonly HandAuthoredCandidate[] =
  TREASURY_ISSUERS.map(treasuryCandidate);

// ── Accessors for the treasury rows ───────────────────────────────────────

/** The issuer this candidate id names, or null on every other row. */
function treasuryIssuerFor(candidateId: string): TreasuryIssuer | null {
  const i = TREASURY_ISSUERS.findIndex(
    (_, n) => TREASURY_CANDIDATES[n]?.id === candidateId,
  );
  return i >= 0 ? (TREASURY_ISSUERS[i] ?? null) : null;
}

/** What the issuer behind this row publishes about getting out, or null on a
 *  row that is not an issuer position. */
export function issuerRedemptionTerms(
  candidateId: string | null | undefined,
): IssuerRedemptionTerms | null {
  return candidateId ? (treasuryIssuerFor(candidateId)?.redemption ?? null) : null;
}

/** The per-issuer register overrides, or null where the family's own nouns
 *  are already true of the row. Exported because `floorRowForRate` rebuilds
 *  this issuer from its parts to price it on a measured day, and a rebuild
 *  that dropped this block would print the fund nouns back onto the reserve. */
export function treasuryIssuerRegisterFor(
  candidateId: string | null | undefined,
): TreasuryIssuerRegister | null {
  return candidateId ? (treasuryIssuerFor(candidateId)?.register ?? null) : null;
}

/** The measured fund facts behind this row, or null on every other row. */
export function treasuryIssuerFacts(
  candidateId: string | null | undefined,
): TreasuryIssuerFacts | null {
  return candidateId ? (treasuryIssuerFor(candidateId)?.facts ?? null) : null;
}

/** The route a lane leaves by unless the builder picks another: the fastest
 *  the issuer publishes. `routes` is non-empty by construction. */
export function fastestExitRoute(terms: IssuerRedemptionTerms): ExitRoute {
  return terms.routes.reduce((a, b) => (b.settlementDays < a.settlementDays ? b : a));
}

/**
 * Business days between asking to leave and holding dollars, on the fastest
 * route the issuer publishes.
 *
 * This is the quantity `redemption-route`'s hidden `settlementDays` record
 * pins and the quantity `exitCost` reads. It is DERIVED from the fetched
 * routes rather than typed anywhere, so an issuer that opens a faster door
 * moves the dial, the axis and the register together.
 */
export function settlementDaysOf(terms: IssuerRedemptionTerms): number {
  return fastestExitRoute(terms).settlementDays;
}

/**
 * A settlement window as a reader reads it. Owned HERE, beside the routes,
 * because `risk-table` computes no quantity and formats none: every figure it
 * prints arrives already formatted from the module that owns the fact.
 *
 * `same day` rather than a zero, because zero days is not a duration a person
 * plans around; it is the absence of a wait, and the words say so.
 */
export function settlementWindowValue(route: ExitRoute): string {
  const d = route.settlementDays;
  if (d <= 0) return "same day";
  return `${d} business ${d === 1 ? "day" : "days"}`;
}

/**
 * THE VINTAGE A TREASURY LANE STAMPS ITS REGISTER WITH, or null on every
 * other row.
 *
 * The register's footer never prints a blank stamp: where no row was read at
 * a block it falls back to `MODELED_NO_BLOCK_NOTE`, which says the figures
 * were priced from the product's own model. On this family that sentence
 * would be false — the rate and the capacity denominator are MEASURED fund
 * readings with a date on them, and only the 5% share constant is modeled —
 * so the family states its own vintage instead of borrowing a sentence that
 * misdescribes it.
 */
export function treasuryAsOfNote(candidateId: string | null | undefined): string | null {
  const issuer = candidateId ? treasuryIssuerFor(candidateId) : null;
  if (!issuer) return null;
  return issuer.register?.asOfNote ?? `Fund readings measured ${TREASURY_SOURCE.asOf}. No block pinned.`;
}

/**
 * Every hand-authored row the product ships.
 *
 * The six treasury rows are SPREAD rather than listed, so a seventh issuer
 * lands in the catalog, in `modeledRows`, in `templateCatalogHit` and in the
 * fixture sweep by being added to `TREASURY_ISSUERS` and nowhere else. The
 * two template rows stay named: they are one row each and there is no set
 * for them to be spread from.
 */

// ── Accessors for the hand-authored rows ──────────────────────────────────

/** The family terms on a hand-authored row, or null on any other row. */
export function handAuthoredTerms(
  c: ProjectedCandidate | null | undefined,
): HandAuthoredTerms | null {
  const e = c?.economics;
  if (!e || !isHandAuthored(e)) return null;
  const t = (e as Partial<HandAuthoredEconomics>).terms;
  return t && Array.isArray(t.legs) ? t : null;
}

/**
 * The hedgeless number for a hand-authored row, or null when the family does
 * not define one.
 *
 * This is the replacement for `mock-quote.hedgelessApy`'s `isTemplateVenue`
 * branch, which subtracted `fundingP25Apr` and therefore repriced a
 * hedge-ejected delta-neutral LP UPWARD (E2).
 */
export function handAuthoredHedgelessApy(
  c: ProjectedCandidate | null | undefined,
): number | null {
  return handAuthoredTerms(c)?.hedgelessApy ?? null;
}

/** Catalog-hit fallback for template candidates (mock-quote path). Block 0
 *  = "no chain pin": every block-pin render site treats 0 as absent. */
export function templateCatalogHit(candidateId: string): CatalogHit | null {
  const row = TEMPLATE_CANDIDATES.find((c) => c.id === candidateId);
  return row ? { row, blockNumber: 0 } : null;
}

// ── Which lane families a market can be priced on ─────────────────────────

/** `FamilyModel["family"]` spells the dn-lp family with a hyphen; `LaneFamily`
 *  does not. One conversion, here, so the two spellings never both travel. */
const MODEL_FAMILY_TO_LANE: Record<FamilyModel["family"], LaneFamily> = {
  "dn-lp": "dnlp",
  collar: "collar",
  /* One spelling both ways, so there is nothing to convert and nothing to
     drift. Kept in the Record anyway: the Record is what fails to compile the
     day a fifth model family ships without a lane to land on. */
  treasury: "treasury",
};

/**
 * The lane families this market can be priced on (§5 rule 5).
 *
 * A hand-authored row belongs to exactly the family whose model built it —
 * `dnLpModel` for the LP, `collarModel` for the collar — and that fact is
 * already carried on the row as `economics.terms.family`, so it is read, never
 * re-derived and never matched off the venue name (the E1 anti-pattern that
 * three files used to share).
 *
 * Everything else is a scan row: a supply/borrow market with a liquidation
 * threshold and a perp leg, which is the loop family and only the loop family.
 * `collarModel` has no way to price it and `dnLpModel` has no pool for it.
 */
export function familiesForCandidate(
  c: ProjectedCandidate | null | undefined,
): LaneFamily[] {
  const t = handAuthoredTerms(c);
  return t ? [MODEL_FAMILY_TO_LANE[t.family]] : ["loop"];
}

/**
 * The same fact reachable from the GRAPH, where all a lane holds is the id it
 * pinned. `validateGraph` is the only caller: a restored draft or a copilot
 * proposal carries an id and no row, and the refusal has to hold there too.
 *
 * An unknown id is a scan row by construction — the hand-authored rows are the
 * two in `TEMPLATE_CANDIDATES` and nothing else is authored anywhere.
 */
export function familiesForCandidateId(candidateId: string): LaneFamily[] {
  return familiesForCandidate(templateCatalogHit(candidateId)?.row ?? null);
}

/**
 * THE STRATEGY SIBLING of `familiesForCandidateId` (funding launch rail,
 * 2026-08-24): is this market FUNDING-CLASS — a spot asset held against a perp
 * short, with no debt leg to lever?
 *
 * Funding is a STRATEGY inside the loop family, not a fourth family (design
 * ruling 1), so the family fact above does not discriminate it: a funding row
 * IS a loop-family row. What discriminates it at the GRAPH level — where a
 * restored draft holds only the id it pinned — is the id itself: the funding
 * scanner prefixes every candidate id with its own venue
 * (`hyperliquid-funding:999:khype:HYPE`), and no other scanner emits that
 * prefix. The ROW-level owner is `fundingComposable` (opportunities.ts), which
 * additionally demands a measured spot leg; this predicate answers the
 * narrower question the strategy layer asks of an id it cannot resolve.
 */
export function fundingClassCandidateId(candidateId: string): boolean {
  return candidateId.startsWith("hyperliquid-funding:");
}

// ── The registry ───────────────────────────────────────────────────────────

/**
 * THE FIFTH TEMPLATE'S TWO ROWS (founder ruling H-1).
 *
 * `basis-floor` racks a PAIR: a funding carry lane, and the treasury lane
 * that floors it. Neither row is invented here. Both are read from the owner
 * that already carries them, for the same reason every other seed in this
 * file is: a second copy of a market's numbers is how a card and a lane come
 * to describe two different positions.
 *
 * ── THE CARRY ROW, AND WHY IT IS THE COMMITTED SCAN ───────────────────────
 * There is no hand-authored funding row and there must not be one: the
 * funding scanner measures these books, and a family model in this file that
 * re-priced one would be a second opinion about a market somebody already
 * measured. So the row is PROJECTED out of the committed funding scan through
 * `projectVenueDocV2`, the same projector the catalog route runs, at the
 * document's own `generatedAtMs` (the only clock a fixture may be read
 * against; `nowMs` reaches nothing but the venue's `stale` flag, which this
 * derivation drops).
 *
 * The lane pins the row's REAL candidate id, so on the canvas it resolves
 * against whatever the live catalog serves for that book and prices there.
 * The projection below decides one thing only: the six liquidity-source
 * fields the seed writes.
 *
 * ── WHY kHYPE ─────────────────────────────────────────────────────────────
 * It is the best measured carry in the committed scan: the row states
 * `netApyOnDepositApy` 7.6961%, which the product's fee identity would
 * publish at 6.157%. Spec F.3 names the pair this template exists to draw as
 * "near 6.2%" against "near 2.75%", and on the committed catalog those two
 * sentences are about these two rows and no others.
 *
 * Both figures above are the ROWS' own, quoted so the choice is checkable.
 * Neither is what the rack prints: a seated lane is repriced by
 * `composedNetApy` at the composition it holds, which is the whole reason the
 * seed pins a composition rather than an APY.
 *
 * ── WHY BUIDL ─────────────────────────────────────────────────────────────
 * 3.4373% 30-day mean, which the same fee identity publishes at 2.7498%: F.3's
 * floor. It is the largest of the six funds ($3.56B), so its 5%-of-fund
 * capacity is the one that can actually receive a move; and it publishes TWO
 * routes out, so `exitPath` is a live control on this lane rather than a dead
 * one.
 *
 * USCC is the one row deliberately NOT taken here even though it prints the
 * highest treasury rate: it is a crypto basis and carry fund, so its return
 * IS funding, and a floor whose eligibility moves with the trigger is not a
 * floor. That separation is the whole thesis of the pairing.
 */
/**
 * THE CARRY LEG IS ETH, AND IT IS PICKED BY CAPACITY, NEVER BY HEADLINE.
 *
 * This seeded `khype:HYPE` until 2026-09-03, chosen because it carries the
 * highest APY in the committed scan (7.696%). That was the wrong criterion
 * twice over.
 *
 * It was wrong about the PRODUCT: the trade this template exists to compose is
 * the Ethena construction, spot LST long against a perp short on the same
 * underlying, and the asset that trade is written in is ETH. A template named
 * for the basis carry that racks a HYPE book teaches the wrong thing on the
 * first screen a builder sees.
 *
 * It was wrong about the SIZE: `khype` carries $10,514 of measured capacity.
 * `wsteth:ETH` carries $621,481, fifty-nine times more, and is the largest
 * book in the scan by a wide margin. A demo whose flagship lane cannot absorb
 * a five-figure deposit is a toy no matter what its headline says.
 *
 * The honest consequence is stated here rather than discovered later: the ETH
 * carry publishes near 1.5% after the compute fee, and the treasury floor
 * publishes 2.7%, so ON TODAY'S MEASURED FUNDING THE FLOOR PAYS MORE THAN THE
 * CARRY. That is not a defect in the pairing, it is the pairing's argument:
 * the administered funding ceiling caps the carry leg (see the quant ledger's
 * 10.95% finding), the spot leg carries the rest, and a router that can move
 * capital to the better lane is worth having precisely because the better lane
 * is not always the one the vault is named after.
 *
 * `bindingCarryRow()` already picks this same row for the router replay by
 * measured capacity, so the composed template and the replay now name one book
 * instead of two.
 */
const BASIS_FLOOR_CARRY_ID = "hyperliquid-funding:999:wsteth:ETH";
const BASIS_FLOOR_TREASURY_VENUE: CanvasVenueId = "treasury-ausdc-base";

/** The committed funding scan, projected once, at its own generation instant. */
const FUNDING_SCAN: ProjectedVenue = (() => {
  const doc = snapHlFunding as unknown as VenueDocV2;
  return projectVenueDocV2(doc, doc.generatedAtMs);
})();


/**
 * The two rows, resolved.
 *
 * Both lookups can miss, and a miss is a REPO defect rather than a runtime
 * state: the funding fixture is a committed artifact and the six issuers are
 * declared thirty lines up. `buildTemplatePortfolio` guards on it anyway and
 * cold-starts the canvas honestly, which is the same answer a catalog-pick
 * template gives an empty catalog, and `template-regression.test.ts` asserts
 * both rows are present so the guard can never pass vacuously.
 */
const BASIS_FLOOR_CARRY_SRC = FUNDING_SCAN.hedged.find(
  (c) => c.id === BASIS_FLOOR_CARRY_ID,
) as ProjectedCandidate;

/**
 * THE SPOT LEG IS PLAIN ETH, NOT AN LST.
 *
 * The trade is spot ETH long against an ETH perp short, harvesting funding.
 * The committed scan carries no plain `eth:ETH` row, only `wsteth:ETH`, and
 * seeding that one made the lane something else: wstETH pays 2.38% of staking
 * yield, so 2.38 of the 2.79 points of gross carry came from STAKING and only
 * 1.16 from funding. A lane sold as a funding carry whose return is 85% staking
 * is teaching the wrong trade, and it also hides the finding that matters.
 *
 * This derives the ETH spot leg off the SAME ETH perp book: same funding, same
 * capacity, same hedge terms, same book depth binding. Only the collateral
 * changes, from a yield-bearing wrapper to the asset itself, so the yield term
 * goes to zero and what is left IS the funding carry.
 *
 * The arithmetic is the class A identity from the quant ledger, at this row's
 * own L = 1 and zero borrow, so nothing here is a second model:
 *
 *   netCarry = collateralYieldApy + fundingP25Apr − EXEC_DRAG_APR
 *            = 0 + 0.011613132 − 0.0075   = 0.004113132
 *   netApy   = F_B × netCarry
 *            = 0.6741573 × 0.004113132    = 0.00277287
 *
 * `F_B` is read off the source row rather than retyped: it is that row's own
 * `netApy / netCarry`, which is `f_b(3, 0.15)` at the shipped hedge.
 *
 * ⚠ IT PUBLISHES NEAR 0.2% AFTER THE COMPUTE FEE, AND THAT IS THE POINT. A
 * pure ETH basis carry earns almost nothing at today's funding, because
 * funding is administered at 10.95% APR and this book's p25 sits at 1.16%.
 * The USDC lending floor beside it publishes 3.0%. The floor out-earning the
 * carry by an order of magnitude is not an embarrassment to hide, it is the
 * argument for having a router at all.
 */
/**
 * THE ETH PERP BOOKS, MEASURED, ONE ROW PER VENUE.
 *
 * The scan reaches Hyperliquid and nothing else, so the ETH carry's capacity
 * read $621,481 and its `capacityBinding` said, accurately, "HL book depth".
 * That is a single-venue artifact quoted as a ceiling. ETH perp open interest
 * across the four venues a basis trade would actually use is about $11.5B.
 *
 * Fetched 2026-09-03, at a mark of $2,504.10 (Hyperliquid `metaAndAssetCtxs`):
 *   Binance      2,295,285 ETH   $5.75B   fapi/v1/openInterest, ETHUSDT
 *   Bybit          793,641 ETH   $1.99B   v5/market/tickers, linear ETHUSDT
 *   Hyperliquid    889,625 ETH   $2.23B   info metaAndAssetCtxs
 *   OKX            634,133 ETH   $1.59B   v5/public/open-interest, ETH-USDT-SWAP
 *
 * ONE FUNDING NUMBER ACROSS ALL FOUR, and the fetch is why. Every venue was
 * printing the administered constant to four decimals at the same instant:
 * Binance, Bybit and OKX at 0.0001 per 8h, Hyperliquid at 0.0000125 per hour,
 * all 10.9500% APR. They are arbitraged to one rate, so quoting a different
 * funding per venue would invent a spread the market does not have. These rows
 * share the ETH book's measured `fundingP25Apr` and differ only in what they
 * can absorb, which is the honest difference between them.
 *
 * Capacity is 5% of measured open interest, the same modelled share
 * `TREASURY_MODEL.maxFundSharePct` and `DN_LP_MODEL.maxPoolSharePct` already
 * use. The denominator is measured; the 5% is modelled and says so.
 */
const ETH_MARK_USD = 2504.1;
const ETH_PERP_OI_SHARE = 0.05;
const ETH_PERP_OI_ETH: readonly { label: string; oiEth: number }[] = [
  { label: "Binance", oiEth: 2_295_285 },
  { label: "Bybit", oiEth: 793_641 },
  { label: "Hyperliquid", oiEth: 889_625 },
  { label: "OKX", oiEth: 634_133 },
];
const ETH_PERP_OI_TOTAL_ETH = ETH_PERP_OI_ETH.reduce((a, v) => a + v.oiEth, 0);

const BASIS_FLOOR_CARRY: ProjectedCandidate = (() => {
  const src = BASIS_FLOOR_CARRY_SRC;
  const e = src.economics!;
  return {
    ...src,
    economics: {
      ...e,
      /* THE CARRY IS NOT ONE BOOK DEEP. The scan reaches Hyperliquid alone, so
         this row arrived carrying $621,481 and a `capacityBinding` reading "HL
         book depth" — accurate about the scanner and wrong about the trade. A
         basis carry shorts ETH wherever the book is, and the four venues it
         would actually use hold about $11.5B of ETH perp open interest between
         them (fetched 2026-09-03, mark $2,504.10: Binance 2,295,285 ETH,
         Bybit 793,641, Hyperliquid 889,625, OKX 634,133). Capacity is 5% of
         that measured total, the same modelled share
         `TREASURY_MODEL.maxFundSharePct` and `DN_LP_MODEL.maxPoolSharePct`
         already use: the denominator is measured, the 5% is modelled. */
      capacityUsd: Math.round(ETH_PERP_OI_TOTAL_ETH * ETH_MARK_USD * ETH_PERP_OI_SHARE),
      capacityBinding: "ETH perp open interest across Binance, Bybit, Hyperliquid and OKX",
    },
  } as ProjectedCandidate;
})();


/**
 * EVERY HAND-AUTHORED ROW THE PICKER OFFERS.
 *
 * Declared here rather than beside the family models because the ETH carry
 * rows derive from the funding scan, which is projected further down this
 * file. Only functions read this binding, so the later declaration is inert:
 * `handAuthoredTerms` and `modeledRows` both resolve it at call time.
 */
export const TEMPLATE_CANDIDATES: readonly ProjectedCandidate[] = [
  DN_LP_CANDIDATE,
  COLLAR_CANDIDATE,
  ...TREASURY_CANDIDATES,
];

const BASIS_FLOOR_TREASURY = TREASURY_CANDIDATES.find(
  (c) => c.venue === BASIS_FLOOR_TREASURY_VENUE,
) as ProjectedCandidate;


/**
 * The exit dials the treasury lane opens on, DERIVED from the issuer's own
 * published routes rather than typed.
 *
 * Both fields have exactly one right value once the issuer is picked, and
 * both owners are in this file: `fastestExitRoute` decides which door, and
 * `settlementDaysOf` decides the window that door publishes. Seeding them
 * matters because the seed places modules with no `ParamContext`, so without
 * this the lane would open on the structural default `issuer-wire` (1
 * business day at this issuer) beside a pinned window of 0 — one lane stating
 * two different exits.
 */
const BASIS_FLOOR_EXIT_DIALS: ReadonlyArray<readonly [string, string]> = (() => {
  const terms = issuerRedemptionTerms(BASIS_FLOOR_TREASURY?.id);
  if (!terms) return [];
  return [
    ["exitPath", fastestExitRoute(terms).id],
    ["settlementDays", String(settlementDaysOf(terms))],
  ];
})();

export const CANVAS_TEMPLATES: Record<TemplateId, CanvasTemplate> = {
  "leveraged-loop": {
    id: "leveraged-loop",
    name: "Leveraged loop",
    header: "Leveraged loop · template",
    strategy: "loop",
    canvas: "loop",
    seed: { kind: "catalog-pick", prefer: { pair: "wstETH/WETH", venue: "morpho-blue-base" } },
  },
  "funding-carry": {
    id: "funding-carry",
    name: "Funding-rate carry",
    header: "Funding-rate carry · template",
    strategy: "funding",
    canvas: "funding",
    seed: { kind: "funding-demo" },
  },
  "dn-lp": {
    id: "dn-lp",
    name: "Delta-neutral LP",
    header: "Delta-neutral LP · template",
    strategy: "dnlp",
    canvas: "loop",
    seed: {
      kind: "mock-candidate",
      candidate: DN_LP_CANDIDATE,
      modules: ["auto-center", "hedge", "auto-compound"],
      laneLabel: "Delta-neutral LP",
      // The exact composition DN_LP_CANDIDATE was priced at. Both equal the
      // descriptor defaults today; pinned anyway, because a default that
      // moves must not silently re-point the advertised number at a
      // different position.
      params: {
        "auto-center": [
          ["rangePct", String(DN_LP_DEFAULT_DIALS.rangePct * 100)],
          ["recenterTriggerPct", String(DN_LP_DEFAULT_DIALS.recenterTriggerPct * 100)],
        ],
      },
    },
  },
  "treasury-collar": {
    id: "treasury-collar",
    name: "Treasury collar",
    header: "Treasury collar · template",
    strategy: "collar",
    canvas: "loop",
    seed: {
      kind: "mock-candidate",
      candidate: COLLAR_CANDIDATE,
      modules: ["covered-call", "protective-put", "auto-compound"],
      laneLabel: "Treasury collar",
      // The template writes its calls at +10%, not the descriptor's +15%.
      // At the modeled IV a +15% call does not cover a -12% put plus the
      // roll, so the +15/-12 collar the seed used to install had NEGATIVE
      // income while the card advertised +4.8%. +10/-12 is the combination
      // that is actually self-funding, and it is what the row is priced at.
      params: {
        "covered-call": [
          ["strikePct", COLLAR_DEFAULT_DIALS.strikePct],
          ["rollDays", COLLAR_DEFAULT_DIALS.rollDays],
        ],
        "protective-put": [["floorPct", COLLAR_DEFAULT_DIALS.floorPct]],
      },
    },
  },
  "basis-floor": {
    id: "basis-floor",
    name: "ETH basis carry with a USDC lending floor",
    header: "ETH basis carry with a USDC lending floor · template",
    /* The lane the deep link opens on is the carry, and a single-lane publish
       of it is a funding vault. See `CanvasTemplate.strategy`. */
    strategy: "funding",
    canvas: "loop",
    seed: {
      kind: "mock-candidate",
      /* LANE 1 — THE CARRY. `lt` is null on every funding row, so there is no
         borrow leg to lever and the leverage module does not belong on it
         (the module ruling, which `buildTemplatePortfolio`'s catalog-pick
         branch applies with `removeModule`). `{liquidity-source, hedge}` is what
         `FAMILY_REQUIRED_GROUPS.loop` already calls a complete lane: the
         funding carry. No `params`: the row is a SCAN row, priced by the
         quote at the composition on the rack, so there is no family model
         here whose dials the seed would have to reproduce. */
      candidate: BASIS_FLOOR_CARRY,
      modules: ["hedge", "auto-compound"],
      laneLabel: "Basis carry",
      docPin: FUNDING_SCAN.contentHash,
      peers: [
        {
          /* LANE 2 — THE FLOOR. USDC lending, on the unlevered family chain. */
          candidate: BASIS_FLOOR_TREASURY,
          modules: ["redemption-route"],
          laneLabel: "USDC lending",
          params: { "redemption-route": BASIS_FLOOR_EXIT_DIALS },
        },
      ],
    },
  },
};

/** Unknown ids fall back to null → the normal empty canvas, never an error. */
export function templateById(id: string | null | undefined): CanvasTemplate | null {
  if (!id) return null;
  return (CANVAS_TEMPLATES as Record<string, CanvasTemplate>)[id] ?? null;
}

// ── Loop-canvas seeding ────────────────────────────────────────────────────

export interface BuiltTemplate {
  portfolio: PortfolioGraph;
  /** Every node id added — for the snap animation. */
  nodeIds: string[];
}

function snapshotOf(r: UnifiedRow): ProposalLoopSnapshot {
  return {
    venue: r.venue,
    venueLabel: r.venueLabel,
    pair: r.pair,
    cls: r.cls,
    hlCoin: r.hlCoin,
    lt: r.lt,
    loopLeverage: r.economics?.loopLeverage ?? null,
    contentHash: r.contentHash,
    launchable: r.launchable,
    stale: r.stale,
    snapshot: r.snapshot,
  };
}

/** The APY the class-aware default composition actually models. Hedged-class
 *  rows install the hedge by default (2026-08-21 ruling: the advertised
 *  number and the default composition describe the same machine), so their
 *  as-composed number IS the headline. */
function composedDefaultApy(r: UnifiedRow): number {
  return typeof r.headlineApr === "number" ? r.headlineApr : -Infinity;
}

/**
 * THE COMPOSITION A CATALOG-PICK TEMPLATE SEEDS, computed once.
 *
 * `buildPortfolioFromProposal` is called below with `hedge: true, compound:
 * true`, and `proposalLoopComposition` is the owner of what those two booleans
 * install — the same owner the copilot's compile body reads. Pricing the seat
 * test at anything else would test a lane the seed does not build.
 */
const SEED_COMPOSITION: LaneComposition = proposalLoopComposition({ hedge: true, compound: true });

/** The preset a template seeds at. `buildPortfolioFromProposal` writes no
 *  `riskPreset`, so the node keeps the descriptor's default, and every other
 *  reader of a template lane resolves it to this. */
const SEED_PRESET = "standard" as const;

/**
 * THE FRAME A TEMPLATE IS ABOUT TO SEAT, and whether the product can publish
 * it (W1-B6, 2026-08-24).
 *
 * ── WHAT WAS WRONG ────────────────────────────────────────────────────────
 * The seed picked on `r.launchable` — a property of the SCAN ROW at the scan's
 * own ceiling L0 — and then seated the lane at `landingLeverage`, which is
 * `0.8 × max` and a different position entirely. Two consequences, both of
 * which put a dead primary action behind a public URL:
 *
 *  · `acceptsDeposits` was never asked at all. It is the review gate's own
 *    clause ("one market is not accepting deposits") and it reads the
 *    REPRICED candidate, whose capacity is re-divided at the seated leverage.
 *
 *  · `netApy <= 0` was never asked either. On the committed catalog
 *    `sWBERA/WBERA` models −10.1% at its landing and +8.9% unlevered, so the
 *    seeded lane was refused by the gate the instant it rendered.
 *
 * ── WHAT IT IS NOW ────────────────────────────────────────────────────────
 * The two clauses the gate will apply, applied first, on the exact object the
 * gate will read: `repriceAtLeverage(row, seatL, SEED_COMPOSITION)`. A row
 * that fails is not seeded, and the ranking falls through to the next one.
 *
 * `leverage` is the number the seed WRITES, and it is derived through the same
 * owners the canvas uses:
 *  · no leverage module on this market (the module ruling) ⇒ the lane is the
 *    unlevered machine and `pricingParamsFor` prices it at the product floor;
 *  · otherwise `landingLeverage` under the breakeven ceiling (R4), so the seed
 *    can never write a leverage the review gate then refuses.
 */
interface TemplateSeat {
  leverage: number;
  candidate: ProjectedCandidate;
  netApy: number | null;
}

export function templateSeat(r: UnifiedRow): TemplateSeat {
  const lt = typeof r.lt === "number" && Number.isFinite(r.lt) ? r.lt : null;
  const hasHedge = r.cls === "A";
  const leverage =
    lt === null || !leverageModuleInstalls(r)
      ? PRODUCT_MIN_LEVERAGE
      : landingLeverage(
          lt,
          SEED_PRESET,
          r.economics?.loopLeverage ?? null,
          breakevenStopFor(r, hasHedge, SEED_COMPOSITION),
        );
  const candidate = repriceAtLeverage(r, leverage, SEED_COMPOSITION);
  return { leverage, candidate, netApy: composedNetApy(candidate, hasHedge, SEED_COMPOSITION) };
}

/** The two review-gate clauses a seeded lane must already satisfy. Both read
 *  the seated frame, never the scan row. */
export function seatIsPublishable(seat: TemplateSeat): boolean {
  return acceptsDeposits(seat.candidate) && typeof seat.netApy === "number" && seat.netApy > 0;
}

/**
 * Deterministic best looping candidate: the row with the best as-composed APY
 * whose SEATED frame the product can publish; freshness breaks ties.
 *
 * The filter is the seat test rather than `r.launchable` (W1-B6). `launchable`
 * describes the scan's own gates at L0 and is orthogonal to both clauses the
 * review gate applies — on the committed catalog it admits rows with zero
 * capacity and excludes rows that publish cleanly at 1.00x.
 */
function pickBestLoopRow(rows: UnifiedRow[]): UnifiedRow | null {
  /* ⚠ A LOOP TEMPLATE MAY NOT FALL THROUGH INTO A DIFFERENT PRODUCT
     (S2 Wave 2 seam, 2026-08-24 — C2 saw it once and could not explain it).
     ------------------------------------------------------------------------
     C2 reported that `?template=leveraged-loop` opened a review sheet reading
     `Funding-rate carry / Hyperliquid · funding / kHYPE`, and guessed a
     stashed draft. It is not a stash: the restore effect returns early on any
     `template` deep link and never loads the stored draft. It is THIS ranking.

     `buildUnifiedList().hedged` holds every hedged-class row in the catalog,
     and the perp funding books are hedged-class rows. So whenever the
     preferred `wstETH/WETH` on `morpho-blue-base` is absent or fails the seat
     test — one degraded venue doc on the cron is enough — the ranking was free
     to hand a LOOP template a FUNDING market, and `laneStrategies` then
     correctly renders the funding canvas and the funding review sheet under a
     URL that priime.finance advertises as `Supply, borrow, repeat.`

     MEASURED on the committed fixtures, with `hyperliquid-funding.json` in the
     catalog (the four loop-venue fixtures alone cannot see this, which is why
     it survived W1-B6's parity suite):
       all six venues            → morpho-blue-base wstETH/WETH   strategy loop
       morpho-blue-base dropped  → morpho-blue-hyperevm kHYPE/WHYPE  strategy loop
       only hyperliquid-funding  → hyperliquid-funding kHYPE      strategy FUNDING

     The third row is the defect. The filter below is `fundingClassCandidateId`
     — the SAME owner `laneStrategies` asks, so the ranking and the strategy
     layer cannot disagree about what a row is — and the consequence of an
     empty result is already ruled: `buildTemplatePortfolio` returns null and
     the canvas cold-starts blank, which is the honest state. A loop template
     that seeds nothing is recoverable in one press; a loop template that
     seeds someone else's product is not even legible as a mistake.

     The preferred branch above needs no such filter: it pins pair AND venue. */
  const loopRows = rows.filter((r) => !fundingClassCandidateId(r.id));
  const usable = loopRows.filter((r) => seatIsPublishable(templateSeat(r)));
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => {
    const d = composedDefaultApy(b) - composedDefaultApy(a);
    if (d !== 0) return d;
    const freshA = !a.stale && !a.snapshot ? 0 : 1;
    const freshB = !b.stale && !b.snapshot ? 0 : 1;
    return freshA - freshB;
  })[0];
}

type SourcedVenue = ProjectedVenue & { source?: string };

/**
 * Build the seeded portfolio for a loop-canvas template. Pure: the RackCanvas
 * effect decides when to apply it. Returns null when a catalog-pick template
 * finds no usable row (the canvas cold-starts honestly).
 */
export function buildTemplatePortfolio(
  t: CanvasTemplate,
  venues: SourcedVenue[],
): BuiltTemplate | null {
  if (t.seed.kind === "catalog-pick") {
    const { hedged } = buildUnifiedList(venues);
    const prefer = t.seed.prefer;
    /* The preferred market wins whenever it is present and the frame the seed
       is about to seat can be published (the mock-quote fallback prices it
       even off a stale doc, so staleness does not disqualify it); otherwise
       the composed-APY ranking decides.

       THE PREFERENCE KEEPS ITS PREFERENCE ONLY IF IT PASSES THE SEATED TEST
       (W1-B6). It used to be gated on `r.launchable`, which asks the scan's
       gates at L0 — a different question from the two the review gate asks of
       the seated lane. A preferred row that has drifted out of capacity, or
       whose landing has drifted below zero, now falls through to the ranking
       instead of arriving on a public URL with a dead primary action. */
    const preferred = hedged.find(
      (r) =>
        r.pair === prefer.pair && r.venue === prefer.venue && seatIsPublishable(templateSeat(r)),
    );
    const pick = preferred ?? pickBestLoopRow(hedged);
    if (!pick) return null;
    const seat = templateSeat(pick);
    // Class-aware default (founder ruling 2026-08-21): hedged-class picks
    // install the hedge so the lane models the advertised catalog number;
    // ejecting it on the canvas reprices honestly.
    const built = buildPortfolioFromProposal({
      proposalId: `template:${t.id}`,
      title: t.name,
      rationale: "Seeded from the template deep link.",
      loops: [
        /* THE LEVERAGE THE SEAT TEST WAS RUN AT, WRITTEN VERBATIM (W1-B6).
           This was `leverage: null`, which let `buildPortfolioFromProposal`
           re-derive the landing through `landingLeverage` with no knowledge of
           the market's economics — so the number the seat test proved
           publishable and the number the graph stored could differ the moment
           the breakeven ceiling bound. `templateSeat` is the one derivation
           and it goes through the same `landingLeverage` owner a catalog pick
           uses, under the R4 ceiling. A template still does not NAME a
           leverage, and it certainly does not name an adjective: the stop it
           used to carry ("balanced") meant a different position on every
           market the template could resolve to. */
        {
          candidateId: pick.id,
          leverage: seat.leverage,
          /* THE MODULE RULING, stated on the way IN since 2026-08-23. The
             replay now honours it itself; the post-hoc `removeModule` below
             is kept as the belt to this brace, and is a no-op on every row. */
          leverageModule: leverageModuleInstalls(pick),
          hedge: true,
          compound: true,
          snapshot: snapshotOf(pick),
        },
      ],
      allocationsBps: [10000],
      notes: [],
    });
    const loopId = built.portfolio.loops[0]?.id;
    const named = loopId ? renameLoop(built.portfolio, loopId, t.name) : built.portfolio;
    /* THE TEMPLATE RE-SEEDS UNDER THE MODULE RULING (P0-D, 2026-08-22).
       -------------------------------------------------------------------
       A template seed is a default under L3 — "the product may not choose a
       setting it would refuse to offer" — and it is the ONE default that
       arrives with a public URL attached, so it is the one that must not
       resolve onto a market where the module it seats contributes nothing.
       `buildPortfolioFromProposal` seats `safety-buffer` unconditionally
       (`copilot/apply.ts`, outside this wave's allowlist — see the handoff in
       the P0-D report), so the ruling is applied to its output rather than to
       its input. Removing the node takes its `targetLeverage` param with it
       and `pricingParamsFor` then answers `PRODUCT_MIN_LEVERAGE` on the loop
       family, which is the unlevered machine the lane actually is.

       ON THE PINNED CATALOG THIS CHANGES NOTHING, AND THAT IS THE POINT. The
       `leveraged-loop` seed prefers wstETH/WETH on Morpho Base, whose slope is
       +0.084pp a notch against the 0.05pp floor, so the module stays and the
       four `?template=` deep links hash exactly as before. The clause bites
       only where the fallback ranking lands the template on a market that
       cannot pay for a borrow leg, which is the case the preference exists to
       avoid and has never been guaranteed to. */
    const portfolio =
      loopId && !leverageModuleInstalls(pick)
        ? removeModule(named, loopId, "safety-buffer")
        : named;
    const dropped = portfolio === named ? null : loopId ? nodeId(loopId, "safety-buffer") : null;
    return {
      portfolio,
      nodeIds: dropped === null ? built.nodeIds : built.nodeIds.filter((id) => id !== dropped),
    };
  }

  if (t.seed.kind === "mock-candidate") {
    /* ONE LOOP OVER THE SEED'S LANES (H-1). The first lane is the seed's own
       top-level fields, so a template with no `peers` runs this body exactly
       once and writes exactly what the single-lane branch wrote: same lane id
       (`loop_1` is both `loops[0]` and the last loop when there is one),
       same field order, same module order, same node ids. That is what keeps
       the three recorded template hashes untouched by a fifth id arriving.

       The two-lane case gets its orchestrator for free: `addLoop` runs
       `withOrchestratorRule`, which enables the router at two lanes and
       normalizes the allocation. This seeder states no allocation of its own,
       so it cannot disagree with the one owner of that rule. */
    const lanes: readonly MockLane[] = [t.seed, ...(t.seed.peers ?? [])];
    /* A lane whose row could not be resolved cold-starts the canvas, the same
       honest answer a catalog-pick template gives an empty catalog. It can
       only fire on a repo defect (a committed fixture that lost its row, an
       issuer removed from the six), never on a runtime state, and the
       regression harness asserts both rows resolve so this is not a way for
       the fifth template to pass by seeding nothing. */
    if (lanes.some((l) => !l.candidate)) return null;
    /* AND A LANE PINNED TO A SCAN ROW MUST BE IN THE CATALOG IT IS SEEDED
       AGAINST, or the template lands on a canvas that cannot price it.
       -------------------------------------------------------------------
       Every mock-candidate seed before `basis-floor` pinned a TEMPLATE venue,
       whose rows `templateCatalogHit` resolves out of `modeledRows()` no
       matter what the scan served, so the live catalog never mattered here.
       `basis-floor`'s carry lane pins a REAL funding row by its scan id, and
       the canvas resolves that id through `catalogRow` against the live
       payload. On a catalog with no funding venue — a single-venue outage,
       and the empty payload the cold start hands it — the row is absent, the
       lane prices null and the review key reads "waiting on a live quote for
       every lane": a public `?template=` URL with a dead primary action,
       which is the third state `template-seed-gating-parity.test.ts` exists
       to refuse.

       The answer is the one the catalog-pick branch already gives and the one
       stated ten lines up: seed nothing and cold-start the canvas honestly. A
       template that seeds nothing is recoverable in one press; a template
       that seeds a lane the canvas cannot quote is not even legible as a
       mistake. */
    const scanLanes = lanes.filter((l) => !isTemplateVenue(l.candidate.venue));
    if (scanLanes.length > 0) {
      const live = buildUnifiedList(venues);
      const liveById = new Map([...live.hedged, ...live.unhedged].map((r) => [r.id, r] as const));
      /* PRESENT AND PUBLISHABLE AT ITS SEAT, both, and the seat test reads the
         LIVE row rather than the frozen one the seed carries. Presence alone
         is not enough: on a document whose capacities have all gone to zero
         the row is still in the list, `acceptsDeposits` is false, and the gate
         is dark for the second of its two clauses instead of the first. This
         is the same pair of clauses the catalog-pick branch applies to its
         preferred row, through the same owner, so a scan-pinned mock lane and
         a catalog pick cannot disagree about what "publishable" means. */
      for (const l of scanLanes) {
        const row = liveById.get(l.candidate.id);
        if (!row || !seatIsPublishable(templateSeat(row))) return null;
      }
    }
    let g = emptyPortfolio();
    const nodeIds: string[] = [];
    for (const { candidate, modules, laneLabel, params, docPin } of lanes) {
      g = addLoop(g);
      const loopId = g.loops[g.loops.length - 1].id;
      g = renameLoop(g, loopId, laneLabel);
      g = addModule(g, loopId, "liquidity-source");
      const fields: [string, string][] = [
        ["venue", candidate.venue],
        ["candidateId", candidate.id],
        ["pairLabel", candidate.pair],
        ["contentHash", docPin ?? "template"],
        ["cls", candidate.cls],
        ["hlCoin", candidate.hlCoin ?? ""],
      ];
      for (const [f, v] of fields) g = updateParam(g, loopId, "liquidity-source", f, v);
      for (const k of modules) g = addModule(g, loopId, k);
      // Pin the composition the candidate row was priced at, after the modules
      // exist. The row and the canvas must describe one position (E1).
      for (const k of modules) {
        for (const [f, v] of params?.[k] ?? []) g = updateParam(g, loopId, k, f, v);
      }
      nodeIds.push(
        ...(["liquidity-source", ...modules] as ModuleKey[]).map((k) => nodeId(loopId, k)),
      );
    }
    return { portfolio: g, nodeIds };
  }

  return null; // funding-demo seeds route to the funding canvas, not here
}
