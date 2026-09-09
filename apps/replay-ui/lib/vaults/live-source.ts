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

import type { Journal } from "@priime-demo/journal-schema";
import type { LoopRecord } from "@priime-demo/loop-deploy";

export interface LoopsListResponse {
  loops: LoopRecord[];
}

export interface LoopDetailResponse {
  loop: LoopRecord;
}

export interface LoopJournalsResponse {
  journals: Journal[];
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

export function fetchLoopJournals(id: string, limit = 20): Promise<LoopJournalsResponse> {
  const suffix = limit === 20 ? "" : `?limit=${String(limit)}`;
  return getJson<LoopJournalsResponse>(`/api/loops/${encodeURIComponent(id)}/journals${suffix}`);
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
