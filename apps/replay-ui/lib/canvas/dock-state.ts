/**
 * Dock state machine (IT4_DOCK_SPEC §2, COMPOSE_PANEL_SPEC §3.1). Pure, no
 * React.
 *
 * The dock's mode is a PURE DERIVATION of RackCanvas state — not a second
 * state machine. Inputs: the forced-Discover target (ADD A LOOP / SWAP
 * MARKET), the extended Focus (module / orchestrator / lane / null), and
 * three portfolio facts. The dock is NEVER empty: every input combination
 * resolves to a mode.
 *
 * 2026-08-22 — `compose` REPLACES the catalog once a lane exists.
 *
 * The founder's complaint was structural, not cosmetic: standing on a
 * composed lane with nothing selected, the dock fell back to the market
 * catalog forever, so the modules a lane can take had no home in the default
 * state. `discover{reason:"idle"}` was that fallback and it is now
 * unreachable — deleted, along with the mode it produced.
 *
 * REJECTED: a tab strip. The dock's stated doctrine is that mode is a pure
 * derivation of canvas state; the app already knows which job the user is in
 * (no market means catalog, composed lane means modules), and a tab strip
 * hands that knowledge back as a chore.
 * REJECTED: a module section beneath the catalog. The dock is 360px and the
 * catalog is an unbounded scroll; anything under it is unreachable.
 *
 * The catalog is never orphaned: `Browse markets` (openSwap on the scoped
 * lane) and `+ Add a lane` (discoverTarget reason "add") are one key away
 * from every compose panel.
 */

import type { LoopId, ModuleKey } from "./types";

export type Focus =
  | { kind: "module"; loopId: LoopId; key: ModuleKey }
  | { kind: "orchestrator" }
  | { kind: "lane"; loopId: LoopId }
  | null;

/**
 * `"empty"` HAS NO PRODUCER since 2026-08-22 (MODULE-FIRST BUILD CANVAS §9).
 *
 * It was the blank canvas's reason, on the premise that "picking a market IS
 * the first job". The founder overturned that premise: a from-scratch vault
 * opens on the module shelf, not on the catalog. Same retirement, same reason,
 * as `discover{idle}` earlier the same day.
 *
 * The member survives only because `DiscoverPanel.discoverKicker` still carries
 * a branch for it and that file belongs to the surface wave. HANDOFF: delete
 * the branch and this member together.
 */
export type DiscoverReason = "empty" | "add" | "swap";

export type DockMode =
  | { kind: "discover"; targetLoopId: LoopId | null; reason: DiscoverReason }
  | { kind: "module"; loopId: LoopId; key: ModuleKey }
  | { kind: "compose"; scopeLoopId: LoopId | null }
  | { kind: "portfolio" }; // orchestrator focused

export interface DiscoverTarget {
  loopId: LoopId;
  reason: "add" | "swap";
}

/**
 * Inputs. Still five facts, still no state.
 *
 * THREE OF THEM ARE OPTIONAL AND THAT IS A HANDOFF, not a design. The blank
 * clause needs `anyModulePlaced` / `firstEmptyLaneId`, and the market clause's
 * retirement needs `firstIncompleteLoopId`; the only caller,
 * `RackCanvas.tsx:1017`, belongs to the surface wave and could not be edited
 * here. Until it is rewired, each new field falls back to the retired one it
 * replaces, which is documented per field and pinned by a test. The correct end
 * state is three required fields and no `anyMarket` / `firstMarketlessLoopId`
 * on this interface at all.
 */
