/**
 * Small display helpers for the vault surfaces. Pure, clock-injected, and
 * deliberately terse: "5h ago", "in 11h". Anything that renders a *number*
 * lands in the mono at the call site; these only shape the string.
 */

const MIN = 60e3;
const HOUR = 3600e3;
const DAY = 86400e3;

/** Coarse elapsed label: "just now", "12m ago", "5h ago", "3d ago". */
export function fmtAgo(ms: number, nowMs = Date.now()): string {
  const d = Math.max(0, nowMs - ms);
  if (d < MIN) return "just now";
  if (d < HOUR) return `${String(Math.floor(d / MIN))}m ago`;
  if (d < DAY) return `${String(Math.floor(d / HOUR))}h ago`;
  return `${String(Math.floor(d / DAY))}d ago`;
}

/** Coarse countdown label: "due now", "in 42m", "in 11h", "in 3d". */
export function fmtIn(ms: number, nowMs = Date.now()): string {
  const d = ms - nowMs;
  if (d <= 0) return "due now";
  if (d < HOUR) return `in ${String(Math.max(1, Math.floor(d / MIN)))}m`;
  if (d < DAY) return `in ${String(Math.floor(d / HOUR))}h`;
  return `in ${String(Math.floor(d / DAY))}d`;
}
