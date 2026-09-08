/**
 * Sample vaults for the /vaults directory.
 *
 * NOTHING HERE IS HAND-AUTHORED (H5).
 *
 * Every seed used to carry a typed-in APY. `kHYPE Boost Loop 18.6%` sat five
 * rows above a user's honest 8.8% on the identical market, venue and module
 * set, inside one sorted grid; `Steady ETH Loop 9.8%` sat next to a live
 * 5.1%. The directory was arguing with itself, and the fabricated number
 * always won because it was bigger.
 *
 * So a seed is now a COMPOSITION, not a number. Each one names a real
 * catalog row (the committed scanner snapshots under lib/canvas/fixtures) or
 * a real modeled template, and its APY, capacity, liquidation threshold and
 * health bands are computed at module load by the same functions the canvas
 * prices with:
 *
 *   loop / dn-lp   repriceAtLeverage → publishedNetApy  (lib/canvas/mock-quote)
 *   funding        laneEconomics                        (lib/canvas/funding-demo)
 *   bands          clampLeverage + deriveHfBands        (lib/canvas/param-schema)
 *   automations    deriveAutomations                    (./store)
 *   the house fee  composedTerms.published / laneEconomics.publishedApr
 *
 * AND AT THE RECORD'S OWN DIALS (frozen-record migration, founder-approved
 * 2026-09-01). The composed-path seeds used to price bookless AND dial-less:
 * `publishedNetApy(priced, hedged)` with no composition, which charged the
 * hedged loops the flat calibration drag (`execDragFor` with no hedge module
 * resolves to the scanner's constant) and priced the auto-compound module the
 * record itself installs at exactly zero — while the record stored the hedge
 * and compound dials beside that number. Same defect class QNT-2 measured on
 * the flagship user record (stored band 4, priced at band 0.5), one register
 * over. Every composed seed now prices through `seedComposition(...)` — its
 * own stored dials — so `reconcileSeedRecords()` can replay any seed record
 * from its stored fields and land on its `modeledApy` to 6 decimals, the same
 * acceptance the localStorage migration in ./store.ts is held to.
 *
 * A sample is a RECORD, so its headline carries the 20% compute fee the docs
 * publish, exactly once. See the `SEED_PRICING` docblock for which path picks
 * the fee up where.
 *
 * A seed therefore cannot differ from its own market's composed value: it IS
 * that value. `assertSeedApyParity()` re-checks it against a 1pp tolerance
 * for anything that runs at build or test time, and a seed whose market has
 * gone missing from the catalog drops out of the directory entirely rather
 * than rendering a number nobody can source (see SEED_SOURCING_NOTES).
 *
 * Register: every seed carries `register: "sample"`. They are Priime-authored
 * demonstrations, and the directory says so.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/prefer-regexp-exec --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import snapAave from "@/lib/canvas/fixtures/aave-v3-base.json";
import snapFunding from "@/lib/canvas/fixtures/hyperliquid-funding.json";
import snapMorphoBase from "@/lib/canvas/fixtures/morpho-blue-base.json";
import snapMorphoEth from "@/lib/canvas/fixtures/morpho-blue-ethereum.json";
import snapHyper from "@/lib/canvas/fixtures/morpho-blue-hyperevm.json";
import { capacityBindingSentence } from "@/lib/canvas/capacity";
import { MINUS } from "@/lib/canvas/format";
import { laneEconomics, type FundingLane, FUNDING_LANE_DEFAULTS } from "@/lib/canvas/funding-demo";
import { APPLIED_LEVERAGE_LABEL, NO_BORROW_BANDS_VALUE } from "@/lib/canvas/labels";
import {
  composedTerms,
  laneDeltaBandPct,
  publishedNetApy,
  repriceAtLeverage,
  type LaneComposition,
} from "@/lib/canvas/mock-quote";
import { MODULE_DEFS } from "@/lib/canvas/modules";
import {
  projectVenueDocV2,
  VENUE_LABELS,
  type CanvasVenueId,
  type ProjectedCandidate,
} from "@/lib/canvas/opportunities";
import {
  clampLeverage,
  deriveHfBands,
  deriveHlMarginBands,
  HF_TARGET_CAP_BPS,
  PRODUCT_MIN_LEVERAGE,
} from "@/lib/canvas/param-schema";
import { perpBookIndex, readingFor } from "@/lib/canvas/perp-books";
import {
  COLLAR_CANDIDATE,
  COLLAR_DEFAULT_DIALS,
  collarForfeit,
  collarForfeitValue,
  DN_LP_CANDIDATE,
  STRUCTURAL_MODULES,
} from "@/lib/canvas/templates";
import type { ModuleKey } from "@/lib/canvas/types";
import { HL_LEVERAGE } from "@/lib/model-constants";
import { HERO_SEED_LEVERAGE } from "@/lib/demo/market";
import { HERO_SLUG } from "@/lib/demo-scope";
import type { VenueDocV2 } from "@/lib/strategy-factory/venues/types";
import {
  deriveAutomations,
  hfFromBps,
  fmtLev,
  fmtPct,
  fmtUsd,
  moduleDepositorLine,
  type VaultRecord,
} from "./store";
import { heroRecord, heroSource } from "./hero";

/** Why a seed is missing, if one is. Surfaced in dev, never fabricated over. */
export const SEED_SOURCING_NOTES: string[] = [];

// ── catalog sourcing ───────────────────────────────────────────────────────

interface RawEconomics {
  ltUsed?: number;
  loopLeverage: number;
  targetLtv: number;
  collateralYieldApy: number;
  borrowApyMarginal: number;
  fundingP25Apr: number | null;
  netApyOnDepositApy: number;
  netCarryOnEquityApy: number;
  capacityUsd: number;
  capacityBinding: string;
}

interface RawCandidate {
  id: string;
  cls: string;
  collateral?: { symbol?: string };
  debt?: { symbol?: string };
  hlCoin?: string | null;
  economics?: RawEconomics | null;
  gates?: { gate: string; detail?: string }[];
}

interface RawDoc {
  chainId?: number;
  blockNumber?: number;
  candidates: RawCandidate[];
}

interface SourcedRow {
  row: ProjectedCandidate;
  chainId: number;
  blockNumber: number;
  /** HL max leverage for the hedge coin, read off the scan's own gate. */
  coinMaxLeverage: number | null;
}

/**
 * Lift one committed scanner row into the client catalog shape the pricing
 * functions take. Field-for-field, no invention: `lt` is the scan's own
 * `ltUsed`, the perp's max leverage comes out of the `native_perp` gate the
 * scan wrote, and a row that is not in the document returns null.
 */
