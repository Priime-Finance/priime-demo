/** Client-side shapes for the canvas API responses (BC-P3/P6; v2 portfolio). */

import type { CompiledConfig } from "@/lib/canvas/server-shim";
import type { ProjectedCandidate, ProjectedVenue } from "@/lib/canvas/opportunities";
import type { CanvasVenueId } from "@/lib/canvas/opportunities";
import type { VenueSource } from "@/lib/canvas/server-shim";
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

/**
 * The /api/canvas/compile single-loop response as the client consumes it.
 *
 * SINGLE OWNER (R5 grep, 2026-08-22). The `economics` and `pinned` members
 * were RETYPED here, field for field, beside the server's own declaration in
 * `lib/canvas/compile.ts`. Two declarations of one wire shape is the same
 * defect class as two derivations of one number: the server could add,
 * rename or re-null a field and this file would go on describing the old
 * contract, silently, at compile time. They are now projections of
 * `CompiledConfig`, so a drift on either side is a type error.
 *
 * Collapsing them also removed the last spelling of the raw funding
 * percentile from `components/`. That identifier is banned under this
 * directory (single-owner.test.ts enforces it) because a surface holding the
 * raw number is one line away from attaching its own verb to it — which is
 * exactly how one screen came to say a hedge "earns 8.7%" while another said
 * it "costs 7.7%". `lib/canvas/hedge-econ.ts` is the only thing that may
 * reach it, and it returns the verb and the magnitude already welded.
 */
export interface CompiledView {
  ok: boolean;
  error?: string;
  decode?: string[];
  violations?: string[];
  strategyConfig?: unknown;
  economics?: CompiledConfig["economics"];
  pinned?: CompiledConfig["pinned"];
}

/** The /api/canvas/compile portfolio response as the client consumes it. */
export interface PortfolioCompiledView {
  ok: boolean;
  error?: string;
  loops?: { loopId: string; label: string; compiled: CompiledView & { decode: string[]; violations: string[] } }[];
  orchestratorMirror?: unknown | null;
  economics?: { netApyBlendedApy: number | null; bindingLoopId: string | null };
  decode?: string[];
  violations?: string[];
  pinned?: { slotId: string; blockNumber: number; marketKey: string }[];
}

/** The lifted /api/canvas/opportunities payload (fetched once in RackCanvas). */
export interface OpportunitiesPayload {
  ok: boolean;
  nowMs: number;
  // `source` mirrors the loader's own VenueSource union — the hand-copied
  // list here missed "blob" for the ten days after the durable tier moved
  // to Vercel Blob (2026-08-21), so the type said the payload could not
  // carry the provenance it had been serving all along.
  venues: (ProjectedVenue & { source?: VenueSource })[];
  degraded: { venue: CanvasVenueId; reason: string }[];
}
