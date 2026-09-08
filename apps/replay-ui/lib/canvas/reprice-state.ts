/**
 * Reprice quote state machine (recette P0-1). Pure, no React.
 *
 * The quote spine has exactly six states and the UI must never conflate
 * them: idle (nothing to quote), quoting (a request is in flight), priced
 * (a live quote landed), and three DEFINITIVE failure states:
 *
 *   gone        — the service answered 404: the market left the latest live
 *                 scan (delisted). Nothing is in flight; waiting is a lie.
 *   failed      — the service answered with a non-404 error (bad request,
 *                 upstream failure). Definitive for this request.
 *   unreachable — the network call itself failed. Retry may help.
 *
 * "Waiting on the live quote" may only ever describe the quoting state.
 */

import { moduleInvalidatesQuote } from "./modules";

export type RepriceFailureKind = "gone" | "failed" | "unreachable";

export type QuoteState = "idle" | "quoting" | "priced" | RepriceFailureKind;

/** Classify a reprice failure from the HTTP status (null = network error). */
export function classifyRepriceFailure(httpStatus: number | null): RepriceFailureKind {
  if (httpStatus === null) return "unreachable";
  if (httpStatus === 404) return "gone";
  return "failed";
}

export interface LaneQuoteFacts {
  /** A reprice request is currently in flight for this lane. */
  repricing: boolean;
  /** The last reprice result: true = priced, a kind = failed, null = none. */
  reprice: { ok: true } | { ok: false; kind?: RepriceFailureKind } | null;
}

/** Derive the lane's quote state. In-flight always wins (a retry is live). */
export function laneQuoteState(f: LaneQuoteFacts): QuoteState {
  if (f.repricing) return "quoting";
  if (f.reprice === null) return "idle";
  if (f.reprice.ok) return "priced";
  return f.reprice.kind ?? "unreachable";
}

/** Short truthful label for the lane header / dock badge. */
export function quoteFailureLabel(kind: RepriceFailureKind): string {
  switch (kind) {
    case "gone":
      return "market left the latest scan";
    case "failed":
      return "quote failed";
    case "unreachable":
      return "quote service unreachable";
  }
}

/** Header guide line for a definitive quote failure: truth plus a way out. */
export function quoteFailureGuide(kind: RepriceFailureKind, laneLabel: string): string {
  switch (kind) {
    case "gone":
      return `${laneLabel}: this market left the latest scan. Pick another market, or rescan`;
    case "failed":
      return `${laneLabel}: the live quote failed. Retry or swap market`;
    case "unreachable":
      return `${laneLabel}: the quote service is unreachable. Retry`;
  }
}

/**
 * Composition changes that invalidate a shown quote (recette P1-5).
 *
 * THIS FILE NO LONGER HOLDS AN OPINION. It used to answer
 * `key !== "auto-compound"` on the reasoning that auto-compound is
 * cadence-only and never priced. That reasoning died with A10 (2026-08-22):
 * `compoundDelta()` gives auto-compound signed, size-dependent economics, so
 * adding it moves the number like any other module. `modules.ts` derives the
 * answer from `QUOTE_AFFECTING_PARAMS` — the ONE list of fields that enter
 * the priced model — and today that list is non-empty for all seven modules.
 *
 * Two opinions about one question is how a canvas ends up showing a stale
 * quote as live. Re-exported under the name every call site already imports
 * so the derivation stays single-sourced.
 */
export { moduleInvalidatesQuote as invalidatesQuote };

/**
 * The lane-displayable net APY (recette P1-5): a quote whose economics
 * assume a different composition than the canvas (class-coherence broken,
 * e.g. hedge ejected from a hedged-class market) must not render as the
 * lane's number. Null means "no honest number to show".
 */
export function laneDisplayApy(netApy: number | null, classCoherent: boolean): number | null {
  return classCoherent ? netApy : null;
}
