/**
 * Dock state machine (IT4_DOCK_SPEC §2). Pure, no React.
 *
 * The dock's mode is a PURE DERIVATION of RackCanvas state — not a second
 * state machine. Inputs: the forced-Discover target (ADD A LOOP / SWAP
 * MARKET), the extended Focus (module / orchestrator / lane / null), and
 * three portfolio facts. The dock is NEVER empty: every input combination
 * resolves to a mode.
 */

import type { LoopId, ModuleKey } from "./types";

export type Focus =
  | { kind: "module"; loopId: LoopId; key: ModuleKey }
  | { kind: "orchestrator" }
  | { kind: "lane"; loopId: LoopId }
  | null;

export type DiscoverReason = "empty" | "add" | "swap" | "idle";

export type DockMode =
  | { kind: "discover"; targetLoopId: LoopId | null; reason: DiscoverReason }
  | { kind: "module"; loopId: LoopId; key: ModuleKey }
  | { kind: "lane"; loopId: LoopId }
  | { kind: "portfolio" }; // orchestrator focused

export interface DiscoverTarget {
  loopId: LoopId;
  reason: "add" | "swap";
}

export function deriveDockMode(args: {
  discoverTarget: DiscoverTarget | null;
  focus: Focus;
  anyMarket: boolean;
  firstMarketlessLoopId: LoopId | null;
  /** First lane with a market but !validateGraph(loop).ok. */
  midBuildLoopId: LoopId | null;
}): DockMode {
  if (args.discoverTarget) {
    return {
      kind: "discover",
      targetLoopId: args.discoverTarget.loopId,
      reason: args.discoverTarget.reason,
    };
  }
  if (args.focus?.kind === "module") {
    return { kind: "module", loopId: args.focus.loopId, key: args.focus.key };
  }
  if (args.focus?.kind === "orchestrator") return { kind: "portfolio" };
  if (args.focus?.kind === "lane") return { kind: "lane", loopId: args.focus.loopId };
  if (!args.anyMarket) {
    return { kind: "discover", targetLoopId: args.firstMarketlessLoopId, reason: "empty" };
  }
  if (args.midBuildLoopId) return { kind: "lane", loopId: args.midBuildLoopId };
  return { kind: "discover", targetLoopId: null, reason: "idle" };
}

/** Slim per-lane facts the helpers consume (computed once in RackCanvas). */
interface DockLaneFacts {
  loopId: LoopId;
  hasMarket: boolean;
  graphOk: boolean;
}

export function firstMarketlessLoopId(lanes: DockLaneFacts[]): LoopId | null {
  return lanes.find((l) => !l.hasMarket)?.loopId ?? null;
}

export function midBuildLoopId(lanes: DockLaneFacts[]): LoopId | null {
  return lanes.find((l) => l.hasMarket && !l.graphOk)?.loopId ?? null;
}

/** Collapsed-rail label — the strip stays honest about the current mode. */
export function dockRailLabel(mode: DockMode): string {
  switch (mode.kind) {
    case "discover":
      return "Markets";
    case "module":
      return "Module";
    case "lane":
      return "Lane";
    case "portfolio":
      return "Portfolio";
  }
}

/** The rail LED lights whenever the mode is not idle Discover. */
export function dockRailLit(mode: DockMode): boolean {
  return !(mode.kind === "discover" && mode.reason === "idle");
}
