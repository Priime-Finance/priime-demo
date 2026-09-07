/**
 * Node-id scheme for the v2 multi-loop portfolio (ARCHITECTURE_V2 §1b).
 *
 * v1 set node id == module key, which collides the moment a second loop
 * exists. v2 namespaces: node id = `${loopId}/${defKey}`; module identity
 * stays in data.defKey. "/" never appears in loop ids or module keys.
 */

import { ORCHESTRATOR_NODE_ID, type LoopId, type ModuleKey } from "./types";

/** Node id = `${loopId}/${defKey}`. */
export function nodeId(loopId: LoopId, key: ModuleKey): string {
  return `${loopId}/${key}`;
}

export function parseNodeId(id: string): { loopId: LoopId; key: ModuleKey } | null {
  if (id === ORCHESTRATOR_NODE_ID) return null;
  const i = id.indexOf("/");
  if (i <= 0) return null;
  return { loopId: id.slice(0, i), key: id.slice(i + 1) as ModuleKey };
}

/**
 * ONE canonical candidateId → marketKey extraction (recette P1-2). Candidate
 * ids are `${venue}:${chainId}:${pair}:${marketKey}` (simulate-v2) or the v1
 * `${venue}:${id}` shape — the market key is ALWAYS the last segment. Every
 * consumer (reprice route, compile glue, orchestrator slots) goes through
 * here; a second inline `.split(":")` is a bug.
 */
export function marketKeyOf(candidateId: string): string {
  if (!candidateId) return "";
  return candidateId.split(":").pop() ?? "";
}

const LOOP_ID_RE = /^loop_(\d+)$/;

/** Deterministic: monotonic integer (max+1). Migration always yields loop_1. */
export function newLoopId(existing: LoopId[]): LoopId {
  const max = existing.reduce((m, id) => {
    const g = LOOP_ID_RE.exec(id);
    return g ? Math.max(m, Number(g[1])) : m;
  }, 0);
  return `loop_${max + 1}`;
}