function sourceRow(doc: RawDoc, idFragment: string, venue: CanvasVenueId, pair: string): SourcedRow | null {
  const raw = doc.candidates.find((c) => c.id.includes(idFragment));
  if (!raw?.economics) return null;
  const e = raw.economics;
  const lt = typeof e.ltUsed === "number" ? e.ltUsed : null;
  if (lt === null) return null;
  const perpGate = raw.gates?.find((g) => g.gate === "native_perp")?.detail ?? "";
  const maxLev = perpGate.match(/maxLev=(\d+)/)?.[1];
  return {
    chainId: doc.chainId ?? 0,
    blockNumber: doc.blockNumber ?? 0,
    coinMaxLeverage: maxLev ? Number.parseInt(maxLev, 10) : null,
    row: {
      id: raw.id,
      venue,
      cls: raw.cls === "N1" ? "N1" : "A",
      pair,
      collateralSymbol: raw.collateral?.symbol ?? pair.split("/")[0] ?? "",
      debtSymbol: raw.debt?.symbol ?? pair.split("/")[1] ?? "",
      hlCoin: raw.hlCoin ?? null,
      eligible: true,
      eligibleWithRewards: null,
      lt,
      headlineApr: e.netApyOnDepositApy,
      score: null,
      scoreN1: null,
      apyRiskAdj: null,
      economics: {
        netApyOnDepositApy: e.netApyOnDepositApy,
        netCarryOnEquityApy: e.netCarryOnEquityApy,
        loopLeverage: e.loopLeverage,
        targetLtv: e.targetLtv,
        capacityUsd: e.capacityUsd,
        capacityBinding: e.capacityBinding,
        fundingP25Apr: e.fundingP25Apr,
        collateralYieldApy: e.collateralYieldApy,
        borrowApyMarginal: e.borrowApyMarginal,
      },
      firstFailedGate: null,
      failedGates: [],
      gatesPassed: 0,
      gatesTotal: 0,
      launchable: false,
    },
  };
}

/**
 * The committed funding scan's own deposit room for one coin's book, in the
 * scan's stored F_B denomination (`capacity.ts` stores HL bounds divided by
 * F_B, so this figure never exceeds the room at any composed escrow share).
 * The MEASURED base a funding seed's TVL sizes against — see the sizing note
 * in `buildFundingSeed`. Null when the committed scan did not price the book.
 */
function measuredBookRoomUsd(coin: string): number | null {
  const doc = snapFunding as unknown as RawDoc;
  const cap = doc.candidates.find((c) => c.hlCoin === coin)?.economics?.capacityUsd;
  return typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? cap : null;
}

/**
 * THE COMMITTED BOOK INDEX (cleanup 2026-08-24, quant cross-owner finding).
 *
 * `buildFundingSeed` and `assertSeedApyParity` called `laneEconomics(lane)`
 * with NO books, so the three funding seeds' `modeledApy` priced from the
 * FUNDING_VENUES hand table — dated 2026-08-19 and declared DEAD FOR PRICING
 * at funding-demo.ts's own docblock — with the spot leg credited 0, compound
 * 0, and the parity assert vacuous (both sides bookless). Measured against
 * the committed scan: basis-desk-one recorded 0.583% where the book-priced
 * figure is 1.88%, and btc-carry-collector's SIGN disagreed with the
 * committed register.
 *
 * This is the same index the funding canvas builds live
 * (`perpBookIndex(d.venues)`), from the committed fixture docs the seed
 * roster already sources — every V2 doc, so the ratified tightest-bound rule
 * sweeps the same books the canvas sweeps. Each doc projects at its own
 * `generatedAtMs`, exactly as the scanner wrote it.
 */
const SEED_BOOKS = perpBookIndex(
  [snapMorphoBase, snapMorphoEth, snapHyper, snapAave, snapFunding].map((d) =>
    projectVenueDocV2(
      d as unknown as VenueDocV2,
      (d as { generatedAtMs?: number }).generatedAtMs ?? 0,
    ),
  ),
);

// ── param-row formatting (one formatter, used by every seed) ───────────────

const CHAIN_NAMES: Record<number, string> = { 8453: "Base", 999: "HyperEVM" };

/**
 * The printed band, straight off the PUBLISHED bps.
 *
 * ⚠ ONE ROUNDING (Wave 1, B4). This took three decimals — `bps / 1e4` — and
 * ran them through `fmtHf`, which is a `toFixed(2)` on a float. 12550 bps is
 * exactly 1.26, but `(12550 / 1e4).toFixed(2)` is "1.25", because 1.255 is
 * stored as 1.25499999999999989. The canvas that published the band rounds
 * from the integer, so a seed and the rack it was priced by printed two
 * spellings of one number. `hfFromBps` is the single owner of that rounding.
 */
function bandsRow(targetBps: number, deleverageBps: number, floorBps: number): string {
  return `${hfFromBps(targetBps)} target · ${hfFromBps(deleverageBps)} deleverage · ${hfFromBps(floorBps)} floor`;
}

/**
 * True when this record has no borrow leg to trim, so a health-factor band
 * would be a sentinel dressed as a measurement.
 *
 * `hfTargetBpsFor` returns `HF_TARGET_CAP_BPS` (100,000 bps = a health factor
 * of 10.00) for anything at or below `PRODUCT_MIN_LEVERAGE`: it is the cap
 * that lets an unlevered position be REACHED, not a target anybody set. A
 * record printing "10.00 target" is stating a threshold the market never
 * offered. Same rule the canvas emitter uses, so a seeded record and a
 * user-published one say the same thing about the same shape.
 */
function unleveredRecord(r: Partial<VaultRecord>): boolean {
  if (r.hfTargetBps === HF_TARGET_CAP_BPS) return true;
  return typeof r.appliedLeverage === "number" && r.appliedLeverage <= PRODUCT_MIN_LEVERAGE;
}

/** The one honest row a vault with no borrow leg carries in place of a band. */
export const NO_BORROW_BAND_ROW = { label: "Health bands", value: NO_BORROW_BANDS_VALUE } as const;

/**
 * Build the published param table from the record's own fields, so a row in
 * the table and the field a surface reads are the same number by
 * construction. Rows whose field is absent are omitted, never defaulted.
 *
 * Exported so the band suppression can be pinned directly rather than
 * inferred from a rendered seed.
 */
