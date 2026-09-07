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

import { projectDolomiteDoc, projectVenueDocV2, type ProjectedVenue } from "./opportunities";
import { reconcileHedgeFunding } from "./perp-books";
import type { SourcedProjectedVenue } from "./server-shim";

/**
 * The six committed venues, in the loader's own order (sorted by venue id, as
 * `loadAllVenues` sorts them).
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

/** Every committed venue, the demo row spliced in, funding reconciled. The opportunities route's body. */
export function demoVenues(nowMs: number): OpportunitiesPayload {
  const reconciled = reconcileHedgeFunding(spliceDemoRow(projectAll(nowMs)));
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