export interface DockModeInputs {
  discoverTarget: DiscoverTarget | null;
  focus: Focus;
  /** Any module node on any lane. False is the blank canvas. */
  anyModulePlaced?: boolean;
  /** First lane carrying no module at all — where a blank canvas starts. */
  firstEmptyLaneId?: LoopId | null;
  /** First lane that is not launch-shaped: no market OR an incomplete spine.
   *  Absorbs the two separate derivations of "which lane needs attention". */
  firstIncompleteLoopId?: LoopId | null;
  /** @deprecated retired input. Stands in for `anyModulePlaced`: a market
   *  cannot be pinned without a `liquidity-source` node carrying it, so
   *  `anyMarket === true` implies a module is placed. The converse is only an
   *  approximation, which is exactly why the surface wave must pass the real
   *  fact. */
  anyMarket?: boolean;
  /** @deprecated retired input. Stands in for `firstEmptyLaneId`: an empty lane
   *  is always marketless, so on a genuinely blank canvas the two agree. */
  firstMarketlessLoopId?: LoopId | null;
  /** @deprecated retired input, narrower than its replacement (it required a
   *  market). Stands in for `firstIncompleteLoopId` so an un-rewired caller
   *  keeps EXACTLY its shipped mid-build behaviour. */
  midBuildLoopId?: LoopId | null;
}

export function deriveDockMode(args: DockModeInputs): DockMode {
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
  if (args.focus?.kind === "lane") return { kind: "compose", scopeLoopId: args.focus.loopId };

  /* THE BLANK CLAUSE, and it runs AHEAD of everything about markets.
     ---------------------------------------------------------------
     What stood here was:

       if (!anyMarket) return { kind: "discover", …, reason: "empty" };
       // "A blank canvas keeps discover{empty} verbatim: picking a market IS
       //  the first job and there is nothing to compose against."

     That comment is the premise the founder overturned. A from-scratch vault
     opens as empty bays and every module in the dock: you choose the module
     that does the work, and the canvas then asks for the market that work runs
     on. So a canvas with no module placed scopes the dock to COMPOSE on the
     first empty lane, and the catalog is one key away (`Browse markets`) rather
     than the thing standing in the way.

     It must precede the incomplete clause because a blank lane is also an
     incomplete one; reversed, the blank canvas would scope to compose anyway
     but by accident, and a portfolio whose first lane is blank while a second
     is mid-build would answer the wrong question. */
  const anyModulePlaced = args.anyModulePlaced ?? args.anyMarket ?? true;
  if (!anyModulePlaced) {
    return { kind: "compose", scopeLoopId: args.firstEmptyLaneId ?? args.firstMarketlessLoopId ?? null };
  }

  const incomplete = args.firstIncompleteLoopId ?? args.midBuildLoopId ?? null;
  if (incomplete) return { kind: "compose", scopeLoopId: incomplete };
  // THE FOUNDER'S EXACT STATE: a composed lane, nothing selected.
  return { kind: "compose", scopeLoopId: null };
}

/**
 * THE ONE LANE THE DOCK IS CURRENTLY TALKING ABOUT.
 *
 * There were three notions of "the current lane" on this canvas and only two
 * of them agreed: `focus`, which the canvas marked; `dockMode.scopeLoopId`,
 * which the dock named in its kicker; and the compose panel's own accordion.
 * `deriveDockMode` returns `compose{scopeLoopId: firstIncompleteLoopId}` while
 * `focus` is null (the incomplete clause above), so the dock could name a lane
 * the canvas marked in no way at all.
 *
 * That was invisible while the seated lane was distinguished only by a zoom
 * step. The moment the canvas paints a real frame around the selected lane it
 * becomes a visible contradiction — so the canvas's seat and the dock's
 * kicker read the SAME derivation and cannot disagree by construction.
 *
 * DELIBERATE CONSEQUENCE, stated up front: on a mid-build canvas the first
 * incomplete lane wears the seat with nothing selected, because it IS the lane
 * the dock is helping with.
 */
export function dockScopeLoopId(mode: DockMode): LoopId | null {
  switch (mode.kind) {
    case "discover":
      return mode.targetLoopId;
    case "module":
      return mode.loopId;
    case "compose":
      return mode.scopeLoopId;
    case "portfolio":
      return null;
  }
}