export function seedParamRows(
  r: Partial<VaultRecord> & { extra?: { label: string; value: string }[] },
) {
  const out: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null) => {
    if (value !== null) out.push({ label, value });
  };
  if (typeof r.appliedLeverage === "number")
    push(APPLIED_LEVERAGE_LABEL, fmtLev(r.appliedLeverage));
  if (typeof r.liqLtv === "number") push("Liquidation LTV", fmtPct(r.liqLtv));
  if (unleveredRecord(r)) {
    push(NO_BORROW_BAND_ROW.label, NO_BORROW_BAND_ROW.value);
  } else if (
    typeof r.hfTargetBps === "number" &&
    typeof r.hfDeleverageBps === "number" &&
    typeof r.hfFloorBps === "number"
  ) {
    push("Health bands", bandsRow(r.hfTargetBps, r.hfDeleverageBps, r.hfFloorBps));
  }
  for (const row of r.extra ?? []) out.push(row);
  if (typeof r.hedgeLeverage === "number") push("Hedge leverage", fmtLev(r.hedgeLeverage));
  if (typeof r.reserveFraction === "number")
    push("Margin reserve", `${fmtPct(r.reserveFraction, 0)} of short notional`);
  if (typeof r.marginTrimPct === "number" && typeof r.marginRestorePct === "number")
    push("Margin rule", `${r.marginTrimPct}% → ${r.marginRestorePct}%`);
  if (typeof r.hlCoin === "string" && r.hlCoin) push("Hedge coin", `${r.hlCoin} perp`);
  if (typeof r.fundingFloorApr === "number") push("Funding floor", `${fmtPct(r.fundingFloorApr)} APR`);
  if (typeof r.thresholdUsd === "number") push("Harvest threshold", `$${r.thresholdUsd}`);
  if (typeof r.compoundCadenceHours === "number")
    push("Compound cadence", `${r.compoundCadenceHours}h`);
  if (typeof r.capacityUsd === "number") push("Capacity", fmtUsd(r.capacityUsd));
  if (typeof r.capacityBindingLabel === "string") push("Capacity binding", r.capacityBindingLabel);
  if (typeof r.chainId === "number" && typeof r.blockNumber === "number" && r.blockNumber > 0) {
    push(
      "Read at",
      `${CHAIN_NAMES[r.chainId] ?? `chain ${r.chainId}`} · block ${r.blockNumber.toLocaleString("en-US")}`,
    );
  }
  return out;
}

/** Module list → depositor lines, straight from the one vocabulary (G4). */
function lines(modules: string[]): { name: string; line: string }[] {
  return modules.map((name) => ({ name, line: moduleDepositorLine(name) ?? "" }));
}

/** Plausible depositor count for a TVL, at a stated average ticket. */
function depositorsFor(tvlUsd: number, avgTicketUsd: number): number {
  return Math.max(1, Math.round(tvlUsd / avgTicketUsd));
}

const HEDGE_RESERVE_DEFAULT = (() => {
  const p = MODULE_DEFS.hedge.params.find((x) => x.field === "reserveFraction");
  return typeof p?.default === "number" ? p.default : 0.1;
})();

const HARVEST_THRESHOLD_DEFAULT = (() => {
  const p = MODULE_DEFS["auto-compound"].params.find((x) => x.field === "minActionUsd");
  return typeof p?.default === "number" ? p.default : 25;
})();

/**
 * The composition a composed-path seed prices at: its own two hedge dials
 * (when hedged) and its own compound dials — exactly the values the record
 * stores. ONE derivation, read by the builders, by `assertSeedApyParity`'s
 * re-derivation and by nothing else, so the build and the check cannot price
 * two compositions (frozen-record migration, 2026-09-01).
 */
function seedComposition(hedged: boolean, compoundCadenceHours: number): LaneComposition {
  return {
    hedge: hedged
      ? { hedgeLeverage: HL_LEVERAGE, reserveFraction: HEDGE_RESERVE_DEFAULT }
      : null,
    compound: {
      cadence: `${compoundCadenceHours}h` as "6h" | "24h" | "72h",
      minActionUsd: HARVEST_THRESHOLD_DEFAULT,
    },
  };
}

// ── the fee, and where each seed picks it up (R1) ──────────────────────────

/**
 * A SAMPLE IS A RECORD, SO IT CARRIES THE HOUSE FEE (Wave 1, R1).
 *
 * `Compute fee: 20% of yield, charged at harvest` is published on
 * priime.finance/docs, and the same page promises the fee appears as a term
 * in every record's itemization. A directory of Priime-authored samples
 * printing a fee-free APY beside a user's fee-bearing one is the same defect
 * the hand-typed seed APYs were: two numbers for one quantity, and the
 * flattering one wins because it is bigger.
 *
 * The fee has ONE owner, `lib/canvas/fees.ts`. Where a seed picks it up
 * depends on which model priced it, and each path takes it exactly once:
 *
 *   loop, dn-lp   `publishedNetApy` → `composedTerms.published`, which applies
 *                 the fee between the core reading and the compound delta.
 *                 Nothing to do here; applying it again would charge 36%.
 *                 ⚠ `composedNetApy` is the VENUE fact and is deliberately
 *                 fee-free — a seed reading it publishes a market number under
 *                 a product label, which is the whole defect R1 closes.
 *   funding       `laneEconomics` is the VENUE model — the funding leg, the
 *                 spot leg, the execution drag and the guard. It knows
 *                 nothing about house fees and must not, because the browse
 *                 rows price off it too and a market row is a venue fact
 *                 (R1's lane/row boundary). So the seed applies the fee at
 *                 the lane, here, where the lane becomes a product number.
 *
 * `SEED_PRICING` records the pre-fee venue reading beside the published one
 * for every seed, so the identity is pinnable rather than inferred.
 */
export interface SeedPricing {
  slug: string;
  /** Net APY from the venue model alone, before any house fee. */
  venueNet: number;
  /** What the record publishes: the R1 identity applied to `venueNet`. */
  published: number;
  /** Which model priced it — the two paths above take the fee differently. */
  path: "composed" | "lane";
  /**
   * The composition the composed path priced at — the seed's own dials
   * (frozen-record migration, 2026-09-01). `published` is `venueNet` through
   * the fee AND through `compoundDelta` at these dials, so the fee-parity
   * suite re-derives the identity with them instead of assuming a bare 0.8.
   * Null on the lane path: `laneEconomics` compounds INSIDE `venueNet`, at
   * the lane's own capacity, and restating its dials here would invite a
   * second derivation of that arithmetic.
   */
  comp: LaneComposition | null;
}

export const SEED_PRICING: SeedPricing[] = [];

// ── loop + dn-lp seeds ─────────────────────────────────────────────────────

interface LoopSpec {
  slug: string;
  name: string;
  summary: string;
  venueLabel: string;
  market: string;
  /** Dial position before the house clamp. */
  targetLeverage: number;
  /**
   * False when the market's own marginal borrow costs more than its
   * collateral yields, so the scan opens it flat. A position at 1.05x has
   * no loop to protect: publishing a liquidation threshold and a health
   * band for it would put a 10.00 health factor and a "90% adverse move"
   * row on a vault that never borrows.
   */
  dynamicLeverage: boolean;
  hedged: boolean;
  compoundCadenceHours: number;
  createdAt: string;
  curator: string;
  /** Share of published capacity this sample vault is holding. */
  utilization: number;
  avgTicketUsd: number;
  source: SourcedRow | null;
}

