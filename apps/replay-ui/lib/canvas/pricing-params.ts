/**
 * THE LANE COMPOSITION — the one reader of a lane's module params.
 *
 * `pricingParamsFor(loop)` lived inside `components/canvas/RackCanvas.tsx`,
 * which is why nothing outside that component could reach it: `tips.ts`
 * needed the hedge dials to narrate the hedge and had to invert the priced
 * row instead, and `capacity.ts` / `mock-quote.ts` documented their `comp`
 * argument by pointing at a symbol living in a client component. A pure
 * derivation over the graph does not belong in a React file.
 *
 * The returned object IS a `LaneComposition` (mock-quote.ts) structurally,
 * so it may be passed straight through as the `comp` argument of
 * `mockQuote` / `repriceAtLeverage` / `composedNetApy` / `hedgeEconomics` /
 * `vaultCapacity`. That is the point: one read of the graph feeds every
 * priced path, so two surfaces cannot price the same lane from two
 * different compositions.
 *
 * NO LITERAL DEFAULTS. Every fallback comes from `defaultValueFor`, i.e.
 * from the module descriptor itself, so a dial whose default moves moves
 * the price and the published record with it.
 */


import { nodeFor, type LaneFamily } from "./graph-ops";
import { fbForComposition } from "./mock-quote";
import { defaultValueFor, derivedDeltaBandPct, HOUSE_FUNDING_FLOOR_APR } from "./modules";
import { LAUNCHABLE_VENUES, type CanvasVenueId } from "./opportunities";
import { PRODUCT_MIN_LEVERAGE, type HfBands, type HlMarginBandsDerived, type RiskPreset } from "./param-schema";
import type { LoopGraph } from "./types";

/** A finite number from a param value that may be a `segmented` string. */
function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** The descriptor's own default for a field, as a number. */
function defNum(key: Parameters<typeof defaultValueFor>[0], field: string, fallback: number): number {
  return num(defaultValueFor(key, field), fallback);
}

export interface LaneHedgeParams {
  hedgeLeverage: number;
  reserveFraction: number;
  /** Guard floor, annualized fraction. Negative: the short stops paying. */
  fundingFloorApr: number;
  /** Funding epochs below the floor before the guard fires. */
  fundingWindowEpochs: number;
}
/* NO `deltaBandPct` HERE. The dial was retired the same day (modules.ts R1):
   the band is not a preference, it is the resize size the venue and the
   watchers permit, and `derivedDeltaBandPct` derives it. It is still a
   published field, so the record below states the DERIVED band. */

export interface LaneCompoundParams {
  cadence: "6h" | "24h" | "72h";
  minActionUsd: number;
}

/**
 * The treasury family's exit, as this lane holds it (WP-3).
 *
 * NOT PRICED, AND STILL PUBLISHED, which is the distinction
 * `QUOTE_AFFECTING_PARAMS` is about and this interface is where it stops being
 * abstract. Neither field enters `composedNetApy` or `repriceAtLeverage` — the
 * window is a MIGRATION cost, charged by `orchestrator.exitProfileFor` when
 * capital leaves — but both decide what a depositor is agreeing to, so both
 * belong in the record. Before this module was named in `pricingParamsFor`
 * they were invisible to BOTH: two dials a builder sets, a route the vault
 * takes out of a fund, and a published record that stated neither.
 */
export interface LaneExitParams {
  /** Which of the issuer's routes this lane takes out of the position.
   *  `EXIT_ROUTE_OPTIONS` (modules.ts) is the vocabulary. */
  exitPath: string;
  /** Days from redemption request to cash, as the issuer publishes it — the
   *  descriptor pins it from the row (H-7: a `stated` reading, sourced to a
   *  named offering document, never a measurement). */
  settlementDays: number;
}

export interface LanePricingParams {
  venue: string;
  candidateId: string;
  launchableVenue: boolean;
  /** `WETH/USDC`, straight off the picked row. */
  pairLabel: string;
  /** The perp coin the hedge would short. Null when the row names none. */
  hlCoin: string | null;
  /** The chain the picked venue settles on. Null when unmapped. */
  chainId: number | null;
  riskPreset: RiskPreset;
  targetLeverage: number;
  hedge: LaneHedgeParams | null;
  compound: LaneCompoundParams | null;
  /** Null on every lane that seats no `redemption-route`, which is every lane
   *  off the treasury family. An absent module is a fact about the lane, not a
   *  missing dial — the same rule the `hedge` and `compound` fields follow. */
  exit: LaneExitParams | null;
}

