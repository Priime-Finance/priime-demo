/**
 * Headless-driving parameters, parsed from the URL once at boot.
 *
 * These are invisible to a presenter and exist so `chrome --headless=new` can
 * park the page on an exact, deterministic frame. See the table in README.md.
 *
 * Pure apart from the one `window.location` read, which is guarded: with no
 * DOM this returns `DEFAULT_BOOT`, so the module is safe to import on the
 * server and testable without a browser.
 */
import { demoEnvironment } from "@/lib/environment";
import { STRIKE_INTERVAL_MS } from "@/lib/simulate";

/** Boot config parsed from the URL once, before the simulator starts. */
export interface Boot {
  /** PRNG seed. Same seed, same session. */
  seed: number;
  /** Wall-clock gap between strikes, in ms. */
  intervalMs: number;
  /** Strikes to run instantly at boot, so the ticker is populated. */
  preStrikes: number;
  /** Freeze the animation clock here and stop scheduling strikes. */
  freezeMs: number | null;
  /** Operator ids to start corrupted. */
  corrupt: readonly string[];
}

/** What the page boots with when the URL says nothing. */
export const DEFAULT_BOOT: Boot = {
  seed: 7,
  intervalMs: STRIKE_INTERVAL_MS,
  preStrikes: 0,
  freezeMs: null,
  corrupt: [],
};

/**
 * Resolve `"node-3"` or a signing address to a registry operator id.
 *
 * @param token one comma-separated `?corrupt=` token.
 * @returns the lowercased operator id, or `null` when it matches nothing.
 */
export function resolveOperatorId(token: string): string | null {
  const wanted = token.trim().toLowerCase();
  if (wanted === "") return null;
  const entry = demoEnvironment.registry.operators.find(
    (operator) =>
      operator.label.toLowerCase() === wanted || operator.id.toLowerCase() === wanted,
  );
  return entry?.id.toLowerCase() ?? null;
}

/** Read a numeric param, or fall back. */
function intParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Parse the headless-driving params from a query string.
 *
 * @param search a `location.search` value.
 * @returns the boot config.
 */
export function parseBootFrom(search: string): Boot {
  const params = new URLSearchParams(search);
  const freeze = params.get("sim-freeze");
  return {
    seed: intParam(params, "sim-seed", DEFAULT_BOOT.seed),
    intervalMs: intParam(params, "sim-interval", DEFAULT_BOOT.intervalMs),
    preStrikes: intParam(params, "sim-strikes", DEFAULT_BOOT.preStrikes),
    freezeMs: freeze === null || Number.isNaN(Number(freeze)) ? null : Number(freeze),
    corrupt: (params.get("corrupt") ?? "")
      .split(",")
      .map(resolveOperatorId)
      .filter((id): id is string => id !== null),
  };
}

/** Parse the live URL. Server-safe: returns `DEFAULT_BOOT` with no DOM. */
export function parseBoot(): Boot {
  if (typeof window === "undefined") return DEFAULT_BOOT;
  return parseBootFrom(window.location.search);
}