function buildLoopSeed(s: LoopSpec): VaultRecord | null {
  if (!s.source) {
    SEED_SOURCING_NOTES.push(`${s.slug}: ${s.market} not in the committed catalog`);
    return null;
  }
  const { row, chainId, blockNumber, coinMaxLeverage } = s.source;
  const lt = row.lt ?? 0;
  const applied = clampLeverage(s.targetLeverage, lt);
  // The seed's OWN composition (frozen-record migration, 2026-09-01): priced
  // dial-less, a hedged seed paid the flat calibration drag while storing the
  // dials the band-derived owner prices differently, and the auto-compound
  // module it installs was priced at zero. The record and its replay are now
  // one arithmetic.
  const comp = seedComposition(s.hedged, s.compoundCadenceHours);
  const priced = repriceAtLeverage(row, applied, comp);
  const terms = composedTerms(priced, s.hedged, comp);
  const apy = publishedNetApy(priced, s.hedged, comp);
  if (apy === null || terms === null) {
    SEED_SOURCING_NOTES.push(`${s.slug}: ${s.market} priced to null`);
    return null;
  }
  // `terms.core` is the venue reading; `terms.published` is that reading after
  // the compute fee and the compound delta, which is what the record carries.
  SEED_PRICING.push({ slug: s.slug, venueNet: terms.core, published: apy, path: "composed", comp });
  const effectiveLeverage = priced.economics?.loopLeverage ?? applied;
  const bands = deriveHfBands("standard", effectiveLeverage, lt);
  const margin = coinMaxLeverage ? deriveHlMarginBands(coinMaxLeverage) : null;
  const capacityUsd = priced.economics?.capacityUsd ?? null;

  const modules = [
    "Liquidity source",
    ...(s.dynamicLeverage ? ["Dynamic leverage"] : []),
    ...(s.hedged ? ["Dynamic hedge"] : []),
    "Auto-compound",
  ];
  const tvl = capacityUsd !== null ? Math.round(capacityUsd * s.utilization) : 250_000;

  const published: Partial<VaultRecord> = {
    liqLtv: s.dynamicLeverage ? lt : null,
    appliedLeverage: s.dynamicLeverage ? effectiveLeverage : null,
    hfTargetBps: s.dynamicLeverage ? bands.hfTargetBps : null,
    hfDeleverageBps: s.dynamicLeverage ? bands.hfDeleverageBps : null,
    hfFloorBps: s.dynamicLeverage ? bands.hfFloorBps : null,
    hedgeLeverage: s.hedged ? HL_LEVERAGE : null,
    reserveFraction: s.hedged ? HEDGE_RESERVE_DEFAULT : null,
    hlCoin: s.hedged ? row.hlCoin : null,
    // DERIVED, never tuned (modules.ts R1) — the exact band `execDragFor`
    // resolved for this composition, read from the same owner, so the stated
    // band and the priced band are one number. A user record stores it via
    // `publishedModelRecord`; a sample stating nothing left the reader's 0.5
    // backfill printing beside a price computed at 4.
    deltaBandPct: s.hedged ? laneDeltaBandPct(comp) : null,
    marginTrimPct: s.hedged && margin ? Math.round(margin.fastTrim * 1000) / 10 : null,
    marginRestorePct: s.hedged && margin ? Math.round(margin.restore * 1000) / 10 : null,
    thresholdUsd: HARVEST_THRESHOLD_DEFAULT,
    compoundCadenceHours: s.compoundCadenceHours,
    capacityUsd,
    capacityBinding: priced.economics?.capacityBinding ?? null,
    capacityBindingLabel: capacityBindingSentence(priced),
    chainId,
    blockNumber,
  };

  const base = {
    slug: s.slug,
    name: s.name,
    strategy: "loop" as const,
    strategyLabel: "Leveraged loop",
    summary: s.summary,
    venue: s.venueLabel,
    market: s.market,
    modules,
    moduleLines: lines(modules),
    params: seedParamRows(published),
    modeledApy: apy,
    baseTvlUsd: tvl,
    baseDepositors: depositorsFor(tvl, s.avgTicketUsd),
    curator: s.curator,
    createdAt: s.createdAt,
    register: "sample" as const,
    ...published,
  };
  return { ...base, automations: deriveAutomations(base) } as VaultRecord;
}

function buildDnLpSeed(): VaultRecord | null {
  const c = DN_LP_CANDIDATE;
  // The hand-authored row is one figure at one composition — no exec drag to
  // re-run — but the auto-compound module this record installs is priced, at
  // the record's own dials (frozen-record migration, 2026-09-01).
  const comp = seedComposition(true, 24);
  const terms = composedTerms(c, true, comp);
  const apy = publishedNetApy(c, true, comp);
  if (apy === null || terms === null) {
    SEED_SOURCING_NOTES.push("aerodrome-rangekeeper: template row priced to null");
    return null;
  }
  SEED_PRICING.push({
    slug: "aerodrome-rangekeeper",
    venueNet: terms.core,
    published: apy,
    path: "composed",
    comp,
  });
  const rangePct =
    MODULE_DEFS["auto-center"].params.find((p) => p.field === "rangePct")?.default ?? "2.5";
  const capacityUsd = c.economics?.capacityUsd ?? null;
  const tvl = capacityUsd !== null ? Math.round(capacityUsd * 0.42) : 500_000;
  const modules = ["Liquidity source", "Auto center", "Dynamic hedge", "Auto-compound"];

  const published: Partial<VaultRecord> = {
    // A concentrated LP is not a loop: no borrow, no liquidation threshold,
    // no health band. Published as null so every leverage surface renders
    // nothing rather than a phantom 3.00x envelope.
    liqLtv: null,
    appliedLeverage: null,
    hedgeLeverage: HL_LEVERAGE,
    reserveFraction: HEDGE_RESERVE_DEFAULT,
    // Stated as `publishedModelRecord` states it on a user's dn-lp record:
    // the derived band at the record's dials. The hand-authored model's own
    // hedge cost is inside the row, so the band prices nothing HERE — but a
    // sample staying silent where the identical user record speaks is the
    // directory arguing with itself (frozen-record migration, 2026-09-01).
    deltaBandPct: laneDeltaBandPct(comp),
    hlCoin: c.hlCoin,
    thresholdUsd: HARVEST_THRESHOLD_DEFAULT,
    compoundCadenceHours: 24,
    capacityUsd,
    capacityBinding: c.economics?.capacityBinding ?? null,
    capacityBindingLabel: "limited by the modeled pool depth",
  };

  const params = seedParamRows({
    ...published,
    extra: [
      { label: "Range width", value: `±${rangePct}%` },
      { label: "Recenter trigger", value: "price at 60% of the half-range" },
      { label: "Hedge venue", value: "Avantis · Base" },
      /* THE SAME PROVENANCE THE COLLAR CARRIES (C4). `DN_LP_CANDIDATE` is the
         other half of the Modeled-markets group: hand-authored, never
         scanned, no block to pin. Two model-priced samples in one sorted
         directory, one declaring its provenance and one silent, is the
         directory arguing with itself in the register this file exists to
         close. */
      { ...MODEL_ROW_PROVENANCE },
    ],
  });

  const base = {
    slug: "aerodrome-rangekeeper",
    name: "Aerodrome Rangekeeper",
    strategy: "dnlp" as const,
    strategyLabel: "Delta-neutral LP",
    summary:
      "Concentrated WETH/USDC liquidity on Aerodrome, with a perp short canceling the price leg.",
    venue: "Aerodrome · Base",
    market: "WETH/USDC LP",
    modules,
    moduleLines: lines(modules),
    params,
    modeledApy: apy,
    baseTvlUsd: tvl,
    baseDepositors: depositorsFor(tvl, 22_000),
    curator: "Priime Labs",
    createdAt: "2026-04-08",
    register: "sample" as const,
    ...published,
  };
  return { ...base, automations: deriveAutomations(base) } as VaultRecord;
}

