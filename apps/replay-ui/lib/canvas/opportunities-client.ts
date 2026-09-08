/**
 * Client-side catalog subscription (2026-08-21).
 *
 * The canvas used to fetch /api/canvas/opportunities exactly once, on
 * mount. With on-demand refresh (lib/canvas/refresh.ts) that first fetch is
 * what SCHEDULES a rescan, so the fresh numbers land a minute or so later —
 * and without polling the user would sit in front of the stale ones until
 * they reloaded the page.
 *
 * Deliberately dependency-free and cheap:
 *   · one poll a minute, and only while the tab is visible;
 *   · the interval is torn down when the tab is hidden and rebuilt when it
 *     comes back, so a backgrounded canvas costs nothing;
 *   · one immediate catch-up fetch on regaining visibility, but only if the
 *     last successful fetch is older than the poll interval;
 *   · overlapping fetches are suppressed, and the in-flight request is
 *     aborted on teardown.
 */

const POLL_INTERVAL_MS = 60_000;
const ENDPOINT = "/api/canvas/opportunities";

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

export interface SubscribeOptions {
  /** Force a scan attempt on the first fetch (still lock-limited server-side). */
  refresh?: boolean;
  intervalMs?: number;
}

/**
 * Fetch the catalog now, then keep it up to date. Returns the teardown
 * function — call it from the effect cleanup.
 */
export function subscribeOpportunities<T>(
  onData: (data: T) => void,
  onError: (message: string) => void,
  opts: SubscribeOptions = {},
): () => void {
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  let alive = true;
  let inFlight: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastOkAt = 0;

  const load = async (force: boolean) => {
    if (!alive || inFlight) return;
    const ac = new AbortController();
    inFlight = ac;
    try {
      const res = await fetch(force ? `${ENDPOINT}?refresh=1` : ENDPOINT, {
        signal: ac.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as T;
      if (!alive) return;
      lastOkAt = Date.now();
      onData(body);
    } catch (e) {
      // An abort is a teardown, not a failure. A poll failure must not wipe
      // the catalog the user is already looking at — report and keep going.
      if (!alive || (e as Error)?.name === "AbortError") return;
      onError("catalog unreachable");
    } finally {
      if (inFlight === ac) inFlight = null;
    }
  };

  const startTimer = () => {
    if (timer === null) timer = setInterval(() => void load(false), intervalMs);
  };
  const stopTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibility = () => {
    if (!alive) return;
    if (document.visibilityState === "visible") {
      if (Date.now() - lastOkAt >= intervalMs) void load(false);
      startTimer();
    } else {
      stopTimer();
    }
  };

  void load(opts.refresh === true);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") startTimer();
  } else {
    startTimer();
  }

  return () => {
    alive = false;
    stopTimer();
    inFlight?.abort();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
