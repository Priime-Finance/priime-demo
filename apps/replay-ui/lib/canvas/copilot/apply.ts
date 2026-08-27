/**
 * Proposal replay. Pure.
 *
 * buildPortfolioFromProposal replays a ProposalPayload through the SAME pure
 * ops the RackCanvas reducer cases call — addLoop / addModule / updateParam /
 * setAllocations / deriveRiskParams — so every clamp, snap and derivation
 * applies identically to a hand-built canvas. RackCanvas dispatches ONE atomic
 * { type: "load" } with the built portfolio. Used by the template deep link
 * and the demo seed.
 */

import type { LoopId, PortfolioGraph } from "@/lib/canvas/types";
import {
  addLoop,
  addModule,
  emptyPortfolio,
  setAllocations,
  updateParam,
} from "@/lib/canvas/graph-ops";
import { nodeId } from "@/lib/canvas/ids";
import { deriveRiskParams, type RiskStop } from "@/lib/canvas/risk-dial";
import type { ProposalPayload } from "./tools";

interface BuiltProposal {
  portfolio: PortfolioGraph;
  riskStops: Record<LoopId, RiskStop | "custom">;
  /** Every node id added — for the snap animation (markSnap). */
  nodeIds: string[];
}

export function buildPortfolioFromProposal(p: ProposalPayload): BuiltProposal {
  let g = emptyPortfolio();
  const riskStops: Record<LoopId, RiskStop | "custom"> = {};
  const nodeIds: string[] = [];
  const loopIds: LoopId[] = [];

  for (const l of p.loops) {
    g = addLoop(g);
    const id = g.loops[g.loops.length - 1]!.id;
    loopIds.push(id);

    g = addModule(g, id, "liquidity-source");
    nodeIds.push(nodeId(id, "liquidity-source"));
    const fields: [string, string][] = [
      ["venue", l.snapshot.venue],
      ["candidateId", l.candidateId],
      ["pairLabel", l.snapshot.pair],
      ["contentHash", l.snapshot.contentHash],
      ["cls", l.snapshot.cls],
      ["hlCoin", l.snapshot.hlCoin ?? ""],
    ];
    for (const [f, v] of fields) g = updateParam(g, id, "liquidity-source", f, v);

    g = addModule(g, id, "safety-buffer");
    nodeIds.push(nodeId(id, "safety-buffer"));
    if (l.snapshot.lt !== null) {
      const d = deriveRiskParams(l.riskStop, l.snapshot.lt);
      g = updateParam(g, id, "safety-buffer", "targetLeverage", d.targetLeverage);
      g = updateParam(g, id, "safety-buffer", "riskPreset", d.riskPreset);
      riskStops[id] = l.riskStop;
    } else {
      riskStops[id] = "custom"; // dial never lies about what applies
    }

    if (l.hedge) {
      g = addModule(g, id, "hedge");
      nodeIds.push(nodeId(id, "hedge"));
    }
    if (l.compound) {
      g = addModule(g, id, "auto-compound");
      nodeIds.push(nodeId(id, "auto-compound"));
    }
  }

  if (p.loops.length >= 2) {
    const alloc: Record<LoopId, number> = {};
    loopIds.forEach((id, i) => {
      alloc[id] = p.allocationsBps[i]!;
    });
    g = setAllocations(g, alloc); // orchestrator already auto-enabled by addLoop
  }

  return { portfolio: g, riskStops, nodeIds };
}
