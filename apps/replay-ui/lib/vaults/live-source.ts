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

export function fetchLoops(): Promise<LoopsListResponse> {
  return getJson<LoopsListResponse>("/api/loops");
}

export function fetchLoop(id: string): Promise<LoopDetailResponse> {
  return getJson<LoopDetailResponse>(`/api/loops/${encodeURIComponent(id)}`);
}

export function fetchLoopJournals(id: string, limit = 20): Promise<LoopJournalsResponse> {
  const suffix = limit === 20 ? "" : `?limit=${String(limit)}`;
  return getJson<LoopJournalsResponse>(`/api/loops/${encodeURIComponent(id)}/journals${suffix}`);
}
