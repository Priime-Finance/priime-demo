/**
 * Reprice failure classification and quote invalidation (recette P0-1).
 * Pure, no React.
 *
 * A failed quote lands in one of three DEFINITIVE states the UI must never
 * conflate:
 *
 *   gone        — the service answered 404: the market left the latest live
 *                 scan (delisted). Nothing is in flight; waiting is a lie.
 *   failed      — the service answered with a non-404 error (bad request,
 *                 upstream failure). Definitive for this request.
 *   unreachable — the network call itself failed. Retry may help.
 *
 * "Waiting on the live quote" may only ever describe the quoting state.
 */

import type { ModuleKey } from "./types";

export type RepriceFailureKind = "gone" | "failed" | "unreachable";

/** Classify a reprice failure from the HTTP status (null = network error). */
export function classifyRepriceFailure(httpStatus: number | null): RepriceFailureKind {
  if (httpStatus === null) return "unreachable";
  if (httpStatus === 404) return "gone";
  return "failed";
}

/**
 * Composition changes that invalidate a shown quote (recette P1-5): the
 * market, the safety buffer, and the hedge all shape the priced economics;
 * auto-compound is cadence-only and never priced, so its add/eject leaves
 * the quote genuinely valid.
 */
export function invalidatesQuote(key: ModuleKey): boolean {
  return key !== "auto-compound";
}

/**
 * The lane-displayable net APY (recette P1-5): a quote whose economics
 * assume a different composition than the canvas (class-coherence broken,
 * e.g. hedge ejected from a hedged-class market) must not render as the
 * lane's number. Null means "no honest number to show".
 */
export function laneDisplayApy(netApy: number | null, classCoherent: boolean): number | null {
  return classCoherent ? netApy : null;
}
