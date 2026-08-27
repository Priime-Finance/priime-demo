/**
 * Unified cross-venue discovery list (UX_ITERATION_3 §1; ranking reworked
 * per recette P1-8).
 *
 * Pure projection from the /api/canvas/opportunities payload to ONE ranked
 * list across all connected venues. Venue is a CHIP on each row, never a
 * gate before the list. ECON-M holds verbatim: hedged (A) and unhedged (N1)
 * stay separate sections, never interleaved — the two arrays never mix.
 *
 * Ranking is by ACTIONABILITY first (P1-8): rows on launchable venues rank
 * above venue-blocked rows unconditionally — a dead card must never sit
 * above the only market that can actually launch. Within each actionability
 * group: headline APY desc, nulls last. Per-venue honesty (stale, snapshot
 * provenance) rides on every row.
 */

import {
  VENUE_LABELS,
  type CanvasVenueId,
  type ProjectedCandidate,
  type ProjectedVenue,
} from "./opportunities";

export interface UnifiedRow extends ProjectedCandidate {
  /** Chip text for the row (VENUE_LABELS of the row's venue). */
  venueLabel: string;
  /** The owning doc's pin — a pick stores THIS venue's contentHash. */
  contentHash: string;
  /** Owning doc older than 24h: row renders the stale register. */
  stale: boolean;
  /** Owning doc served from snapshot: re-verifies before launch. */
  snapshot: boolean;
}

interface UnifiedList {
  hedged: UnifiedRow[];
  unhedged: UnifiedRow[];
}

type VenueFilter = "all" | ReadonlySet<CanvasVenueId>;
export type ClassFilter = "both" | "hedged" | "unhedged";

type SourcedVenue = ProjectedVenue & { source?: string };

function toRows(cs: ProjectedCandidate[], v: SourcedVenue): UnifiedRow[] {
  return cs.map((c) => ({
    ...c,
    venueLabel: VENUE_LABELS[c.venue] ?? c.venue,
    contentHash: v.contentHash,
    stale: v.stale,
    snapshot: v.source === "snapshot",
  }));
}

/** Headline APY desc; rows without a headline sink to the bottom. */
function byHeadlineDesc(a: UnifiedRow, b: UnifiedRow): number {
  const ah = typeof a.headlineApr === "number" ? a.headlineApr : -Infinity;
  const bh = typeof b.headlineApr === "number" ? b.headlineApr : -Infinity;
  return bh - ah;
}

/** Actionability first (P1-8): launchable rows always outrank venue-blocked
 *  rows; headline APY breaks ties within each group. */
function byActionabilityThenHeadline(a: UnifiedRow, b: UnifiedRow): number {
  if (a.launchable !== b.launchable) return a.launchable ? -1 : 1;
  return byHeadlineDesc(a, b);
}

export function buildUnifiedList(
  venues: SourcedVenue[],
  opts: { venueFilter?: VenueFilter; classFilter?: ClassFilter } = {},
): UnifiedList {
  const vf = opts.venueFilter ?? "all";
  const cf = opts.classFilter ?? "both";
  const included = venues.filter((v) => vf === "all" || vf.has(v.venue));
  const hedged =
    cf === "unhedged"
      ? []
      : included.flatMap((v) => toRows(v.hedged, v)).sort(byActionabilityThenHeadline);
  const unhedged =
    cf === "hedged"
      ? []
      : included.flatMap((v) => toRows(v.unhedged, v)).sort(byActionabilityThenHeadline);
  return { hedged, unhedged };
}