/**
 * THE MODEL-ROW VERDICT, one string, shared by every seed whose market was
 * never scanned (WAVE 2 · C4).
 *
 * `DiscoverPanel`'s Modeled-markets group states it to a builder before they
 * seat one of these rows: `Priced from the product's own model, not from a
 * scan. No launch rail yet.` The two hand-authored rows — the Aerodrome LP
 * and the options collar — are the whole of that group, and a SAMPLE built on
 * one of them is the same claim one surface later, read by a depositor
 * instead of a builder.
 *
 * Before this row the sample carried the absence silently: no `Read at` line,
 * because `seedParamRows` omits the block pin when there is none, and a
 * reader who does not know that a missing row is a statement reads a modeled
 * vault as a scanned one. Every scanned sample in this directory prints
 * `Read at Base · block 34,712,880`; these two print nothing there, and now
 * they say why.
 *
 * ⚠ It is a claim about PROVENANCE, never a disclaimer: the value names what
 * priced the number, in the same words the canvas used, and the record's
 * honesty grammar (`register: "sample"`, the modeled stamp) is unchanged.
 */
export const MODEL_ROW_PROVENANCE = {
  label: "Pricing",
  value: "Priced from the product’s own model, not from a scan",
} as const;

// ── treasury collar seed ───────────────────────────────────────────────────

/**
 * The fourth advertised strategy, as a record.
 *
 * priime.finance/stack and the four template cards advertise FOUR strategies;
 * `/vaults` shipped samples for three, so the directory's own filter bar —
 * which derives its chips from the union of the records' strategy kinds —
 * counted three and quietly contradicted the shelf that sent the reader
 * there. This is the missing fourth, and it is a COMPOSITION like every other
 * seed in this file: the number is `collarModel`'s, taken through the same
 * `publishedNetApy` a user's own collar publishes through, at the same dials
 * `COLLAR_DEFAULT_DIALS` seats on the canvas.
 *
 * IT CLAIMS NO SCAN. `COLLAR_CANDIDATE` is a hand-authored row on a mock
 * options venue: there is no block to pin, no `Read at` line, and
 * `MODEL_ROW_PROVENANCE` says so on the record rather than leaving the
 * absence to be inferred.
 *
 * THE COMPOSITION IS PASSED, not assumed. `composedHere` refuses a
 * hand-authored row's number to a lane that does not hold the machine it was
 * priced for — and the collar is the row that trap was written for: all three
 * partial states print +11.826%, the figure for BOTH option legs, and a
 * written call with no put is the most seductive number in the product. The
 * seed hands `composedTerms` the exact keys it installs, so the sample is
 * checked by the same gate the canvas is checked by instead of being exempt
 * from it.
 */
const COLLAR_PLACED: readonly ModuleKey[] = [
  ...STRUCTURAL_MODULES.collar,
  "auto-compound",
];

function buildCollarSeed(): VaultRecord | null {
  const c = COLLAR_CANDIDATE;
  // cls N1: the option pair IS the protection, so there is no perp leg to
  // install or eject and `hasHedge` is false at every reader. The compound
  // module the record installs is priced at the record's own dials (frozen-
  // record migration, 2026-09-01) — the same 9.86% the copilot's lane frame
  // already quotes for this composition, where the seed printed 9.46%.
  const comp = seedComposition(false, 24);
  const terms = composedTerms(c, false, comp, COLLAR_PLACED);
  const apy = publishedNetApy(c, false, comp, COLLAR_PLACED);
  if (apy === null || terms === null) {
    SEED_SOURCING_NOTES.push("dao-treasury-collar: collar model priced to null");
    return null;
  }
  SEED_PRICING.push({
    slug: "dao-treasury-collar",
    venueNet: terms.core,
    published: apy,
    path: "composed",
    comp,
  });
  const capacityUsd = c.economics?.capacityUsd ?? null;
  // Fixture sizing, strictly inside the modeled book — the same rule the
  // funding seeds follow, over the only capacity this row measures.
  const tvl = capacityUsd !== null ? Math.round(capacityUsd * 0.28) : 250_000;
  const modules = ["Liquidity source", "Covered call", "Protective put", "Auto-compound"];

  const published: Partial<VaultRecord> = {
    // A collar borrows nothing. No liquidation threshold, no leverage, no
    // health band: every leverage surface renders nothing rather than the
    // 10.00 sentinel an unlevered record used to carry.
    liqLtv: null,
    appliedLeverage: null,
    // No perp leg, so no lane band exists — published as null, the same
    // "declines to state" a user's collar record carries.
    deltaBandPct: null,
    thresholdUsd: HARVEST_THRESHOLD_DEFAULT,
    compoundCadenceHours: 24,
    capacityUsd,
    capacityBinding: c.economics?.capacityBinding ?? null,
    // Through the one owner, with `hasHedge` false so no perp noun appears on
    // a lane that holds no perp.
    capacityBindingLabel: capacityBindingSentence(c, 1, false),
  };

  const params = seedParamRows({
    ...published,
    extra: [
      /* THE DIALS THE NUMBER WAS COMPUTED AT, read from the one owner.
         `COLLAR_DEFAULT_DIALS` is what `COLLAR_CANDIDATE` is priced at and
         what the `treasury-collar` template seats, so a descriptor default
         that moves moves the printed strike and the published APY together.
         Written in the canvas's OWN spelling (`+10%` / `−12%` / `30d`,
         RackCanvas.tsx collar branch) because `riskGrade` and
         `registerInputForVault` both parse these values back out of the
         record: a sample spelling them differently would publish a collar
         whose page reads differently from a user's identical one.
         ⚠ THE FLOOR'S GLYPH IS U+2212 (`MINUS`), not an ASCII hyphen (S2
         Wave 2 seam, 2026-08-24). The canvas writer and both record-side
         parsers moved together; this seed follows the writer, which is the
         whole reason this comment exists. */
      { label: "Call strike", value: `+${COLLAR_DEFAULT_DIALS.strikePct}%` },
      /* QNT-3 (quant ledger, 2026-08-27): the premium is the price of the
         upside sold above the strike, so the record states the forfeiture
         beside the dial that set it — derived through `collarForfeit` at the
         same dials the headline was computed at, never typed. The canvas's
         collar publish path writes the identical row, so a sample and a
         user's own collar read the same. */
      ...(() => {
        const f = collarForfeit(COLLAR_DEFAULT_DIALS);
        return f ? [{ label: "Upside forfeited", value: collarForfeitValue(f) }] : [];
      })(),
      { label: "Put floor", value: `${MINUS}${COLLAR_DEFAULT_DIALS.floorPct}%` },
      { label: "Roll cadence", value: `${COLLAR_DEFAULT_DIALS.rollDays}d` },
      { ...MODEL_ROW_PROVENANCE },
    ],
  });

  const base = {
    slug: "dao-treasury-collar",
    name: "DAO Treasury Collar",
    strategy: "collar" as const,
    strategyLabel: "Treasury collar",
    summary:
      "A governance-token treasury with calls written above spot funding the puts that hold its floor.",
    venue: VENUE_LABELS["options-base"],
    /* THE PAIR, FROM THE ROW'S OWN FIELDS, not from its display label.
       ------------------------------------------------------------------
       `COLLAR_CANDIDATE.pair` is `DAO token`, and every OTHER surface on a
       record reads the market as a PAIR: `registerInputForVault` splits it
       on `/` and returns null when there is no second half, so a record
       whose market carries no slash renders NO register at all —
       `AutomationsSection` returns null on an empty entry list, and the
       whole "What can be closed" section leaves the page with it. Measured:
       with `market: c.pair` this sample published zero register entries; with
       the pair it publishes five, including the roll cost, the sold upside,
       the flat-vol structural row and the declared-blind row.
       `collateralSymbol` and `debtSymbol` are the row's own fields and the
       strikes are quoted against that numeraire, so this is READ, never
       typed.
       ⚠ SEAM, recorded in `seams-w2.md`: a user publishing
       `?template=treasury-collar` publishes `pairLabel` (`DAO token`) and
       therefore still gets no register. The owner is the template row's
       label or `registerInputForVault`'s split, neither of which is this
       file's to change. */
    market: `${c.collateralSymbol}/${c.debtSymbol}`,
    modules,
    moduleLines: lines(modules),
    params,
    modeledApy: apy,
    baseTvlUsd: tvl,
    baseDepositors: depositorsFor(tvl, 35_000),
    curator: "Priime Labs",
    createdAt: "2026-04-22",
    register: "sample" as const,
    ...published,
  };
  return { ...base, automations: deriveAutomations(base) } as VaultRecord;
}

