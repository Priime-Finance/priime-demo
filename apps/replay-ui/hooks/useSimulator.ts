"use client";

/**
 * The heartbeat: a React hook that turns the pure simulator into a running
 * system.
 *
 * Everything stateful about time lives here and nowhere else. `lib/simulate.ts`
 * stays pure (seed in, journal out) and `lib/replay.ts` stays pure (journal +
 * `t` in, renderable state out); this hook owns the two clocks that connect
 * them: the strike interval (a new journal every `STRIKE_INTERVAL_MS`) and the
 * per-strike animation clock (`requestAnimationFrame`, reset on every strike).
 *
 * Between strikes the animation clock simply runs past the timeline's end. The
 * canvas reads that as "breathing": nothing in flight, lamps idling.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Journal } from "@priime-demo/journal-schema";

import {
  buildTimeline,
  deriveReplayState,
  type ReplayPacing,
  type ReplayState,
  type ReplayTimeline,
} from "@/lib/replay";
import {
  bootSession,
  initialSimState,
  nextStrike,
  setCorrupt,
  SIM_CONFIG,
  type SimConfig,
  type SimState,
} from "@/lib/simulate";

/**
 * Playback pacing for a simulated strike.
 *
 * Deliberately faster than `REPLAY_PACING` (which is tuned for a presenter
 * narrating one captured strike): a simulated strike must finish inside its
 * own interval and still leave the system visibly idle before the next one.
 * With three operators this lands at ~6.2 s of flight inside a 12 s cycle.
 */
export const SIM_PACING: ReplayPacing = {
  leadInMs: 500,
  minGapMs: 500,
  maxGapMs: 1_100,
  msPerRealSecond: 550,
  tailHoldMs: 1_500,
};

/** How many strikes stay in memory for the history strip. */
export const HISTORY_LIMIT = 20;

/** Knobs the page passes in, all of them URL-driven for headless runs. */
export interface SimulatorOptions {
  /** PRNG seed. Same seed, same session. */
  seed: number;
  /** Wall-clock gap between strikes, in ms. */
  intervalMs: number;
  /** Operator ids to start corrupted. */
  corrupt: readonly string[];
  /** Strikes to run instantly at boot, to populate history. */
  preStrikes: number;
  /**
   * Freeze the animation clock at this offset (ms into the live strike) and
   * never schedule another. The deterministic-screenshot escape hatch.
   */
  freezeMs: number | null;
  /** Service description; defaults to `SIM_CONFIG`. */
  config?: SimConfig;
}

/** What the canvas needs to draw one frame. */
export interface SimulatorFeed {
  /** Strikes newest first, live one at index 0. Capped at `HISTORY_LIMIT`. */
  history: readonly Journal[];
  /** The strike currently in (or just out of) flight. */
  journal: Journal | null;
  /** Its compiled timeline. */
  timeline: ReplayTimeline | null;
  /** Its derived state at the current animation offset. */
  state: ReplayState | null;
  /** Animation offset in ms since the live strike triggered. */
  tMs: number;
  /** Simulator state after the live strike (RNG, block, LTV, corruption). */
  sim: SimState;
  /** Operator ids currently flipped to corrupt, lowercased. */
  corrupt: ReadonlySet<string>;
  /**
   * Operator ids that were flipped to corrupt when the live strike fired.
   *
   * Diverges from `corrupt` in exactly the window a flip opens: the switch has
   * moved, the strike on screen predates it. Anything describing that strike
   * reads this; only the switches themselves read `corrupt`.
   */
  strikeCorrupt: ReadonlySet<string>;
  /** Flip one operator. Takes effect from the next strike. */
  toggleCorrupt: (operatorId: string) => void;
  /** True when the OS asks for reduced motion: no pulses, no shake. */
  reducedMotion: boolean;
  /** True while the clock is frozen by `freezeMs`. */
  frozen: boolean;
}

/** Prepend `journal` to `history`, capped. */
function pushHistory(
  history: readonly Journal[],
  journal: Journal,
): readonly Journal[] {
  return [journal, ...history].slice(0, HISTORY_LIMIT);
}

/**
 * Run the simulated feed.
 *
 * @param options seed, pacing and headless overrides.
 * @returns everything a frame needs.
 */
