/**
 * Deterministic serialization + content hash (BC-P1; v2 in ARCHITECTURE_V2 §4).
 *
 * Rules: v1 drafts must load; hash checks run under the version the draft
 * was written in; toDraft always writes v2.
 *
 * v1 canonical form: version-tagged, nodes sorted by spine rank then id,
 * edges by id, param keys sorted, positions EXCLUDED.
 * v2 canonical form: loops sorted by id (lane ORDER is presentational →
 * hash-excluded, like positions), labels excluded, nodes per loop sorted by
 * rank then id, edges by id, orchestrator with sorted param/alloc keys.
 * deriveOrchestratorEdges output is NOT serialized (derived, like layout).
 */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion --
 * Kit-verbatim file (priime-build-ui-kit integration); not rewriting kit
 * logic to satisfy lint, per the integration's own directive. */

import type {
  AnyCanvasDraft,
  CanvasDraft,
  CanvasDraftV2,
  LoopGraph,
  ModuleEdge,
  ModuleNode,
  PortfolioGraph,
  StrategyGraph,
} from "./types";
import { getDef } from "./modules";
import { nodeId } from "./ids";
import { defaultOrchestrator } from "./orchestrator";
import { deriveEdges } from "./graph-ops";

interface CanonicalNode {
  id: string;
  defKey: ModuleNode["data"]["defKey"];
  params: Record<string, ModuleNode["data"]["params"][string]>;
}

interface CanonicalGraph {
  v: 1;
  nodes: CanonicalNode[];
  edges: Pick<ModuleEdge, "id" | "source" | "target">[];
}

function sortedParams<T>(params: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(params).sort()) out[k] = params[k]!;
  return out;
}

function sortNodes(nodes: ModuleNode[]): ModuleNode[] {
  return [...nodes].sort((a, b) => {
    const ra = getDef(a.data.defKey).rank;
    const rb = getDef(b.data.defKey).rank;
    return ra !== rb ? ra - rb : a.id.localeCompare(b.id);
  });
}

/** v1 canonical form — BYTE-IDENTICAL to the original canonicalize(). */
function canonicalizeV1(graph: StrategyGraph): string {
  const canonical: CanonicalGraph = {
    v: 1,
    nodes: sortNodes(graph.nodes).map((n) => ({ id: n.id, defKey: n.data.defKey, params: sortedParams(n.data.params) })),
    edges: [...graph.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
  return JSON.stringify(canonical);
}

async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** sha-256 hex of the v1 canonical form (checks v1-era drafts on load). */
async function contentHash(graph: StrategyGraph): Promise<string> {
  return sha256Hex(canonicalizeV1(graph));
}

function canonicalizeV2(p: PortfolioGraph): string {
  const canonical = {
    v: 2 as const,
    loops: [...p.loops]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((l) => ({
        id: l.id,
        nodes: sortNodes(l.nodes).map((n) => ({ id: n.id, defKey: n.data.defKey, params: sortedParams(n.data.params) })),
        edges: [...l.edges]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((e) => ({ id: e.id, source: e.source, target: e.target })),
      })),
    orchestrator: {
      enabled: p.orchestrator.enabled,
      params: sortedParams(p.orchestrator.params),
      allocationsBps: sortedParams(p.orchestrator.allocationsBps),
    },
  };
  return JSON.stringify(canonical);
}

async function contentHashV2(p: PortfolioGraph): Promise<string> {
  return sha256Hex(canonicalizeV2(p));
}

/** Always writes v2. */
export async function toDraft(p: PortfolioGraph, savedAtMs: number): Promise<CanvasDraftV2> {
  return { v: 2, portfolio: p, contentHash: await contentHashV2(p), savedAtMs };
}

/**
 * v1 → v2. Deterministic: single loop "loop_1", node ids re-namespaced,
 * edges re-derived (ids change with the namespacing, so re-derive rather
 * than rewrite), allocation 10000, orchestrator defaults (disabled).
 */
function migrateV1(graph: StrategyGraph): PortfolioGraph {
  const nodes = graph.nodes.map((n) => ({ ...n, id: nodeId("loop_1", n.data.defKey) }));
  const loop: LoopGraph = { id: "loop_1", label: "Loop 1", nodes, edges: deriveEdges(nodes) };
  const orchestrator = defaultOrchestrator();
  orchestrator.allocationsBps = { loop_1: 10000 };
  return { v: 2, loops: [loop], orchestrator };
}

/** Version-dispatching load. Integrity check ALWAYS against the stored
 *  version's canonical form. Returns null on any mismatch. */
export async function fromDraft(raw: unknown): Promise<PortfolioGraph | null> {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as AnyCanvasDraft;
  try {
    if (d.v === 2) {
      const v2 = d as CanvasDraftV2;
      if (!v2.portfolio || typeof v2.contentHash !== "string") return null;
      if ((await contentHashV2(v2.portfolio)) !== v2.contentHash) return null;
      return v2.portfolio;
    }
    if (d.v === 1) {
      const v1 = d as CanvasDraft;
      if (!v1.graph || typeof v1.contentHash !== "string") return null;
      if ((await contentHash(v1.graph)) !== v1.contentHash) return null; // v1 hash = canonicalizeV1
      return migrateV1(v1.graph);
    }
  } catch {
    return null;
  }
  return null;
}
