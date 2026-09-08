/**
 * Liquidity-source opportunity projection (BC-P2).
 *
 * Pure functions from scanner KV docs (VenueDocV2 + the v1 Dolomite doc) to
 * the client-safe catalog shape. Deliberate field projection: symbols and
 * economics survive; token/oracle addresses, operator notes, scanStats and
 * ineligible spam rows do not.
 *
 * Floor policy (founder ruling 2026-07-28): the 8% house floor is the DEFAULT
 * of a user-tunable screen, not a hard gate. The API returns every scanned
 * candidate with economics; screening happens client-side at the user's floor,
 * and sub-house-floor selections carry the warning register in the UI.
 *
 * ECON-M ruling holds: hedged (A, `score`) and unhedged (N1, `scoreN1`/
 * `apyRiskAdj`) are separate sections, never interleaved.
 */

/* eslint-disable @typescript-eslint/array-type, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/prefer-regexp-exec --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { ECON_FLOOR_APY } from "@/lib/model-constants";
import type { CandidateDocument } from "@/lib/strategy-factory/types";
import type { CandidateV2, VenueDocV2 } from "@/lib/strategy-factory/venues/types";

export const HOUSE_FLOOR_APR = ECON_FLOOR_APY;
export const STALE_MS = 24 * 60 * 60 * 1000;

export type CanvasVenueId =
  | "aave-v3-base"
  | "morpho-blue-base"
  | "morpho-blue-ethereum"
  | "morpho-blue-hyperevm"
  | "hyperliquid-funding"
  | "dolomite-berachain"
  // Template mock venues (TEMPLATE_DEEPLINKS 2026-08-21): modeled rows the
  // template registry ships; never scanned, never launchable, never listed
  // in the discovery catalog.
  | "aerodrome-base"
  | "options-base"
  /**
   * THE SIX TREASURY ISSUER VENUES (BASIS CARRY + TREASURY FLOOR).
   *
   * SHAPE IS LOAD-BEARING: every venue id is `${protocol}-${chain}` because
   * `chainOfVenue` (orchestrator/rule-schema.ts) takes the LAST hyphen
   * segment and hands it to the router's same-chain friction test. A venue id
   * whose last segment is not a chain silently reprices every move in the
   * portfolio, and nothing would say so. Here the protocol segment is
   * `treasury-<token>` and the chain segment is `ethereum`, which resolves in
   * `VENUE_CHAIN_ID` (pricing-params.ts) to 1.
   *
   * WHICH SIX, and where they come from: the six Ethereum-resident tokenized
   * treasury products in `priime/brand/vaults-data.json`'s `protocols` array
   * with the CLO fund filtered out by name — BUIDL (blackrock-buidl), USYC
   * (circle-usyc), OUSG and USDY (ondo-yield-assets, two products from one
   * protocol), USTB (invesco-ustb) and USCC (bitwise-uscc). Six rows rather
   * than one so the BUILDER picks the issuer, and so `exitPath` has real
   * cross-issuer variation to be a control about.
   *
   * NEVER in `LAUNCHABLE_VENUES` (no rail), never in `CatalogVenueId` /
   * `LEDGER_VENUES` / `ALL_VENUES` / `SNAPSHOTS` (nothing scans them). They
   * are modeled rows, exactly like the two template venues above.
   */
  | "treasury-ausdc-base"
  | "treasury-buidl-ethereum"
  | "treasury-usyc-ethereum"
  | "treasury-ousg-ethereum"
  | "treasury-usdy-ethereum"
  | "treasury-ustb-ethereum"
  | "treasury-uscc-ethereum";

