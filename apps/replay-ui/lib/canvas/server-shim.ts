/**
 * Structural copies of four server-side shapes the ported kit reads as types.
 *
 * On build.priime.finance these live in `lib/canvas/opportunities-server.ts`,
 * `lib/canvas/compile-portfolio.ts`, `lib/canvas/compile-request.ts` and
 * `lib/canvas/compile.ts`, which are the server rail (Blob, KV, viem) and do
 * not travel to this repo (docs/plans/LATEST_UI_PORT_SPEC.md A.1). The kit's
 * client-safe modules only ever needed their SHAPES, so the shapes are
 * declared here, field for field, and nothing else. Types only; the single
 * import is the client-safe row type.
 */

import type { ProjectedVenue } from "./opportunities";
import type { LaneFamily } from "./graph-ops";
import type { RiskPreset } from "./param-schema";
import type { OrchestratorDials } from "./orchestrator/types";

/**
 * Where a served venue document came from (LIVE `opportunities-server.ts:74`).
 * This repo serves committed snapshots only, so `snapshot` is the value the
 * catalog loader stamps; the other three are kept so the payload type matches
 * the live client byte for byte.
 */
export type VenueSource = "blob" | "kv" | "process-cache" | "snapshot";

/** A projected venue with its provenance (LIVE `opportunities-server.ts:88`). */
export type SourcedProjectedVenue = ProjectedVenue & { source?: VenueSource };

/** One lane's compile request (LIVE `compile-request.ts`). */
export interface CompileRequestBody {
  venue?: string;
  marketKey?: string;
  candidateId?: string;
  /** The lane's family. Absent means `loop`. */
  family?: LaneFamily;
  riskPreset?: RiskPreset;
  targetLeverage?: number;
  hedge?: { hedgeLeverage: number; reserveFraction: number } | null;
  compound?: { cadence: "6h" | "24h" | "72h"; minActionUsd: number } | null;
}

/** The portfolio compile request (LIVE `compile-portfolio.ts:56`). */
export interface PortfolioCompileRequestBody {
  loops: { loopId: string; label: string; body: CompileRequestBody }[];
  orchestrator: {
    enabled: boolean;
    /** The three dials; re-clamped server-side (client never trusted). */
    params: Partial<Record<keyof OrchestratorDials, unknown>>;
    allocationsBps: Record<string, number>;
  } | null;
}

/**
 * The compiled single-loop config (LIVE `compile.ts`), narrowed to the two
 * members `components/canvas/types.ts` actually projects (`economics`,
 * `pinned`). The strategy config and runner params are the rail's own and are
 * not read by any client surface.
 */
export interface CompiledConfig {
  economics: {
    netApyOnDepositApy: number | null;
    capacityUsd: number | null;
    capacityBinding: string | null;
    fundingP25Apr: number | null;
  };
  decode: string[];
  violations: string[];
  pinned: { blockNumber: number; marketKey: string };
}