// ── funding seeds ──────────────────────────────────────────────────────────

interface FundingSpec {
  slug: string;
  name: string;
  summary: string;
  venueLabel: string;
  marketLabel: string;
  marketId: string;
  venueId: string;
  coin: string;
  coinMaxLeverage: number | null;
  cadence: "6h" | "24h" | "72h";
  createdAt: string;
  curator: string;
  utilization: number;
  avgTicketUsd: number;
}

function buildFundingSeed(s: FundingSpec): VaultRecord | null {
  const preset = FUNDING_LANE_DEFAULTS;
  const lane: FundingLane = {
    id: `seed_${s.slug}`,
    label: s.name,
    // A seed's product name is minted, not typed, and no picker ever
    // reaches a seed lane — the flag is inert here either way.
    namedByBuilder: false,
    venueId: s.venueId,
    marketId: s.marketId,
    placed: ["perp-market", "basis-engine", "funding-guard", "auto-compound"],
    params: {
      ...preset,
      guardWindowH: 24,
      cadence: s.cadence,
      minActionUsd: HARVEST_THRESHOLD_DEFAULT,
    },
  };
  // Priced WITH the committed book index (SEED_BOOKS): the rate, the spot
  // leg, the compound term and the capacity all come from the measured scan,
  // never the dead hand table. A coin the committed scan did not price still
  // drops out below (`measuredBookRoomUsd`), never a fabricated number.
  const econ = laneEconomics(lane, SEED_BOOKS);
  if (!econ) {
    SEED_SOURCING_NOTES.push(`${s.slug}: ${s.marketId} not in the funding venue table`);
    return null;
  }
  /* THE FEE NOW LANDS INSIDE `laneEconomics`, IN R1's ORDERING (S1,
     2026-08-24). This line read `applyComputeFee(econ.netApr)`, which is the
     NAIVE ordering: `netApr` already contains `compoundDelta(carryApr, ...)`,
     so charging the fee here charged it AFTER compounding, on a dollar the
     depositor never held. R1 requires the fee on the CARRY, before the
     compound step. It also charged the fee at a boundary the CANVAS did not
     have, so a seeded sample and a user-published vault on the same book
     printed two numbers for one quantity. `publishedApr` is that one number,
     and both paths now read it. */
  const publishedApy = econ.publishedApr;
  SEED_PRICING.push({
    slug: s.slug,
    venueNet: econ.netApr,
    published: publishedApy,
    path: "lane",
    comp: null,
  });
  const margin = s.coinMaxLeverage ? deriveHlMarginBands(s.coinMaxLeverage) : null;
  /* FIXTURE SIZING, NOT A CAPACITY CLAIM — re-seeded 2026-08-24 (G7 nit).
     A demo vault's TVL is mock data by construction, but the base it scales
     was `FUNDING_VENUES`' hand-typed capacityUsd, which perp-books.ts
     measured as overstating the same books by 56x (ETH) to 6,562x (HYPE): at
     these utilizations the three funding seeds printed between $7.2M and
     $17.1M of TVL on books whose measured deposit room runs from $11.6K to
     $691K. The base is now the committed funding scan's own capacityUsd for
     this coin's book (fixtures/hyperliquid-funding.json, stored in the
     scan's F_B denomination, which never exceeds the room at any composed
     escrow share), so a seed's TVL sits strictly inside the room its own
     book measured — and a coin the committed scan did not price seeds no
     vault rather than a number nobody measured. */
  const roomUsd = measuredBookRoomUsd(s.coin);
  if (roomUsd === null) {
    SEED_SOURCING_NOTES.push(`${s.slug}: ${s.coin} book not in the committed funding scan`);
    return null;
  }
  const tvl = Math.round(roomUsd * s.utilization);
  const modules = ["Perp market", "Basis engine", "Funding guard", "Auto-compound"];

  const published: Partial<VaultRecord> = {
    // A basis position carries no borrow and no liquidation threshold.
    liqLtv: null,
    appliedLeverage: null,
    hedgeLeverage: preset.hedgeLeverage,
    reserveFraction: preset.marginReserve,
    hlCoin: s.coin,
    fundingFloorApr: preset.guardFloorApr,
    marginTrimPct: margin ? Math.round(margin.fastTrim * 1000) / 10 : null,
    marginRestorePct: margin ? Math.round(margin.restore * 1000) / 10 : null,
    thresholdUsd: HARVEST_THRESHOLD_DEFAULT,
    compoundCadenceHours: Number.parseInt(s.cadence, 10),
    // The measured room at THIS lane's escrow share (SEED_BOOKS above) — the
    // same figure the funding template canvas states for the same book. It
    // used to be null on the bookless path, so the page carried a "Capacity
    // binding" claim with NO capacity figure beside it (cleanup 2026-08-24).
    capacityUsd: econ.capacityUsd,
    // The scan's own binding for this book, never a hand-typed one ("HL OI"
    // was typed here while every committed book binds on HL book depth).
    capacityBinding: readingFor(SEED_BOOKS, s.venueId, s.coin)?.bindingLabel ?? null,
    capacityBindingLabel: `limited by the depth of the ${s.coin} perp book at ${s.venueLabel}`,
  };

  const params = seedParamRows({
    ...published,
    extra: [{ label: "Guard window", value: `${lane.params.guardWindowH}h under the floor` }],
  });

  const base = {
    slug: s.slug,
    name: s.name,
    strategy: "funding" as const,
    strategyLabel: "Funding-rate carry",
    summary: s.summary,
    venue: s.venueLabel,
    market: s.marketLabel,
    modules,
    moduleLines: lines(modules),
    params,
    modeledApy: publishedApy,
    baseTvlUsd: tvl,
    baseDepositors: depositorsFor(tvl, s.avgTicketUsd),
    curator: s.curator,
    createdAt: s.createdAt,
    register: "sample" as const,
    ...published,
  };
  return { ...base, automations: deriveAutomations(base) } as VaultRecord;
}