export const VENUE_LABELS: Record<CanvasVenueId, string> = {
  "aave-v3-base": "Aave v3 · Base",
  "morpho-blue-base": "Morpho Blue · Base",
  "morpho-blue-ethereum": "Morpho Blue · Ethereum",
  "morpho-blue-hyperevm": "Morpho Blue · HyperEVM",
  "hyperliquid-funding": "Hyperliquid · funding",
  "dolomite-berachain": "Dolomite · Berachain",
  "aerodrome-base": "Aerodrome · Base",
  "options-base": "Options venue · Base",
  /* The TOKEN, then the chain. The issuer's own name is a property of the row
     (WP-2 builds it from `vaults-data.json`), not of the venue id: a label
     here that attributes a fund to a manager is a second, unsourced spelling
     of a fact the row already carries. */
  "treasury-ausdc-base": "Aave v3 · Base",
  "treasury-buidl-ethereum": "BUIDL · Ethereum",
  "treasury-usyc-ethereum": "USYC · Ethereum",
  "treasury-ousg-ethereum": "OUSG · Ethereum",
  "treasury-usdy-ethereum": "USDY · Ethereum",
  "treasury-ustb-ethereum": "USTB · Ethereum",
  "treasury-uscc-ethereum": "USCC · Ethereum",
};

/** Venues the launch rail can actually serve today (plan: Morpho-first).
 *
 *  `morpho-blue-ethereum` is DELIBERATELY ABSENT (2026-08-23). The venue is
 *  scanned, projected and screenable, but the rail behind a launch is not on
 *  this chain: `compile.ts` rejects any chainId other than 8453/999 by its own
 *  test, `live-scan.ts` answers for the two launchable Morpho venues only, and
 *  no UserVault factory is deployed on mainnet. Listing it here would render a
 *  Launch button over a rail that does not exist; leaving it out renders the
 *  "venue not launchable yet" register the projector already ships.
 *
 *  `hyperliquid-funding` is DELIBERATELY ABSENT too (2026-08-23), and for a
 *  reason of a different kind: founder decision D2 says a funding row
 *  publishes as `launchable: false` WITH full economics, on purpose. The
 *  economics are real and measured; the rail is not built. A funding lane
 *  holds a spot asset (frequently on another chain — wstETH is on mainnet)
 *  and runs a short on HyperCore, and `compile.ts` has no such shape. So the
 *  row prices, screens and explains itself, and does not offer a button. */
export const LAUNCHABLE_VENUES: ReadonlySet<CanvasVenueId> = new Set([
  "morpho-blue-base",
  "morpho-blue-hyperevm",
]);

/** Template mock venues: modeled rows shipped by the template registry.
 *  Never scanned, never launchable, never in the discovery catalog. */
export const TEMPLATE_VENUES: ReadonlySet<CanvasVenueId> = new Set([
  "aerodrome-base",
  "options-base",
  /* The six issuer venues belong here for the same reason the two above do:
     the rows are shipped by the registry, priced by a hand-authored model,
     and never scanned. Membership is what keeps them out of the discovery
     catalog's scanned sections. */
  "treasury-ausdc-base",
  "treasury-buidl-ethereum",
  "treasury-usyc-ethereum",
  "treasury-ousg-ethereum",
  "treasury-usdy-ethereum",
  "treasury-ustb-ethereum",
  "treasury-uscc-ethereum",
]);

export function isTemplateVenue(venue: string): boolean {
  return TEMPLATE_VENUES.has(venue as CanvasVenueId);
}

/**
 * CAN THIS FUNDING ROW COMPOSE A LANE? — the ROW-level owner predicate of the
 * funding launch rail (2026-08-24).
 *
 * True on exactly the rows the rack can honestly build: the funding venue's
 * own rows, priced (`economics` present), with a MEASURED spot leg to hold
 * against the short. A funding book with no registered leg has no deposit
 * asset and therefore no lane — those rows stay screen-only in the catalog's
 * `Nothing to hold` group, and this predicate is what keeps them there.
 *
 * The GRAPH-level sibling — where all a lane holds is the id it pinned — is
 * `fundingClassCandidateId` (templates.ts), keyed on the scanner's own id
 * prefix. `LAUNCHABLE_VENUES` is deliberately untouched: it owns the
 * compile-rail fact, and a funding lane enters review through the same
 * eyes-open disjunct the dn-LP and collar templates use, never through a
 * venue flip.
 */
