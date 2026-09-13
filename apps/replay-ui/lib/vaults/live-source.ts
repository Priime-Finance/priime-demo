/**
 * Client-side fetchers for the live loop-server data.
 *
 * Every route is a thin wrapper around the local Next API proxy
 * (`app/api/loops/*`), which forwards to loop-server on the server. Types
 * mirror the on-server shapes: `LoopRecord` from `@priime-demo/loop-deploy`
 * for loops, `Journal` from `@priime-demo/journal-schema` for journals.
 *
 * Consumers should degrade gracefully when the server is unreachable: a 502
 * from the proxy is expected during a demo pause or a fresh dev boot.
 */

import type {
  JournalWireEntry,
  LoopRecord,
  Observations,
  StrikeRecord,
} from "@priime-demo/loop-deploy";
import type { Journal } from "@priime-demo/journal-schema";

export interface LoopsListResponse {
  loops: LoopRecord[];
}

export interface LoopDetailResponse {
  loop: LoopRecord;
}

/**
 * `/api/loops/:id/journals` payload. `chainStrikeCount` reports the
 * vault's own `updateCount()`; if it is strictly greater than
 * `journals.length` the vault has strikes older than the scan window,
 * so the UI must NOT render "awaiting first strike". `chainQuorum`
 * carries the manager's own `QuorumThresholdUpdated` numerator/
 * denominator when the reader could resolve one from chain
 * (`source: "chain"`); when the scan window held no emission the
 * reader falls back to the loop-server env defaults
 * (`source: "fallback"`) and the UI MUST render that source. `null`
 * values mean the vault has not been deployed yet.
 */
export interface LoopJournalsResponse {
  journals: StrikeRecord[];
  chainStrikeCount: string | null;
  windowFromBlock: string | null;
  windowToBlock: string | null;
  chainQuorum: { threshold: number; total: number; source: "chain" | "fallback" } | null;
}

/** Wrap fetch so callers get a typed result or a plain Error. */
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) {
    let detail = "";
    try {
      const body: unknown = await res.json();
      if (body !== null && typeof body === "object" && "error" in body && typeof body.error === "string") {
        detail = `: ${body.error}`;
      }
    } catch {
      // fall through with no detail
    }
    throw new Error(`GET ${path} returned ${String(res.status)}${detail}`);
  }
  return (await res.json()) as T;
}

export function fetchLoops(options?: { strategist?: string }): Promise<LoopsListResponse> {
  const strategist = options?.strategist;
  const path = strategist === undefined ? "/api/loops" : `/api/loops?strategist=${encodeURIComponent(strategist)}`;
  return getJson<LoopsListResponse>(path);
}

export function fetchLoop(id: string): Promise<LoopDetailResponse> {
  return getJson<LoopDetailResponse>(`/api/loops/${encodeURIComponent(id)}`);
}

/**
 * Wire shape of `/api/loops/:id/journals`. Each entry nests the
 * schema-valid Journal under `.journal`, with `observations` and `plan`
 * as SIBLINGS. This mirrors the shape loop-server actually returns
 * (`packages/loop-deploy/src/journal-source.ts::JournalWireEntry`) so
 * every emitted `journal` object validates against
 * `schema/journal.v1.schema.json` with `additionalProperties:false`.
 */
interface LoopJournalsWireResponse {
  journals: JournalWireEntry[];
  chainStrikeCount: string | null;
  windowFromBlock: string | null;
  windowToBlock: string | null;
  chainQuorum: { threshold: number; total: number; source: "chain" | "fallback" } | null;
}

/**
 * Flatten a wire entry into the intersection shape existing UI reads
 * (`strike.attestation`, `strike.plan.status`, …). The wire STAYS
 * schema-valid; only the in-memory client shape is flat.
 */
function flattenWire(entry: JournalWireEntry): StrikeRecord {
  const journal: Journal = entry.journal;
  const observations: Observations = entry.observations;
  return { ...journal, observations, plan: entry.plan };
}

export async function fetchLoopJournals(id: string, limit = 20): Promise<LoopJournalsResponse> {
  const suffix = limit === 20 ? "" : `?limit=${String(limit)}`;
  const wire = await getJson<LoopJournalsWireResponse>(
    `/api/loops/${encodeURIComponent(id)}/journals${suffix}`,
  );
  return {
    journals: wire.journals.map(flattenWire),
    chainStrikeCount: wire.chainStrikeCount,
    windowFromBlock: wire.windowFromBlock,
    windowToBlock: wire.windowToBlock,
    chainQuorum: wire.chainQuorum,
  };
}


/**
 * Body shape for POST /api/loops. Matches the loop-deploy `LoopConfigInput`
 * server-side; kept as a local interface so callers do not need to import
 * the server package just to build the payload. loop-server resolves the
 * candidateId against its market catalog and returns 400 with per-field
 * issues on anything it cannot deploy.
 */
export interface CreateLoopInput {
  name: string;
  strategist: string;
  cronSeconds: number;
  candidateId: string;
  targetLeverage: number;
  /** Unix seconds; the strategist's signature is over this value + the rest of the fields above. */
  signedAt: number;
  /** EIP-712 signature over `LoopPublish`. Loop-server refuses the request when the recovered address does not equal `strategist`. */
  signature: `0x${string}`;
  /**
   * Composer knobs, string-encoded. Merged into the workflow's
   * `componentConfig` verbatim so every user choice lands on IPFS.
   */
  strategyParams?: Record<string, string>;
}

export class LoopValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`invalid loop config: ${issues.join("; ")}`);
    this.name = "LoopValidationError";
    this.issues = issues;
  }
}

/** POST /api/loops. On the loop-server's own 400 response the promise
 *  rejects with a LoopValidationError so the form can render per-field
 *  hints; other failures throw a plain Error. */
export async function createLoop(input: CreateLoopInput): Promise<LoopDetailResponse> {
  const res = await fetch("/api/loops", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 201) {
    return (await res.json()) as LoopDetailResponse;
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.status === 400 && body !== null && typeof body === "object" && "issues" in body && Array.isArray(body.issues)) {
    throw new LoopValidationError(body.issues.filter((v): v is string => typeof v === "string"));
  }
  let detail = "";
  if (body !== null && typeof body === "object" && "error" in body && typeof body.error === "string") {
    detail = `: ${body.error}`;
  }
  throw new Error(`POST /api/loops returned ${String(res.status)}${detail}`);
}
