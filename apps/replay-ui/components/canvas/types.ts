/** Client-side shapes for the canvas API responses (BC-P3/P6; v2 portfolio). */

import type { ProjectedCandidate, ProjectedVenue } from "@/lib/canvas/opportunities";
import type { CanvasVenueId } from "@/lib/canvas/opportunities";
import type { HfBands, HlMarginBandsDerived } from "@/lib/canvas/param-schema";
import type { RepriceFailureKind } from "@/lib/canvas/reprice-state";

export type RepriceData =
  | {
      ok: true;
      repricedAtMs: number;
      blockNumber: number;
      candidate: ProjectedCandidate | null;
      requestedLeverage: number | null;
      appliedLeverage: number | null;
      bands: { hf: HfBands; margin: HlMarginBandsDerived | null };
      minDepositUsd: number;
      violations: { invariant: string; detail: string }[];
    }
  | {
      ok: false;
      error: string;
      /** Definitive failure classification (recette P0-1): gone = the
       *  service answered 404 (market left the live scan), failed = other
       *  server answer, unreachable = the network call itself failed. */
      kind: RepriceFailureKind;
    };

/** The lifted /api/canvas/opportunities payload (fetched once in RackCanvas). */
export interface OpportunitiesPayload {
  ok: boolean;
  nowMs: number;
  venues: (ProjectedVenue & { source?: "kv" | "process-cache" | "snapshot" })[];
  degraded: { venue: CanvasVenueId; reason: string }[];
}