export function fundingComposable(r: ProjectedCandidate | null | undefined): boolean {
  return !!r && r.venue === "hyperliquid-funding" && !!r.economics && !!r.economics.spotLeg;
}

export interface ProjectedCandidate {
  id: string;
  venue: CanvasVenueId;
  cls: "A" | "N1";
  pair: string;
  collateralSymbol: string;
  debtSymbol: string;
  hlCoin: string | null;
  /** The perp venue's own max leverage for `hlCoin`, read off the scan's
   *  `native_perp` gate (`maxLev=N`) — the book's own limit, and the input
   *  `hedgeLeverageCeiling` derives the hedge dial's ceiling from (D3,
   *  2026-09-01). OPTIONAL so every existing producer and committed fixture
   *  projects byte-identically; absent where the scan wrote no figure. */
  coinMaxLeverage?: number | null;
  eligible: boolean;
  eligibleWithRewards: boolean | null;
  /** Liquidation threshold used by the scan (public chain parameter) — the
   *  client risk dial derives house-max leverage from it via the EXISTING
   *  houseMaxLeverage/clampLeverage functions. Null when no economics. */
  lt: number | null;
  /** Headline for screening: A = net APY on deposit; N1 = risk-adjusted APY. */
  headlineApr: number | null;
  score: number | null;
  scoreN1: number | null;
  apyRiskAdj: number | null;
  economics: {
    netApyOnDepositApy: number;
    netCarryOnEquityApy: number;
    loopLeverage: number;
    targetLtv: number;
    capacityUsd: number;
    capacityBinding: string;
    fundingP25Apr: number | null;
    collateralYieldApy: number;
    borrowApyMarginal: number;
    // ── The funding venue's evidence (founder D1), OPTIONAL ─────────────
    // Present only on rows whose scanner emitted them, so every existing
    // row projects byte-identically. A funding row's number is
    // `min(p25 over 30d, 90d, 180d, 365d)` and a reader who cannot see
    // WHICH window won cannot tell a book that is boringly positive over a
    // year from one that is positive over a quarter and was p25 −55.5% over
    // the year before it.
    /** The scanner's own execution drag, the structural cost term. It sits in
     *  the slot `borrow` occupies on a loop card, and it is the third term of
     *  the identity the funding scanner writes out verbatim in its
     *  `marginal_rates_carry` gate:
     *    net APY on deposit = escrow x (spot + funding − drag)
     *  Projected wherever a v2 scanner emits it; the v1 Dolomite doc has no
     *  such field and carries none. */
    executionDragApr?: number | null;
    fundingWindowDays?: number | null;
    fundingWindows?: Array<{
      days: number;
      hours: number;
      p25Apr: number;
      fractionNegative: number;
      longestNegativeStreakHours: number;
    }>;
    fundingAsOfMs?: number | null;
    fundingSpanDays?: number | null;
    /** The asset held against the short, and where it lives (D3). Null = no
     *  spot leg registered, which the funding-only ceiling says cannot clear
     *  the screen — shown, not hidden. */
    spotLeg?: {
      symbol: string;
      protocol: string;
      chain: string;
      chainId: number | null;
      apy: number | null;
      source: string;
      reachable: boolean;
      tvlUsd: number | null;
    } | null;
  } | null;
  firstFailedGate: string | null;
  /** Every failing gate id (recette P2-2: the "gates N/M" chip must open the
   *  full failing list, not dead-end at a count). Ids only, never details. */
  failedGates: string[];
  gatesPassed: number;
  gatesTotal: number;
  /** false = row renders with the "venue not launchable yet" register. */
  launchable: boolean;
}

export interface ProjectedVenue {
  venue: CanvasVenueId;
  label: string;
  generatedAtMs: number;
  blockNumber: number;
  contentHash: string;
  stale: boolean;
  launchable: boolean;
  hedged: ProjectedCandidate[];
  unhedged: ProjectedCandidate[];
}

function round(v: number | null | undefined, dp = 6): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(dp)) : null;
}