/**
 * WHICH LANE THE SELECTION MOVES TO WHEN THE SELECTED ONE IS REMOVED.
 *
 * `removeLoop` used to run `setFocus(null)` unconditionally, which is two
 * defects in one line: it deselected a lane the user was standing in when
 * they removed a DIFFERENT one, and where they removed the selected lane it
 * dropped to nothing — against the Esc ladder's own ruling that leaving a
 * thing lands on the thing that contained it.
 *
 * PREVIOUS FIRST, so the eye stays roughly where the removed row was; the
 * next lane only when the removed one was the first. Null only when the
 * removed lane was the last one on the canvas.
 */
export function laneAfterRemoval(ids: readonly LoopId[], removed: LoopId): LoopId | null {
  const i = ids.indexOf(removed);
  if (i < 0) return null;
  return ids[i - 1] ?? ids[i + 1] ?? null;
}

/**
 * The lane ↑ / ↓ walks to, or null at either end of the rack.
 *
 * DELIBERATELY DOES NOT WRAP. A selection that wraps from the last lane to the
 * first reads as a jump on a surface where the lanes are laid out in space and
 * the frame is what the eye follows.
 */
export function laneStep(ids: readonly LoopId[], from: LoopId, dir: 1 | -1): LoopId | null {
  const i = ids.indexOf(from);
  if (i < 0) return null;
  return ids[i + dir] ?? null;
}

/** Slim per-lane facts the helpers consume (computed once in RackCanvas). */
export interface DockLaneFacts {
  loopId: LoopId;
  hasMarket: boolean;
  graphOk: boolean;
  /** At least one module node on the lane. Optional ONLY so the un-rewired
   *  `RackCanvas.tsx:1006` object literal keeps compiling; absent reads as
   *  "unknown", never as "empty". HANDOFF: make it required. */
  hasModule?: boolean;
}

/**
 * Any module placed anywhere. The blank clause's own input.
 *
 * `undefined` on every lane means the caller has not been rewired, and the
 * honest answer there is "unknown, do not claim blank": it returns true, which
 * is `deriveDockMode`'s non-blank branch.
 */
export function anyModulePlaced(lanes: DockLaneFacts[]): boolean {
  return lanes.some((l) => l.hasModule !== false);
}

/** The lane a blank canvas starts on: the first with no module. */
export function firstEmptyLaneId(lanes: DockLaneFacts[]): LoopId | null {
  return lanes.find((l) => l.hasModule === false)?.loopId ?? null;
}

/**
 * The first lane that is not launch-shaped, for EITHER reason.
 *
 * This is `firstMarketlessLoopId` and `midBuildLoopId` collapsed into one:
 * they were two derivations of "which lane needs attention", they partition
 * the same set (`!hasMarket` versus `hasMarket && !graphOk`), and keeping them
 * apart only mattered while a marketless lane sent the dock somewhere else.
 */
export function firstIncompleteLoopId(lanes: DockLaneFacts[]): LoopId | null {
  return lanes.find((l) => !l.hasMarket || !l.graphOk)?.loopId ?? null;
}

/**
 * @deprecated for dock-mode derivation — absorbed by `firstIncompleteLoopId`.
 * Still the live owner of "which lane does `Browse markets` target" at
 * `RackCanvas.tsx:1445`, so it is not deletable until that caller moves.
 */
export function firstMarketlessLoopId(lanes: DockLaneFacts[]): LoopId | null {
  return lanes.find((l) => !l.hasMarket)?.loopId ?? null;
}

/** @deprecated absorbed by `firstIncompleteLoopId`. */
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
    case "compose":
      return "Compose";
    case "portfolio":
      return "Portfolio";
  }
}

/** The rail LED lights whenever the dock holds a scoped job. Unscoped
 *  Compose is the resting state — it is where the user lands with nothing
 *  selected, and a permanently lit LED is not a signal. */
export function dockRailLit(mode: DockMode): boolean {
  return !(mode.kind === "compose" && mode.scopeLoopId === null);
}