// ── the roster ─────────────────────────────────────────────────────────────

const WSTETH = sourceRow(
  snapMorphoBase as unknown as RawDoc,
  "wsteth-weth",
  "morpho-blue-base",
  "wstETH/WETH",
);
const KHYPE = sourceRow(
  snapHyper as unknown as RawDoc,
  "khype-whype",
  "morpho-blue-hyperevm",
  "kHYPE/WHYPE",
);
const SYRUP = sourceRow(
  snapAave as unknown as RawDoc,
  "syrupusdc-usdc",
  "aave-v3-base",
  "syrupUSDC/USDC",
);

/**
 * THE LIVE RECORD FIRST (docs/plans/LATEST_UI_PORT_SPEC.md A.2). `heroRecord()`
 * is built through the same owners as every seed below; it is the one record
 * with an attested NAV, and the directory sorts it first whatever the key.
 * The seven that follow are the coming-soon cards: the one negative-APY sample
 * (`btc-carry-collector`) is not in the array, so 1 + 7 + the ghost card fills
 * three rows of three.
 */
export const SEED_VAULTS: VaultRecord[] = [
  heroRecord(),
  buildLoopSeed({
    slug: "steady-eth-loop",
    name: "Steady ETH Loop",
    summary:
      "wstETH looped against WETH on Morpho, with an ETH perp short holding net delta at zero.",
    venueLabel: "Morpho Blue · Base",
    market: "wstETH/WETH",
    targetLeverage: 3,
    dynamicLeverage: true,
    hedged: true,
    compoundCadenceHours: 24,
    createdAt: "2026-03-02",
    curator: "Priime Labs",
    utilization: 0.62,
    avgTicketUsd: 9_000,
    source: WSTETH,
  }),
  buildLoopSeed({
    slug: "khype-boost-loop",
    name: "kHYPE Boost Loop",
    summary:
      "kHYPE staking carry looped on HyperEVM, hedged on the HYPE perp, sized to the book it can exit into.",
    venueLabel: "Morpho Blue · HyperEVM",
    market: "kHYPE/WHYPE",
    targetLeverage: 3,
    dynamicLeverage: true,
    hedged: true,
    compoundCadenceHours: 24,
    createdAt: "2026-05-11",
    curator: "Priime Labs",
    utilization: 0.55,
    avgTicketUsd: 2_500,
    source: KHYPE,
  }),
  buildLoopSeed({
    slug: "stable-yield-router",
    name: "Stable Carry Base",
    summary:
      "syrupUSDC held against USDC on Aave v3 in E-Mode. All-stable collateral, no price leg, no hedge.",
    venueLabel: "Aave v3 · Base",
    market: "syrupUSDC/USDC",
    targetLeverage: 1.5,
    dynamicLeverage: false,
    hedged: false,
    compoundCadenceHours: 24,
    createdAt: "2026-03-27",
    curator: "Anchorpoint",
    utilization: 0.35,
    avgTicketUsd: 26_000,
    source: SYRUP,
  }),
  buildDnLpSeed(),
  buildCollarSeed(),
  buildFundingSeed({
    slug: "basis-desk-one",
    name: "Basis Desk One",
    summary:
      "Delta-neutral ETH basis on Hyperliquid: staked spot long against a perp short at equal notional.",
    venueLabel: "Hyperliquid",
    marketLabel: "ETH-USD",
    marketId: "hyperliquid:ETH",
    venueId: "hyperliquid",
    coin: "ETH",
    coinMaxLeverage: 25,
    cadence: "24h",
    createdAt: "2026-02-14",
    curator: "North Basis",
    utilization: 0.3,
    avgTicketUsd: 48_000,
  }),
  buildFundingSeed({
    slug: "hype-funding-harvest",
    name: "HYPE Funding Harvest",
    summary:
      "HYPE basis on Hyperliquid, the richest funding print in the scan, swept back in every six hours.",
    venueLabel: "Hyperliquid",
    marketLabel: "HYPE-USD",
    marketId: "hyperliquid:HYPE",
    venueId: "hyperliquid",
    coin: "HYPE",
    coinMaxLeverage: 10,
    cadence: "6h",
    createdAt: "2026-06-30",
    curator: "Velvet Quant",
    utilization: 0.18,
    avgTicketUsd: 21_000,
  }),
].filter((v): v is VaultRecord => v !== null);

export const SEED_SLUGS: ReadonlySet<string> = new Set(SEED_VAULTS.map((v) => v.slug));

// ── parity assertion ───────────────────────────────────────────────────────

/**
 * Re-derives every seed's APY from its own market and reports anything more
 * than 1pp away from what the record carries. It should always return an
 * empty array — the seeds ARE the composed values — so a non-empty result
 * means a builder above stopped routing through the pricing functions.
 * Call it from a build step or a test; it does no I/O.
 */
