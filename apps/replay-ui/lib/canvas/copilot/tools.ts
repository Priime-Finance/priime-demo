/**
 * Proposal payload contract.
 *
 * What survives the strip: the wire shapes a *proposal* is expressed in — a
 * complete composition, ready to replay through the pure graph ops in
 * `apply.ts`. Two producers use it today, the template deep link and the demo
 * seed; the LLM copilot that originally authored proposals (its tool schemas,
 * its server-side validators, its SSE transport and its panel) is gone.
 */

// ── Wire payload types ────────────────────────────────────────────────────

export interface ProposalLoopSnapshot {
  venue: string;
  venueLabel: string;
  pair: string;
  cls: "A" | "N1";
  hlCoin: string | null;
  lt: number | null;
  headlineAprPct: number | null;
  /** Owning venue doc pin — the same pin the canvas stores on pick. */
  contentHash: string;
  launchable: boolean;
  stale: boolean;
  snapshot: boolean;
}

export interface ProposalPayload {
  proposalId: string;
  title: string;
  rationale: string;
  loops: {
    candidateId: string;
    riskStop: "safer" | "balanced" | "max";
    hedge: boolean;
    compound: boolean;
    snapshot: ProposalLoopSnapshot;
  }[];
  /** Normalized: length == loops.length, sum 10000 (single loop: [10000]). */
  allocationsBps: number[];
  /** Server corrections, rendered verbatim on the card. */
  notes: string[];
}