/**
 * A row that borrows NOTHING (2026-08-23, `hyperliquid-funding`).
 *
 * Two projections change on such a row, and both changes are the difference
 * between a fact and a claim:
 *
 *  · `lt`. `round(0)` is `0`, and `0` reads as "the liquidation threshold is
 *    zero" — the most dangerous number on the card. A spot-class row has no
 *    debt, so it has no liquidation threshold at all, and `null` is what
 *    "not applicable" is spelled as everywhere else in this shape. Every
 *    consumer already handles null (`mockQuote` falls through to its own
 *    default exactly as it does for `0`).
 *
 *  · `netApyOnDepositApy` / `netCarryOnEquityApy` stop being rounded to 6dp.
 *    These two are NOT independent: `hedge-econ.ts`'s identity assert reduces
 *    to `netApy === f_b · netCarry` and blanks every hedge readout on the lane
 *    when it misses by more than 1e-9. Every OTHER row satisfies it because
 *    `repriceAtLeverage` recomputes both from the same f_b before anything
 *    reads them — but that function returns a row with `loopLeverage <= 1`
 *    UNTOUCHED (its own guard, and the ratified behaviour for these rows), so
 *    the projection is the last thing to touch these numbers. Rounding two
 *    dependent quantities independently at 6dp injects disagreement of order
 *    f_b·5e-7. MEASURED over the committed live document (2026-08-23):
 *      max |netApy − f_b·netCarry| unrounded  = 0 exactly
 *      max |netApy − f_b·netCarry| at 6dp     = 7.4e-7  — 741x the tolerance
 *    Nothing else moves: `Number(v.toFixed(6))` is the identity on a value
 *    that is already 6dp, and every scanner row with real leverage keeps its
 *    rounding untouched.
 */
function borrowsNothing(e: CandidateV2["economics"]): boolean {
  return !!e && e.loopLeverage <= 1 && e.borrowApyMarginal === 0;
}

/** The venue's own max leverage for the row's coin, as the scan's
 *  `native_perp` gate states it (`HL ETH idx=1 maxLev=25`) — the same read
 *  `lib/vaults/seeds.ts` performs on the committed docs. Null where the gate
 *  or the figure is absent, and the hedge dial keeps its structural bound
 *  there (D3, 2026-09-01). */