/**
 * Venue → chain. The two Morpho venues are the pair `compile.ts` asserts
 * (`chainId !== 999 && chainId !== 8453` is its own rejection test, and
 * `venue: chainId === 8453 ? MorphoBlueBase : MorphoBlueHyperevm` its own
 * mapping); the two template venues name Base in their id and Base's id is
 * already a constant in `labels.ts`. `dolomite-berachain` is deliberately
 * absent: the canvas has no source for that id, and a guessed chain id is
 * a fabricated number. Unmapped publishes null, never a guess.
 */
const VENUE_CHAIN_ID: Partial<Record<CanvasVenueId, number>> = {
  // `aave-v3-base` was MISSING here until 2026-08-23 and nothing said so:
  // it is a scanned, projected venue whose every published record carried
  // `chainId: null`, because this map was written for the launchable venues
  // and then read by every priced lane. Base's id is not a guess — it is
  // BASE_CHAIN_ID in the scanner's own registry and already a constant in
  // labels.ts. Found by the generic registration test, which asserts the
  // invariant for every member of LEDGER_VENUES rather than for one venue.
  "aave-v3-base": 8453,
  "treasury-ausdc-base": 8453,
  "morpho-blue-base": 8453,
  "morpho-blue-ethereum": 1,
  "morpho-blue-hyperevm": 999,
  // The Hyperliquid NETWORK. HyperCore, where the perps and their funding
  // live, publishes no chain id of its own; 999 is the id the same network
  // publishes for HyperEVM and is already this map's entry above. It names
  // where the SHORT settles. The spot leg carries its own chain on the row
  // and is frequently a different one (wstETH is on mainnet, D3).
  "hyperliquid-funding": 999,
  "aerodrome-base": 8453,
  "options-base": 8453,
  /* The six treasury issuer venues. Ethereum mainnet is where every one of
     these funds' share tokens is issued in `vaults-data.json`, and 1 is
     already this map's entry for `morpho-blue-ethereum`. Each id's last
     hyphen segment is `ethereum`, so `chainOfVenue` and this map agree by
     construction rather than by convention. */
  "treasury-buidl-ethereum": 1,
  "treasury-usyc-ethereum": 1,
  "treasury-ousg-ethereum": 1,
  "treasury-usdy-ethereum": 1,
  "treasury-ustb-ethereum": 1,
  "treasury-uscc-ethereum": 1,
};

export function chainIdForVenue(venue: string): number | null {
  return VENUE_CHAIN_ID[venue as CanvasVenueId] ?? null;
}

