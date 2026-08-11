/**
 * Display helpers for the replay UI.
 *
 * Two house rules are enforced here rather than left to each renderer:
 *
 * 1. **Percentages and attestations, not dollar P&L** (spec open question 3).
 *    NAV is shown as a signed percentage of a baseline; there is no
 *    dollar-formatting helper in this file on purpose.
 * 2. **Never float on base units.** Every `nav` in the journal is an integer
 *    string in `nav_unit` base units, and it is the input to a keccak hash.
 *    All arithmetic below is `BigInt`; `Number` never touches a NAV.
 */

/** Chains we can deep-link. Anything absent renders as plain text, not a dead link. */
const EXPLORER_BASE_URLS: Readonly<Record<number, string>> = {
  // Base mainnet — the live track (spec M6).
  8453: "https://basescan.org",
  // 31337 (anvil mainnet fork, the "fork track") is deliberately absent: a
  // local fork has no public explorer, so renderers must show plain text.
};

/* ------------------------------------------------------------ NAV as a pct */

/** Divide `numerator / denominator`, rounding halves away from zero. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n; // sign xor
  const a = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * a + d) / (2n * d);
  return negative ? -q : q;
}

/**
 * Format a NAV as a signed percentage of a baseline NAV.
 *
 * Both values are integer strings in the *same* `nav_unit` base units; the
 * unit scale cancels out, so `decimals` is the number of fraction digits to
 * display, not `nav_unit.decimals`. Computed entirely in `BigInt` and rounded
 * half away from zero, so sub-1% moves survive.
 *
 * @param nav NAV to render, integer string in base units.
 * @param baseline NAV to compare against, integer string in the same units.
 * @param decimals fraction digits to show (default 2, negatives treated as 0).
 * @returns e.g. `"+50.00%"`, `"-33.33%"`, `"-0.05%"`, `"0.00%"` when unchanged.
 * @throws RangeError if `baseline` is zero (no percentage is defined).
 * @throws SyntaxError if either argument is not an integer string.
 */
export function formatNavPct(nav: string, baseline: string, decimals = 2): string {
  const value = BigInt(nav);
  const base = BigInt(baseline);
  if (base === 0n) {
    throw new RangeError("formatNavPct: baseline must be non-zero");
  }

  const places = Math.max(0, Math.trunc(decimals));
  const scale = 10n ** BigInt(places);
  const scaled = divRound((value - base) * 100n * scale, base);

  const magnitude = scaled < 0n ? -scaled : scaled;
  const whole = magnitude / scale;
  const fraction = magnitude % scale;
  const fractionText =
    places === 0 ? "" : `.${fraction.toString().padStart(places, "0")}`;
  const sign = scaled > 0n ? "+" : scaled < 0n ? "-" : "";

  return `${sign}${whole.toString()}${fractionText}%`;
}

/* --------------------------------------------------------------- shortening */

/**
 * Middle-truncate a hex string for display: `0x1234…abcd`.
 *
 * Returns the input untouched when it is already short enough to show whole.
 *
 * @param value hex string (or anything else; not validated).
 * @param lead leading characters to keep, including `0x` (default 6).
 * @param tail trailing characters to keep (default 4).
 * @returns the truncated string.
 */
export function truncateHash(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  // Not `slice(-tail)`: `-0` is `0`, so `tail = 0` would return the lead, the
  // ellipsis, and then the whole string again. No call site passes 0 today,
  // but lead/tail are exported API.
  return `${value.slice(0, lead)}…${value.slice(value.length - tail)}`;
}

/**
 * Middle-truncate an EVM address for display: `0x1234…abcd`.
 *
 * Same shape as `truncateHash`, named separately so call sites read right and
 * address truncation can diverge later without touching hash call sites.
 *
 * @param address the address.
 * @returns the truncated address.
 */
export function truncateAddress(address: string): string {
  return truncateHash(address, 6, 4);
}

/* ---------------------------------------------------------------- explorers */

/**
 * Explorer origin for a chain id.
 *
 * @param chainId EVM chain id.
 * @returns the origin (no trailing slash), or `null` for chains with no public
 *   explorer (31337 anvil) and any chain we do not know.
 */
export function explorerBaseUrl(chainId: number): string | null {
  return EXPLORER_BASE_URLS[chainId] ?? null;
}

/**
 * Deep link to a transaction.
 *
 * @param chainId EVM chain id.
 * @param txHash transaction hash.
 * @returns the URL, or `null` when the chain has no explorer — renderers show
 *   plain text rather than a dead link.
 */
export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = explorerBaseUrl(chainId);
  return base === null ? null : `${base}/tx/${txHash}`;
}

/**
 * Deep link to an address.
 *
 * @param chainId EVM chain id.
 * @param address EVM address.
 * @returns the URL, or `null` when the chain has no explorer.
 */
export function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = explorerBaseUrl(chainId);
  return base === null ? null : `${base}/address/${address}`;
}

/* ----------------------------------------------------------------- clock */

/** Rendered in place of a time that does not exist yet (null attestation). */
export const EMPTY_TIME = "--:--:--";

/**
 * Format journal unix seconds as a UTC wall clock.
 *
 * Journal timestamps are unix seconds UTC; the demo must read identically in
 * every timezone it is presented in, so this never uses local time.
 *
 * @param unixSeconds unix seconds, or `null` for a value not yet known.
 * @returns `"HH:MM:SS"`, or `EMPTY_TIME` for null/non-finite input.
 */
export function formatUtcTime(unixSeconds: number | null): string {
  if (unixSeconds === null || !Number.isFinite(unixSeconds)) return EMPTY_TIME;
  const date = new Date(Math.trunc(unixSeconds) * 1000);
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
