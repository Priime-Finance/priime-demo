/**
 * The catalog this build serves: the six committed scanner snapshots, projected
 * by the kit's own projectors, with the demo market's row spliced into the
 * Morpho Blue Base venue.
 *
 * On build.priime.finance the loader behind the opportunities route and the
 * copilot route reads a durable store first and falls back to these snapshots
 * (`opportunities-server.ts`, not ported). Here the snapshots ARE the catalog
 * of record, so both routes read this file and nothing else, and a live
 * catalog behind the opportunities route reaches the copilot automatically.
 *
 * `reconcileHedgeFunding` runs exactly as the live loader runs it (QNT-1): one
 * funding register per book, at the API boundary, over the full venue set.
 */

import type { OpportunitiesPayload } from "@/components/canvas/types";
import { floorRowToday } from "@/lib/canvas/router-history";
import { MODELED_CONTENT_HASH } from "@/lib/canvas/unified-list";
import snapAave from "@/lib/canvas/fixtures/aave-v3-base.json";
import snapDolomite from "@/lib/canvas/fixtures/dolomite-v1.json";
import snapHlFunding from "@/lib/canvas/fixtures/hyperliquid-funding.json";
import snapMorphoBase from "@/lib/canvas/fixtures/morpho-blue-base.json";
import snapMorphoEth from "@/lib/canvas/fixtures/morpho-blue-ethereum.json";
import snapHyper from "@/lib/canvas/fixtures/morpho-blue-hyperevm.json";
import { isLiveMarket } from "@/lib/demo-scope";
import { demoMarketCandidate } from "@/lib/demo/market";
import type { CandidateDocument } from "@/lib/strategy-factory/types";
import type { VenueDocV2 } from "@/lib/strategy-factory/venues/types";

import { projectDolomiteDoc, projectVenueDocV2, VENUE_LABELS, type ProjectedVenue } from "./opportunities";
import { reconcileHedgeFunding } from "./perp-books";
import type { SourcedProjectedVenue } from "./server-shim";

/**
 * The six committed venues, in the loader's own order (sorted by venue id, as
 * `loadAllVenues` sorts them). The floor venue joins them in `demoVenues`.
 */
function projectAll(nowMs: number): ProjectedVenue[] {
  const v2 = [snapAave, snapMorphoBase, snapMorphoEth, snapHyper, snapHlFunding].map((doc) =>
    projectVenueDocV2(doc as unknown as VenueDocV2, nowMs),
  );
  const dolomite = projectDolomiteDoc(snapDolomite as unknown as CandidateDocument, nowMs);
  return [...v2, dolomite].sort((a, b) => a.venue.localeCompare(b.venue));
}

/** The demo row takes the head of its venue's unhedged section; a row with the same id never survives beside it. */
function spliceDemoRow(venues: ProjectedVenue[]): ProjectedVenue[] {
  const demo = demoMarketCandidate();
  return venues.map((v) =>
    v.venue === demo.venue
      ? {
          ...v,
          hedged: v.hedged.filter((c) => c.id !== demo.id),
          unhedged: [demo, ...v.unhedged.filter((c) => c.id !== demo.id)],
        }
      : v,
  );
}

/**
 * THE ROUTER'S FLOOR LANE, SERVED AS ITS OWN VENUE (router lane plan R1).
 *
 * The floor is a hand-authored issuer row, not a scanned market, so it belongs
 * to no scanner snapshot. On the live app such a row reaches the client only
 * through `modeledRows()` and a lane pins it through `templateCatalogHit`,
 * which returns the SHIPPED `TREASURY_CANDIDATES` row and its own 2026-09-03
 * capture. The router prices the same reserve from the 2026-09-07 capture, and
 * `catalogRow` beats `templateCatalogHit` in `param-context.ts`, so serving the
 * row here is what makes the dock card, the lane's own quote, the published
 * record and the router instrument read ONE number.
 *
 * `floorRowToday()` is that number's owner and nothing is priced here. The
 * venue carries `MODELED_CONTENT_HASH`, the same hash `modeledRows` stamps: a
 * hand-authored row has no scan document behind it and must not claim one.
 * Null when the capture has no aligned day, in which case the catalog is the
 * six snapshots exactly as before.
 */
function floorVenue(nowMs: number): ProjectedVenue | null {
  const row = floorRowToday();
  if (!row) return null;
  return {
    venue: "treasury-ausdc-base",
    label: VENUE_LABELS["treasury-ausdc-base"],
    generatedAtMs: nowMs,
    blockNumber: 0,
    contentHash: MODELED_CONTENT_HASH,
    stale: false,
    launchable: false,
    hedged: [],
    unhedged: [row],
  };
}

/** Every committed venue plus the floor, the demo row spliced in, funding reconciled. The opportunities route's body. */
export function demoVenues(nowMs: number): OpportunitiesPayload {
  const floor = floorVenue(nowMs);
  const all = [...projectAll(nowMs), ...(floor ? [floor] : [])].sort((a, b) =>
    a.venue.localeCompare(b.venue),
  );
  const reconciled = reconcileHedgeFunding(spliceDemoRow(all));
  const venues: SourcedProjectedVenue[] = reconciled.map((v) => ({ ...v, source: "snapshot" }));
  return { ok: true, nowMs, venues, degraded: [] };
}

/** The same payload narrowed to the live rows: exactly one. The copilot's market list. */
export function liveVenues(nowMs: number): OpportunitiesPayload {
  const all = demoVenues(nowMs);
  const venues = all.venues
    .map((v) => ({
      ...v,
      hedged: v.hedged.filter((c) => isLiveMarket(c.id)),
      unhedged: v.unhedged.filter((c) => isLiveMarket(c.id)),
    }))
    .filter((v) => v.hedged.length + v.unhedged.length > 0);
  return { ...all, venues };
}
