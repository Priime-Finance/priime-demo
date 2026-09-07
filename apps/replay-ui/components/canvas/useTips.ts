"use client";

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-optional-chain --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * useTips — THE CLOCK for the canvas tip layer (TIP_SPEC §C).
 *
 * `lib/canvas/tips.ts` answers "what is TRUE". This hook answers "what is
 * SHOWN RIGHT NOW", and it owns every time-dependent rule so those rules stay
 * out of the pure module and out of RackCanvas:
 *
 *   C5  slow in / fast out / minimum life — ENTER needs the condition
 *       continuously true for 900ms, EXIT needs it false for 400ms, and a
 *       visible card lives at least 2500ms. Slow in prevents firing
 *       mid-thought; fast out means a tip you already fixed by hand vanishes
 *       before you read it; the floor stops a card blinking as a debounced
 *       quote lands.
 *   C6  the quiet gate — no tip may ENTER while the user is mid-action.
 *       Already-visible tips are never removed by the gate; it blocks
 *       entrances only.
 *   C7  oscillation guard — two enter/exit transitions inside 30s mutes the
 *       id for the session. The hysteresis handles jitter; this handles a
 *       user deliberately dragging a slider across the borrow/yield
 *       crossover, and it fails quiet.
 *   C4  caps, in order: one per loopId, one `tune`, one `note`, MAX_VISIBLE 2.
 *   C8  dismissal, scoped by kind, keyed `${id}:${causeSig}`, in a ref Map.
 *       NOTHING is persisted (rejected: localStorage per-tip dismissal —
 *       invisible cross-session state on a surface where a draft reload is a
 *       legitimate fresh start).
 *   C9  the ONLY persisted state is the master mute, which RackCanvas owns
 *       inside the existing panels key; toggling it off and on CLEARS the
 *       session dismissal map and is the single recovery path.
 *   C10 accepting re-derives everything: the accepted id enters `justAccepted`
 *       SYNCHRONOUSLY so it cannot re-enter in the same frame while its
 *       condition stays briefly true (installDefaults staggers over 480ms).
 *   C11 undo captures the portfolio reference BEFORE the dispatch, and
 *       re-mutes the id — without that, undo restores the exact
 *       state that made the tip true and the card returns 900ms later, which
 *       reads as the system arguing with the user.
 *   C12 dock suppression · C13 hard hide · C14 blank canvas.
 *   C15 the key's own mount, latched once per session — `everFired`. The
 *       predicate and the whole argument live in `hasTipSubject()`; the latch
 *       lives here because "has the layer ever spoken" is session state on the
 *       clock, exactly like the dismissal map beside it. `reset()` deliberately
 *       does NOT clear it (see 2. in that comment).
 *
 * All gate evaluation runs in an EFFECT, never in render: the bookkeeping is
 * mutable (dwell clocks, transition counts, show counts) and a double-invoked
 * render would double-count it straight into the oscillation mute.
 *
 * The single-beat governor (§E) lives here too: one module-scope claim, 90ms
 * queue gap, depth 3. Beyond depth 3 ENTRANCES drop to their resting state;
 * ACCEPTS are never dropped. Losing an arrival beat is cheaper than losing a
 * reward beat.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { deriveTips, hasTipSubject, type Tip, type TipContext } from "@/lib/canvas/tips";
import type { LoopId, ModuleKey, PortfolioGraph } from "@/lib/canvas/types";
import { DEMO_SCOPE, isLiveModule } from "@/lib/demo-scope";

/**
 * THE SCOPE FILTER (docs/plans/LATEST_UI_PORT_SPEC.md 2.11). A tip whose
 * subject is a module this build does not seat, or whose action would seat
 * one, is not shown: proposing the hedge on a lane that cannot install it is
 * a card the shelf contradicts. Tips at portfolio scope exist only for a
 * second lane (the allocation and the shared funding stream), and a second
 * lane is the capital router, which is coming soon, so they are withheld
 * while one strategy is live. `deriveTips` stays the one owner of what is
 * TRUE; this only decides what is SHOWN, which is this hook's job.
 */