export function assertSeedApyParity(tolerancePp = 1): string[] {
  const problems: string[] = [];
  const check = (slug: string, live: number | null) => {
    const seed = SEED_VAULTS.find((v) => v.slug === slug);
    if (!seed) return;
    if (live === null) {
      problems.push(`${slug}: market no longer prices`);
      return;
    }
    const deltaPp = Math.abs(seed.modeledApy - live) * 100;
    if (deltaPp > tolerancePp) {
      problems.push(
        `${slug}: record ${fmtPct(seed.modeledApy)} vs live ${fmtPct(live)} (${deltaPp.toFixed(2)}pp apart)`,
      );
    }
  };

  // The same `seedComposition` the builders price at (frozen-record
  // migration, 2026-09-01): a dial-less re-derivation here would report the
  // fix as a drift on every composed seed and miss a builder that stopped
  // threading its own dials.
  const loop = (slug: string, src: SourcedRow | null, target: number, hedged: boolean) => {
    if (!src) return;
    const applied = clampLeverage(target, src.row.lt ?? 0);
    const comp = seedComposition(hedged, 24);
    check(slug, publishedNetApy(repriceAtLeverage(src.row, applied, comp), hedged, comp));
  };
  loop("steady-eth-loop", WSTETH, 3, true);
  loop("khype-boost-loop", KHYPE, 3, true);
  loop("stable-yield-router", SYRUP, 1.5, false);
  check("aerodrome-rangekeeper", publishedNetApy(DN_LP_CANDIDATE, true, seedComposition(true, 24)));
  // The collar re-derives through its own composition, exactly as the builder
  // priced it: a bookless `composedTerms` call with no `placed` would pass the
  // gate vacuously and could not catch a lane that lost an option leg.
  check(
    "dao-treasury-collar",
    publishedNetApy(COLLAR_CANDIDATE, false, seedComposition(false, 24), COLLAR_PLACED),
  );

  for (const [slug, marketId, cadence] of [
    ["basis-desk-one", "hyperliquid:ETH", "24h"],
    ["hype-funding-harvest", "hyperliquid:HYPE", "6h"],
  ] as const) {
    // The same SEED_BOOKS the builder priced with — a bookless re-derivation
    // here was vacuous (both sides read the dead hand table and agreed).
    const econ = laneEconomics(
      {
        id: slug,
        label: slug,
        namedByBuilder: false,
        venueId: "hyperliquid",
        marketId,
        placed: ["perp-market", "basis-engine", "funding-guard", "auto-compound"],
        params: {
          ...FUNDING_LANE_DEFAULTS,
          guardWindowH: 24,
          cadence,
          minActionUsd: HARVEST_THRESHOLD_DEFAULT,
        },
      },
      SEED_BOOKS,
    );
    // Re-derived through the SAME published number the builder took (R1):
    // `laneEconomics.publishedApr`. Comparing a fee-bearing record against a
    // fee-free re-derivation would report a 1pp-shaped drift on every funding
    // seed and call the fix the defect.
    check(slug, econ ? econ.publishedApr : null);
  }
  return problems;
}

// ── record ↔ recompute reconciliation (frozen-record migration) ────────────

/** The leverage half of a loop seed's spec, restated beside the reconcile so
 *  the replay does not read the builder's variable it is checking. */
const LOOP_SEED_DIALS: Record<string, { src: SourcedRow | null; target: number; hedged: boolean }> = {
  // The live record replays through its own owners (hero.ts): the typed
  // market row at the seed leverage, unhedged, no compound dial stored.
  [HERO_SLUG]: { src: heroSource(), target: HERO_SEED_LEVERAGE, hedged: false },
  "steady-eth-loop": { src: WSTETH, target: 3, hedged: true },
  "khype-boost-loop": { src: KHYPE, target: 3, hedged: true },
  "stable-yield-router": { src: SYRUP, target: 1.5, hedged: false },
};

/**
 * RECORD == RECOMPUTE, TO 6 DECIMALS (founder-approved migration,
 * 2026-09-01). Replays every shipped seed record from its OWN STORED FIELDS
 * — hedge dials, stated delta band, compound dials, guard settings — through
 * the current single-owner pricing path, and reports any record whose
 * `modeledApy` the replay does not reproduce to 6 decimals. It should always
 * return an empty array; a non-empty result means a builder above priced a
 * composition its record does not state, which is exactly the frozen-record
 * drift QNT-2 measured on the flagship (stored 2.101272% vs 2.289993%
 * recomputed at its own dials).
 *
 * `bandOverridePct` exists for the regression test's MUTATION proof: replayed
 * at the calibration band (0.5) instead of each record's stated band, the two
 * hedged loop seeds must FAIL to reconcile — that failure is what shows the
 * stated band actually reaches the priced drag rather than riding along.
 */
export function reconcileSeedRecords(bandOverridePct?: number): string[] {
  const problems: string[] = [];
  const TOLERANCE = 0.5e-6; // six decimals of APY — the migration's own bound
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;

  const compOf = (v: VaultRecord): LaneComposition => {
    const lh = num(v.hedgeLeverage);
    const reserve = num(v.reserveFraction);
    const band = bandOverridePct ?? num(v.deltaBandPct);
    const cadence = num(v.compoundCadenceHours);
    const threshold = num(v.thresholdUsd);
    return {
      hedge:
        lh !== null && reserve !== null
          ? {
              hedgeLeverage: lh,
              reserveFraction: reserve,
              ...(band !== null ? { deltaBandPct: band } : {}),
            }
          : null,
      compound:
        cadence !== null && threshold !== null
          ? { cadence: `${cadence}h` as "6h" | "24h" | "72h", minActionUsd: threshold }
          : null,
    };
  };

  const settle = (v: VaultRecord, replay: number | null) => {
    if (replay === null) {
      problems.push(`${v.slug}: replay at the record's own dials priced to null`);
      return;
    }
    if (Math.abs(replay - v.modeledApy) > TOLERANCE) {
      problems.push(`${v.slug}: record ${v.modeledApy} vs replay ${replay} at its own dials`);
    }
  };

  for (const v of SEED_VAULTS) {
    const comp = compOf(v);
    if (v.strategy === "loop") {
      const dials = LOOP_SEED_DIALS[v.slug];
      if (!dials?.src) {
        // A loop seed this table does not know cannot be replayed, and a
        // record the reconcile silently skips is a record it falsely blesses.
        problems.push(`${v.slug}: loop seed absent from LOOP_SEED_DIALS`);
        continue;
      }
      const applied = clampLeverage(dials.target, dials.src.row.lt ?? 0);
      settle(v, publishedNetApy(repriceAtLeverage(dials.src.row, applied, comp), dials.hedged, comp));
    } else if (v.strategy === "dnlp") {
      settle(v, publishedNetApy(DN_LP_CANDIDATE, true, comp));
    } else if (v.strategy === "collar") {
      settle(v, publishedNetApy(COLLAR_CANDIDATE, false, comp, COLLAR_PLACED));
    } else {
      // funding — the lane rebuilt from the record's stored dials, including
      // the guard window the record publishes as its own param row.
      const lh = num(v.hedgeLeverage);
      const reserve = num(v.reserveFraction);
      const floor = num(v.fundingFloorApr);
      const cadence = num(v.compoundCadenceHours);
      const threshold = num(v.thresholdUsd);
      const windowH = Number(
        v.params.find((p) => p.label === "Guard window")?.value.match(/\d+/)?.[0] ?? Number.NaN,
      );
      if (
        lh === null ||
        reserve === null ||
        floor === null ||
        cadence === null ||
        threshold === null ||
        !Number.isFinite(windowH) ||
        !v.hlCoin
      ) {
        problems.push(`${v.slug}: record is missing a stored dial the replay needs`);
        continue;
      }
      const econ = laneEconomics(
        {
          id: `reconcile_${v.slug}`,
          label: v.slug,
          namedByBuilder: false,
          venueId: "hyperliquid",
          marketId: `hyperliquid:${v.hlCoin}`,
          placed: ["perp-market", "basis-engine", "funding-guard", "auto-compound"],
          params: {
            ...FUNDING_LANE_DEFAULTS,
            hedgeLeverage: lh,
            marginReserve: reserve,
            guardFloorApr: floor,
            guardWindowH: windowH,
            cadence: `${cadence}h` as "6h" | "24h" | "72h",
            minActionUsd: threshold,
          },
        },
        SEED_BOOKS,
      );
      settle(v, econ ? econ.publishedApr : null);
    }
  }
  return problems;
}
