/**
 * Vault store (mockup register) — the client-side source of truth for the
 * end-to-end Build → Publish → Directory → Deposit → Portfolio flow.
 *
 * Everything persists in localStorage; every performance number rendered
 * from here is labeled "modeled" in the UI. Deterministic drift: share
 * values grow from inception at the vault's modeled APY plus a small
 * per-day wobble seeded from the slug, so numbers feel alive without ever
 * being random between renders.
 *
 * READER DOCTRINE (recette build item 10, 2026-08-22)
 * ---------------------------------------------------
 * This module READS the published record. It does not re-invent it.
 *
 * Every parameter the canvas rendered is carried on VaultRecord as an
 * optional field (see "published model record" below). A reader here takes
 * the published value when it is present, and only falls through to a
 * derivation when the field is ABSENT — which happens exactly once, for
 * records written to localStorage before the publish wave landed.
 *
 * Three rules follow from that, and they are the whole point:
 *   1. `guessLiqLtv` is a BACKFILL. It is a regex on a pair string and it is
 *      wrong on kHYPE/WHYPE by 8.5 points of LTV (0.945 guessed vs 0.86
 *      real), which is 10 points of distance-to-liquidation in the
 *      depositor's favour. Never call it when `record.liqLtv` exists.
 *   2. `deriveLeverageZones` is a pure FORMATTER. It converts published
 *      health-factor bands (bps) into the decimal shape the instrument
 *      draws. It invents no threshold. When the record carries no bands the
 *      caller supplies the canvas's OWN derivation (`deriveHfBands`), never
 *      a second geometry.
 *   3. A value that is published as `null` means "the model declines to
 *      state this" (e.g. a multi-lane vault whose lanes carry different
 *      leverage). `null` is not `undefined`: null renders NOTHING, undefined
 *      falls back. Readers here distinguish the two.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/prefer-regexp-exec, eqeqeq --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { fmtCapacityUsd } from "@/lib/canvas/capacity";
import { applyComputeFee, HOUSE_FEES } from "@/lib/canvas/fees";
import { MINUS, pct, ppMag } from "@/lib/canvas/format";
// `LaneComposition` itself arrives via the register section's type import
// further down; only the value imports live here.
import { CATALOG_COMPOSITION, compoundDelta, execDragApr, fB, fbForComposition } from "@/lib/canvas/mock-quote";
import { deriveHfBands, HF_TARGET_CAP_BPS, hfTargetBpsFor } from "@/lib/canvas/param-schema";
import { adverseMoveLine, liquidationDistance, liquidationDistanceAtHf } from "@/lib/canvas/liquidation";
import { MODULE_DEFS, defaultValueFor } from "@/lib/canvas/modules";
import { EXEC_DRAG_APR } from "@/lib/model-constants";
import { DEMO_SCOPE } from "@/lib/demo-scope";
/* THE ROUTER'S NUMBERS HAVE ONE OWNER EACH (plan seam 4). The bar, the
   hysteresis, the founder's window and the move weight are imported here and
   retyped nowhere: `deriveAutomations` uses them only as the backfill for a
   record that predates the field, exactly as `deriveHfBands` backfills the
   health envelope. */