function inScope(tip: Tip): boolean {
  if (tip.moduleKey && !isLiveModule(tip.moduleKey)) return false;
  const a = tip.action;
  if (a?.moduleKey && !isLiveModule(a.moduleKey)) return false;
  if (a?.actionId === "add-hedge") return false;
  if (tip.loopId === null && DEMO_SCOPE.liveStrategies.length === 1) return false;
  return true;
}

export const TIP_ENTER_MS = 900;
export const TIP_EXIT_MS = 400;
export const TIP_MIN_LIFE_MS = 2500;
export const TIP_QUIET_MS = 350;
export const TIP_OSC_WINDOW_MS = 30_000;
export const TIP_MAX_VISIBLE = 2;
export const TIP_MAX_EXPANDED = 4;
/** 296 card + 18 right inset + 8 breathing (D3). */
export const TIP_GUTTER = 322;
/** Below this BOARD width the column becomes the pill (D3). */
export const TIP_PILL_BELOW = 1100;
/** Cadence of the settle clock while any candidate is mid-hysteresis. */
const TICK_MS = 180;

export interface TipQuiet {
  panning: boolean;
  pointerDown: boolean;
  repricing: Record<LoopId, boolean>;
  reviewOpen: boolean;
  /** Dock is open AND forced into Discover for this lane. */
  discoverLoopId: LoopId | null;
  /** Dock is in Module mode on this exact module. */
  focusModule: { loopId: LoopId; key: ModuleKey } | null;
  /** Epoch ms of the last reducer dispatch. */
  lastDispatchAt: number;
  /** Hard hide (unmount, never dim): review open, mobile sheet, narrow+dock. */
  hidden: boolean;
  /** Master mute (persisted by RackCanvas in the existing panels key). */
  muted: boolean;
}

interface Seen {
  /** First moment the condition was continuously true. */
  trueSince: number | null;
  /** First moment the condition went false while the tip was visible. */
  falseSince: number | null;
  visibleAt: number | null;
  transitions: number[];
}

interface DismissRecord {
  dismissed: boolean;
  shows: number;
}

export interface UseTipsResult {
  /** The cards the stack renders, already capped and ordered. */
  visible: Tip[];
  /** Everything true-but-gated: the overflow count and the debug panel. */
  overflow: Tip[];
  /** All candidates from deriveTips, unfiltered (debug panel). */
  candidates: Tip[];
  /** C15: the tips key mounts on this. Latches once, never clears (§C15). */
  everFired: boolean;
  /** Why each candidate is not visible (debug panel). */
  gateReasons: Record<string, string>;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  dismiss: (tip: Tip) => void;
  /** Call SYNCHRONOUSLY on accept press, before the dispatch. */
  noteAccept: (tip: Tip) => void;
  /** Call on undo: re-mutes the id so the card does not come straight back. */
  noteUndo: (tip: Tip) => void;
  /** Clears the session dismissal + mute maps (the master-mute recovery). */
  reset: () => void;
  /** Claim the single-beat governor: the delay to wait, or -1 to drop. */
  claimBeat: (kind: "entrance" | "accept") => number;
}

const dismissKey = (t: Tip) => `${t.id}:${t.causeSig}`;

/** `true` while the user is mid-action (C6). */
function isQuietBlocked(q: TipQuiet, tip: Tip, nowMs: number): boolean {
  if (q.panning || q.pointerDown || q.reviewOpen) return true;
  if (tip.loopId && q.repricing[tip.loopId]) return true;
  if (nowMs - q.lastDispatchAt < TIP_QUIET_MS) return true;
  if (typeof document !== "undefined") {
    const el = document.activeElement as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return true;
  }
  return false;
}

/** C12: the dock is the working surface; a card repeating the affordance the
 *  user is already looking at is noise, and worse, it makes the two surfaces
 *  look like they disagree. */
function isDockSuppressed(q: TipQuiet, tip: Tip): boolean {
  if (tip.loopId && q.discoverLoopId === tip.loopId) return true;
  return !!(
    tip.moduleKey &&
    tip.loopId &&
    q.focusModule &&
    q.focusModule.loopId === tip.loopId &&
    q.focusModule.key === tip.moduleKey
  );
}