export function useSimulator(options: SimulatorOptions): SimulatorFeed {
  const config = options.config ?? SIM_CONFIG;

  const simRef = useRef<SimState | null>(null);
  const startedAtRef = useRef<number>(0);
  const frameRef = useRef<number | null>(null);

  const [history, setHistory] = useState<readonly Journal[]>([]);
  const [sim, setSim] = useState<SimState>(() =>
    initialSimState(options.seed, 0, options.corrupt),
  );
  const [tMs, setTMs] = useState(options.freezeMs ?? 0);
  const [reducedMotion, setReducedMotion] = useState(false);
  // The flags as they stood when the live strike fired, frozen until the next
  // one. `sim.corrupt` moves the instant a switch is flipped; this does not.
  const [strikeCorrupt, setStrikeCorrupt] = useState<readonly string[]>([]);

  /* ------------------------------------------------------------- strikes */

  /** Produce one strike, advance the simulator, restart the animation clock. */
  const fire = useCallback(() => {
    const current = simRef.current;
    if (current === null) return;
    const result = nextStrike(
      { ...current, unixSeconds: Math.floor(Date.now() / 1_000) },
      config,
    );
    simRef.current = result.state;
    setSim(result.state);
    // Snapshot before any later flip: `nextStrike` never touches `corrupt`, so
    // the flags this strike was actually computed under are `current.corrupt`.
    setStrikeCorrupt(current.corrupt);
    setHistory((previous) => pushHistory(previous, result.journal));
    startedAtRef.current =
      typeof performance === "undefined" ? Date.now() : performance.now();
    setTMs(0);
  }, [config]);

  // Boot: seed the session, optionally pre-run history, fire the first strike.
  // The sequencing (including seeding the warmup in the past so the ticker's
  // clock runs forwards) lives in `bootSession`, pure and unit-tested.
  useEffect(() => {
    const now = Math.floor(Date.now() / 1_000);
    const boot = bootSession(options.seed, now, options.corrupt, options.preStrikes, config);

    simRef.current = boot.state;
    setSim(boot.state);
    setStrikeCorrupt(boot.strikeCorrupt);
    setHistory(boot.history.slice(0, HISTORY_LIMIT));
    startedAtRef.current =
      typeof performance === "undefined" ? Date.now() : performance.now();
    setTMs(options.freezeMs ?? 0);
    // Boot config is read once, on mount, exactly like a deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The strike interval. Frozen sessions never schedule one.
  useEffect(() => {
    if (options.freezeMs !== null) return;
    const id = window.setInterval(fire, Math.max(1_000, options.intervalMs));
    return () => window.clearInterval(id);
  }, [fire, options.intervalMs, options.freezeMs]);

  /* --------------------------------------------------------------- clock */

  useEffect(() => {
    if (options.freezeMs !== null) {
      setTMs(options.freezeMs);
      return;
    }
    const step = (now: number): void => {
      setTMs(now - startedAtRef.current);
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [options.freezeMs]);

  /* ------------------------------------------------------- reduced motion */

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  /* ---------------------------------------------------------- corruption */

  const toggleCorrupt = useCallback((operatorId: string) => {
    const current = simRef.current;
    if (current === null) return;
    const wanted = operatorId.toLowerCase();
    const next = setCorrupt(current, wanted, !current.corrupt.includes(wanted));
    simRef.current = next;
    setSim(next);
  }, []);

  /* -------------------------------------------------------------- derive */

  const journal = history[0] ?? null;
  const timeline = useMemo(
    () => (journal === null ? null : buildTimeline(journal, SIM_PACING)),
    [journal],
  );
  const state = useMemo(
    () =>
      journal === null || timeline === null
        ? null
        : deriveReplayState(journal, tMs, timeline),
    [journal, timeline, tMs],
  );

  const corrupt = useMemo(() => new Set(sim.corrupt), [sim.corrupt]);
  const strikeCorruptSet = useMemo(() => new Set(strikeCorrupt), [strikeCorrupt]);

  return {
    history,
    journal,
    timeline,
    state,
    tMs,
    sim,
    corrupt,
    strikeCorrupt: strikeCorruptSet,
    toggleCorrupt,
    reducedMotion,
    frozen: options.freezeMs !== null,
  };
}
