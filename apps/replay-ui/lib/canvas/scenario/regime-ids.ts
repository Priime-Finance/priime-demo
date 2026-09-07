/**
 * THE FOUR REGIMES THE DEMO'S ROUTER REPLAY RUNS, AND NOTHING ELSE.
 *
 * This file is DELIBERATELY IMPORT-FREE and it stays that way. The regime
 * switcher is a client control inside `LanePanel`, and every other module the
 * replay touches reaches `router-history.ts`, which reaches `templates.ts` and
 * the pricing owners. A client control that only needs the list of regimes
 * imports THIS file and nothing deeper, so the browser bundle never grows a
 * pricing graph to draw four keys.
 *
 * ── WHAT CHANGED, AND WHY THE SEEDS WENT WITH IT ─────────────────────────
 * The six regimes this file used to carry were the live app's SYNTHETIC
 * funding scenarios: premiums, venue clamps and funding percentiles, each
 * generated from a seed token. The demo's replay is not generated. It is the
 * measured history in `lib/canvas/router-history.ts`, 89 aligned days of two
 * published series, and the three stress regimes are TRANSFORMS of that
 * history rather than draws from a generator.
 *
 * A history replay has no seed, so `REGIME_SEED_TOKEN`, `REGIME_SEED`,
 * `seedOf` and `fnv1a32` are gone rather than kept at a value nobody can act
 * on. Nothing outside this file referenced them (checked by grep across
 * `app`, `components`, `lib` and `tests` before the deletion).
 *
 * ── THE SENTENCES ────────────────────────────────────────────────────────
 * `REGIME_MECHANISM` states the TRANSFORM on the measured series, in the
 * present tense, mechanism only, never a risk adjective. The route owns the
 * transforms; these sentences are the same statements in words, and the
 * dates and sizes in them are the dates and sizes the route actually runs
 * (`app/api/canvas/orchestrate/route.ts`, the regime table).
 */

export type RegimeId = "measured" | "incentive-halves" | "usdc-squeeze" | "whipsaw";

/** Render order, and the order the switcher draws. */
export const REGIME_IDS: readonly RegimeId[] = [
  "measured",
  "incentive-halves",
  "usdc-squeeze",
  "whipsaw",
] as const;

/** The measured history is the default: the run a reader should meet first is
 *  the one that happened, not a stress. */
export const DEFAULT_REGIME: RegimeId = "measured";

/** Rendered verbatim. One noun phrase each, sentence case, one part of
 *  speech across the set: four labels are one control. */
export const REGIME_LABEL: Record<RegimeId, string> = {
  measured: "Measured",
  "incentive-halves": "Incentive halved",
  "usdc-squeeze": "USDC squeeze",
  whipsaw: "Whipsaw",
};

/**
 * What each regime DOES to the measured series, in one present-tense
 * sentence. The measured one carries the honest register: the window holds
 * no qualifying return crossing, so the return leg is shown by the stresses
 * and not by history.
 */
export const REGIME_MECHANISM: Record<RegimeId, string> = {
  measured:
    "The last 89 days as they happened, to 2026-09-07. The rule fires once, on 2026-06-12, and nothing in this window crosses back by the margin.",
  "incentive-halves":
    "The USDe incentive halves from 2026-07-25, so the loop's reason to exist weakens and the router moves to the floor and stays.",
  "usdc-squeeze":
    "Aave USDC supply lifts 5pp for 20 days from 2026-08-10, then reverts, so the reverse has to clear the same bar on its own.",
  whipsaw:
    "The two published series cross in runs of growing length, so the sustain, the cooldown, the reverse-edge lock and the payback gate each get to refuse.",
};

export function isRegimeId(v: unknown): v is RegimeId {
  return typeof v === "string" && (REGIME_IDS as readonly string[]).includes(v);
}