function gateCoinMaxLeverage(gates: ReadonlyArray<{ gate: string; detail?: string }>): number | null {
  const detail = gates.find((g) => g.gate === "native_perp")?.detail ?? "";
  const m = detail.match(/maxLev=(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

export function projectV2Candidate(c: CandidateV2, launchable: boolean): ProjectedCandidate {
  const failedAll = c.gates.filter((g) => !g.pass);
  const failed = failedAll[0];
  const e = c.economics;
  const unlevered = borrowsNothing(e);
  const cml = gateCoinMaxLeverage(c.gates);
  const headline =
    c.cls === "N1" ? round(c.apyRiskAdj) : unlevered ? (e?.netApyOnDepositApy ?? null) : round(e?.netApyOnDepositApy ?? null);
  return {
    id: c.id,
    venue: c.venue as CanvasVenueId,
    cls: c.cls as "A" | "N1",
    // No debt leg means no pair. `kHYPE/` is not a market name.
    pair: c.debt.symbol ? `${c.collateral.symbol}/${c.debt.symbol}` : c.collateral.symbol,
    collateralSymbol: c.collateral.symbol,
    debtSymbol: c.debt.symbol,
    hlCoin: c.hlCoin,
    ...(cml !== null ? { coinMaxLeverage: cml } : {}),
    eligible: c.eligible,
    eligibleWithRewards: c.eligibleWithRewards,
    lt: unlevered ? null : round(e?.ltUsed ?? null, 4),
    headlineApr: headline,
    score: c.score,
    scoreN1: c.scoreN1,
    apyRiskAdj: round(c.apyRiskAdj),
    economics: e
      ? {
          netApyOnDepositApy: (unlevered ? e.netApyOnDepositApy : round(e.netApyOnDepositApy)) ?? 0,
          netCarryOnEquityApy: (unlevered ? e.netCarryOnEquityApy : round(e.netCarryOnEquityApy)) ?? 0,
          loopLeverage: round(e.loopLeverage, 3) ?? 0,
          targetLtv: round(e.targetLtv, 4) ?? 0,
          capacityUsd: Math.round(e.capacityUsd),
          capacityBinding: e.capacityBinding,
          fundingP25Apr: round(e.fundingP25Apr),
          collateralYieldApy: round(e.collateralYieldApy) ?? 0,
          borrowApyMarginal: round(e.borrowApyMarginal) ?? 0,
          executionDragApr: round(e.executionDragApr),
          ...(e.fundingWindowDays !== undefined ? { fundingWindowDays: e.fundingWindowDays } : {}),
          ...(e.fundingWindows
            ? {
                fundingWindows: e.fundingWindows.map((w) => ({
                  days: w.days,
                  hours: w.hours,
                  p25Apr: round(w.p25Apr) ?? 0,
                  fractionNegative: round(w.fractionNegative, 4) ?? 0,
                  longestNegativeStreakHours: w.longestNegativeStreakHours,
                })),
              }
            : {}),
          ...(e.fundingAsOfMs !== undefined ? { fundingAsOfMs: e.fundingAsOfMs } : {}),
          ...(e.fundingSpanDays !== undefined ? { fundingSpanDays: e.fundingSpanDays } : {}),
          ...(e.spotLeg !== undefined
            ? {
                spotLeg: e.spotLeg
                  ? { ...e.spotLeg, apy: round(e.spotLeg.apy), tvlUsd: e.spotLeg.tvlUsd === null ? null : Math.round(e.spotLeg.tvlUsd) }
                  : null,
              }
            : {}),
        }
      : null,
    firstFailedGate: failed ? failed.gate : null,
    failedGates: failedAll.map((g) => g.gate),
    gatesPassed: c.gates.filter((g) => g.pass).length,
    gatesTotal: c.gates.length,
    launchable,
  };
}

export function projectVenueDocV2(doc: VenueDocV2, nowMs: number): ProjectedVenue {
  const venue = doc.venue as CanvasVenueId;
  const launchable = LAUNCHABLE_VENUES.has(venue);
  const projected = (doc.candidates as CandidateV2[]).map((c) =>
    projectV2Candidate(c, launchable),
  );
  return {
    venue,
    label: VENUE_LABELS[venue] ?? venue,
    generatedAtMs: doc.generatedAtMs,
    blockNumber: doc.blockNumber,
    contentHash: doc.contentHash,
    stale: nowMs - doc.generatedAtMs > STALE_MS,
    launchable,
    hedged: projected.filter((c) => c.cls === "A"),
    unhedged: projected.filter((c) => c.cls === "N1"),
  };
}

/** The v1 Dolomite doc predates the venue registry; adapt it to the same shape. */
export function projectDolomiteDoc(doc: CandidateDocument, nowMs: number): ProjectedVenue {
  const hedged = doc.candidates.map((c): ProjectedCandidate => {
    const failedAll = c.gates.filter((g) => !g.pass);
    const failed = failedAll[0];
    const e = c.economics;
    const cml = gateCoinMaxLeverage(c.gates);
    return {
      id: `dolomite-berachain:${c.id}`,
      venue: "dolomite-berachain",
      cls: "A",
      pair: `${c.collateral.symbol}/${c.debt.symbol}`,
      collateralSymbol: c.collateral.symbol,
      debtSymbol: c.debt.symbol,
      hlCoin: c.hlCoin,
      ...(cml !== null ? { coinMaxLeverage: cml } : {}),
      eligible: c.eligible,
      eligibleWithRewards: null,
      lt: round(e?.ltUsed ?? null, 4),
      headlineApr: round(e?.netApyOnDepositApr ?? null),
      score: c.score,
      scoreN1: null,
      apyRiskAdj: null,
      economics: e
        ? {
            netApyOnDepositApy: round(e.netApyOnDepositApr) ?? 0,
            netCarryOnEquityApy: round(e.netCarryOnEquityApr) ?? 0,
            loopLeverage: round(e.loopLeverage, 3) ?? 0,
            targetLtv: round(e.targetLtv, 4) ?? 0,
            capacityUsd: Math.round(e.capacityUsd),
            capacityBinding: e.capacityBinding,
            fundingP25Apr: round(e.fundingP25Apr),
            collateralYieldApy: round(e.collateralYieldApr) ?? 0,
            borrowApyMarginal: round(e.borrowAprMarginal) ?? 0,
          }
        : null,
      firstFailedGate: failed ? failed.gate : null,
      failedGates: failedAll.map((g) => g.gate),
      gatesPassed: c.gates.filter((g) => g.pass).length,
      gatesTotal: c.gates.length,
      launchable: false,
    };
  });
  return {
    venue: "dolomite-berachain",
    label: VENUE_LABELS["dolomite-berachain"],
    generatedAtMs: doc.generatedAtMs,
    blockNumber: doc.dolomiteBlock,
    contentHash: doc.contentHash,
    stale: nowMs - doc.generatedAtMs > STALE_MS,
    launchable: false,
    hedged,
    unhedged: [],
  };
}

/**
 * The screenable rate for a row (recette B3, data half).
 *
 * `headlineApr` is `apyRiskAdj` on a class-N1 row, and `apyRiskAdj` is null on
 * EVERY unhedged row the live scanners emit today — the risk adjustment is not
 * computed by the N1 path. A null there is not "this market has no rate": the
 * row carries a fully modelled `netApyOnDepositApy` that the lane prices from
 * the moment it is picked. Printing `—` on a card whose lane prices at 2.9% is
 * the catalog refusing to show a number it already holds.
 *
 * So: the row's own headline when it has one, the modelled net APY on deposit
 * when it does not, null only when the row carries no economics at all (three
 * Dolomite rows). It NEVER overwrites a headline that exists, which is why it
 * is safe to run over hand-authored rows (templates, demo seeds) too.
 *
 * NOT applied inside `projectV2Candidate`: `__tests__/opportunities.test.ts`
 * asserts `headlineApr === apyRiskAdj` verbatim on the per-doc projection, and
 * that file is owned elsewhere. The catalog projection (`unified-list`) is the
 * shopping surface and applies it there. See the handoff note in that file.
 */
export function screeningApr(c: ProjectedCandidate): number | null {
  if (typeof c.headlineApr === "number" && Number.isFinite(c.headlineApr)) return c.headlineApr;
  const n = c.economics?.netApyOnDepositApy;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** User-floor screening: clears = headline ≥ floor. Sub-house-floor rows are
 *  selectable but carry the warning register (UI concern, not filtered here). */
export function clearsFloor(c: ProjectedCandidate, floorApr: number): boolean {
  return typeof c.headlineApr === "number" && c.headlineApr >= floorApr;
}

export type SelectionState =
  | { kind: "none" }
  | { kind: "valid"; candidate: ProjectedCandidate }
  | { kind: "doc-changed"; candidate: ProjectedCandidate }
  | { kind: "gone" };

/** Pin check: a selection made pre-scan must be visibly invalidated post-scan. */
export function selectionState(
  params: { candidateId?: unknown; contentHash?: unknown },
  venueDoc: ProjectedVenue | null,
): SelectionState {
  const id = typeof params.candidateId === "string" ? params.candidateId : "";
  if (!id || !venueDoc) return { kind: "none" };
  const candidate = [...venueDoc.hedged, ...venueDoc.unhedged].find((c) => c.id === id);
  if (!candidate) return { kind: "gone" };
  const pinned = typeof params.contentHash === "string" ? params.contentHash : "";
  if (pinned && pinned !== venueDoc.contentHash) return { kind: "doc-changed", candidate };
  return { kind: "valid", candidate };
}