/** Compound cadence as hours. `"24h"` → 24. */
export function cadenceHours(cadence: string | null | undefined): number | null {
  const n = Number(String(cadence ?? "").replace(/h$/, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The module params every priced and published path reads, per loop.
 *
 * ⚠ THIS FUNCTION READS LITERAL MODULE KEYS, AND THAT LIST IS A CENSUS
 * (WP-3, 2026-09-03). It named four — `liquidity-source`, `safety-buffer`,
 * `hedge`, `auto-compound` — and every module outside those four was invisible
 * to it. A fifth module can therefore be fully defined, fully clamped and
 * fully stored on the graph and still reach NOTHING: not the quote, which is
 * correct and deliberate for `redemption-route` (see
 * `QUOTE_AFFECTING_PARAMS`), but ALSO not the published record, which is not.
 * The two absences look identical from inside `modules.ts` and have opposite
 * verdicts, so the fifth key is read here explicitly.
 *
 * `exogenous-risk` is still absent, and that is a different answer rather than
 * the same oversight: the overlay is on no capital chain, it publishes through
 * `exogenous.ts`'s own derivation, and nothing in `LanePricingParams` is a
 * place to put a watcher's holds.
 */
export function pricingParamsFor(loop: LoopGraph): LanePricingParams {
  const src = nodeFor(loop, "liquidity-source");
  const hf = nodeFor(loop, "safety-buffer");
  const hedge = nodeFor(loop, "hedge");
  const compound = nodeFor(loop, "auto-compound");
  const exit = nodeFor(loop, "redemption-route");
  const venue = String(src?.data.params.venue ?? "");
  const hlCoin = String(src?.data.params.hlCoin ?? "");
  return {
    venue,
    candidateId: String(src?.data.params.candidateId ?? ""),
    launchableVenue: LAUNCHABLE_VENUES.has(venue as CanvasVenueId),
    pairLabel: String(src?.data.params.pairLabel ?? ""),
    hlCoin: hlCoin || null,
    chainId: chainIdForVenue(venue),
    riskPreset: String(hf?.data.params.riskPreset ?? "standard") as RiskPreset,
    /* NO SAFETY-BUFFER MEANS NO LEVERAGE, and that is a fact about the lane,
       not a missing dial (2026-08-22).
       ------------------------------------------------------------------
       This read `defNum("safety-buffer", "targetLeverage", 3)` — the
       descriptor's default — whenever the module was absent, so a lane with a
       market and no leverage module was priced as a 3x loop. Harmless while
       every lane was seeded with the whole spine; a phantom the moment the
       canvas can stand at "market pinned, nothing else placed", which is the
       state every module-first composition passes through.
       `PRODUCT_MIN_LEVERAGE` (1) is the unlevered machine: supply the
       collateral, borrow nothing. `repriceAtLeverage` prices exactly that
       since A2, and `grossCarry(c, 1)` is `cy`.
       The descriptor default still lands where it belongs — on the INSTALLED
       module, through `defaultParams` — so a default that moves still moves
       the price of a levered lane.

       THE FAMILY'S OWN DERIVATION IS THE OWNER (MTX-2, founder-approved
       re-pin 2026-09-01). The 2026-08-22 fix was narrowed to the loop family
       on the theory that this field was inert off it. It was not: `mockQuote`
       clamps whatever number stands here (2.869 at the lt fallback) and
       derives HF bands from it, and both leaked into the two published family
       records while the lanes' own hand-authored rows carry `loopLeverage: 1`.
       The narrowing also split one family in two — a dnlp subset without
       `auto-center` priced at 1, the same lane with it priced at 3, because
       `laneFamily` flips on a module that has nothing to do with leverage.
       So the branch is now module-only, on every family: installed,
       `safety-buffer` carries its params (and, through `defaultParams`, the
       descriptor default); absent, the lane is the unlevered machine, and the
       loop descriptor default is read nowhere else. */
    targetLeverage: hf
      ? num(hf.data.params.targetLeverage, defNum("safety-buffer", "targetLeverage", 3))
      : PRODUCT_MIN_LEVERAGE,
    hedge: hedge
      ? {
          hedgeLeverage: num(
            hedge.data.params.hedgeLeverage,
            defNum("hedge", "hedgeLeverage", 3),
          ),
          reserveFraction: num(
            hedge.data.params.reserveFraction,
            defNum("hedge", "reserveFraction", 0.15),
          ),
          /* THE HOUSE FLOOR HAS ONE OWNER (recette v2, DEF-01, 2026-09-02).
             This fallback spelled -0.05 a third time, beside the descriptor's
             own default and `deriveDescriptor`'s narrowing fallback. It is
             inert today because `defaultValueFor` answers first, and that is
             exactly the shape of a second owner that stops matching silently
             the next time the first one moves. */
          fundingFloorApr: num(
            hedge.data.params.fundingFloorApr,
            defNum("hedge", "fundingFloorApr", HOUSE_FUNDING_FLOOR_APR),
          ),
          fundingWindowEpochs: num(
            hedge.data.params.fundingWindowEpochs,
            defNum("hedge", "fundingWindowEpochs", 3),
          ),
        }
      : null,
    compound: compound
      ? {
          cadence: String(
            compound.data.params.cadence ?? defaultValueFor("auto-compound", "cadence") ?? "24h",
          ) as "6h" | "24h" | "72h",
          minActionUsd: num(
            compound.data.params.minActionUsd,
            defNum("auto-compound", "minActionUsd", 25),
          ),
        }
      : null,
    /* NO LITERAL FALLBACKS, per this file's own rule: every fallback is the
       descriptor's, so a default that moves moves the record with it. Both
       reads go through `defaultValueFor` / `defNum` with NO context, which is
       the structural descriptor — the honest answer for a node whose stored
       value is missing, since the narrowed value is exactly what `addModule`
       and `reclampLoopParams` already wrote onto the node. */
    exit: exit
      ? {
          exitPath: String(
            exit.data.params.exitPath ?? defaultValueFor("redemption-route", "exitPath") ?? "issuer",
          ),
          settlementDays: num(
            exit.data.params.settlementDays,
            defNum("redemption-route", "settlementDays", 0),
          ),
        }
      : null,
  };
}

// ── the published model record ────────────────────────────────────────────
//
// WHAT WAS BROKEN. The canvas published the market, the venue, a leverage
// number that was the dial's REQUEST rather than the applied value, and a
// subjective risk adjective. Everything else the user tuned was dropped, and
// the vault page then invented it: it guessed the liquidation threshold from
// the market's name, invented the health bands, hardcoded the hedge venue and
// the margin rule, restated a harvest threshold the schema had retired, and
// on a funding vault invented the guard floor that IS the strategy. Two
// vaults differing only in `fundingFloorApr`, `reserveFraction` or
// `minActionUsd` published byte-identical records.
//
// This derivation is pure and lives here, not in the component, for the same
// reason `pricingParamsFor` does: a record that decides what a depositor
// reads has to be runnable by a test.

/** Exactly the optional model fields `PublishInput` accepts (store.ts). */
export interface PublishedModel {
  liqLtv: number | null;
  appliedLeverage: number | null;
  hfTargetBps: number | null;
  hfDeleverageBps: number | null;
  hfFloorBps: number | null;
  hedgeLeverage: number | null;
  reserveFraction: number | null;
  hlCoin: string | null;
  deltaBandPct: number | null;
  marginTrimPct: number | null;
  marginRestorePct: number | null;
  fundingFloorApr: number | null;
  thresholdUsd: number | null;
  compoundCadenceHours: number | null;
  capacityBinding: string | null;
  chainId: number | null;
  blockNumber: number | null;
  /** The treasury lane's exit, as the lanes that seat `redemption-route`
   *  agree on it: which of the issuer's routes, and the window that route
   *  publishes. Null off every lane without the module. */
  exitRouteId: string | null;
  exitSettlementDays: number | null;
}

/** One lane, as the canvas holds it: its composition plus its live quote. */
export interface RecordLane {
  p: LanePricingParams;
  /** The lane's family (`laneFamily(loop.nodes)`), from the same graph the
   *  composition was read from. It decides which params the record MAY state:
   *  only the loop family runs a borrow leg, so `liqLtv`, `appliedLeverage`
   *  and the HF bands publish null off any other family (MTX-2). */
  family: LaneFamily;
  /** The priced row's liquidation threshold. */
  lt: number | null;
  /** The leverage the model APPLIED after the house clamp. */
  appliedLeverage: number | null;
  /** The perp coin the priced row names, when the graph does not. */
  rowHlCoin: string | null;
  blockNumber: number | null;
  /** Bands as the quote produced them. `margin` is null off the live rail. */
  bands: { hf: HfBands; margin: HlMarginBandsDerived | null } | null;
}

/**
 * One value across the lanes that VOTE, or null.
 *
 * An averaged envelope is not an envelope: two lanes at 2.00x and 4.00x are
 * not a vault at 3.00x, and a vault page drawing one protection band over
 * two different positions is drawing a band that protects neither. But a
 * lane that has no such quantity casts no vote. This used to take EVERY
 * lane, so on the loop + USDC lending pair the treasury lane voted null on
 * the loop's leverage and the record published `appliedLeverage: null`,
 * which the reader takes as a DECLINED envelope: the Dynamic leverage card
 * fell to an `Also installed` prose row, Parameters lost its envelope rows
 * and the Verification canvas printed `NOT COMPOSED` on a loop the canvas
 * had priced at 2.50x (founder, 2026-09-08). The caller now hands in only
 * the lanes the quantity is a fact about, and those must agree.
 */
function agreed<T>(lanes: RecordLane[], read: (l: RecordLane) => T | null | undefined): T | null {
  if (lanes.length === 0) return null;
  const head = read(lanes[0]);
  if (head === null || head === undefined) return null;
  return lanes.every((l) => read(l) === head) ? head : null;
}

/**
 * A module's dials across the lanes that SEAT it: the one lane's where one
 * does, the shared value where several do and agree (by content, since these
 * are objects), null otherwise. A lane without the module casts no vote, for
 * the reason `agreed` gives.
 */
function seated<T>(lanes: RecordLane[], read: (l: RecordLane) => T | null | undefined): T | null {
  const holders = lanes.filter((l) => {
    const v = read(l);
    return v !== null && v !== undefined;
  });
  if (holders.length === 0) return null;
  const head = read(holders[0]) as T;
  const key = JSON.stringify(head);
  return holders.every((l) => JSON.stringify(read(l)) === key) ? head : null;
}

/**
 * Every parameter the canvas composed, in the shape the vault record accepts.
 *
 * A value states what the user saw. `null` states that the model declines to
 * state it, and the reader renders nothing or falls to its own documented
 * backfill. Nothing here is defaulted to a number that was not on screen.
 */
export function publishedModelRecord(
  lanes: RecordLane[],
  capacityBinding: string | null,
  /** The size the band is stated at. A published vault opens at the seed TVL
   *  `store.ts` gives it, and the executable-order floor inside
   *  `derivedDeltaBandPct` is a function of size, so the band is quoted at
   *  the size the vault actually opens with. */
  openingTvlUsd = 25_000,
): PublishedModel {
  /* ONLY THE FAMILY'S OWN PARAMS (MTX-2, founder-approved 2026-09-01), AND
     ONLY THE FAMILY VOTES (2026-09-08). `liqLtv`, `appliedLeverage` and the
     three HF bands describe the borrow leg only the loop family runs. A dnlp
     or collar lane's quote still carries all three, `mockQuote` clamps and
     bands whatever leverage it is handed, and publishing them verbatim
     stamped the collar record with `appliedLeverage: 2.869` and health bands
     for a leg that does not exist. Off the loop family the record declines to
     state them; the loop lanes that are there vote among themselves. */
  const loops = lanes.filter((l) => l.family === "loop");
  const hf = seated(loops, (l) => l.bands?.hf ?? null);
  /* Each module's dials from the lanes that seat it. A single lane is its own
     one holder, so a single-lane record is byte for byte what it was. */
  const hedge = seated(lanes, (l) => l.p.hedge);
  const compound = seated(lanes, (l) => l.p.compound);
  /* HERO-SHAPE GATE (roadmap P2 #6). `redemption-route` only seats on the
     TREASURY family (`graph-ops.FAMILY_CHAINS.treasury`), so a hero (loop
     lane + treasury floor lane) that lifts either lane's exit onto the
     record used to stamp the deployed LOOP vault with the treasury lane's
     `exit_route_id=instant-usdc`. The vault-nav component's refuse list
     then killed every cycle. A single treasury lane still publishes its
     own exit; a hero composition publishes null and defers the route to
     whichever component first honors redemption-route. */
  const hasLoop = lanes.some((l) => l.family === "loop");
  const exit = hasLoop ? null : seated(lanes, (l) => l.p.exit);
  /* The HL margin ladder is coin-dependent (`deriveHlMarginBands` off the
     coin's own max leverage) and the canvas payload carries no HL coin
     table, so it exists only when the live reprice rail supplied it. Absent,
     the field publishes null rather than a literal that happens to match one
     coin. The reader's own 13 → 28 backfill is documented as exactly that. */
  const margin = seated(
    lanes.filter((l) => l.p.hedge),
    (l) => l.bands?.margin ?? null,
  );
  return {
    liqLtv: agreed(loops, (l) => l.lt),
    appliedLeverage: agreed(loops, (l) => l.appliedLeverage),
    hfTargetBps: hf?.hfTargetBps ?? null,
    hfDeleverageBps: hf?.hfDeleverageBps ?? null,
    hfFloorBps: hf?.hfFloorBps ?? null,
    hedgeLeverage: hedge?.hedgeLeverage ?? null,
    reserveFraction: hedge?.reserveFraction ?? null,
    hlCoin: seated(lanes, (l) => l.p.hlCoin ?? l.rowHlCoin ?? null),
    // DERIVED, not tuned (modules.ts R1). The band is a function of the
    // escrow fraction the two hedge dials set and of the size being resized,
    // so it still moves with the composition, and the reader stops falling
    // back to the 0.5 the dial used to ship.
    deltaBandPct: hedge
      ? derivedDeltaBandPct(fbForComposition({ hedge, compound: null }), openingTvlUsd)
      : null,
    // The ladder is a fraction of notional; the record's unit is percent.
    marginTrimPct: margin ? margin.safetyFloor * 100 : null,
    marginRestorePct: margin ? margin.restore * 100 : null,
    fundingFloorApr: hedge?.fundingFloorApr ?? null,
    thresholdUsd: compound?.minActionUsd ?? null,
    compoundCadenceHours: cadenceHours(compound?.cadence),
    capacityBinding,
    chainId: agreed(lanes, (l) => l.p.chainId),
    blockNumber: agreed(lanes, (l) => l.blockNumber),
    exitRouteId: exit?.exitPath ?? null,
    exitSettlementDays: exit?.settlementDays ?? null,
  };
}