export function useTips(ctx: TipContext, quiet: TipQuiet): UseTipsResult {
  const candidates = useMemo(() => deriveTips(ctx).filter(inScope), [ctx]);

  const seenRef = useRef<Map<string, Seen>>(new Map());
  const dismissRef = useRef<Map<string, DismissRecord>>(new Map());
  const muteRef = useRef<Set<string>>(new Set());
  const justAcceptedRef = useRef<Set<string>>(new Set());
  const beatRef = useRef({ queue: 0, releaseAt: 0 });
  const pendingRef = useRef(false);
  /** C15. The ref is the guard (the effect runs on every committed state and
   *  must set the latch at most once); the state is what re-renders the nav. */
  const everFiredRef = useRef(false);
  const [everFired, setEverFired] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [gate, setGate] = useState<{ show: string[]; over: string[]; why: Record<string, string> }>({
    show: [],
    over: [],
    why: {},
  });
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  // ── The evaluation pass. Effect-only: it mutates the dwell/transition
  //    bookkeeping, so it must run exactly once per committed state. ──
  useEffect(() => {
    const now = Date.now();
    const why: Record<string, string> = {};
    const survivors: Tip[] = [];
    const seen = seenRef.current;
    const liveIds = new Set(candidates.map((c) => c.id));
    let pending = false;

    // C5 EXIT: conditions that went false. A visible card is held for 400ms
    // of falseness AND its 2500ms minimum life before it retires.
    for (const [id, s] of seen) {
      if (liveIds.has(id)) continue;
      if (s.falseSince === null) s.falseSince = now;
      if (s.visibleAt !== null) {
        const settled = now - s.falseSince >= TIP_EXIT_MS && now - s.visibleAt >= TIP_MIN_LIFE_MS;
        if (!settled) {
          pending = true;
          continue;
        }
        s.visibleAt = null;
        s.transitions.push(now); // an exit counts toward the oscillation guard
      }
      s.trueSince = null;
    }

    for (const tip of candidates) {
      let s = seen.get(tip.id);
      if (!s) {
        s = { trueSince: null, falseSince: null, visibleAt: null, transitions: [] };
        seen.set(tip.id, s);
      }
      s.falseSince = null;

      const hardStop =
        (quiet.hidden && "hard hide") ||
        (quiet.muted && "master mute") ||
        (muteRef.current.has(tip.id) && "oscillation mute") ||
        (justAcceptedRef.current.has(tip.id) && "just accepted") ||
        (isDockSuppressed(quiet, tip) && "dock suppression") ||
        (dismissRef.current.get(dismissKey(tip))?.dismissed === true && "dismissed") ||
        null;
      if (hardStop) {
        why[tip.id] = hardStop;
        s.visibleAt = null;
        continue;
      }

      if (s.visibleAt !== null) {
        survivors.push(tip);
        continue;
      }

      // `tune` is capped at 2 shows per id per session even undismissed (C8).
      const rec = dismissRef.current.get(dismissKey(tip));
      if (tip.kind === "tune" && (rec?.shows ?? 0) >= 2) {
        why[tip.id] = "tune show cap";
        continue;
      }
      if (s.trueSince === null) s.trueSince = now;
      if (isQuietBlocked(quiet, tip, now)) {
        // The gate blocks ENTRANCES only. The dwell clock keeps running so a
        // tip that was true throughout does not restart on every frame.
        why[tip.id] = "quiet gate";
        pending = true;
        continue;
      }
      if (now - s.trueSince < TIP_ENTER_MS) {
        why[tip.id] = "hysteresis";
        pending = true;
        continue;
      }
      // C7: two transitions inside 30s mutes the id for the session.
      //
      // BLOCKS ARE EXEMPT (§(d) ordering rule 5, 2026-08-22). A `tune` that
      // jitters is noise; a `block` that jitters is STILL TRUE, and muting it
      // leaves Review disarmed with no card explaining why and no key to fix
      // it. Swapping a lane's market back and forth twice used to be enough:
      // `duplicate-market` went away for the session while the vault stayed
      // unpublishable, and `class-conflict` — the only surface that explains a
      // blank APY — went with it. The clock still RECORDS a block's
      // transitions, so the debug panel can still see the oscillation; it just
      // never acts on them.
      s.transitions = s.transitions.filter((t) => now - t < TIP_OSC_WINDOW_MS);
      if (s.transitions.length >= 2 && tip.kind !== "block") {
        muteRef.current.add(tip.id);
        why[tip.id] = "oscillation mute";
        continue;
      }
      s.transitions.push(now);
      s.visibleAt = now;
      dismissRef.current.set(dismissKey(tip), { dismissed: false, shows: (rec?.shows ?? 0) + 1 });
      survivors.push(tip);
    }
    pendingRef.current = pending;

    // C4 caps, in this exact order. Tips filtered out by caps still count
    // toward the overflow number — and EXPANDING is what lifts them: an
    // overflow control that expands into nothing is a dead end, so the
    // expanded set is bounded by TIP_MAX_EXPANDED alone.
    //
    // THE LADDER (§(d) ordering rules 2 and 3, 2026-08-22):
    //
    //   1. per (loopId, moduleKey)      max 1        [new]
    //   2. per loopId                   max 1
    //   3. kind tune, LANE scope        max 1
    //   4. kind tune, PORTFOLIO scope   max 1        [new — was folded into 3]
    //   5. kind note                    max 1
    //   6. MAX_VISIBLE                  2  (4 expanded)
    //
    // Rule 1 exists because the catalog now has real plate collisions —
    // `market-never-positive`, `venue-dominated`, `venue-not-launchable` and
    // `quote-fell-back` all point at `liquidity-source`; `hedge-mismatch` and
    // `funding-is-the-income` both point at `hedge`. Two cards darting at one
    // 142px plate is the failure mode the cap exists to prevent, and rank
    // ordering makes the winner deterministic and correct: the block beats the
    // tune, the tune beats the note, the higher-value tune beats the lower.
    //
    // Rule 4 does NOT put more on screen — MAX_VISIBLE still binds at 2. It
    // changes WHICH two: a portfolio-level fact is about the whole thing the
    // user is building, and it should not have to out-rank a lane tune it has
    // nothing to do with in order to be seen at all.
    const perModule = new Set<string>();
    const perLane = new Set<LoopId>();
    let laneTunes = 0;
    let portfolioTunes = 0;
    let notes = 0;
    const show: string[] = [];
    const over: string[] = [];
    const room = expanded ? TIP_MAX_EXPANDED : TIP_MAX_VISIBLE;
    const moduleKeyOf = (t: Tip) => (t.loopId && t.moduleKey ? `${t.loopId}:${t.moduleKey}` : null);
    for (const tip of survivors) {
      const mk = moduleKeyOf(tip);
      const capped =
        // NOT gated on `expanded`, deliberately, and this is the one place the
        // implementation departs from the spec's illustrative snippet. Every
        // other cap lifts on expand because the user asked to see more; this
        // one is not about VOLUME, it is about two cards claiming one 142px
        // plate and two darts flying at the same target. Expanding is exactly
        // when the per-lane cap stops covering for it.
        (mk && perModule.has(mk) && "per-module cap") ||
        (!expanded && tip.loopId && perLane.has(tip.loopId) && "per-lane cap") ||
        (!expanded && tip.kind === "tune" && tip.loopId !== null && laneTunes >= 1 && "tune cap") ||
        (!expanded &&
          tip.kind === "tune" &&
          tip.loopId === null &&
          portfolioTunes >= 1 &&
          "portfolio tune cap") ||
        (!expanded && tip.kind === "note" && notes >= 1 && "note cap") ||
        (show.length >= room && "max visible") ||
        null;
      if (capped) {
        why[tip.id] = capped;
        over.push(tip.id);
        continue;
      }
      if (mk) perModule.add(mk);
      if (tip.loopId) perLane.add(tip.loopId);
      if (tip.kind === "tune") {
        if (tip.loopId === null) portfolioTunes += 1;
        else laneTunes += 1;
      }
      if (tip.kind === "note") notes += 1;
      show.push(tip.id);
    }

    // C15: the tips key's mount. Evaluated here because `show` is only known
    // here, latched because the state it recovers outlives its own condition.
    if (!everFiredRef.current && hasTipSubject(show.length, quiet.muted, candidates.length)) {
      everFiredRef.current = true;
      setEverFired(true);
    }

    setGate((prev) =>
      prev.show.join() === show.join() && prev.over.join() === over.join()
        ? { ...prev, why }
        : { show, over, why },
    );
  }, [candidates, quiet, expanded, tick]);

  // One settle clock, running ONLY while something is mid-hysteresis. Not an
  // animation and not a poll: it is the only way a 900ms enter delay resolves
  // when nothing else re-renders, and it stops itself once everything settles.
  useEffect(() => {
    if (!pendingRef.current) return;
    const t = setInterval(bump, TICK_MS);
    return () => clearInterval(t);
  }, [bump, tick, gate]);

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const visible = useMemo(
    () => gate.show.map((id) => byId.get(id)).filter((t): t is Tip => !!t),
    [gate.show, byId],
  );
  const overflow = useMemo(
    () => gate.over.map((id) => byId.get(id)).filter((t): t is Tip => !!t),
    [gate.over, byId],
  );

  const dismiss = useCallback(
    (tip: Tip) => {
      const prev = dismissRef.current.get(dismissKey(tip));
      dismissRef.current.set(dismissKey(tip), { dismissed: true, shows: prev?.shows ?? 1 });
      const s = seenRef.current.get(tip.id);
      if (s) s.visibleAt = null;
      bump();
    },
    [bump],
  );

  const noteAccept = useCallback(
    (tip: Tip) => {
      // SYNCHRONOUS (C10a): installDefaults staggers over 480ms, so B1's
      // condition stays true for three more renders.
      justAcceptedRef.current.add(tip.id);
      const s = seenRef.current.get(tip.id);
      if (s) {
        s.visibleAt = null;
        s.trueSince = null;
      }
      setExpanded(false); // expansion collapses on the next accept (C4)
      setTimeout(() => {
        justAcceptedRef.current.delete(tip.id);
        bump();
      }, 1400);
      bump();
    },
    [bump],
  );

  const noteUndo = useCallback(
    (tip: Tip) => {
      muteRef.current.add(tip.id);
      bump();
    },
    [bump],
  );

  const reset = useCallback(() => {
    dismissRef.current.clear();
    muteRef.current.clear();
    seenRef.current.clear();
    // NOT `everFiredRef` (C15). This runs on the unmute press, and clearing
    // the latch there would unmount the key the user is still touching, for
    // the 900ms it takes the first card to re-enter.
    setExpanded(false);
    bump();
  }, [bump]);

  /** §E governor: claimants queue with a 90ms gap, depth 3. */
  const claimBeat = useCallback((kind: "entrance" | "accept") => {
    const now = Date.now();
    const g = beatRef.current;
    if (g.releaseAt < now) {
      g.queue = 0;
      g.releaseAt = now;
    }
    if (kind === "entrance" && g.queue >= 3) return -1; // rests, unanimated
    const delay = Math.max(0, g.releaseAt - now);
    g.queue += 1;
    g.releaseAt = Math.max(now, g.releaseAt) + 90;
    return delay;
  }, []);

  return {
    visible,
    overflow,
    candidates,
    everFired,
    gateReasons: gate.why,
    expanded,
    setExpanded,
    dismiss,
    noteAccept,
    noteUndo,
    reset,
    claimBeat,
  };
}

/** E7: one hook feeds BOTH the `data-rm` attribute and the JS branches —
 *  CSS-only guarding is insufficient here, because FLIP writes inline
 *  transforms and the dart mounts real DOM, neither reachable from a media
 *  query. */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduce;
}

/** C11: the reducer is pure and the graph immutable, so a reference snapshot
 *  is a complete, cheap undo for every action in the catalog. */
export interface TipUndoSnapshot {
  tip: Tip;
  /* The GRAPH is the whole snapshot since the risk-stop state was deleted
     (2026-08-22): the leverage a tip applies is a safety-buffer param, so
     restoring the portfolio restores the control's position by construction.
     The old second field held a subjective adjective that lived outside the
     graph, which is exactly why it had to be snapshotted separately. */
  portfolio: PortfolioGraph;
  loopId: LoopId | null;
}
