/**
 * Plain-language label map for user surfaces (recette P2-1).
 *
 * Raw internal venue ids never render verbatim on a retail surface: every id
 * passes through here at point of use. The fallback humanizes unknown ids
 * (dashes to spaces) so a new venue degrades to readable words, never to a
 * raw id.
 */

import { VENUE_LABELS, type CanvasVenueId } from "./opportunities";

/** Venue id to display name (falls back to the raw id, humanized). */
export function venueLabel(venue: string): string {
  return VENUE_LABELS[venue as CanvasVenueId] ?? venue.replace(/-/g, " ");
}