import {
  DEMO_ROUTER_MOVE_WEIGHT,
  DEMO_SUSTAIN_HOURS,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";
import { ORCH_DIAL_DEFAULTS } from "@/lib/canvas/param-schema";
import { VAULTS_EVENT } from "./events";
import { heroNavUsd } from "./rows";

/**
 * `treasury` is FORCED by the graph, not chosen here: `laneStrategies` pushes
 * every non-loop `LaneFamily` straight into a `StrategyKind[]`, so a fourth
 * family is a fifth strategy by construction. It is the treasury floor lane
 * (an issuer position plus a redemption route), and it is the first strategy
 * whose eligibility is uncorrelated with the funding trigger the router
 * reacts to.
 */
export type StrategyKind = "loop" | "funding" | "dnlp" | "collar" | "treasury";

/**
 * LIFECYCLE STAGE (R2, 2026-08-24) — the venue's own thesis, made true.
 *
 * "Compose, test, incubate and scale" is advertised in 30+ places across the
 * docs and the deck, and two of those four stages existed nowhere in the
 * product. This is the missing one, and it is deliberately a SEPARATE field
 * from `register`, never a third value in that union: every
 * `register === "published"` check in the codebase keeps its exact meaning,
 * and a reader that has never heard of a stage behaves as it did before.
 *
 *   incubating — published from the canvas. No capital, no armed automation.
 *   live       — a Priime-authored sample the venue stands behind.
 *   attested   — the one record whose NAV, share value and strikes are read
 *                off a captured operator journal (this build's live vault,
 *                `DEMO_SCOPE.liveSlug`). Its APY is still modeled.
 *
 * `modeled` is orthogonal and still true of all three: no APY here is realized.
 */
export type VaultStage = "incubating" | "live" | "attested";

export interface VaultRecord {
  slug: string;
  name: string;
  strategy: StrategyKind;
  /** "Leveraged loop" | "Funding-rate carry" | "Delta-neutral LP" | "Treasury collar" */
  strategyLabel: string;
  /** One-line description shown on the vault page. */
  summary: string;
  venue: string;
  market: string;
  /** Composed module names, in spine order. */
  modules: string[];
  /** One line per module for the vault page. */
  moduleLines: { name: string; line: string }[];
  /** The parameters that matter, label/value pairs. */
  params: { label: string; value: string }[];
  /** Modeled net APY as a fraction (0.124 = 12.4%). */
  modeledApy: number;
  /** Composed deposit capacity, FROZEN at publish exactly as modeledApy is:
   *  re-deriving it later from a drifted catalog would disagree with what
   *  the user was shown. Absent on records published before it existed. */
  capacityUsd?: number | null;
  capacityBindingLabel?: string | null;
  baseTvlUsd: number;
  baseDepositors: number;
  curator: string;
  /** ISO date of inception. */
  createdAt: string;
  /** True for vaults the user published from the canvas. */
  mine?: boolean;
  /**
   * Provenance. `sample` = a Priime-authored demo vault whose numbers are
   * recomputed from the live catalog by seeds.ts at module load, so the
   * directory can never show a seed contradicting the market it names
   * (H5). `published` = written by a user from the canvas. Absent on
   * records written before the register existed; treat those as published.
   */
  register?: "sample" | "published";
  /**
   * Where the vault sits in the advertised lifecycle. Written at publish
   * time (`publishVault` always writes `incubating`); absent on samples and
   * on every record written before the stage existed, which is why nothing
   * reads this field raw — `vaultStage()` is the one resolver.
   */
  stage?: VaultStage;
  /**
   * Automation instrument parameters, fixed at publish time (seeds carry
   * them in seeds.ts). Older localStorage records may lack this field:
   * loadUserVaults backfills via deriveAutomations, never crashes.
   */
  automations?: VaultAutomations;
  /**
   * PRICING-MODEL VERSION (frozen-record migration, 2026-09-01). Stamped by
   * `publishVault` at `RECORD_MODEL_VERSION`; absent means the record was
   * written before the exec-drag single-owner fix (QNT-2) and is repriced
   * once, on load, by `repriceFrozenRecord`. Nothing else reads it.
   */
  modelVersion?: number;

  // ── published model record ───────────────────────────────────────────────
  //
  // Written by the canvas at publish time (`publishDraft`). EVERY field is
  // optional because records written before that wave landed carry none of
  // them; every reader below therefore handles three states:
  //   value   → use it, it is what the user saw on the canvas
  //   null    → the model declines to state it; render nothing
  //   absent  → pre-record vault; fall through to the backfill path
  // Do not "helpfully" default any of these to a number at the write site.

  /** Liquidation threshold of the loop market, as a fraction (0.86, 0.945).
   *  The public chain parameter the scan read — never a guess. */
  liqLtv?: number | null;
  /** The leverage the model actually applied after the house clamp — NOT
   *  the requested dial value. Null on a multi-lane vault whose lanes carry
   *  different leverage: the envelope is then unrenderable, not averaged. */
  appliedLeverage?: number | null;
  /** Health-factor bands in bps, exactly as `deriveHfBands` produced them
   *  on the canvas. 12500 = 1.25x. */
  hfTargetBps?: number | null;
  hfDeleverageBps?: number | null;
  hfFloorBps?: number | null;
  /** Leverage on the perp short leg. */
  hedgeLeverage?: number | null;
  /** Idle margin held aside, as a fraction of short notional (0.1 = 10%). */
  reserveFraction?: number | null;
  /** The perp coin the hedge shorts ("ETH", "HYPE"). */
  hlCoin?: string | null;
  /** Net-delta rebalance band, ± percent of position notional. */
  deltaBandPct?: number | null;
  /** HL margin ratio bands as PERCENT of notional (13 = 13%). */
  marginTrimPct?: number | null;
  marginRestorePct?: number | null;
  /** Funding guard floor as an annualized fraction (0.01 = 1% APR). This is
   *  the entire strategy on a funding vault; it is never restated. */
  fundingFloorApr?: number | null;
  /** Minimum harvest size in USD before the compounder acts. */
  thresholdUsd?: number | null;
  /** Compound check cadence in hours. */
  compoundCadenceHours?: number | null;
  /** Raw capacity binding key ("HL book depth", "debt borrow liquidity"). */
  capacityBinding?: string | null;
  /** Chain + block the catalog row was read at. */
  chainId?: number | null;
  blockNumber?: number | null;
  /**
   * What the collateral asset itself paid at `blockNumber`, as a fraction.
   *
   * PUBLISHED 2026-08-27 (recette, track 1), and the block comment above
   * `registerInputForVault` used to say this was one of three fields the
   * record deliberately withheld. It named the right remedy in the same
   * breath: "the honest fix for those two is a published field, not a cleverer
   * adapter". This is that field.
   *
   * WHY IT HAD TO BE THIS ONE. A lane's asset ISSUER is a party on its route
   * exactly where the held asset pays a yield it does not mint, and
   * `partyPresent` asks that question of this number and nothing else. Absent,
   * the projection answered `NaN`, the issuer left the derived set, and the
   * two classes that live on it — Stablecoin depeg, Basis widening — could not
   * reach a published record at all even once the watcher was carried.
   *
   * It moves NO other entry. The pair spread (`carry`) and the hedge
   * economics both need `borrowApyMarginal` beside it, that one is still not
   * published, and both readers guard with `Number.isFinite` — so a record
   * that states this states one more fact and no new sentence.
   */
  collateralYieldApy?: number | null;

  /**
   * THE WATCHER, AS THE LANE COMMITTED IT (recette 2026-08-27, track 1).
   *
   * `exogenous-risk` is an OVERLAY. It seats no automation, so `automations`
   * cannot carry it, and until this wave nothing a record published could
   * prove it had ever been placed — so `placedKeysOf` answered `false` for it
   * on every record ever written, `registerFor` took the declared-blind branch
   * unconditionally, and a published vault page printed
   *
   *   1 thing this vault does not measure · Oracle, bridge, stablecoin and
   *   RPC health · Not watched by this vault
   *
   * four lines above `Also installed · Exogenous risk`. One record, two
   * answers to one question, both on screen at once.
   *
   * Three fields close it, and each is a fact the canvas actually held:
   *
   *  · `exogenousParams` — the overlay node's own params, verbatim. The MAP
   *    rather than a posture word beside a hold list, because both readers
   *    already validate it: `postureOf` accepts only a member of
   *    `POSTURE_STOPS` and otherwise returns the descriptor's default, and
   *    `holdsOf` reads `=== true` on the six closed hold fields and nothing
   *    else. No stored value can be invalid, and a hold on a party this
   *    record's route does not have is INERT rather than stale — the same
   *    property the module's own schema was designed around.
   *  · `failedGates` / `gatesTotal` — what the scan read at `blockNumber`,
   *    frozen exactly as `modeledApy` and `capacityUsd` are frozen at publish.
   *    Without them `dependenciesOf` sees `gatesTotal: 0`, rules the row never
   *    scanned, and hands back every party at `blind`: a lane that published
   *    four MEASURED parties would keep its rows and lose their evidence,
   *    which is the same silent downgrade wearing a quieter costume.
   *
   * Absent on every record written before this wave and on every record whose
   * builder never pressed the key. Nothing defaults them to a value.
   */
  exogenousParams?: Record<string, ParamValue> | null;
  failedGates?: string[] | null;
  gatesTotal?: number | null;

  /**
   * THE ROUTED RECORD (plan R5, seam 1). Declared here by WP-3, written by
   * the canvas at publish, read by the Capital router instrument.
   *
   * Both fields are OPTIONAL and absent on every record written before the
   * router existed, which is every record in the product today. A reader
   * therefore handles three states exactly as it does for the published
   * model above: a value states what the user saw, `null` states that the
   * model declines to state it, and ABSENT means a single-lane record that
   * must render precisely as it did before this field existed. Nothing
   * defaults either of them at the write site.
   *
   * `lanes` carries one entry per composed lane, in the canvas's own order.
   * A record with fewer than two lanes is not routed, whatever it carries in
   * `router`: `deriveAutomations` seats the instrument only when BOTH are
   * present and `lanes.length >= 2`, so a half-written record renders as the
   * single-lane vault it actually is rather than as a router with one side.
   */
  lanes?: PublishedLane[];
  router?: PublishedRouter | null;
}

/**
 * One lane of a routed vault, exactly as the canvas priced it.
 *
 * `publishedApy` is FROZEN at publish, the same discipline `modeledApy` and
 * `capacityUsd` are held to: re-deriving a lane's rate later from a drifted
 * capture would disagree with the pair the depositor read before publishing.
 * Null on a lane whose composition never priced.
 */
export interface PublishedLane {
  /** The venue slug the canvas priced (`morpho-blue-base`, `treasury-ausdc-base`). */
  venue: string;
  /** The venue in the page's own words (`Morpho Blue · Base`). */
  venueLabel: string;
  /** The market as the depositor reads it (`USDe/USDC`, `USDC reserve`). */
  market: string;
  /** The lane label the canvas gave it (`Leveraged loop`, `USDC lending`). */
  label: string;
  /** The lane's template family, from the same graph the composition was read from. */
  family: StrategyKind;
  /** The lane's published net APY at publish, as a fraction. */
  publishedApy: number | null;
  /** The lane's share of the book at publish, in basis points. 10000 = the whole book. */
  allocationBps: number;
}

/**
 * The capital router, as the canvas published it.
 *
 * Every number here has ONE owner in `lib/canvas/orchestrator/demo-rules.ts`
 * and the canvas reads it from there at publish rather than typing it. The
 * record carries them so the page can render what the depositor was shown
 * even after the owners move, in the same way `automations` carries the
 * health bands rather than re-deriving them; a reader that finds a field
 * absent falls back to the owner's value and never to a literal.
 */
export interface PublishedRouter {
  /** Dial 1: how fast the rules react (`ORCH_DIAL_DEFAULTS.reactivity`). */
  reactivity: string;
  /** Dial 2: the concentration cap, percent of the book on one lane. */
  maxConcentrationPct: number;
  /** Dial 3: the weekly turnover budget, percent of the book. */
  turnoverBudgetPctWeek: number;
  /** The rule in the depositor's words, one sentence, composed at publish. */
  ruleSentence: string;
  /** The improvement a move must clear, as a fraction (`DEMO_UPGRADE_THRESHOLD`). */
  thresholdApy: number;
  /** Hysteresis: the improvement the rule re-arms at (`DEMO_UPGRADE_REARM`). */
  rearmApy: number;
  /** The founder's window in hours (`DEMO_SUSTAIN_HOURS`). Fixed by ruling. */
  sustainHours: number;
  /** What one firing moves, as a fraction of the book (`DEMO_ROUTER_MOVE_WEIGHT`). */
  moveWeight: number;
}

/**
 * What `deriveAutomations` needs: the composition, plus whatever the record
 * managed to publish. Widened deliberately so `publishDraft` can hand its
 * in-flight draft straight in.
 */
export type AutomationSource = Pick<
  VaultRecord,
  "strategy" | "venue" | "market" | "modules" | "params"
> &
  Partial<
    Pick<
      VaultRecord,
      | "lanes"
      | "router"
      | "liqLtv"
      | "appliedLeverage"
      | "hfTargetBps"
      | "hfDeleverageBps"
      | "hfFloorBps"
      | "hedgeLeverage"
      | "reserveFraction"
      | "hlCoin"
      | "deltaBandPct"
      | "marginTrimPct"
      | "marginRestorePct"
      | "fundingFloorApr"
      | "thresholdUsd"
      | "compoundCadenceHours"
    >
  >;

// ── automations schema (vault page v3) ─────────────────────────────────────

/**
 * Dynamic-leverage protection envelope, in health factors (liquidation at
 * 1.00). Every threshold here is CARRIED from the canvas, not re-derived:
 * `emergencyHf`/`deleverHf`/`targetHf` are the published hfFloorBps /
 * hfDeleverageBps / hfTargetBps divided by 10,000, so the vault page and
 * the canvas that published it cannot disagree.
 */
export interface LeverageAutomation {
  /** The APPLIED leverage (post house clamp), the one the model priced. */
  targetLeverage: number;
  /** Liquidation LTV of the loop market, as a fraction. */
  liqLtv: number;
  /**
   * True when `liqLtv` came from `guessLiqLtv`, a regex on the pair string,
   * rather than from the record or a published param. An inferred threshold
   * is wrong by construction and can be wrong in the depositor's favour: on
   * kHYPE/WHYPE the guess returns 0.945 against a real 0.860, which prints a
   * 29% adverse-move cushion where the truth is 20 to 24%. Surfaces must
   * mark this row as inferred and must NOT render a distance-to-liquidation
   * derived from it. A number nobody measured does not get a measured label.
   */
  liqLtvInferred: boolean;
  /** Health factor below which the cascade picks a fast unwind (hfFloorBps). */
  emergencyHf: number;
  /** Below this (and above emergency): sell a slice, repay borrow. */
  deleverHf: number;
  /** Steady-state open / re-lever target (hfTargetBps). */
  targetHf: number;
  /**
   * Upper edge of the no-action band: the mirror of `deleverHf` about
   * `targetHf`. Nothing publishes a lever-up threshold, so this is stated
   * as what it is — a symmetric band edge, derived here in one line — and
   * never dressed up as a tuned parameter.
   */
  leverUpHf: number;
  /** Right edge of the plotted envelope axis. */
  axisMaxHf: number;
  cadence: string;
  cooldown: string;
}

/** Dynamic-hedge instrument: net-delta band plus margin maintenance. */
export interface HedgeAutomation {
  venue: string;
  /** The perp coin actually shorted, when the record published it. */
  coin?: string | null;
  /** Leverage on the short leg, when the record published it. */
  leverage?: number | null;
  /** Idle margin reserve as a fraction of short notional. */
  reserveFraction?: number | null;
  /** Funding guard floor, annualized fraction. Null = no floor published. */
  fundingFloorApr?: number | null;
  /** Net delta band, ± percent of position notional. */
  deltaBandPct: number;
  marginTrimBelowPct: number;
  marginRestorePct: number;
  /** Consecutive negative funding periods before de-allocating the venue. */
  fundingDeallocPeriods: number;
  cadence: string;
}

/** Auto-compound harvest meter parameters. */
export interface CompoundAutomation {
  /** How often the recapture CHECK runs. */
  cadenceHours: number;
  /** Minimum accrued yield before the check acts. */
  thresholdUsd: number;
}

/**
 * The capital router's instrument parameters, seated only on a record that
 * actually carries two lanes AND a router (plan R5).
 *
 * Every figure is the RECORD's where the record states it, and the owner's
 * (`lib/canvas/orchestrator/demo-rules.ts`) where it does not, the same
 * published-then-backfill discipline the leverage envelope follows. Nothing
 * here is a literal: a record published before a field existed reads the
 * constant that produced it, never a number retyped on this line.
 */
export interface RouterAutomation {
  /** The lanes the router routes between, in the record's own order. */
  lanes: readonly PublishedLane[];
  /** The improvement a move must clear, as a fraction. */
  thresholdApy: number;
  /** The improvement the rule re-arms at, as a fraction. */
  rearmApy: number;
  /** The founder's window, in hours. */
  sustainHours: number;
  /** What one firing moves, as a fraction of the book. */
  moveWeight: number;
  /** The concentration cap, percent of the book on one lane. */
  maxConcentrationPct: number;
  /** The weekly turnover budget, percent of the book. Under the switch it is
   *  the bound that still binds: one full move per week, and the second is
   *  refused rather than sized down. */
  turnoverBudgetPctWeek: number;
  /** The rule in the depositor's words, one sentence. */
  ruleSentence: string;
}

export interface VaultAutomations {
  leverage: LeverageAutomation | null;
  hedge: HedgeAutomation | null;
  compound: CompoundAutomation | null;
  /**
   * ABSENT, not null, on every record written before the router existed, so
   * a stored `automations` object from an older publish still satisfies this
   * type and `loadUserVaults` does not have to rewrite it.
   */
  router?: RouterAutomation | null;
}

export interface PositionRecord {
  id: string;
  vaultSlug: string;
  vaultName: string;
  amountUsd: number;
  shareValueAtDeposit: number;
  depositedAt: string; // ISO
}

const LS_VAULTS = "priime:vaults:v1";
const LS_POSITIONS = "priime:positions:v1";
const LS_WITHDRAWALS = "priime:withdrawals:v1";
export { VAULTS_EVENT };

// ── deterministic PRNG ─────────────────────────────────────────────────────

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One deterministic [0,1) draw from a numeric seed. */
export function rand01(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ── persistence ────────────────────────────────────────────────────────────

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Persist and announce. Returns whether the write actually landed.
 *
 * G2: this used to swallow every storage error under `/* private mode *​/`,
 * so a Safari private window or a full quota published a vault that did not
 * exist and then offered "Open your vault" for it. A failed write is a
 * failed publish, and the caller has to be able to say so.
 */
function write<T>(key: string, rows: T[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    return false; // quota exceeded, private mode, storage disabled
  }
  window.dispatchEvent(new Event(VAULTS_EVENT));
  return true;
}

export function loadUserVaults(): VaultRecord[] {
  const stored = read<VaultRecord>(LS_VAULTS);
  // The frozen-record migration runs before every read of the store, and its
  // result is persisted once (best-effort — G2's write contract; a failed
  // write just means the same pure reprice runs again on the next load).
  const migrated = stored.map(repriceFrozenRecord);
  if (migrated.some((v, i) => v !== stored[i])) write(LS_VAULTS, migrated);
  // Backfill: vaults published before the automations schema existed get
  // deterministic defaults derived from their modules, on read, every time.
  return migrated.map((v) => ({
    ...v,
    mine: true,
    automations: v.automations ?? deriveAutomations(v),
  }));
}

// ── frozen-record migration: pricing-model version 2 ───────────────────────

/**
 * Bumped when the pricing model changes in a way that makes an already
 * published record disagree with its own stored dials. Version 2 is the
 * exec-drag single-owner fix (QNT-2, 2026-09-01).
 */
export const RECORD_MODEL_VERSION = 2;

type CompoundDials = LaneComposition["compound"];

/** The record's stored compound dials as a composition member, or null. */
function storedCompoundDials(v: VaultRecord): CompoundDials {
  const cadence = finite(v.compoundCadenceHours);
  const threshold = finite(v.thresholdUsd);
  return cadence !== null && threshold !== null
    ? { cadence: `${cadence}h` as "6h" | "24h" | "72h", minActionUsd: threshold }
    : null;
}

/**
 * Inverse of the publish pipeline's last two steps at fixed compound dials:
 * the after-fee carry whose compounded value is the stored headline.
 * `x + compoundDelta(x, dials)` is a near-identity contraction (the delta is
 * pennies of APY against the carry at every real dial), so the fixed-point
 * iteration converges in a handful of steps; the residual check refuses an
 * answer that did not, and the caller then leaves the record untouched
 * rather than writing a number the algebra cannot stand behind.
 */
function invertCompoundStep(published: number, dials: CompoundDials): number | null {
  let x = published;
  for (let i = 0; i < 120; i++) {
    const next = published - compoundDelta(x, dials);
    if (Math.abs(next - x) < 1e-15) {
      x = next;
      break;
    }
    x = next;
  }
  return Math.abs(x + compoundDelta(x, dials) - published) <= 1e-10 ? x : null;
}

/**
 * ── THE FROZEN-RECORD REPRICE (founder-approved rewrite, 2026-09-01) ──────
 *
 * Records published BEFORE the exec-drag single-owner fix (QNT-2) froze a
 * `modeledApy` priced at the flat 0.0075 calibration drag while stating the
 * DERIVED delta band beside it — the flagship stored `deltaBandPct: 4` and
 * 2.101272% where its own dials recompute to 2.289993%. One frozen object,
 * two owners of one drag. The records-are-never-rewritten rule was lifted by
 * the founder FOR THIS MIGRATION ONLY: each qualifying record's modeled
 * number is recomputed from its OWN stored dials through the current
 * single-owner pricing path, to 6 decimals of the true replay. No dial is
 * touched — only the derived number moves.
 *
 * The algebra is the pipeline's own, run backwards then forwards. The stored
 * headline is `applyComputeFee(core) + compoundDelta(...)` (composedTerms,
 * unchanged by QNT-2), so the venue core is recovered exactly by inverting
 * the compound step and the fee. Only the drag inside that core moved:
 *
 *   loop     core is affine in the drag at the record's own escrow —
 *            `f_b(L_h, r) · (gross + funding − drag)` — so
 *            coreNew = coreOld + f_b · (dragFlat − execDragApr(band)).
 *   funding  a rack basis lane's frozen core is the SCANNER's row, priced at
 *            the catalog composition (`fbForComposition(CATALOG_COMPOSITION)`)
 *            and the flat drag — verified exact to the bit on the committed
 *            scan. The carry is recovered in that frame and re-denominated at
 *            the record's own dials, which is precisely what QNT-2's
 *            class-A-at-L0=1 recompute does with the row in hand.
 *
 * WHAT QUALIFIES: a record storing the three hedge facts the algebra needs
 * (`deltaBandPct`, `hedgeLeverage`, `reserveFraction`) — exactly the records
 * `publishedModelRecord` wrote, i.e. single-lane rack publishes. Everything
 * else is stamped and left as published, each for a stated reason:
 *   · dnlp / collar — hand-authored models; no canvas drag ever entered
 *     their number, so there is no drift to repair.
 *   · funding-canvas records — no band is stored, and the recompute needs
 *     the market's funding distribution, which no client holds. Leaving the
 *     number as published is honest; half-migrating it would not be.
 *   · multi-lane records — `publishedModelRecord` declines the band across
 *     lanes (`agreed`), so there is no per-record algebra to run.
 *
 * VERSION COUPLING: version 2 ships in the same deploy as QNT-2 itself, so
 * an unstamped record was necessarily priced at the flat drag; every publish
 * from here on is stamped at `RECORD_MODEL_VERSION` and never repriced.
 */
export function repriceFrozenRecord(v: VaultRecord): VaultRecord {
  if ((v.modelVersion ?? 1) >= RECORD_MODEL_VERSION) return v;
  const stamped: VaultRecord = { ...v, modelVersion: RECORD_MODEL_VERSION };
  const band = finite(v.deltaBandPct);
  const hedgeLeverage = finite(v.hedgeLeverage);
  const reserve = finite(v.reserveFraction);
  const apy = finite(v.modeledApy);
  if (band === null || band <= 0 || hedgeLeverage === null || reserve === null || apy === null) {
    return stamped;
  }
  if (v.strategy !== "loop" && v.strategy !== "funding") return stamped;
  // The flat charge the pre-fix resolver fell to when the retired dial was
  // absent — a fact about the past, so the constant, not today's resolver.
  const dragOld = EXEC_DRAG_APR;
  const dragNew = execDragApr(band);
  if (Math.abs(dragNew - dragOld) < 1e-15) return stamped;
  const dials = storedCompoundDials(v);
  const afterFeeOld = invertCompoundStep(apy, dials);
  if (afterFeeOld === null) return stamped;
  const coreOld = afterFeeOld > 0 ? afterFeeOld / (1 - HOUSE_FEES.computeOnYield) : afterFeeOld;
  const fbLane = fB(hedgeLeverage, reserve);
  const coreNew =
    v.strategy === "loop"
      ? coreOld + fbLane * (dragOld - dragNew)
      : fbLane * (coreOld / fbForComposition(CATALOG_COMPOSITION) + dragOld - dragNew);
  const afterFeeNew = applyComputeFee(coreNew);
  return { ...stamped, modeledApy: afterFeeNew + compoundDelta(afterFeeNew, dials) };
}

/** Persist a user vault. False = the write did not land; nothing was saved. */
export function saveUserVault(v: VaultRecord): boolean {
  const rows = read<VaultRecord>(LS_VAULTS);
  return write(LS_VAULTS, [{ ...v, mine: true }, ...rows.filter((r) => r.slug !== v.slug)]);
}

export function loadPositions(): PositionRecord[] {
  return read<PositionRecord>(LS_POSITIONS);
}

/** Record a deposit. Null = the write failed and there is no position (G2). */
export function addPosition(p: Omit<PositionRecord, "id">): PositionRecord | null {
  const rows = read<PositionRecord>(LS_POSITIONS);
  const rec: PositionRecord = { ...p, id: `pos_${Date.now()}_${rows.length + 1}` };
  return write(LS_POSITIONS, [rec, ...rows]) ? rec : null;
}

/** A withdrawal the reader made, for the activity table. */
export interface WithdrawalRecord {
  id: string;
  vaultSlug: string;
  vaultName: string;
  amountUsd: number;
  withdrawnAt: string; // ISO
}

export function loadWithdrawals(): WithdrawalRecord[] {
  return read<WithdrawalRecord>(LS_WITHDRAWALS);
}

/**
 * Redeem part or all of the reader's position in a vault.
 *
 * Reduces the reader's positions in that vault FIFO (oldest deposit first) by
 * `amountUsd / shareValueAtDeposit` shares per record, which is a reduction
 * of `amountUsd` at the deposit's own cost basis; a record drained to nothing
 * is deleted. Writes the positions, logs the withdrawal for the activity
 * table, dispatches `VAULTS_EVENT` (inside `write`), and returns the
 * remaining positions. Null = the write did not land (G2) or the amount is
 * not a positive number: nothing changed, and the caller must say so.
 */
export function withdrawPosition(vaultSlug: string, amountUsd: number): PositionRecord[] | null {
  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  const rows = read<PositionRecord>(LS_POSITIONS);
  let remaining = amountUsd;
  let vaultName = "";
  const kept: PositionRecord[] = [];
  // Stored newest-first; FIFO walks from the end.
  for (let i = rows.length - 1; i >= 0; i--) {
    const p = rows[i];
    if (p.vaultSlug !== vaultSlug || remaining <= 0) {
      kept.unshift(p);
      continue;
    }
    vaultName = p.vaultName;
    const take = Math.min(p.amountUsd, remaining);
    remaining -= take;
    const left = p.amountUsd - take;
    // Sub-cent residue is a rounding artefact, not a position.
    if (left >= 0.01) kept.unshift({ ...p, amountUsd: left });
  }
  const redeemed = amountUsd - Math.max(0, remaining);
  if (redeemed <= 0) return null;
  if (!write(LS_POSITIONS, kept)) return null;
  const log = read<WithdrawalRecord>(LS_WITHDRAWALS);
  write(LS_WITHDRAWALS, [
    {
      id: `wd_${Date.now()}_${log.length + 1}`,
      vaultSlug,
      vaultName,
      amountUsd: redeemed,
      withdrawnAt: new Date().toISOString(),
    },
    ...log,
  ]);
  return kept;
}

// ── slugs ──────────────────────────────────────────────────────────────────

export function slugify(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "vault";
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

// ── deterministic share-value model ────────────────────────────────────────

const DAY_MS = 86400e3;

function dayIndex(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/**
 * SIMPLE ACCRUAL, deliberately (A16).
 *
 * `modeledApy` is not an APY. Every model behind it — `netApyOnDepositApy`
 * in the catalog, `netApr` on the funding canvas — is a linear annualized
 * RATE on deposit, and the auto-compound instrument is what would turn it
 * into a compounded return. Running `(1 + rate)^(t/365)` over it compounds
 * a number that was never compounded upstream, which quietly overstates a
 * 10% vault by ~50 bps over a year and does it on a vault that may not even
 * have a compounder installed.
 *
 * So: value = 1 + rate × t/365. If the product later wants compounding, it
 * comes from `CompoundAutomation.cadenceHours` and it gets stated on the
 * surface, not smuggled in through Math.pow.
 */
function accrue(rate: number, days: number): number {
  // A record whose APY never priced (or predates the field) still VALUES:
  // no modeled rate means no modeled drift, so the share value holds 1.0000
  // instead of pushing NaN through every card, spark and portfolio total
  // (recette DL-3: a broken record must never render `NaN` as a figure).
  return 1 + (Number.isFinite(rate) ? rate : 0) * (days / 365);
}

/** Share value of a vault on a given day index (1.0 at inception). */
export function shareValueOnDay(v: VaultRecord, dayIdx: number): number {
  const created = dayIndex(Date.parse(v.createdAt));
  const t = Math.max(0, dayIdx - created);
  if (t === 0) return 1;
  const base = accrue(v.modeledApy, t);
  const wobble = (rand01(hashString(v.slug) * 31 + dayIdx) - 0.5) * 0.004; // ±0.2%
  return base * (1 + wobble);
}

/**
 * Continuous share value at a timestamp: the day model plus the intraday
 * fraction of the daily rate, so P&L visibly drifts within a session.
 * Wobble stays day-seeded (deterministic between renders); inception day
 * carries pure drift with no wobble so day-zero P&L never dips negative.
 */
export function shareValueAt(v: VaultRecord, ms: number): number {
  const created = dayIndex(Date.parse(v.createdAt));
  const dayIdx = dayIndex(ms);
  const days = Math.max(0, dayIdx - created);
  const frac = (ms - dayIdx * DAY_MS) / DAY_MS;
  const base = accrue(v.modeledApy, days + frac); // simple accrual — see accrue()
  const wobble = days === 0 ? 0 : (rand01(hashString(v.slug) * 31 + dayIdx) - 0.5) * 0.004;
  return base * (1 + wobble);
}

export function currentShareValue(v: VaultRecord): number {
  return shareValueAt(v, Date.now());
}

/**
 * Deterministic share-value series for the sparkline (oldest → newest).
 * The series starts at inception — a day-zero vault renders 2 points from
 * 1.0000, never a 56-point flat line pinned to the frame. The last point
 * carries the intraday drift so the chart agrees with the stat cards.
 */
export function sparkSeries(v: VaultRecord, maxPoints = 56): number[] {
  const today = dayIndex(Date.now());
  const created = dayIndex(Date.parse(v.createdAt));
  const points = Math.max(2, Math.min(maxPoints, today - created + 1));
  const out: number[] = [];
  for (let i = points - 1; i >= 1; i--) out.push(shareValueOnDay(v, today - i));
  out.push(shareValueAt(v, Date.now()));
  return out;
}

/**
 * A spark strip needs HISTORY (recette DL-3). A day-zero record's series is
 * two points on one flat line, and the card strips' draw-in dash choreography
 * (`pathLength={1}` + `stroke-dasharray` + `non-scaling-stroke`) paints that
 * degenerate path as broken fragments — measured on the freshly published
 * Recette QA records, on /vaults and /portfolio at once. Below three points
 * the slot states the fact instead of charting a history that does not exist.
 * One gate for both strips, so the two pages cannot disagree on when a chart
 * is a chart.
 */
export function sparkHasHistory(series: readonly number[]): boolean {
  return series.length >= 3;
}

// ── aggregates ─────────────────────────────────────────────────────────────

export function depositTotals(slug: string): { totalUsd: number; count: number } {
  let totalUsd = 0;
  let count = 0;
  for (const p of loadPositions()) {
    if (p.vaultSlug === slug) {
      totalUsd += p.amountUsd;
      count += 1;
    }
  }
  return { totalUsd, count };
}

export function vaultTvlUsd(v: VaultRecord): number {
  return v.baseTvlUsd + depositTotals(v.slug).totalUsd;
}

export function vaultDepositors(v: VaultRecord): number {
  return v.baseDepositors + (depositTotals(v.slug).count > 0 ? 1 : 0);
}

export function positionValueUsd(p: PositionRecord, v: VaultRecord): number {
  return (p.amountUsd / p.shareValueAtDeposit) * currentShareValue(v);
}

// ── portfolio aggregation + value series (portfolio page v2) ───────────────

/**
 * One card per vault: multiple deposits into the same vault aggregate into
 * a single holding. `shares` is the exact sum of per-deposit share counts
 * (amount / entry share value), so `shares × currentShareValue` reproduces
 * the same total the old per-row math summed to; `shareValueAtDeposit` is
 * the deposit-weighted effective entry (total in / total shares).
 */
export interface AggregatePosition {
  vaultSlug: string;
  vaultName: string;
  /** Total deposited, USD. */
  amountUsd: number;
  /** Σ amount_i / shareValueAtDeposit_i. */
  shares: number;
  /** Deposit-weighted effective entry share value. */
  shareValueAtDeposit: number;
  firstDepositMs: number;
  deposits: number;
}

export function aggregatePositions(rows: PositionRecord[]): AggregatePosition[] {
  const by = new Map<string, AggregatePosition>();
  for (const p of rows) {
    const shares = p.amountUsd / p.shareValueAtDeposit;
    const ms = Date.parse(p.depositedAt);
    const cur = by.get(p.vaultSlug);
    if (!cur) {
      by.set(p.vaultSlug, {
        vaultSlug: p.vaultSlug,
        vaultName: p.vaultName,
        amountUsd: p.amountUsd,
        shares,
        shareValueAtDeposit: p.shareValueAtDeposit,
        firstDepositMs: ms,
        deposits: 1,
      });
    } else {
      cur.amountUsd += p.amountUsd;
      cur.shares += shares;
      cur.shareValueAtDeposit = cur.amountUsd / cur.shares;
      cur.firstDepositMs = Math.min(cur.firstDepositMs, ms);
      cur.deposits += 1;
    }
  }
  return [...by.values()];
}

/**
 * Deterministic total-value series over the given position rows, earliest
 * deposit day → now (strided to ≤ maxPoints). Each deposit contributes
 * shares × shareValueOnDay from its own deposit day onward — a later
 * deposit steps the curve up on the day it landed, never inflates history.
 * The last point rides shareValueAt(now), so the terminal value agrees
 * exactly with the hero total and the per-card current values. Rows whose
 * vault cannot be resolved contribute their deposit amount, flat (same
 * fallback the table used).
 */
export function portfolioValueSeries(
  rows: PositionRecord[],
  resolve: (slug: string) => VaultRecord | null,
  nowMs = Date.now(),
  maxPoints = 64,
): number[] {
  if (rows.length === 0) return [0, 0];
  const today = dayIndex(nowMs);
  const entries = rows.map((p) => ({
    startDay: dayIndex(Date.parse(p.depositedAt)),
    shares: p.amountUsd / p.shareValueAtDeposit,
    amountUsd: p.amountUsd,
    v: resolve(p.vaultSlug),
  }));
  const start = Math.min(...entries.map((e) => e.startDay));
  const at = (d: number) =>
    entries.reduce(
      (s, e) => (d < e.startDay ? s : s + (e.v ? e.shares * shareValueOnDay(e.v, d) : e.amountUsd)),
      0,
    );
  const atNow = entries.reduce(
    (s, e) => s + (e.v ? e.shares * shareValueAt(e.v, nowMs) : e.amountUsd),
    0,
  );
  const span = today - start;
  if (span < 1) return [at(today), atNow];
  const stride = Math.max(1, Math.ceil(span / maxPoints));
  const out: number[] = [];
  for (let d = start; d < today; d += stride) out.push(at(d));
  out.push(atNow);
  return out;
}

// ── publish ────────────────────────────────────────────────────────────────

export interface PublishInput
  extends Partial<
    Pick<
      VaultRecord,
      | "liqLtv"
      | "appliedLeverage"
      | "hfTargetBps"
      | "hfDeleverageBps"
      | "hfFloorBps"
      | "hedgeLeverage"
      | "reserveFraction"
      | "hlCoin"
      | "deltaBandPct"
      | "marginTrimPct"
      | "marginRestorePct"
      | "fundingFloorApr"
      | "thresholdUsd"
      | "compoundCadenceHours"
      | "capacityBinding"
      | "chainId"
      | "blockNumber"
      /* The overlay's own three, plus the collateral yield its issuer row is
         derived from. Optional like every other member of this Pick, so a
         canvas that seats no watcher publishes exactly the record it published
         before. */
      | "collateralYieldApy"
      | "exogenousParams"
      | "failedGates"
      | "gatesTotal"
      /* THE ROUTED RECORD (plan R5, seam 1). Declared on `VaultRecord` above
         and admitted here so the canvas writes the two fields through the
         same door as every other record field, rather than widening the
         input type at the publish site. Optional like the rest of this Pick:
         a single-lane publish passes neither and the record it writes is
         byte for byte the one it wrote before the router existed. */
      | "lanes"
      | "router"
    >
  > {
  name: string;
  strategy: StrategyKind;
  strategyLabel: string;
  summary: string;
  venue: string;
  market: string;
  modules: string[];
  moduleLines: { name: string; line: string }[];
  params: { label: string; value: string }[];
  modeledApy: number;
  /** Composed deposit capacity (lib/canvas/capacity.ts `vaultCapacity`) — the
   *  tightest SHARED resource, never the sum of the lanes. Null when a canvas
   *  does not compute it; Review then renders neither block, no placeholder. */
  capacityUsd: number | null;
  /** `limited by the ETH perp book, shared by 2 loops` — the sub-register
   *  under the capacity stat. A caption, never a warning. */
  capacityBindingLabel: string | null;
  /** Computed at publish time from the canvas graph (PublishFlow). */
  automations?: VaultAutomations;
}

/**
 * Create + persist a user vault. Seed TVL $25k, share value 1.0000.
 *
 * Returns null when the write did not land (G2) — a caller that ignores
 * null will offer "Open your vault" for a vault that does not exist.
 *
 * `baseDepositors: 0` (H13): nobody has deposited into a vault published
 * one second ago, and the seat that used to be counted was attributed to
 * somebody who does not exist. `vaultDepositors` adds the reader's own
 * seat the moment they deposit.
 */
export function publishVault(
  input: PublishInput,
  seedSlugs: ReadonlySet<string>,
): VaultRecord | null {
  /* THIS BUILD HAS ONE LIVE RECORD (docs/plans/LATEST_UI_PORT_SPEC.md A.2).
     A publish writes the composition ONTO it rather than minting a slug: the
     name, summary, parameters, applied leverage and automations are the
     user's; the NAV stays the attested one (read off the settling capture by
     `heroNavUsd`, never typed); the stage stays `attested`. `curator` follows
     the live user-vault convention. */
  if (DEMO_SCOPE.liveSlug) {
    const rec: VaultRecord = {
      ...input,
      automations: input.automations ?? deriveAutomations(input),
      slug: DEMO_SCOPE.liveSlug,
      baseTvlUsd: heroNavUsd() ?? 0,
      baseDepositors: 1,
      curator: "You",
      createdAt: new Date().toISOString(),
      mine: true,
      register: "published",
      modelVersion: RECORD_MODEL_VERSION,
      stage: "attested",
    };
    return saveUserVault(rec) ? rec : null;
  }
  const taken = new Set<string>([...seedSlugs, ...loadUserVaults().map((v) => v.slug)]);
  /* THE SEED NEVER EXCEEDS THE RECORD'S OWN CAPACITY (gate catch,
     2026-08-24). A flat $25K seed on the kHYPE funding book — whose record
     states $11,696, limited by the HYPE perp book — published a card
     reading "TVL $25K" beside "100% of $11.6K · at capacity": two answers
     to "how much is in this vault" on one screen, and a mock position the
     book it binds on could not hold. The same rule the funding SEEDS
     already follow (seeds.ts: a seed's TVL sits strictly inside the room
     its own book measured). The $25K model reference itself
     (`MODELED.refTvlUsd`, `publishedModelRecord.openingTvlUsd`) is NOT
     decided here — that is blocker 5's pending ruling; this only stops the
     store from seeding more dollars than the record it is writing says the
     vault can hold. */
  const seedTvl =
    typeof input.capacityUsd === "number" && Number.isFinite(input.capacityUsd) && input.capacityUsd > 0
      ? Math.min(25_000, Math.floor(input.capacityUsd))
      : 25_000;
  const rec: VaultRecord = {
    ...input,
    automations: input.automations ?? deriveAutomations(input),
    slug: slugify(input.name, taken),
    baseTvlUsd: seedTvl,
    baseDepositors: 0,
    curator: "You",
    createdAt: new Date().toISOString(),
    mine: true,
    register: "published",
    // Priced by the current model, so the frozen-record migration never
    // touches it (see repriceFrozenRecord).
    modelVersion: RECORD_MODEL_VERSION,
    /* R2: a vault published from the canvas enters the incubation zone. It
       holds no capital and arms no automation, which is exactly what the
       stage says on the record and in the directory. Written unconditionally
       — no caller may publish straight to `live`. */
    stage: "incubating",
  };
  return saveUserVault(rec) ? rec : null;
}

// ── lifecycle stage ────────────────────────────────────────────────────────

/**
 * THE ONE RESOLVER. Nothing reads `record.stage` directly.
 *
 * Three states, as everywhere else in this module:
 *   value  → use it (every publish since R2 writes one)
 *   absent on a `sample` → `live`; the eight Priime-authored records are the
 *            venue's own, and a sample must never render the incubating chip
 *            (the count is pinned against `SEED_VAULTS` in
 *            `copilot-prompt-bytes.test.ts`, because the copilot's system
 *            prompt states it in prose and prose goes stale in silence)
 *   absent otherwise → `incubating`; a record a user published before the
 *            field existed was already incubating, and saying `live` over it
 *            would be the fabrication this whole wave exists to remove
 *
 * It reads `register` but changes no `register` check: this is a new
 * derivation, and `register` keeps its two values and its meaning.
 */
export function vaultStage(v: Pick<VaultRecord, "stage" | "register">): VaultStage {
  if (v.stage === "incubating" || v.stage === "live" || v.stage === "attested") return v.stage;
  return v.register === "sample" ? "live" : "incubating";
}

/**
 * The chip, one declaration for every surface that prints it — the record
 * header and the directory card state the same string, so "the same chip"
 * is checkable rather than a resemblance.
 *
 * `modeled` stays on both: the stage says whether capital and automation are
 * behind the record, never whether the number was realized.
 */
export const VAULT_STAGE_LABEL: Record<VaultStage, string> = {
  incubating: "Incubating · modeled",
  live: "Live · modeled",
  attested: "Live · attested",
};

/**
 * The single line a record carries under an incubating chip. It states the
 * two facts the stage stands for and what the record therefore IS. It is not
 * a disclaimer and carries no risk adjective: no capital and no armed
 * automation are both measurable properties of this mockup today.
 */
export const INCUBATING_LINE = "No capital, no armed automation. The record is the design.";

/** Directory filter label for the incubating cohort. */
export const INCUBATING_FILTER_LABEL = "Incubating";

/**
 * THE STAGE AS A WORD IN A SENTENCE (S2 Wave 2 seam, 2026-08-24).
 *
 * `VAULT_STAGE_LABEL` is the CHIP — a label with its own `· modeled` half —
 * and it cannot be dropped into prose. The publish toast needed the stage in a
 * sentence and, having no owner to read, asserted `Live in the directory` over
 * a record whose very next screen chips `Incubating · modeled` and states
 * `No capital, no armed automation.` One lifecycle, two claims, thirty
 * seconds apart.
 *
 * So the noun is declared HERE, beside the chip, from the same union. Two
 * spellings of one fact, one file, no third opinion. A surface that needs the
 * stage in prose reads this; a surface that needs the chip reads that.
 */
export const VAULT_STAGE_NOUN: Record<VaultStage, string> = {
  incubating: "incubating",
  live: "live",
  attested: "live",
};

// ── automations derivation (deterministic, slug-seeded) ────────────────────

/** A finite number, or the stated fallback. Never coerces null to a value. */
function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The auto-compound module's own default for a field, as a number.
 *
 * `cadence` publishes as `"24h"` and `minActionUsd` as a number, so the
 * numeric token is read out of either shape. Sourcing the backfill here
 * means a schema change to the default reaches old records too, instead of
 * the reader holding a copy that silently goes stale.
 */
function defaultNum(field: "cadence" | "minActionUsd"): number | null {
  const d = defaultValueFor("auto-compound", field);
  if (typeof d === "number") return Number.isFinite(d) ? d : null;
  if (typeof d === "string") {
    const m = d.match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = Number.parseFloat(m[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * ⚠ THE MINUS SIGN A PUBLISHED PARAM ROW CARRIES IS U+2212, NOT A HYPHEN
 * (S2 Wave 2 seam, 2026-08-24) — one quantity, one glyph, both ways.
 *
 * `format.MINUS` has been the house glyph on every signed number the product
 * PRINTS for a long time; `AutomationsSection` renders the collar's floor with
 * it. But the param-row WRITERS (`RackCanvas`'s collar branch and the collar
 * seed) spelled the same floor with an ASCII hyphen, so one record page showed
 * `-12%` in Parameters and `−12%` in the protection envelope four rows below.
 * The writers moved to U+2212 in the same edit as these parsers, and they had
 * to move together: a U+2212 against `/-?\d+/` matches the digits WITHOUT the
 * sign, which is how `riskGrade` would have printed `Protected floor 12%` on a
 * floor that sits below spot.
 *
 * So the token class is stated once, here, and every reader below uses it.
 * `Number.parseFloat` does not understand U+2212, so the match is normalized
 * before it is parsed — never after, and never by a second copy of this rule.
 */
const SIGNED_NUM = /[-−]?\d+(?:\.\d+)?/;
const SIGNED_NUM_G = /[-−]?\d+(?:\.\d+)?/g;
/** One normalization: U+2212 back to the hyphen `parseFloat` reads. */
function parseSigned(token: string): number | null {
  const n = Number.parseFloat(token.replace(/−/g, "-"));
  return Number.isFinite(n) ? n : null;
}

/** First numeric token in the param row whose label matches any fragment. */
function paramNum(
  params: readonly { label: string; value: string }[],
  ...frags: string[]
): number | null {
  for (const f of frags) {
    const row = params.find((p) => p.label.toLowerCase().includes(f));
    const m = row?.value.match(SIGNED_NUM);
    if (m) {
      const n = parseSigned(m[0]);
      if (n !== null) return n;
    }
  }
  return null;
}

/**
 * The LAST numeric token in the matching param row.
 *
 * A rule stated as a range publishes both of its edges in one row:
 * `Margin rule  13% → 28%`. `paramNum` reads the first token, which is the
 * TRIM. Backfilling the restore level with it printed `13% → 13%` — a rule
 * that trims below 13% and restores to 13%, i.e. does nothing — on any
 * record that carried the row but not the numeric fields.
 */
function paramNumLast(
  params: readonly { label: string; value: string }[],
  ...frags: string[]
): number | null {
  for (const f of frags) {
    const row = params.find((p) => p.label.toLowerCase().includes(f));
    const m = row?.value.match(SIGNED_NUM_G);
    if (m && m.length > 0) {
      const n = parseSigned(m[m.length - 1]);
      if (n !== null) return n;
    }
  }
  return null;
}

/** Same, but reads a percent token and returns a fraction (1% → 0.01). */
function paramPctFraction(
  params: readonly { label: string; value: string }[],
  ...frags: string[]
): number | null {
  for (const f of frags) {
    const row = params.find((p) => p.label.toLowerCase().includes(f));
    const m = row?.value.match(/([-−]?\d+(?:\.\d+)?)\s*%/);
    if (m) {
      const n = parseSigned(m[1]);
      if (n !== null) return n / 100;
    }
  }
  return null;
}

/**
 * BACKFILL ONLY — a regex on a pair string.
 *
 * Stable/stable pairs carry the widest band, correlated staked pairs next,
 * uncorrelated pairs the tightest. It is wrong wherever the venue disagrees
 * with the naming convention: it reads kHYPE/WHYPE as a correlated staked
 * pair at 0.945 when the market's own LLTV is 0.860, and the vault page
 * then prints a distance to liquidation of 30% where the truth is 20%.
 *
 * Call this ONLY when `record.liqLtv` is absent, i.e. on a vault published
 * before the record carried the scan's `lt`. Every new publish carries it.
 */
export function guessLiqLtv(market: string): number {
  const [a = "", b = ""] = market.split("/").map((s) => s.trim());
  const stable = (s: string) => /usd|dai/i.test(s);
  if (a && b && stable(a) && stable(b)) return 0.915;
  const coreB = b.replace(/^w/i, "").toUpperCase();
  if (a && coreB && a.toUpperCase().includes(coreB)) return 0.945;
  return 0.86;
}

/**
 * PURE FORMATTER. Invents no threshold.
 *
 * Takes the leverage and the health-factor bands the canvas published (in
 * bps, straight out of `deriveHfBands`) and returns them in the decimal
 * shape the instrument draws. It used to manufacture its own geometry —
 * `1 + span × {0.28, 0.55, 1.35, 1.75}` around a health factor it computed
 * itself — which disagreed with the canvas on 100 of 258 compositions and
 * invented a lever-up band that existed nowhere upstream (H2).
 *
 * The only value computed here is `leverUpHf`, and it is stated as what it
 * is: the mirror of the deleverage edge about target, the upper edge of the
 * no-action band. Nothing upstream publishes a lever-up threshold.
 */
/**
 * THE ONE ROUNDING from published bps to a health factor, as a NUMBER.
 *
 * Round from the bps INTEGER, never from the float: 12550 bps is exactly
 * 1.26, but rounding `12550 / 10_000` as a float lands on 1.25 because
 * 1.255 * 100 is 125.49999999999999. The band the reader sees has to be a
 * rounding of the band that was published, not of a float that drifted on
 * the way here.
 *
 * Module-private on purpose: one exported owner (`hfFromBps`) means one
 * spelling of one quantity. Callers that want the printed band take the
 * string; nothing outside this file needs the intermediate number.
 */
function hfRound(bps: number): number {
  return Math.round(bps / 100) / 100;
}

/**
 * THE ONE ROUNDING from published bps to a PRINTED health factor.
 *
 * Every surface that prints a health-factor band — the canvas rack, the
 * seeded records, the vault page's Parameters table and its protection
 * envelope — takes its string from here. Three writers each carrying their
 * own `toFixed` is how one record ends up saying 1.34 in one row and 1.35 in
 * the next: both are correct roundings of two floats that drifted apart on
 * the way to the reader (Wave 1, B3/B4).
 *
 * `deriveLeverageZones` shares the identical rule through `hfRound`, so the
 * instrument's geometry and the printed band cannot disagree either.
 */
export function hfFromBps(bps: number): string {
  return hfRound(bps).toFixed(2);
}

export function deriveLeverageZones(input: {
  targetLeverage: number;
  liqLtv: number;
  /** Defaults to false: a caller that knows the threshold was measured. */
  liqLtvInferred?: boolean;
  hfTargetBps: number;
  hfDeleverageBps: number;
  hfFloorBps: number;
}): LeverageAutomation {
  const hf = hfRound;
  const leverUpBps = 2 * input.hfTargetBps - input.hfDeleverageBps;
  return {
    targetLeverage: input.targetLeverage,
    liqLtv: input.liqLtv,
    liqLtvInferred: input.liqLtvInferred ?? false,
    emergencyHf: hf(input.hfFloorBps),
    deleverHf: hf(input.hfDeleverageBps),
    targetHf: hf(input.hfTargetBps),
    leverUpHf: hf(leverUpBps),
    axisMaxHf: hf(2 * leverUpBps - input.hfTargetBps),
    cadence: "every block",
    cooldown: "1 min",
  };
}

/** The published HF bands, or null when the record carries none. */
function publishedBands(
  v: AutomationSource,
): { hfTargetBps: number; hfDeleverageBps: number; hfFloorBps: number } | null {
  const t = finite(v.hfTargetBps);
  const d = finite(v.hfDeleverageBps);
  const f = finite(v.hfFloorBps);
  return t !== null && d !== null && f !== null
    ? { hfTargetBps: t, hfDeleverageBps: d, hfFloorBps: f }
    : null;
}

/** True when the record explicitly published `null` for a field. */
function declinedNull(v: AutomationSource, key: keyof AutomationSource): boolean {
  return key in v && v[key] === null;
}

/**
 * The automation instruments for a vault record or publish draft.
 *
 * Reads the published record first and derives only what the record does
 * not carry. Which module is installed still decides which instrument
 * exists: leverage envelope iff Dynamic leverage is installed, hedge iff a
 * hedge-shaped module is (Dynamic hedge, or the Basis engine whose short
 * leg carries the same margin rules), compound iff Auto-compound is.
 */
export function deriveAutomations(v: AutomationSource): VaultAutomations {
  const has = (name: string) =>
    v.modules.some((m) => canonicalModuleName(m).toLowerCase() === name.toLowerCase());
  const param = (frag: string) =>
    v.params.find((p) => p.label.toLowerCase().includes(frag))?.value ?? "";

  // ── leverage envelope ──────────────────────────────────────────────────
  let leverage: LeverageAutomation | null = null;
  if (has("Dynamic leverage") && !declinedNull(v, "appliedLeverage")) {
    // The APPLIED leverage, never the requested dial value. Absent on old
    // records — parse the params row, and if even that is missing, publish
    // no envelope rather than a fabricated 3.00x (G3).
    const applied =
      finite(v.appliedLeverage) ??
      paramNum(v.params, "applied leverage", "target leverage", "leverage");
    const measuredLt = declinedNull(v, "liqLtv")
      ? null
      : (finite(v.liqLtv) ?? paramPctFraction(v.params, "liquidation ltv"));
    const lt = declinedNull(v, "liqLtv")
      ? null
      : (measuredLt ?? guessLiqLtv(v.market));
    /* THE SENTINEL IS NOT A BAND (S1, 2026-08-24, census F2).
       `hfTargetBpsFor` answers `HF_TARGET_CAP_BPS` (100,000 bps = a health
       factor of 10.00) wherever the true health factor runs off the top — a
       cap that exists so the unlevered corner is REACHABLE, not a target
       anybody set. `applied > 1` alone does not catch it: at lt 0.86 and
       L 1.05 the true HF is 18.06 and clips to the cap, so a barely-levered
       record built the envelope and `AutomationsSection` rendered three zones
       around a liquidation line at 10.00 that no market offered.
       B2 suppressed the PARAMETER row in `VaultDetail`; the envelope has a
       SECOND renderer reading `automations.leverage` verbatim, so the rule
       has to live here, at the emitter both of them read. Null envelope, and
       both surfaces print nothing rather than a sentinel dressed as a
       measurement. */
    const bands = publishedBands(v);
    const sentinelBands = bands !== null && bands.hfTargetBps === HF_TARGET_CAP_BPS;
    if (applied !== null && applied > 1 && lt !== null && !sentinelBands) {
      leverage = deriveLeverageZones({
        targetLeverage: applied,
        liqLtv: lt,
        liqLtvInferred: measuredLt === null,
        // Pre-record vaults get the canvas's OWN band derivation at the
        // default preset — one geometry in the product, not two.
        ...(bands ?? deriveHfBands("standard", applied, lt)),
      });
    }
  }

  // ── hedge ──────────────────────────────────────────────────────────────
  let hedge: HedgeAutomation | null = null;
  if (has("Dynamic hedge") || has("Basis engine")) {
    const fromParam = param("hedge venue");
    const venue = fromParam
      ? venueParts(fromParam).venue
      : v.strategy === "funding"
        ? (v.venue.split(/[+·]/)[0] ?? "").trim() || "Hyperliquid"
        : "Hyperliquid";
    // BACKFILL ONLY. The real bands are coin-dependent (`deriveHlMarginBands`
    // off the coin's max leverage), so these literals are a guess that
    // happens to match one coin — they are reached only by a record published
    // before the writer carried the fields. Restore reads the LAST token of a
    // `13% → 28%` row: the first one is the trim.
    const trim = finite(v.marginTrimPct) ?? paramNum(v.params, "margin rule", "margin trim") ?? 13;
    const restore =
      finite(v.marginRestorePct) ??
      paramNum(v.params, "margin restore") ??
      paramNumLast(v.params, "margin rule") ??
      28;
    hedge = {
      venue,
      coin: typeof v.hlCoin === "string" && v.hlCoin ? v.hlCoin : null,
      leverage: finite(v.hedgeLeverage) ?? paramNum(v.params, "hedge leverage", "short leverage"),
      reserveFraction:
        finite(v.reserveFraction) ?? paramPctFraction(v.params, "margin reserve", "idle margin"),
      fundingFloorApr: declinedNull(v, "fundingFloorApr")
        ? null
        : (finite(v.fundingFloorApr) ?? paramPctFraction(v.params, "funding floor", "guard floor")),
      deltaBandPct: finite(v.deltaBandPct) ?? paramNum(v.params, "delta band") ?? 0.5,
      marginTrimBelowPct: Math.min(trim, restore),
      marginRestorePct: Math.max(trim, restore),
      fundingDeallocPeriods: paramNum(v.params, "negative periods", "dealloc") ?? 3,
      cadence: "every 5 min",
    };
  }

  // ── compounder ─────────────────────────────────────────────────────────
  let compound: CompoundAutomation | null = null;
  if (has("Auto-compound")) {
    // BACKFILL ONLY, and off the module's OWN default rather than a literal.
    // The reader used to hardcode $25, which is precisely the threshold the
    // schema retired: `MODULE_DEFS["auto-compound"].minActionUsd` records
    // that $25 was 208 days of accrual at the launch cap, so the rule
    // published and never fired. A reader that restates a retired default
    // reintroduces the defect on every record too old to carry the field.
    const cadenceHours =
      finite(v.compoundCadenceHours) ??
      paramNum(v.params, "compound cadence", "cadence") ??
      defaultNum("cadence") ??
      24;
    const thresholdUsd =
      finite(v.thresholdUsd) ??
      paramNum(v.params, "harvest threshold", "minimum action", "min action") ??
      defaultNum("minActionUsd") ??
      10;
    compound = { cadenceHours, thresholdUsd };
  }

  // ── the capital router ─────────────────────────────────────────────────
  //
  // TWO CONDITIONS, both required. `lanes.length >= 2` because a router with
  // one lane routes nothing, and `router` because the dials are what the rule
  // is made of. A record carrying one without the other is a half-written
  // publish and renders as the single-lane vault it actually is, which is
  // also exactly what every record written before this field existed does.
  let router: RouterAutomation | null = null;
  const lanes = Array.isArray(v.lanes) ? v.lanes : [];
  if (lanes.length >= 2 && v.router) {
    const r = v.router;
    const thresholdApy = finite(r.thresholdApy) ?? DEMO_UPGRADE_THRESHOLD;
    const rearmApy = finite(r.rearmApy) ?? DEMO_UPGRADE_REARM;
    const sustainHours = finite(r.sustainHours) ?? DEMO_SUSTAIN_HOURS;
    const moveWeight = finite(r.moveWeight) ?? DEMO_ROUTER_MOVE_WEIGHT;
    const maxConcentrationPct =
      finite(r.maxConcentrationPct) ?? ORCH_DIAL_DEFAULTS.maxConcentrationPct;
    const turnoverBudgetPctWeek =
      finite(r.turnoverBudgetPctWeek) ?? ORCH_DIAL_DEFAULTS.turnoverBudgetPctWeek;
    router = {
      lanes,
      thresholdApy,
      rearmApy,
      sustainHours,
      moveWeight,
      maxConcentrationPct,
      turnoverBudgetPctWeek,
      ruleSentence:
        typeof r.ruleSentence === "string" && r.ruleSentence.trim()
          ? r.ruleSentence.trim()
          : routerRuleSentence({
              lanes,
              thresholdApy,
              sustainHours,
              moveWeight,
              maxConcentrationPct,
            }),
    };
  }

  return { leverage, hedge, compound, router };
}

/**
 * THE RULE IN THE DEPOSITOR'S WORDS, ONE OWNER.
 *
 * The canvas composes this at publish and writes it onto the record; this
 * function is what it calls, and it is also the backfill a record published
 * without the field gets. Two spellings of one rule is how a vault page and
 * the review sheet that published it come to describe different machines.
 *
 * THE VERB IS `moves everything`, AND IT IS NOW TRUE (G1). It used to be
 * `moves Np of the book`, because the mechanism shifted weight inside a
 * concentration band and could not empty a lane. Between a lane and its floor
 * it now evacuates and rebuilds: one firing carries the whole lane, the band
 * is [0, 1], and the measured replay leaves the loop at exactly zero. So the
 * sentence says what the machine does, in the founder's own words, and the
 * size clause goes because there is no longer a size to state: it is all of it.
 *
 * The payback lock is NOT in this sentence. It is its own line wherever the
 * rule renders, because a clause about when the way back opens does not belong
 * inside a sentence about when the way out fires.
 */
export function routerRuleSentence(r: {
  lanes: readonly PublishedLane[];
  thresholdApy: number;
  sustainHours: number;
  moveWeight: number;
  maxConcentrationPct: number;
}): string {
  /* BOTH LANES ARE NAMED, AND BOTH ARE NAMED AS LANES. The sentence used to
     read `... to ${other} when it has paid more than the loop`, which was two
     defects at once: the destination was dropped in bare (`to Lane 2`, and
     after the canvas started publishing the family word, `to treasury floor`),
     and the source was the literal `the loop`, which is a family the second
     lane on this rack is not. `the <label> lane` is grammatical for a family
     word, for the plan's own lane labels and for a name the builder typed. */
  const dest = r.lanes[1]?.label ?? "other";
  const source = r.lanes[0]?.label ?? "first";
  const bar = `${(r.thresholdApy * 100).toFixed(2)}pp`;
  return `Moves everything to ${dest} when it has paid at least ${bar} more than the ${source} for ${r.sustainHours} hours; rebuilds the ${source} the same way.`;
}

/**
 * THE MOVE THIS BOOK CAN ACTUALLY MAKE, and the one owner of it.
 *
 * A lane can give at most the weight it holds and a peer can take at most the
 * room under its ceiling, so the move is
 * `min(moveWeight, max - destWeight, sourceWeight - min)`.
 *
 * THE TWO WEIGHTS ARE THE RECORD'S OWN NOW, not `1 / laneCount`. The even
 * split was true while the canvas seated every pair evenly and became false
 * the moment a switch seated the whole book in one lane: it printed a 50pp
 * move over a book that is 100% in the lane the rule would evacuate. Seated
 * evenly it still answers exactly what it answered before (50pp at a [0, 1]
 * band, 10pp at a 60% ceiling against a 12.5pp dial), so nothing that was
 * right about it moved.
 *
 * A record whose lane shares do not sum to the book is a half-written publish
 * and falls back to the even split rather than dividing by a total it cannot
 * trust.
 *
 * IT LIVES HERE BECAUSE THE PARAMETERS ROW AND THE REPLAY BOTH STATE IT, and
 * an earlier pass computed it twice and typed the dial into the sentence, so
 * one page said `Moves 12.5pp` four lines above `Max move · 10.0pp`. Found in
 * the browser, not by a test, which is why the arithmetic is one call.
 */
export function routerMaxMoveFrac(r: {
  lanes: readonly PublishedLane[];
  moveWeight: number;
  maxConcentrationPct: number;
}): number {
  const laneCount = Math.max(2, r.lanes.length);
  const maxW = r.maxConcentrationPct / 100;
  const minW = Math.max(0, 1 - (laneCount - 1) * maxW);
  const even = 1 / laneCount;
  const shares = r.lanes.map((l) => (finite(l.allocationBps) ?? 0) / 10_000);
  const total = shares.reduce((s, x) => s + x, 0);
  const seated = shares.length >= 2 && Math.abs(total - 1) < 1e-6;
  const ordered = seated ? [...shares].sort((a, b) => b - a) : [even, even];
  const sourceW = ordered[0] as number;
  const destW = ordered[1] as number;
  return Math.max(0, Math.min(r.moveWeight, maxW - destW, sourceW - minW));
}

/** The band a lane's weight may travel in, as fractions. */
export function routerConcentrationBand(r: {
  lanes: readonly PublishedLane[];
  maxConcentrationPct: number;
}): { min: number; max: number } {
  const laneCount = Math.max(2, r.lanes.length);
  const max = r.maxConcentrationPct / 100;
  return { min: Math.max(0, 1 - (laneCount - 1) * max), max };
}

// ── liquidation geometry (one definition, used by every surface) ───────────

/**
 * Health factor of a loop at a leverage, given the market's liq LTV.
 * Delegates to the canvas's one definition (`hfTargetBpsFor`) so the vault
 * page cannot drift from the plate that published the number.
 */
export function healthFactorAtLeverage(liqLtv: number, leverage: number): number {
  return hfTargetBpsFor(liqLtv, leverage) / 10_000;
}

/**
 * Adverse pair move to liquidation, as a fraction, from the PUBLISHED
 * liquidation threshold at the APPLIED leverage: 1 − 1/HF.
 *
 * kHYPE/WHYPE at the house max (lt 0.860, L 3.205) is 20.0%; at 3.00x it is
 * 22.5%. The guessed lt of 0.945 at 3.00x used to print 29.5%, which the
 * page rounded to "30%" — ten points of comfort the market never offered,
 * on the flagship market, in the depositor's favour (H1).
 */
export function distanceToLiquidation(lev: LeverageAutomation): number | null {
  // An inferred threshold cannot produce a measured distance. Returning null
  // makes every caller decide explicitly rather than inherit a number that
  // reads as measured and can err in the depositor's favour.
  if (lev.liqLtvInferred) return null;
  return liquidationDistance(lev.liqLtv, lev.targetLeverage)?.d ?? null;
}

/**
 * The same distance as the STRING every surface prints.
 *
 * ⚠ ONE OWNER (2026-08-22). Three call sites welded their own
 * `(d * 100).toFixed(0) + "% adverse pair move"` — twice in this file and
 * once in `AutomationsSection`. All three were correct, which is the
 * dangerous shape: the next caller picks its own rounding or its own noun and
 * the vault page then states two spellings of one fact. `liquidation.ts`
 * carries the string with its unit already welded on, and the canvas control
 * that offers the leverage reads the identical function, so the number a
 * builder chose by and the number a depositor reads cannot diverge.
 */
export function distanceToLiquidationLine(lev: LeverageAutomation): string | null {
  if (lev.liqLtvInferred) return null;
  return adverseMoveLine(liquidationDistance(lev.liqLtv, lev.targetLeverage));
}

/**
 * HOW FAR THE PAIR DRIFTS BEFORE THE CASCADE ACTS, in points of the distance
 * above. The reaction's own trigger, from the PUBLISHED bands.
 *
 * ⚠ THIS IS WHAT THE VAULT PAGE OWES UNDER LAW L6, and its absence is why the
 * page led on the liquidation line for so long. `deriveHfBands` places the
 * trim at `target − presetSpread` with `presetSpread` strictly positive on all
 * three presets, so the trim fires strictly BEFORE the line on every record,
 * by construction. A page printing the line and not the trigger was describing
 * a machine with its automations removed.
 *
 * It is a DIFFERENCE of two readings of `liquidationDistanceAtHf` — the one
 * owner, entered twice — and not a second derivation of anything. Null where
 * the record cannot support it: an inferred threshold, an unlevered position
 * (no borrow leg, so no band to trim inside), or bands that do not close.
 */
export function deleverageDrift(lev: LeverageAutomation): number | null {
  if (lev.liqLtvInferred) return null;
  const target = liquidationDistanceAtHf(lev.targetHf * 10_000);
  const trim = liquidationDistanceAtHf(lev.deleverHf * 10_000);
  if (!target || !trim || target.d === null || trim.d === null) return null;
  const drift = target.d - trim.d;
  return drift > 0 ? drift : null;
}

/**
 * The same drift as the string the page prints. 2 dp, following
 * `PlateControls`' own precedent and for its reason: the live drifts run from
 * 0.04pp to 5.12pp, and at 1 dp the smallest of them prints `0.1pp` — a large
 * overstatement of the one number whose job is to be visibly small.
 */
export function deleverageDriftLine(lev: LeverageAutomation): string | null {
  const d = deleverageDrift(lev);
  return d === null ? null : `${ppMag(d, 2)} of pair drift`;
}

// ── one module vocabulary ─────────────────────────────────────────────────

/**
 * ONE spelling per module, product-wide (G4).
 *
 * The names came out of three places that disagreed: the plate said
 * `Capital router`, the loop record said `Yield router`; the seeds said
 * `Range engine` where the module registry says `Auto center`. And the
 * published `moduleLines` were the BUILDER's instructions ("Pins the loop
 * market on Morpho Blue") shown verbatim to a depositor who never touched
 * the canvas.
 *
 * So: canonical names come from `MODULE_DEFS` where the module lives there,
 * plus the four funding-canvas and orchestrator modules that do not. Each
 * carries a `depositorLine` written for the person reading the vault page,
 * not the person who built it.
 */
export interface ModuleVocabEntry {
  /** The only spelling any surface may render. */
  name: string;
  /** What this instrument does, in the depositor's terms. */
  depositorLine: string;
}

const CANVAS_VOCAB: Record<string, string> = {
  "liquidity-source": "Holds the position on the venue and market this vault runs on.",
  "safety-buffer":
    "Watches the health factor every block and trims the loop before it reaches the liquidation band.",
  hedge: "Runs a perp short against the position so price moves cancel, and keeps its margin funded.",
  "auto-compound": "Sweeps earned yield back into the position once it clears the harvest threshold.",
  "auto-center": "Recenters the liquidity range when price walks toward an edge, so fees keep accruing.",
  "covered-call": "Writes calls above spot and rolls them on cadence. The premium is the income.",
  "protective-put": "Holds puts below spot, funded by the written calls, so the position has a floor.",
};

/** Modules that live outside MODULE_DEFS (funding canvas, orchestrator). */
const EXTRA_VOCAB: ModuleVocabEntry[] = [
  { name: "Perp market", depositorLine: "Pins the perp venue and market the basis position runs on." },
  {
    name: "Basis engine",
    depositorLine: "Holds spot long against a perp short at equal notional, and collects the funding.",
  },
  {
    name: "Funding guard",
    depositorLine: "Closes the short and parks in spot when funding sits under the published floor.",
  },
  {
    name: "Capital router",
    depositorLine: "Moves capital between the vault's positions inside the published concentration cap.",
  },
];

export const MODULE_VOCAB: readonly ModuleVocabEntry[] = [
  ...Object.entries(CANVAS_VOCAB).map(([key, depositorLine]) => ({
    name: MODULE_DEFS[key as keyof typeof MODULE_DEFS].name,
    depositorLine,
  })),
  ...EXTRA_VOCAB,
];

/** Retired spellings → the canonical one. Readers stay tolerant forever. */
const MODULE_ALIASES: Record<string, string> = {
  "range engine": "Auto center",
  "yield router": "Capital router",
  /* The router arrives from three writers (the canvas graph key, the record's
     module list, a hand-seeded localStorage record), and a second spelling on
     this page prints the instrument once and the same machine again as a
     prose row in `Also installed` 400px below it. */
  router: "Capital router",
  "capital-router": "Capital router",
  "dynamic leverage": "Dynamic leverage",
  "safety buffer": "Dynamic leverage",
  "auto compound": "Auto-compound",
  "perp short": "Dynamic hedge",
};

const VOCAB_BY_KEY = new Map(MODULE_VOCAB.map((e) => [e.name.toLowerCase(), e]));

/** The canonical spelling of a module name. Unknown names pass through. */
export function canonicalModuleName(raw: string): string {
  const k = raw.trim().toLowerCase();
  const alias = MODULE_ALIASES[k];
  if (alias) return alias;
  return VOCAB_BY_KEY.get(k)?.name ?? raw.trim();
}

/** The depositor-facing line for a module, or null if we have none. */
export function moduleDepositorLine(raw: string): string | null {
  return VOCAB_BY_KEY.get(canonicalModuleName(raw).toLowerCase())?.depositorLine ?? null;
}

/**
 * THE FUNDING RECORD SPEAKS THE FUNDING REGISTER (cleanup 2026-08-24).
 *
 * A rack-published funding record carries the loop chain's module NAMES
 * (Liquidity source / Dynamic hedge / Auto-compound), and its recorded
 * `moduleLines` carry the canvas taglines — so /vaults/my-hype-carry read
 * "Pick the venue and the loop market" and "Recapture yield back into the
 * loop" on a vault with no loop in it, two vocabularies on one page beside
 * the sibling seeds' "Basis engine". These lines speak the strategy layer's
 * own language (spot leg / short leg / funding — `fundingPublishView`'s
 * params rows), keyed by canonical name so every module the vocabulary does
 * not re-voice keeps its standard depositor line.
 */
const FUNDING_STRATEGY_VOCAB: Record<string, string> = {
  "Liquidity source": "Holds the spot leg on the venue and market this carry runs on.",
  "Dynamic hedge":
    "Runs the short leg against the spot at equal notional, collects the funding, and keeps its margin funded.",
  "Auto-compound": "Sweeps collected funding back into the carry once it clears the harvest threshold.",
};

/**
 * The vault page's module list: canonical names, depositor-facing lines in
 * the record's own strategy vocabulary, and the record's own line kept only
 * where the vocabulary has none.
 */
export function depositorModuleLines(
  v: Pick<VaultRecord, "modules" | "moduleLines"> & { strategy?: VaultRecord["strategy"] },
): { name: string; line: string }[] {
  return v.modules.map((raw) => {
    const name = canonicalModuleName(raw);
    const fallback = v.moduleLines.find((l) => canonicalModuleName(l.name) === name)?.line ?? "";
    const strategyLine = v.strategy === "funding" ? FUNDING_STRATEGY_VOCAB[name] : undefined;
    return { name, line: strategyLine ?? moduleDepositorLine(name) ?? fallback };
  });
}

/**
 * THE ONE MODULE LIST A RECORD SHOWS (recette DL-2).
 *
 * The Overview's `Modules` chips rendered `v.modules` RAW while every other
 * surface — the automations roster, the `Also installed` panel, the Composed
 * modules panel — speaks canonical names, so one record could chip a retired
 * spelling (`Range engine`) beside a card titled `Auto center`. Canonical,
 * first-appearance order, deduped; the chips and the roster both read this
 * list, so one record cannot name one machine two ways.
 */
export function recordModuleNames(v: Pick<VaultRecord, "modules">): string[] {
  return (v.modules ?? [])
    .map(canonicalModuleName)
    .filter((m, i, all) => all.indexOf(m) === i);
}

/**
 * The hedge instrument's head, resolved from the record's OWN module list
 * (recette DL-2). `deriveAutomations` seats the hedge iff `Dynamic hedge` OR
 * `Basis engine` is installed, but the card hard-coded `Dynamic hedge` — so
 * the live funding record chipped `Perp market · Basis engine · Funding
 * guard · Auto-compound` in Overview while its Automations section answered
 * to a name on no chip. The title is whichever hedge-seating module the
 * record carries, and a `Basis engine` card speaks that module's own
 * depositor sentence (one vocabulary owner, `MODULE_VOCAB`), so the roster
 * and the chips derive from one source: `v.modules`.
 */
export function hedgeInstrumentHead(
  v: Pick<VaultRecord, "modules">,
): { title: string; role: string } {
  const dynamicRole = "Keeps net delta at zero and the short funded.";
  const names = recordModuleNames(v);
  const title = names.includes("Dynamic hedge")
    ? "Dynamic hedge"
    : names.includes("Basis engine")
      ? "Basis engine"
      : "Dynamic hedge";
  return {
    title,
    role: title === "Dynamic hedge" ? dynamicRole : (moduleDepositorLine(title) ?? dynamicRole),
  };
}

// ── parameter table hygiene ───────────────────────────────────────────────

/**
 * Collapse parameter rows that say the same thing under two labels (H10).
 *
 * The record grew a `Margin restore` row and a `Margin rule` row that both
 * read `13% → 28%`; the old dedupe keyed on the label alone, so both
 * survived. Keying on the normalized VALUE catches the real duplicate and
 * keeps the first (canvas-order) label.
 */
export function dedupeParams(
  params: readonly { label: string; value: string }[],
): { label: string; value: string }[] {
  const seenLabel = new Set<string>();
  const seenValue = new Set<string>();
  const out: { label: string; value: string }[] = [];
  for (const p of params) {
    const label = p.label.trim().toLowerCase();
    const value = p.value.trim().toLowerCase().replace(/\s+/g, " ");
    if (seenLabel.has(label) || (value.length > 3 && seenValue.has(value))) continue;
    seenLabel.add(label);
    seenValue.add(value);
    out.push(p);
  }
  return out;
}

/**
 * Objective risk grade: measurable rows derived from the vault's own published
 * parameters, plus one sentence naming the dominant risk. Never a subjective
 * adjective; every figure is recomputable from the envelope.
 */
/**
 * THE PAIR A LIQUIDATION SENTENCE MAY NAME.
 *
 * `record.market` is the whole vault's market, and on a routed record the
 * canvas writes `2 markets` there because two lanes pin two of them. The
 * liquidation line is a property of ONE of those lanes, the one that borrows,
 * so the sentence read `Liquidation on the 2 markets pair needs 34% adverse
 * pair move`: a count where a pair belongs, about a lane it did not name.
 *
 * The borrowing lane is found by its family rather than by its index, so a
 * record that ever publishes the floor first still names the right pair.
 * Single-lane records are untouched and read exactly as they always have.
 */
function riskPairLabel(v: VaultRecord): string {
  const lanes = Array.isArray(v.lanes) ? v.lanes : [];
  if (lanes.length < 2) return v.market;
  const levered = lanes.find((l) => l.family === "loop") ?? lanes[0];
  return levered?.market ?? v.market;
}

export function riskGrade(v: VaultRecord): { rows: { label: string; value: string }[]; sentence: string } {
  /* ══ D3 + D4 (2026-08-22, law L6 / law L8) ══════════════════════════════
     TWO EDITS, BOTH DELETIONS, AND NEITHER CHANGES A FACT.

     D4 — the prefix `Main risk:` is gone from every branch. Two things were
     wrong with it. `Main` is a RANKING CLAIM across mechanisms nobody can rank
     without probabilities this product does not have and has banned itself
     from inventing; and the prefix was dead weight anyway, because the one
     caller (`VaultDetail`) has always stripped it with a regex before
     rendering. Deleting it removes the claim and the regex's job at once.
     ⚠ HANDOFF: the ROW LABEL is still the literal `"Main risk"` at
     `components/vaults/VaultDetail.tsx:224`, which is outside this pass's
     allowlist. The word survives there and only there.

     D3 — on the levered branch the REACTION now leads and the line it defends
     trails it. Every fact in the old sentence was true and correctly owned;
     the ORDER was the violation. `deriveHfBands` places the trim at
     `target − presetSpread` with `presetSpread` strictly positive on all three
     presets, so the cascade fires strictly before the liquidation line on
     every record at every setting, by construction. A sentence opening on the
     line described a machine with its automations removed. */
  const a = v.automations;
  const rows: { label: string; value: string }[] = [];
  /* U+2212 is in the sign class beside the hyphen (S2 seam, see `SIGNED_NUM`).
     This returns the token VERBATIM — it is printed, not parsed — so a floor
     written `−12%` prints `−12%` here and the ASCII-only class would have
     matched `12%` and silently dropped the sign off a floor below spot. */
  const pctRow = (re: RegExp) =>
    v.params.find((p) => re.test(p.label))?.value.match(/[+\-−±]?\s?\d+(?:\.\d+)?%/)?.[0] ?? null;

  if (v.strategy === "collar") {
    // Strike and floor are published parameters. Parse them, never restate
    // them: the old `?? "+15%"` / `?? "-12%"` fallbacks printed the default
    // collar for a vault that had published something else entirely.
    const strike = pctRow(/call strike/i);
    const floor = pctRow(/put floor/i);
    if (strike) rows.push({ label: "Upside cap", value: `calls written ${strike} above spot` });
    if (floor) rows.push({ label: "Protected floor", value: floor });
    const sentence = floor
      ? `The floor at ${floor} holds only to the option venue's performance, and upside above ` +
        `${strike ?? "the strike"} is sold.`
      : "The floor holds only to the option venue's performance; upside above the strike is sold.";
    return { rows, sentence };
  }

  if (v.strategy === "dnlp") {
    // H8: the dominant risk on a concentrated LP is the range exit, not
    // hedge slippage. Price walking out of the range turns the position
    // one-sided and stops the fees that are the entire return.
    const width = pctRow(/range width|range/i);
    const trigger = v.params.find((p) => /recenter/i.test(p.label))?.value ?? null;
    if (width) rows.push({ label: "Range", value: `fees accrue inside ${width} of spot` });
    if (trigger) rows.push({ label: "Recenter", value: trigger });
    if (a?.hedge) rows.push({ label: "Delta band", value: `±${a.hedge.deltaBandPct.toFixed(1)}%` });
    const sentence =
      `Price leaves the ${width ?? "published"} range. The position goes one-sided, fees stop, ` +
      `and the recenter pays the spread to re-enter` +
      (a?.hedge
        ? ". The perp hedge cancels the price leg, not the range exit."
        : ", with the price leg unhedged.");
    return { rows, sentence };
  }

  if (a?.leverage) {
    // Distance from the PUBLISHED liquidation threshold at the APPLIED
    // leverage — one definition, shared with the automations instrument.
    const ddLine = distanceToLiquidationLine(a.leverage);
    // The SENTENCE reads the owner's object, not a re-formatted fraction.
    //
    // ⚠ IT USED TO READ `${fmtPct(ddRaw ?? 0, 0)} of adverse pair move away`
    // (fixed 2026-08-22). Two defects in one expression. It span up a SECOND
    // spelling of the product's risk number through a different formatter than
    // the one `liquidation.ts` welds on, which is the drift this file's owner
    // exists to refuse. And `?? 0` turned "unknown" into a MEASUREMENT of
    // zero: an unlevered record has no borrow leg, so the distance is null
    // with `liqLtvInferred` false, and the page told a depositor with no debt
    // at all that "Liquidation sits 0% of adverse pair move away". Since A2
    // made L = 1 a reachable dial position — and the corner optimum on most of
    // the live catalog — that record is expected, not exotic.
    const dd = liquidationDistance(a.leverage.liqLtv, a.leverage.targetLeverage);
    const measured = a.leverage.liqLtvInferred ? null : dd;
    // null means the threshold was inferred from the pair name. Withhold the
    // distance rather than print an unmeasured number under a measured label,
    // and say the threshold is inferred where it is shown.
    /* ⚠ THE ROW'S HEAD IS THE CANVAS'S, NOT THE BANNED ONE (recette
       2026-08-23, I4). `Distance to liquidation` survived here after D1/D2
       retired it from ComposePanel and AutomationsSection — the exact banned
       head, live on two vault pages. The 2026-08-21 ratification that listed
       it among the measurable rows is OVERRULED (recorded in the design
       TASTE ledger): risk names what DEFEATS the reaction, because the trim
       fires strictly before the line on every record by construction.

       So the row wears ComposePanel's D1 head (`Room the trim works in`,
       spelling kept identical to its `ROOM_HEAD`) and its caption grammar:
       the reaction leads (`trims X.XXpp before it`), the line it defends
       trails (`Y% adverse pair move`). Both quantities keep their owners —
       `deleverageDrift` and `adverseMoveLine` — and on a record that cannot
       prove the drift (unlevered, or bands that do not close) the value is
       the owner's own string alone, never a fabricated trim. */
    if (ddLine !== null) {
      const rowDrift = measured?.unlevered ? null : deleverageDrift(a.leverage);
      rows.push({
        label: "Room the trim works in",
        value:
          rowDrift !== null ? `trims ${ppMag(rowDrift, 2)} before it · ${ddLine}` : ddLine,
      });
    }
    rows.push({ label: "Auto-deleverage begins", value: `${fmtHf(a.leverage.deleverHf)} health` });
    rows.push({
      label: "Liquidation LTV",
      value:
        `${(a.leverage.liqLtv * 100).toFixed(1)}%` +
        (a.leverage.liqLtvInferred ? " (inferred from the pair)" : ""),
    });
    /* THE REACTION, AND IT LEADS. Capitalised because it now opens the
       sentence: the old lower-case `cascade` was a trailing semicolon clause
       and the capital is the whole of D3 made visible. */
    const cascadeLead =
      `The cascade starts trimming at ${fmtHf(a.leverage.deleverHf)} health, ` +
      `emergency unwind at ${fmtHf(a.leverage.emergencyHf)}.`;
    // The trigger, in the unit a depositor owns. Null on an inferred
    // threshold or an unlevered record, which are exactly the two branches
    // that state no distance either.
    const drift = deleverageDriftLine(a.leverage);
    // The pair the borrow leg is actually on. See `riskPairLabel`.
    const pair = riskPairLabel(v);
    const sentence = a.leverage.liqLtvInferred
      ? `${cascadeLead} This vault predates the published liquidation ` +
        `threshold, so the ${pair} pair's distance to liquidation is not stated.`
      : measured?.unlevered
        ? // No borrow leg. There is no liquidation line and no cascade to
          // describe, and inventing either would be the `?? 0` bug in prose.
          `Nothing is borrowed here, so the ${pair} pair has no liquidation ` +
          `line to reach.`
        : measured && measured.d !== null
          ? `${cascadeLead}${drift ? ` The trim is ${drift} from here.` : ""} ` +
            `Liquidation on the ${pair} pair needs ${adverseMoveLine(measured)}.`
          : // Threshold in hand but the distance is not derivable. Say so and
            // print no number, rather than round an absence down to zero.
            `${cascadeLead} The ${pair} pair's distance to liquidation is ` +
            `not stated.`;
    return { rows, sentence };
  }

  if (a?.hedge && v.strategy === "funding") {
    // The guard floor IS the strategy. It comes from the record; there is
    // no "0%" fallback, because a floor nobody published is not a floor.
    const floor = a.hedge.fundingFloorApr;
    if (floor !== null && floor !== undefined) {
      rows.push({
        label: "Funding guard",
        value: `floor ${fmtPct(floor)}, ${a.hedge.fundingDeallocPeriods} periods under it`,
      });
    }
    rows.push({ label: "Delta band", value: `±${a.hedge.deltaBandPct.toFixed(1)}%` });
    if (a.hedge.reserveFraction != null) {
      rows.push({ label: "Margin reserve", value: `${fmtPct(a.hedge.reserveFraction, 0)} of short` });
    }
    const sentence =
      `Funding turns negative. The carry pays only while longs fund the short; ` +
      (floor !== null && floor !== undefined
        ? `after ${a.hedge.fundingDeallocPeriods} periods under ${fmtPct(floor)} the guard closes the short and parks in spot.`
        : `the guard closes the short after ${a.hedge.fundingDeallocPeriods} negative periods.`);
    return { rows, sentence };
  }

  if (a?.hedge) {
    rows.push({ label: "Delta band", value: `±${a.hedge.deltaBandPct.toFixed(1)}%` });
    rows.push({
      label: "Margin rule",
      value: `${a.hedge.marginTrimBelowPct}% → ${a.hedge.marginRestorePct}%`,
    });
    const sentence =
      `Hedge slippage during fast price moves. Net delta rebalances inside ±${a.hedge.deltaBandPct.toFixed(1)}%; ` +
      `a gap wider than the band is unhedged exposure until the next rebalance.`;
    return { rows, sentence };
  }

  // No leverage, no hedge. This used to be a bare sentence with zero
  // measurable rows on 54 compositions (H8). The composition itself is
  // measurable: an unlevered, unhedged position moves 1:1 with what it
  // holds, and saying so is a fact a reader can check against the modules.
  rows.push({ label: "Leverage", value: "none, 1:1 with the collateral" });
  rows.push({ label: "Hedge", value: "none, the price leg is unhedged" });
  return {
    rows,
    sentence:
      `${v.market} moves in full. Nothing here levers the position and nothing ` +
      `shorts against it, so the vault moves with what it holds.`,
  };
}

/**
 * Number of installed automation instruments (directory fact).
 *
 * Counts the family instruments too (H4): `Auto center` ships on 104
 * compositions and `Covered call` / `Protective put` on 54 each, and a
 * count that ignored them made a collar vault report zero automations on
 * the section the page calls its differentiator.
 */
export function automationCount(v: VaultRecord): number {
  const a = v.automations;
  const family = ["Auto center", "Covered call", "Protective put"].filter((name) =>
    v.modules.some((m) => canonicalModuleName(m) === name),
  ).length;
  if (!a) return family;
  /* THE ROUTER COUNTS. The directory card prints this number beside the card
     that links to the page, and the page mounts the router as its FIRST
     instrument, so a routed record that counted three while showing four made
     the card and the page disagree about the same vault. `router` is absent
     on every record written before it existed, so nothing else moves. */
  return [a.leverage, a.hedge, a.compound, a.router].filter(Boolean).length + family;
}

/** Split "Morpho Blue · Base" into venue + chain; single-name venues map honestly.
 *
 *  `Hyperliquid · funding` is the one venue label whose second segment is a
 *  PRODUCT word, not a chain (`lib/canvas/funding-card.ts`) — a rack-published
 *  funding record carries it verbatim, and the naive split printed
 *  "Chain: funding" in the vault configuration panel. That segment resolves
 *  the way the seeded funding vaults (venue "Hyperliquid") already do. */
export function venueParts(
  venue: string,
  /**
   * The lane venue IDS the record was priced on, when the caller has them.
   * This is the AUTHORITY on how many venues the vault touches; the label is
   * only a fallback for records written before the ids were carried.
   */
  venueIds?: readonly string[] | null,
): { venue: string; chain: string } {
  const ix = venue.indexOf("·");
  if (ix >= 0) {
    const head = venue.slice(0, ix).trim();
    const tail = venue.slice(ix + 1).trim();
    const sole = soleVenue(head, venueIds);
    if (/^funding$/i.test(tail)) {
      if (sole === null) return { venue: head, chain: "Cross-venue" };
      return { venue: sole, chain: /hyperliquid/i.test(sole) ? "Hyperliquid L1" : "Multi-venue" };
    }
    return { venue: sole ?? head, chain: tail };
  }
  const sole = soleVenue(venue, venueIds);
  if (sole === null) return { venue, chain: "Cross-venue" };
  if (/hyperliquid/i.test(sole)) return { venue: sole, chain: "Hyperliquid L1" };
  return { venue: sole, chain: "Multi-venue" };
}

/**
 * The single venue this label names, or null when it names two or more.
 *
 * ⚠ COUNT THE VENUES, NEVER THE PLUS SIGN (Wave 1, B4). This used to be
 * `venue.includes("+")`, and a two-lane funding vault whose lanes both sit on
 * Hyperliquid published the label "Hyperliquid + Hyperliquid" — one venue,
 * joined twice — which the plus-sign test read as a multi-venue vault and
 * printed "Cross-venue" as the chain of a vault that never leaves Hyperliquid
 * L1. The chain is a fact about how many DISTINCT venues were priced, so that
 * is what gets counted: the ids when the caller carries them, and the distinct
 * names in the joined label otherwise. One id resolves to that venue's chain;
 * two or more is genuinely cross-venue.
 */
function soleVenue(label: string, venueIds?: readonly string[] | null): string | null {
  const parts = label
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  const distinctParts = new Set(parts.map((p) => p.toLowerCase()));
  if (venueIds && venueIds.length > 0) {
    const ids = new Set(venueIds.map((v) => v.trim().toLowerCase()).filter(Boolean));
    if (ids.size > 1) return null;
    // One id: the label is a join of one venue with itself, so any single
    // part names it. A label the ids disagree with is returned whole rather
    // than silently halved.
    return distinctParts.size <= 1 ? (parts[0] ?? label) : label;
  }
  if (distinctParts.size > 1) return null;
  return parts[0] ?? label;
}

/**
 * THE VENUE LINE A ROUTED RECORD ACTUALLY HAS, and the one owner of it.
 *
 * `venueParts` splits ONE label, and the label a two-venue composition
 * publishes is the word `Multi-venue`, which the split then reads as both the
 * venue AND the chain. The Projection card printed `Multi-venue · Multi-venue`
 * on a vault whose two lanes never leave Base, while the Modeled APY row two
 * lines below it printed a composed two-lane number: one card, two answers to
 * "what is this vault". All three rail rows move together on a routed record
 * or the rail contradicts itself.
 *
 * THE SHAPE IS THE PAGE'S OWN `<name> · <chain>` and not a counted phrase: the
 * lanes name themselves, joined by the word the depositor would use, and the
 * chain is stated once because it is one chain. A routed record whose lanes
 * genuinely sit on different chains keeps the label's own answer, because at
 * that point `Cross-venue` is the true one.
 *
 * Falls through to `venueParts` on every record that is not routed, which is
 * every record in the product today, so nothing that ships moves.
 */
export function recordVenueParts(v: {
  venue: string;
  automations?: VaultAutomations | null;
}): { venue: string; chain: string } {
  const lanes = v.automations?.router?.lanes ?? null;
  if (!lanes || lanes.length < 2) return venueParts(v.venue);
  const split = lanes.map((l) => {
    const ix = l.venueLabel.indexOf("·");
    return ix >= 0
      ? { name: l.venueLabel.slice(0, ix).trim(), chain: l.venueLabel.slice(ix + 1).trim() }
      : { name: l.venueLabel.trim(), chain: "" };
  });
  const names = Array.from(new Set(split.map((x) => x.name).filter(Boolean)));
  const chains = Array.from(new Set(split.map((x) => x.chain).filter(Boolean)));
  if (names.length === 0 || chains.length !== 1) {
    return venueParts(
      v.venue,
      lanes.map((l) => l.venue),
    );
  }
  const joined =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return { venue: joined, chain: chains[0] };
}

/**
 * The venue as a CARD prints it: `<market> · <this>`.
 *
 * One resolver for every card, because the directory and the portfolio each
 * printed the raw field and a routed record read `2 markets · Multi-venue` on
 * the card that links to the page where the same record reads
 * `Morpho Blue and Aave USDC · Base`. Every record that is not routed falls
 * straight through to the field it has always printed, so nothing else moves.
 */
export function recordVenueLine(v: Parameters<typeof recordVenueParts>[0]): string {
  if (v.venue !== "Multi-venue") return v.venue;
  const { venue, chain } = recordVenueParts(v);
  return `${venue} · ${chain}`;
}

// ── live derivation helpers (all deterministic, slug + clock seeded) ───────

const HOUR_MS = 3600e3;

/**
 * Deterministic continuous wobble in [-0.5, 0.5]: two adjacent seeded draws
 * linearly interpolated by the fraction of the step elapsed, so instrument
 * needles drift smoothly within a session and agree between renders.
 */
function smoothWobble(seedBase: number, ms: number, stepMs: number): number {
  const idx = Math.floor(ms / stepMs);
  const f = (ms - idx * stepMs) / stepMs;
  const a = rand01(seedBase + idx) - 0.5;
  const b = rand01(seedBase + idx + 1) - 0.5;
  return a + (b - a) * f;
}

/**
 * Current modeled leverage: target plus a small seeded intraday wobble (±1.5%).
 *
 * ⚠ THE `?? 3` PHANTOM, LAST OWNER (2026-08-22). This read
 * `v.automations?.leverage?.targetLeverage ?? 3`, so a vault holding NO
 * leverage automation reported 3x on a position that borrows nothing.
 * `deriveAutomations` publishes no envelope unless `applied > 1`, which is
 * exactly the funding-carry shape (`liquidity source + dynamic hedge` at
 * L = 1) and exactly the on-chain-only shape the canvas can now compose —
 * so the literal was not a stale corner, it was the number the two newest
 * products would have reported about themselves.
 *
 * An unlevered vault is at 1.00x, exactly. There is no borrow leg to drift,
 * so the wobble is not applied either: a needle moving on a position that
 * cannot move is the same fabrication one decimal place down. The gauge
 * does not render at all in that state — `AutomationsSection` gates
 * `LeverageInstrument` on `automations.leverage` — which is the point: this
 * returning 1 is the floor under a surface that should not be asking, never
 * a value meant to be printed.
 *
 * `pricing-params.ts:141` fixed the same literal on the canvas side with
 * `PRODUCT_MIN_LEVERAGE`. This was its last owner. Do not restore it.
 *
 * @param lev the envelope the caller is already rendering, when it has one.
 *   `LeverageInstrument` holds `lev` as a prop and used to print the
 *   leverage from a second lookup on the record; passing it closes the gap
 *   in which the printed leverage and the printed liquidation distance
 *   could describe two different positions.
 */
export function currentLeverage(
  v: VaultRecord,
  nowMs = Date.now(),
  lev: LeverageAutomation | null | undefined = v.automations?.leverage,
): number {
  if (!lev) return 1;
  // The attested record prints its stored leverage: the intraday wobble is a
  // modeled illusion, and nothing modeled moves a number on the record whose
  // NAV is read off the journal (docs/plans/LATEST_UI_PORT_SPEC.md E.6).
  if (vaultStage(v) === "attested") return lev.targetLeverage;
  return lev.targetLeverage * (1 + smoothWobble(hashString(v.slug) * 13 + 7, nowMs, HOUR_MS) * 0.03);
}

/** Health factor at a leverage, using the record's published liquidation LTV. */
export function healthFactorAt(lev: LeverageAutomation, leverage: number): number {
  return healthFactorAtLeverage(lev.liqLtv, leverage);
}

/** Current modeled net delta (percent), always inside the hedge band. */
export function currentNetDelta(v: VaultRecord, nowMs = Date.now()): number {
  const band = v.automations?.hedge?.deltaBandPct ?? 0.5;
  return smoothWobble(hashString(v.slug) * 17 + 3, nowMs, 600e3) * band * 1.1;
}

/** Current modeled hedge margin (percent), drifting between trim and restore. */
export function currentHedgeMarginPct(v: VaultRecord, nowMs = Date.now()): number {
  const h = v.automations?.hedge;
  if (!h) return 0;
  const span = h.marginRestorePct - h.marginTrimBelowPct;
  const k = 0.55 + smoothWobble(hashString(v.slug) * 23 + 11, nowMs, 1800e3) * 0.7;
  return h.marginTrimBelowPct + span * Math.min(0.95, Math.max(0.2, k));
}

/**
 * When the harvest rule can actually fire (H7).
 *
 * The compounder is two numbers, not one: a CHECK cadence and a minimum
 * action size. The product used to publish `every 24h` next to a $25
 * threshold on a $25,000 vault, where a day accrues $6.71 at 9.8% — a rule
 * that could not fire on 119 of 129 compounding compositions, while the
 * Activity ledger cheerfully printed compound rows at $6.71 anyway.
 *
 * This states the truth: the check runs on `cadenceHours`, and it ACTS
 * every `checksPerHarvest` checks, which is when accrual clears the
 * threshold. A vault that cannot ever clear it (non-positive modeled rate)
 * reports `fires: false`, and nothing downstream draws a harvest.
 */
export interface HarvestPlan {
  /** How often the check runs. */
  cadenceHours: number;
  /** Minimum accrued yield before the check acts. */
  thresholdUsd: number;
  /** Yield accrued between two checks at this TVL and rate. */
  perCheckUsd: number;
  /** Checks that must pass before accrual clears the threshold (≥ 1). */
  checksPerHarvest: number;
  /** Real interval between harvests, hours. */
  harvestEveryHours: number;
  /** Yield actually swept per harvest (≥ threshold when it fires). */
  perHarvestUsd: number;
  /** False when the rule can never fire: no compounder, or a rate ≤ 0. */
  fires: boolean;
}

export function harvestPlan(v: VaultRecord, tvlUsd?: number): HarvestPlan | null {
  const c = v.automations?.compound;
  if (!c) return null;
  const tvl = tvlUsd ?? v.baseTvlUsd;
  const perCheckUsd = (tvl * v.modeledApy * c.cadenceHours * HOUR_MS) / (365 * DAY_MS);
  if (!(perCheckUsd > 0)) {
    return {
      cadenceHours: c.cadenceHours,
      thresholdUsd: c.thresholdUsd,
      perCheckUsd,
      checksPerHarvest: 0,
      harvestEveryHours: 0,
      perHarvestUsd: 0,
      fires: false,
    };
  }
  const checksPerHarvest = Math.max(1, Math.ceil(c.thresholdUsd / perCheckUsd));
  return {
    cadenceHours: c.cadenceHours,
    thresholdUsd: c.thresholdUsd,
    perCheckUsd,
    checksPerHarvest,
    harvestEveryHours: c.cadenceHours * checksPerHarvest,
    perHarvestUsd: perCheckUsd * checksPerHarvest,
    fires: true,
  };
}

/** Most recent harvest: slug-anchored on the interval the rule really acts on. */
export function lastCompoundMs(v: VaultRecord, nowMs = Date.now()): number {
  const plan = harvestPlan(v);
  const hours = plan?.fires ? plan.harvestEveryHours : (v.automations?.compound?.cadenceHours ?? 24);
  const cadMs = Math.max(HOUR_MS, hours * HOUR_MS);
  const offset = hashString(v.slug + ":cmp") % cadMs;
  const last = Math.floor((nowMs - offset) / cadMs) * cadMs + offset;
  return Math.max(Date.parse(v.createdAt), last);
}

/** Dollars accrued since the last harvest: TVL × rate × elapsed time. */
export function accruedSinceCompound(v: VaultRecord, nowMs = Date.now(), tvlUsd?: number): number {
  const tvl = tvlUsd ?? v.baseTvlUsd;
  const elapsed = Math.max(0, nowMs - lastCompoundMs(v, nowMs));
  return (tvl * v.modeledApy * elapsed) / (365 * DAY_MS);
}

export interface ActionTimes {
  leverage: number;
  hedge: number;
  compound: number;
  nextCompoundCheck: number;
}

/**
 * Deterministic recent action timestamps. Each clock derives from the same
 * anchors the instrument publishes: hedge from its 5-min cadence grid
 * (always within one interval of "now"), leverage from the modeledActivity
 * rebalance period, so the footer and the Activity ledger agree.
 */
export function lastActionTimes(v: VaultRecord, nowMs = Date.now()): ActionTimes {
  const created = Date.parse(v.createdAt);
  const hedGrid = 5 * 60e3;
  const hed = Math.floor(nowMs / hedGrid) * hedGrid - (hashString(v.slug + ":hed") % hedGrid);
  const period = (52 + (hashString(v.slug + ":lp") % 26)) * HOUR_MS;
  const offset = hashString(v.slug + ":lo") % period;
  const lev = Math.floor((nowMs - offset) / period) * period + offset;
  const cmp = lastCompoundMs(v, nowMs);
  const cadMs = (v.automations?.compound?.cadenceHours ?? 24) * HOUR_MS;
  return {
    leverage: Math.max(created, lev),
    hedge: Math.max(created, hed),
    compound: cmp,
    // The next CHECK, on the check cadence — not the next harvest.
    nextCompoundCheck: Math.ceil((nowMs + 1) / cadMs) * cadMs,
  };
}

export interface ActivityRow {
  action: string;
  detail: string;
  ms: number;
  kind: "publish" | "deposit" | "auto";
  mine?: boolean;
}

/**
 * Modeled automation ledger (newest first): compounds on the vault's cadence,
 * leverage rebalances every couple of days, hedge trims where installed, plus
 * the publish row. Deposits merge in at the component from positions.
 */
export function modeledActivity(v: VaultRecord, nowMs = Date.now(), tvlUsd?: number): ActivityRow[] {
  const a = v.automations;
  const created = Date.parse(v.createdAt);
  const tvl = tvlUsd ?? v.baseTvlUsd;
  const rows: ActivityRow[] = [];

  // Harvests are drawn on the interval the rule ACTUALLY acts on, at the
  // amount it actually sweeps (H7), and only when it can fire at all: a
  // vault modelled at or below zero has nothing to re-supply, and printing
  // "−$25.78 re-supplied" was the ledger's share of H3.
  const plan = harvestPlan(v, tvl);
  if (plan?.fires) {
    const stepMs = plan.harvestEveryHours * HOUR_MS;
    let t = lastCompoundMs(v, nowMs);
    for (let k = 0; k < 6 && t > created; k++, t -= stepMs) {
      const amt = plan.perHarvestUsd * (0.85 + rand01(hashString(v.slug + ":ca") + k) * 0.3);
      rows.push({
        action: "Compound executed",
        detail: `${fmtUsdFull(amt)} re-supplied`,
        ms: t,
        kind: "auto",
      });
    }
  }

  if (a?.leverage) {
    const target = a.leverage.targetLeverage;
    const period = (52 + (hashString(v.slug + ":lp") % 26)) * HOUR_MS; // ~2-3 days
    const offset = hashString(v.slug + ":lo") % period;
    let t = Math.floor((nowMs - offset) / period) * period + offset;
    for (let k = 0; k < 4 && t > created; k++, t -= period) {
      const from = target * (1 + (rand01(hashString(v.slug + ":lf") + k) - 0.5) * 0.05);
      rows.push({
        action: "Leverage rebalanced",
        detail: `${from.toFixed(2)}x → ${target.toFixed(2)}x`,
        ms: t,
        kind: "auto",
      });
    }
  }

  if (a?.hedge) {
    const period = (80 + (hashString(v.slug + ":hp") % 40)) * HOUR_MS; // ~3-5 days
    const offset = hashString(v.slug + ":ho") % period;
    let t = Math.floor((nowMs - offset) / period) * period + offset;
    for (let k = 0; k < 3 && t > created; k++, t -= period) {
      rows.push({
        action: "Hedge trimmed",
        detail: `margin restored to ${a.hedge.marginRestorePct}%`,
        ms: t,
        kind: "auto",
      });
    }
  }

  // Family instruments that are not leverage/hedge/compound and used to
  // leave the ledger empty on 54 collar and 104 range compositions (H4).
  const hasModule = (name: string) =>
    v.modules.some((m) => canonicalModuleName(m) === name);

  if (hasModule("Auto center")) {
    const width = v.params.find((p) => /range width|range/i.test(p.label))?.value ?? null;
    const period = (140 + (hashString(v.slug + ":rc") % 100)) * HOUR_MS; // ~6-10 days
    const offset = hashString(v.slug + ":ro") % period;
    let t = Math.floor((nowMs - offset) / period) * period + offset;
    for (let k = 0; k < 3 && t > created; k++, t -= period) {
      rows.push({
        action: "Range recentered",
        detail: width ? `range reset to ${width} of spot` : "range reset around spot",
        ms: t,
        kind: "auto",
      });
    }
  }

  if (hasModule("Covered call")) {
    const strike = v.params.find((p) => /call strike/i.test(p.label))?.value ?? null;
    const rollDays = paramNum(v.params, "roll cadence", "roll") ?? 30;
    const period = rollDays * DAY_MS;
    const offset = hashString(v.slug + ":cc") % period;
    let t = Math.floor((nowMs - offset) / period) * period + offset;
    for (let k = 0; k < 3 && t > created; k++, t -= period) {
      rows.push({
        action: "Call rolled",
        detail: strike ? `written ${strike} above spot` : "written above spot",
        ms: t,
        kind: "auto",
      });
    }
  }

  /* ⚠ THE STAGE OWNS THE DEPOSIT VERB (Wave 2 gate, 2026-08-24). This row is
     the THIRD writer of one sentence, after the stat band and the capacity
     bar, and it sat on the same page as `No capital, no armed automation.`
     `seeded` asserts capital arrived; on an incubating record none did.
     `modeled` is what the number is, and it is the word the chip, the hero
     caption and the publish toast already use. A curated sample is unchanged:
     a sample really is seeded. Pinned in `incubating-deposit-noun.test.ts`. */
  rows.push({
    action: "Vault published",
    detail: `by ${v.curator} · ${fmtUsd(v.baseTvlUsd)} ${
      vaultStage(v) === "incubating" ? "modeled" : vaultStage(v) === "attested" ? "attested" : "seeded"
    }`,
    ms: created,
    kind: "publish",
  });

  return rows.sort((x, y) => y.ms - x.ms);
}

// ── performance series + returns (vault page v3) ───────────────────────────

/**
 * Share-value series over a window of days (undefined = since inception),
 * strided so the point count stays chart-friendly; the last point carries
 * the intraday drift.
 */
export function perfSeries(v: VaultRecord, nowMs = Date.now(), windowDays?: number): number[] {
  const today = dayIndex(nowMs);
  const created = dayIndex(Date.parse(v.createdAt));
  const age = today - created;
  const span = Math.max(0, windowDays === undefined ? age : Math.min(windowDays, age));
  if (span < 1) return [1, shareValueAt(v, nowMs)];
  const stride = Math.max(1, Math.ceil(span / 90));
  const out: number[] = [];
  for (let d = today - span; d < today; d += stride) out.push(shareValueOnDay(v, d));
  out.push(shareValueAt(v, nowMs));
  return out;
}

/** Age of the vault in whole days. */
export function vaultAgeDays(v: VaultRecord, nowMs = Date.now()): number {
  return Math.max(0, dayIndex(nowMs) - dayIndex(Date.parse(v.createdAt)));
}

/**
 * Modeled return over a trailing window (undefined = since inception).
 *
 * Null when the window is longer than the vault has existed (H12). The old
 * version clamped the base to 1.0 before inception, which made a 40-day
 * vault report a 30d return LARGER than its since-inception return — the
 * window silently reached back into time the vault did not have. A window
 * that does not exist has no return, and the surface renders a dash.
 */
export function windowReturn(v: VaultRecord, nowMs = Date.now(), days?: number): number | null {
  const cur = shareValueAt(v, nowMs);
  if (days === undefined) return cur - 1;
  if (days > vaultAgeDays(v, nowMs)) return null;
  const base = shareValueOnDay(v, dayIndex(nowMs) - days);
  return cur / base - 1;
}

/**
 * Position counts that exclude vaults nothing can resolve (H11).
 *
 * /portfolio used to render a card with a working-looking link for a slug
 * that no longer exists, and count it in "3 positions · 3 vaults". A
 * deposit whose vault cannot be resolved is still the user's money, so it
 * is reported — separately, as `unresolved`, never folded into the counts
 * that headline a navigable holding.
 */
export function resolvedPositionCounts(
  rows: readonly PositionRecord[],
  resolve: (slug: string) => VaultRecord | null,
): { positions: number; vaults: number; unresolved: number; unresolvedUsd: number } {
  const vaults = new Set<string>();
  let positions = 0;
  let unresolved = 0;
  let unresolvedUsd = 0;
  for (const p of rows) {
    if (resolve(p.vaultSlug)) {
      positions += 1;
      vaults.add(p.vaultSlug);
    } else {
      unresolved += 1;
      unresolvedUsd += p.amountUsd;
    }
  }
  return { positions, vaults: vaults.size, unresolved, unresolvedUsd };
}

// ── generated overview description (docs voice, no hype) ───────────────────

export function vaultDescription(v: VaultRecord): string {
  const a = v.automations;
  /* THROUGH THE ROUTED OWNER. On a two-venue record `v.venue` is the word
     `Multi-venue`, and the split reads it as the chain too, so this sentence
     said a vault runs "via Multi-venue on Multi-venue" while the panel beside
     it named both venues and Base. */
  const { venue, chain } = recordVenueParts(v);
  const lev = a?.leverage;
  const hedged = Boolean(a?.hedge);
  const cad = a?.compound?.cadenceHours;
  const compoundLine = cad ? ` Earned yield is swept back into the position on a ${cad}h cadence.` : "";
  if (v.strategy === "loop") {
    // ⚠ P0-2, THE SAME PHANTOM ONE SENTENCE OVER (2026-08-22). This read
    // `const t = lev ? fmtLev(lev.targetLeverage) : "target"` and printed
    // "Dynamic leverage holds the position at target" on a vault that
    // installs no leverage automation — a claim about a module that is not
    // there, which is the `?? 3` defect in prose. A lane holding a source
    // and a hedge at L = 1 publishes with `strategy: "loop"`, so this is
    // reachable from the canvas in one publish, not a legacy corner.
    // With no envelope the sentence names what IS installed, and no leverage.
    if (!lev) {
      const hedgeClause = hedged
        ? " A perp hedge shorts the collateral, holding net delta at zero."
        : "";
      return `${v.name} runs on ${v.market} via ${venue} on ${chain}.${hedgeClause}${compoundLine}`;
    }
    // `fmtLev`, not a private 1-dp copy: this sentence printed "3.2x" while
    // the parameter panel two sections down printed "3.25x" for the same dial.
    return (
      `${v.name} runs a leveraged loop on ${v.market} via ${venue} on ${chain}. ` +
      `Dynamic leverage holds the position at ${fmtLev(lev.targetLeverage)} and keeps it inside the published protection envelope` +
      `${hedged ? ", while a perp hedge holds net delta at zero" : ""}.${compoundLine}`
    );
  }
  if (v.strategy === "funding") {
    // Prose takes the venue NOUN (`lib/canvas/labels.ts` venueNoun rule): a
    // rack-published funding record's venue is the chip label "Hyperliquid ·
    // funding", and a chip label interpolated mid-sentence reads as a
    // typographic accident. `venueParts` already isolated the noun above.
    return (
      `${v.name} collects funding on ${v.market} at ${venue}. ` +
      `The basis engine holds spot long against a perp short at equal notional, and margin rules keep the short funded.` +
      compoundLine
    );
  }
  if (v.strategy === "collar") {
    return (
      `${v.name} runs a collar on ${v.market} via ${venue} on ${chain}. ` +
      `Covered calls written above spot fund a protective put below; the net premium is the income and the puts hold the floor.` +
      compoundLine
    );
  }
  return (
    `${v.name} provides concentrated liquidity on ${v.market} at ${venue} on ${chain}. ` +
    `${hedged ? "A perp hedge cancels the price leg, holding net delta at zero. " : ""}` +
    `The range recenters as price walks.${compoundLine}`
  );
}

// ── formatting ─────────────────────────────────────────────────────────────

/**
 * THE usd-magnitude formatter, which is `capacity.ts`'s (single-owner wave,
 * 2026-08-22). This file used to hold a third copy built on `toFixed`, which
 * ROUNDS TO NEAREST — and it fed the directory card, the vault page's stat
 * band and the seeds' "Capacity" param row. Rounding a capacity UP advertises
 * headroom the vault refuses: a $124,999 book printed "$125K" here and "$124K"
 * on the canvas, and only one of those is a bound the model will honour.
 * `fmtCapacityUsd` floors in every magnitude band, so this is now an ALIAS,
 * not a re-implementation that happens to agree.
 *
 * The widening from `(v: number)` to `(v: number | null | undefined)` is
 * deliberate: it is the one formatter that can be handed an absent capacity,
 * and it answers with an em dash rather than "$NaN".
 */
export const fmtUsd = fmtCapacityUsd;

/**
 * Exact dollars, cents kept. The sign is U+2212 and it leads the `$`,
 * mirroring `format.usd`: `toLocaleString`'s own "-$25.78" put an ASCII
 * hyphen in the one register every other signed value prints with the
 * ratified minus. A value that rounds to zero cents carries no sign.
 */
export function fmtUsdFull(v: number): string {
  const body = Math.abs(v).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
  return v < 0 && Number(Math.abs(v).toFixed(2)) !== 0 ? `${MINUS}${body}` : body;
}

/**
 * THE percent formatter, which is `format.ts`'s `pct` (glyph sweep,
 * 2026-08-24). This file held a private `(v * 100).toFixed(dp) + "%"`, which
 * prints an ASCII hyphen on a negative value while every canvas surface
 * prints U+2212 — so one vault page carried "−5.0%" and "-5.0% APR" as two
 * spellings of one sign. An ALIAS, not a re-implementation that happens to
 * agree: the glyph and the signed-zero suppression stay with their one owner.
 */
export const fmtPct = pct;

/**
 * A health factor is a RATIO, and the canvas prints it unitless. The vault
 * page used one formatter for both quantities and produced
 * `1.37x health factor · 3.25x leverage`, which reads as two leverages
 * (H14). Two quantities, two formatters.
 */
export function fmtHf(v: number): string {
  return v.toFixed(2);
}

/** Leverage carries the multiplier suffix. */
export function fmtLev(v: number): string {
  return `${v.toFixed(2)}x`;
}

// ══ THE RECORD, AS THE LAW READS IT ════════════════════════════════════════
//
// `lib/canvas/register.ts` produces the risk register from an `AxisLane` — the
// canvas's own flat lane shape. The vault page holds a published RECORD, not a
// lane, so the register can only reach that page through a projection of the
// record into that shape.
//
// ⚠ THIS IS A PROJECTION, NOT A RECONSTRUCTION, AND THE DIFFERENCE IS THE
// WHOLE POINT. Every field below is a field the record actually published. The
// two the record does NOT publish — `borrowApyMarginal` and `fundingP25Apr` —
// are set to `NaN`, deliberately and not to zero:
//
//   · zero is a MEASUREMENT. `carry(0, 0)` prints `+0.00pp`, which tells a
//     depositor the borrow rate exactly equals the collateral yield on their
//     market. That is the `?? 0` defect this file has already been cleaned of
//     twice, and it would be reintroduced under a measured label.
//   · `NaN` is not a measurement, and every reader in this product guards with
//     `Number.isFinite`. `format.carry` returns null; `hedge-econ` returns
//     null; the register's schema then DROPS both entries rather than printing
//     them. An entry whose field is absent is absent — which is exactly the
//     rule the register runs under everywhere else.
//
// So a record-built register carries the mechanisms the record can prove — the
// pair's cushion, the exit at the published capacity, the short's margin, the
// refills the reserve funds, the venue freeze, the block the quote was pinned
// at — and silently omits the two that need a rate the record never carried.
// The honest fix for those two is a published field, not a cleverer adapter.
//
// ⚠ AND IT WAS THREE (recette 2026-08-27, track 1). `collateralYieldApy` was
// withheld for the same reason and it could not stay withheld, because it is
// not only a term in the carry: it is the ONE question `partyPresent` asks to
// decide whether a lane's asset ISSUER is a party on its route. `NaN` answered
// no on every published record, so the issuer left the derived set and its two
// classes — Stablecoin depeg, Basis widening — could not reach a published
// vault page at all. The remedy this paragraph already prescribed is the one
// that shipped: the record publishes the field. `borrowApyMarginal` sits
// beside it unpublished, so `carry` and `hedge-econ` still return null and no
// entry moved; one more fact, no new sentence.
//
// Returns null before there is anything to say: no automations, or no market.

import type { AxisLane } from "@/lib/canvas/axes";
import type { LaneComposition } from "@/lib/canvas/mock-quote";
import type { ProjectedCandidate, CanvasVenueId } from "@/lib/canvas/opportunities";
/* THE LABEL MAP, AS A VALUE, so the projection below can walk it BACKWARDS.
   A record publishes `venueLabel(id)`, never the id; see `recordVenueId`. */
import { VENUE_LABELS } from "@/lib/canvas/opportunities";
import type { ModuleKey, ParamValue } from "@/lib/canvas/types";
import { armingState, type ArmingState, type RegisterFamily, type RegisterInput } from "@/lib/canvas/register";
import { PRODUCT_MIN_LEVERAGE, type RiskPreset } from "@/lib/canvas/param-schema";
/* THE OVERLAY SET, from the file that DERIVES it (`DISPLAY_ORDER` minus every
   `FAMILY_CHAINS` member) rather than a second hand-typed list here. The edge
   is one-way at runtime: `graph-ops` reaches back for `StrategyKind` only as a
   type, so nothing new is evaluated in a cycle, and the vault page already
   pulls this module through `register → templates → graph-ops`. */
import { OVERLAY_KEYS } from "@/lib/canvas/graph-ops";

/**
 * The record's module names, back to the canvas's own keys. One direction of
 * `MODULE_VOCAB`, which is already the single owner of that spelling.
 *
 * ⚠ TWO KINDS OF BRANCH, AND THE SECOND IS WHY THE OVERLAY WAS MISSED.
 *
 * Four of the seven read an AUTOMATION or the market: those modules seat a
 * running instrument, so the record proves them through a field it publishes
 * (`automations.leverage`, `.hedge`, `.compound`, `market`) and never through
 * a name. Three read the NAME, because a range engine and the two option legs
 * seat no automation entry — the module list is the only place the record
 * states them.
 *
 * An OVERLAY is the second kind and could only ever have been the second kind:
 * nothing passes through it, so there is no automation to look for. It was
 * added as neither, and `lane.placed.includes("exogenous-risk")` was therefore
 * false on every record the product has ever written — which put the
 * declared-blind sentence and `Also installed · Exogenous risk` on one page.
 *
 * The overlays are read from `OVERLAY_KEYS`, which `graph-ops` derives, so a
 * second overlay is carried here for free and a module promoted onto a family
 * chain leaves this loop on the same edit. Appended after the chain keys, the
 * order `DISPLAY_ORDER` already puts them in.
 *
 * Exported because the placed-set question has a SECOND asker (recette
 * 2026-09-01, EXO-D1): the funding producer (`lib/vaults/funding-register.ts`)
 * never projects a lane, so this function is the only author it can ask
 * whether a record seated the overlay. A local re-derivation there would be
 * the two-author drift this function exists to close, one file over.
 */
export function placedKeysOf(v: VaultRecord): ModuleKey[] {
  const keys: ModuleKey[] = [];
  const a = v.automations;
  if (v.market) keys.push("liquidity-source");
  if (a?.leverage) keys.push("safety-buffer");
  if (a?.hedge) keys.push("hedge");
  if (a?.compound) keys.push("auto-compound");
  if (hasModuleName(v, "Auto center")) keys.push("auto-center");
  if (hasModuleName(v, "Covered call")) keys.push("covered-call");
  if (hasModuleName(v, "Protective put")) keys.push("protective-put");
  for (const k of OVERLAY_KEYS) if (hasModuleName(v, MODULE_DEFS[k].name)) keys.push(k);
  return keys;
}

function hasModuleName(v: VaultRecord, name: string): boolean {
  return v.modules.some((m) => canonicalModuleName(m) === name);
}

// ── the armed boolean, ONE owner ───────────────────────────────────────────

/**
 * ⚠ ONE BOOLEAN, ONE OWNER (recette 2026-08-23, I6/I9).
 *
 * /vaults/my-khype-loop-2 printed BOTH `Armed` (the instrument chips) and
 * `Automations compile in shadow / not armed` (the register's amber row) on
 * one page — one boolean asserted from two owners, disagreeing on screen.
 *
 * The truth for a published record: `compile.ts` writes `railsReady: false`
 * unconditionally, no rail runs any published vault, every automation
 * compiles in shadow and nothing is armed. The register row was right; the
 * chips were wrong. Both now read THIS function — the chips through
 * `AutomationsSection`'s `ArmedChip`, the register through
 * `registerInputForVault`/`vaultArmingState` — so the day the launch rail
 * lands, arming flips in one place and every surface follows.
 */
export function railsArmed(_v: VaultRecord): boolean {
  return false;
}

/**
 * The register's blocking state for a RECORD, through the canvas's own
 * `armingState` so the row's words keep one owner. `armingState` reads
 * exactly one field (`railsReady`); the cast hands it the owner's boolean
 * without fabricating the lane a funding record does not hold.
 */
export function vaultArmingState(v: VaultRecord): ArmingState | null {
  return armingState({ railsReady: railsArmed(v) } as unknown as RegisterInput);
}

/**
 * THE VENUE, BACK IN THE VOCABULARY THE DERIVATIONS SPEAK (recette 2026-09-02,
 * DEF-02).
 *
 * A record publishes `venueLabel(id)` — `Morpho Blue · Base`,
 * `Hyperliquid · funding` — because the label is what the review sheet and the
 * vault page print. Every canvas derivation that takes a venue takes the ID:
 * `chainIdForVenue` keys on it, and `exogenous.venueProseNoun` keys on it to
 * decide whether a lane's lending venue and its perp venue are ONE COMPANY.
 * Handed the label, both fall to their fallbacks — so a rack-published funding
 * record derived `Hyperliquid · funding` as its prose noun, that string is not
 * `Hyperliquid`, the fold never fired, and the record would have counted one
 * counterparty twice: the exact double-count `dependenciesOf`'s own gate fix
 * removed from the canvas on 2026-08-27.
 *
 * So the label is inverted, and the inverse is DERIVED from `VENUE_LABELS` —
 * the one owner of that spelling — rather than typed as a second table. A
 * label the map does not name (a seed's `Hyperliquid`, a multi-lane record's
 * `Multi-venue`) passes through unchanged, which is what it did before.
 *
 * It moves no loop sentence: `register.loopEntries` reads the venue through
 * `venueLabel`, and `venueLabel(id)` and `venueLabel(label)` are the same
 * string for every member of the map.
 */
const VENUE_ID_BY_LABEL: ReadonlyMap<string, CanvasVenueId> = new Map(
  (Object.entries(VENUE_LABELS) as [CanvasVenueId, string][]).map(([id, label]) => [label, id]),
);

export function recordVenueId(v: Pick<VaultRecord, "venue">): string {
  const raw = typeof v.venue === "string" ? v.venue.trim() : "";
  return VENUE_ID_BY_LABEL.get(raw) ?? raw;
}

/** The register family a record's own strategy names. `funding` maps to
 *  `loop` exactly as the block below describes; one derivation, two callers. */
function registerFamilyOf(v: VaultRecord): RegisterFamily {
  return v.strategy === "dnlp" ? "dnlp" : v.strategy === "collar" ? "collar" : "loop";
}

/**
 * THE LANE A FUNDING RECORD CAN PROVE — for the DEPENDENCY DERIVATION ONLY
 * (recette 2026-09-02, DEF-02).
 *
 * `registerInputForVault` refuses a funding record, and that refusal is right:
 * projected as a collateral/debt lane it produced three false MECHANISMS. But
 * the refusal was read as "a funding record holds no lane", and the exogenous
 * derivation was denied along with the mechanisms — so a funding record that
 * seated the watcher published a module list saying it watches the parties
 * this lane depends on, and a register with no party in it and not even the
 * constant sentence the watcher replaces. That is `exogenous.ts` charter rule
 * 3 broken on the artifact a depositor keeps.
 *
 * The two refusals are not the same refusal. Every loop mechanism is a
 * sentence about a collateral asset and the asset it is measured against;
 * `dependenciesOf` asks NONE of those questions. It asks who holds the
 * capital, what rails a dollar crosses, whether the held asset pays a yield it
 * does not mint, and whether a debt leg exists at all — and it answers the
 * last one NO on a funding record by its own predicate (`partyPresent`
 * requires `lt !== null && debtSymbol`), which is why the price feed drops out
 * rather than being fabricated.
 *
 * So this export is the SAME projection, minus the pair gate, and the caller
 * that takes it (`lib/vaults/funding-register.ts`) runs only
 * `exogenousEntries` over it. One author for the candidate every published
 * record projects, so the loop path and the funding path cannot form two
 * opinions about one record's parties.
 */
export function exogenousInputForVault(v: VaultRecord): RegisterInput | null {
  return laneInputForVault(v, registerFamilyOf(v));
}

export function registerInputForVault(v: VaultRecord): RegisterInput | null {
  const a = v.automations;
  if (!a) return null;
  /* ⚠ THE PROJECTION REQUIRES A COLLATERAL/DEBT PAIR, and that is a
     STRUCTURAL gate rather than a strategy-name check.
     ------------------------------------------------------------------------
     All three rack families hold a pair — a collateral asset and the asset it
     is measured against — and every register mechanism written for them is a
     sentence about that pair: what gaps against what, whose market freezes,
     what the short hedges. A FUNDING lane holds no such pair: its market is
     the perp itself (`ETH-USD`), the venue is the perp venue, and there is no
     lending market to freeze. Projected as a loop it produced three false
     mechanisms — `Hyperliquid freezing the ETH-USD market` among them — on
     three of seven seeded vaults.

     The ledger already ruled that a funding lane is a different lane class
     that prints LESS, and that the quantities it may state are the short's
     margin ratio and the guard floor and nothing else until the scan emits
     `maxLeverage`. So the honest answer is not a cleverer mapping, it is a
     funding producer — and one now exists: `lib/vaults/funding-register.ts`
     builds the funding-class register straight from the record (recette
     2026-08-23, I4/I8), and the vault page's register renders it in place of
     this projection. THIS function still returns null for a funding record,
     deliberately: projecting a perp market into a collateral/debt lane would
     reintroduce the three false mechanisms the gate exists to refuse.

     ── S2 WAVE 2 SEAM, 2026-08-24: THE GATE IS PER FAMILY, NOT PER SLASH ──
     The gate above is right about the LOOP and DNLP producers, whose every
     sentence is about a collateral asset and the asset it is measured
     against. It was wrong about the COLLAR producer, which reads `c.pair` and
     nothing else — no `collateralSymbol`, no `debtSymbol`, not once — because
     a collar's sentences are about a strike, a floor and a roll.

     `COLLAR_CANDIDATE.pair` is `DAO token`, a display noun with no slash, so
     a user publishing `?template=treasury-collar` published a record that
     tripped a gate written for a different family: `registerInputForVault`
     returned null, `AutomationsSection` returns null on an empty entry list,
     and the ENTIRE "What would have to break" section left the page. Measured
     by C4: 0 entries on the display label, 5 on a pair. C4's seed sidesteps it
     by publishing the row's own `DAO/USDC`; a user's collar could not.

     So the family is resolved FIRST and the pair requirement is asked of the
     families that actually have one. A collar with no slash keeps two empty
     symbols, which is honest — it has no borrow leg to name — and no producer
     reads them. Nothing else moves: loop and dnlp still refuse, and FUNDING
     never reaches this function at all (`AutomationsSection` routes it to
     `fundingRegisterFor` by strategy, one line above its call to this).

     ── DEF-02, 2026-09-02: THE FUNDING REFUSAL IS NOW WRITTEN, NOT INFERRED ──
     It was carried by the pair gate alone — a funding record's market is
     `stLINK` or `ETH-USD` and neither holds a slash — so the ruling in this
     block was true by a coincidence of naming rather than by a line of code.
     It is stated below, on the record's own `strategy`, because the same
     projection now has a SECOND caller that must NOT inherit this refusal
     (`exogenousInputForVault`, for the dependency derivation only), and a
     refusal that lives in a shared body would have reached it too. */
  const family = registerFamilyOf(v);
  const [gateCollateral = "", gateDebt = ""] = v.market.split("/");
  if (family !== "collar" && (!gateCollateral || !gateDebt)) return null;
  if (v.strategy === "funding") return null;
  return laneInputForVault(v, family);
}

/**
 * THE PROJECTION ITSELF, with no gate on it — the one author of the candidate
 * every published record projects (recette 2026-09-02, DEF-02).
 *
 * `registerInputForVault` above owns WHETHER a record may be projected into a
 * lane the MECHANISM producers read; this owns WHAT that lane is. They were
 * one function, and the exogenous derivation — which reads none of the fields
 * the gate protects — could only be reached through the gate, so the funding
 * class was silently outside it. Splitting them changes nothing a loop record
 * publishes: the gate still runs first, and its callers still get null in
 * exactly the cases they got null in before.
 */
function laneInputForVault(v: VaultRecord, family: RegisterFamily): RegisterInput | null {
  const a = v.automations;
  if (!a) return null;
  const [collateralSymbol = "", debtSymbol = ""] = v.market.split("/");

  /* NO LEVERAGE AUTOMATION MEANS NO BORROW LEG, and that is a fact about the
     record rather than a missing field — so it is written as a branch, not as
     a `??` fallback. The shape matters: `unlevered-vault.test.ts` greps this
     file for `leverage?.targetLeverage ??` precisely because that shape is
     where the `?? 3` phantom lived, and a correct value in the wrong shape
     would defeat a gate that exists to catch the wrong value. */
  const lev = a.leverage;
  const appliedLeverage = lev ? lev.targetLeverage : PRODUCT_MIN_LEVERAGE;
  const hedge = a.hedge;
  const comp: LaneComposition = {
    hedge:
      hedge && typeof hedge.leverage === "number" && typeof hedge.reserveFraction === "number"
        ? { hedgeLeverage: hedge.leverage, reserveFraction: hedge.reserveFraction }
        : null,
    compound: a.compound
      ? {
          cadence: `${a.compound.cadenceHours}h` as LaneComposition["compound"] extends null
            ? never
            : NonNullable<LaneComposition["compound"]>["cadence"],
          minActionUsd: a.compound.thresholdUsd,
        }
      : null,
  };

  const candidate: ProjectedCandidate = {
    id: v.slug,
    /* THE ID, RECOVERED FROM THE PUBLISHED LABEL. See `recordVenueId`: the
       record prints `Morpho Blue · Base`, every canvas derivation keys on
       `morpho-blue-base`, and `venueLabel` maps both to the same string — so
       no sentence moves and two derivations that were falling to their
       fallbacks now resolve. */
    venue: recordVenueId(v) as CanvasVenueId,
    cls: hedge ? "A" : "N1",
    pair: v.market,
    collateralSymbol,
    debtSymbol,
    hlCoin: hedge?.coin ?? null,
    eligible: true,
    eligibleWithRewards: null,
    lt: lev && !lev.liqLtvInferred ? lev.liqLtv : null,
    headlineApr: v.modeledApy,
    score: null,
    scoreN1: null,
    apyRiskAdj: null,
    economics: {
      netApyOnDepositApy: v.modeledApy,
      netCarryOnEquityApy: v.modeledApy,
      loopLeverage: appliedLeverage,
      targetLtv: 0,
      /* ⚠ NOT ZERO. `$0 capacity` is a measurement — it tells a depositor the
         vault can absorb nothing — and it is exactly what a record published
         before the capacity field existed would have produced. `NaN` is not a
         measurement, `laneCapacityUsd` guards with `Number.isFinite`, and the
         exit entry then drops rather than printing an invented floor. */
      capacityUsd: typeof v.capacityUsd === "number" ? v.capacityUsd : Number.NaN,
      capacityBinding: v.capacityBinding ?? v.capacityBindingLabel ?? "",
      // ⚠ See the block comment above. Absent, never zero.
      fundingP25Apr: Number.NaN,
      /* PUBLISHED SINCE 2026-08-27, and `NaN` where a record predates it or
         declines it — which is the same three-state rule every other field on
         this projection follows, and the reason the issuer row is derived
         rather than defaulted on. */
      collateralYieldApy:
        typeof v.collateralYieldApy === "number" ? v.collateralYieldApy : Number.NaN,
      borrowApyMarginal: Number.NaN,
    },
    /* THE RECORD DOES NOT PUBLISH A FIRST FAILING GATE, and nothing on this
       path asks for one: `firstFailedGate` feeds the browse list's absence
       word, never the register. Guessing `failedGates[0]` here would mint a
       fourth spelling of an ordering the scan owns. */
    firstFailedGate: null,
    /* ⚠ THE SCAN EVIDENCE THE RECORD FROZE (recette 2026-08-27, track 1).
       `dependenciesOf` promotes a party to `measured` only where a CLASS of it
       names a gate the scan actually ran, and it asks two questions to decide:
       `gatesTotal > 0` (was this row scanned at all) and `failedGates` (what
       did it read). Zeroed, both answers are "never scanned", so every party
       on a published record came back `blind` — the rows would render and
       their evidence would not, which is the same downgrade as dropping them
       in a quieter costume. The record now carries what it read at
       `blockNumber`, and a record written before this wave still answers
       "never scanned", which for it is true. */
    failedGates: Array.isArray(v.failedGates) ? [...v.failedGates] : [],
    /* EXACT ARITHMETIC ON TWO PUBLISHED FIELDS, not a third measurement:
       `opportunities.ts` builds `gatesPassed` as the gates that passed and
       `failedGates` as every gate that did not, over one list, so total minus
       failed IS passed. `max(0, …)` keeps a pre-wave record's zeros at zero
       rather than going negative. */
    gatesPassed: Math.max(
      0,
      (typeof v.gatesTotal === "number" ? v.gatesTotal : 0) -
        (Array.isArray(v.failedGates) ? v.failedGates.length : 0),
    ),
    gatesTotal: typeof v.gatesTotal === "number" ? v.gatesTotal : 0,
    launchable: false,
  };

  /* THE FAMILY COMES FROM THE RECORD, never from the projected candidate.
     `register.familyOf` reads `handAuthoredTerms`, which only the two template
     rows carry, so a projection would answer "loop" for every published vault
     — and a delta-neutral LP would render a pair gap and a lending freeze on a
     position that borrows nothing. `funding` maps to `loop`: a funding-carry
     lane is a hedged carry with no borrow leg, which is exactly the shape the
     loop producers already handle by asking whether a borrow leg exists.

     S2 2026-08-24: this derivation is unchanged, but it is now taken at the
     TOP of the function, because the pair gate above asks it. One `family`,
     one place, read twice. */

  /* THE DIALS THE RECORD PUBLISHED, in the canvas's own param vocabulary, so
     the family producers read the SETTINGS a depositor's vault is running
     rather than a descriptor default. Absent rows stay absent: an axis that
     cannot read drops its entry, which is the register's rule everywhere. */
  const params: Partial<Record<ModuleKey, Record<string, ParamValue>>> = {};
  const rangePct = paramNum(v.params, "range width", "range");
  const recenterPct = paramNum(v.params, "recenter trigger", "recenter");
  if (rangePct !== null || recenterPct !== null) {
    params["auto-center"] = {
      ...(rangePct !== null ? { rangePct: String(Math.abs(rangePct)) } : {}),
      ...(recenterPct !== null ? { recenterTriggerPct: String(Math.abs(recenterPct)) } : {}),
    };
  }
  const strikePct = paramNum(v.params, "call strike", "strike");
  const rollDays = paramNum(v.params, "roll cadence", "roll");
  if (strikePct !== null || rollDays !== null) {
    params["covered-call"] = {
      ...(strikePct !== null ? { strikePct: String(Math.abs(strikePct)) } : {}),
      ...(rollDays !== null ? { rollDays: String(Math.abs(rollDays)) } : {}),
    };
  }
  const floorPct = paramNum(v.params, "put floor", "floor");
  if (floorPct !== null) params["protective-put"] = { floorPct: String(Math.abs(floorPct)) };
  if (hedge) {
    params.hedge = {
      ...(typeof hedge.leverage === "number" ? { hedgeLeverage: hedge.leverage } : {}),
      ...(typeof hedge.reserveFraction === "number"
        ? { reserveFraction: hedge.reserveFraction }
        : {}),
      ...(typeof hedge.fundingFloorApr === "number"
        ? { fundingFloorApr: hedge.fundingFloorApr }
        : {}),
    };
  }
  /* THE LINE THE BUILDER MOVED, carried whole (recette 2026-08-27, track 1).
     The overlay's stop decides WHICH parties carry a written response, and its
     six holds move one party each across that line. Absent, `postureOf` lands
     on the descriptor default and a record whose builder answered all six
     parties would publish a register answering two — the canvas and the
     artifact disagreeing about a count both of them print. Handed over
     verbatim rather than re-derived, because both readers already refuse an
     invalid value: this is a copy, not a second opinion. */
  if (v.exogenousParams && typeof v.exogenousParams === "object") {
    params["exogenous-risk"] = { ...v.exogenousParams };
  }

  const lane: AxisLane = {
    candidate,
    placed: placedKeysOf(v),
    params,
    comp,
    appliedLeverage,
    /* The record publishes BANDS, not the preset that produced them, so the
       preset is stated as the schema's own default rather than reverse-derived
       from a spread. Nothing on this path reads it: the register takes the
       trim drift from the record (`trimDrift` below), so the bands stay the
       published truth and a re-derivation from a guessed preset cannot become
       a second owner. */
    preset: "standard" as RiskPreset,
    tvlUsd: v.baseTvlUsd,
    /* P-H3: the record's frozen capacity, printed verbatim by the capacity
       axis. The pseudo-candidate's rates invert wrongly under statedFb, so
       letting `laneCapacityUsd` run over it re-converted the stored figure
       (x1.1125 on an HL-bound hedged record). The record owns its number. */
    storedCapacityUsd: typeof v.capacityUsd === "number" ? v.capacityUsd : null,
  };

  return {
    lane,
    family,
    blockNumber: typeof v.blockNumber === "number" ? v.blockNumber : null,
    /* ONE DERIVATION OF THE TRIM DRIFT PER PAGE (G7 nit, 2026-08-24). The
       register used to derive its "We trim X.XXpp before it" from the preset
       over UNROUNDED bands while the Parameters foot and the risk row print
       `deleverageDrift` over the record's published (bps-rounded) bands —
       steady-eth-loop printed 3.66pp beside 3.65pp for one quantity. The
       record is the owner: the register now reads the same derivation every
       other surface on this page prints. Null where the record cannot prove
       it (no envelope, inferred threshold, bands that do not close), and the
       register then states no drift rather than a fabricated one. */
    trimDrift: a.leverage ? deleverageDrift(a.leverage) : null,
    /* No rail runs any published vault yet: `compile.ts` writes
       `railsReady: false` unconditionally, and the register's blocking state
       is the loudest thing on this page while that is true. Read through
       `railsArmed`, the boolean's one owner, so this and the instrument
       chips cannot disagree again (recette 2026-08-23, I6). */
    railsReady: railsArmed(v),
    cadence: {
      leverage: a.leverage?.cadence ?? null,
      hedge: hedge?.cadence ?? null,
      compound: a.compound ? `${a.compound.cadenceHours}h` : null,
    },
  };
}
