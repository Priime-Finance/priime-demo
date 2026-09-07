/**
 * Plain-language label map for user surfaces (recette P2-1).
 *
 * Raw internal enums (gate ids, venue ids, chain ids) never render verbatim
 * on a retail surface: every id passes through here at point of use. The
 * fallback humanizes unknown ids (underscores to spaces) so a new scanner
 * gate degrades to readable words, never to snake_case.
 */

import { VENUE_LABELS, type CanvasVenueId } from "./opportunities";

/**
 * THE ONE STRING A `Health bands` ROW PRINTS WHEN THERE IS NO BORROW LEG.
 *
 * S1, 2026-08-24. This sentence was declared FIVE times — `NO_BORROW_BANDS_VALUE`
 * in `RackCanvas.tsx`, `NO_BORROW_BAND_ROW` in `seeds.ts`, and three bare
 * literals in `PlateControls.tsx`, `PlateScreen.tsx` and `DockReadouts.tsx`.
 * Two of the five were pinned equal by a cross-file test; the other three
 * could drift silently, which is how a canvas and the record it publishes
 * come to say two things about one shape. It lives here because `labels.ts`
 * is the product's prose vocabulary and is importable by every surface,
 * including the canvas — which cannot import `seeds.ts`, since that module
 * builds every sample record at load.
 *
 * Not a number, and deliberately not a risk adjective: the label is the
 * quantity and the value is the reason there is none.
 */
export const NO_BORROW_BANDS_VALUE = "no borrow leg to trim";

/**
 * THE ONE LABEL FOR THE LEVERAGE THE MODEL PRICED (W1 gate, 2026-08-24).
 *
 * Three writers state this one quantity: the canvas (`RackCanvas` publishes
 * it as a record param), the samples (`lib/vaults/seeds.ts`) and the record
 * itself (`VaultDetail` derives it from `automations.leverage` for a record
 * that published no param). The canvas said `Leverage` while the other two
 * said `Applied leverage`, so on every canvas-published loop record BOTH rows
 * printed the same number — `Leverage 2.75x` and `Applied leverage 2.75x`,
 * measured on `/vaults/my-wsteth-loop`. The H10 family rule keys on the first
 * word, so `leverage` and `applied` never met and the dedupe could not see
 * one fact. Under one label the exact-label rule collapses them.
 *
 * `Applied` is the honest word: `LeverageAutomation.targetLeverage` is the
 * POST-CLAMP leverage the model priced, not the dial's request.
 */
export const APPLIED_LEVERAGE_LABEL = "Applied leverage";

/** Scanner gate ids (v1 + v2) to human labels. */
const GATE_LABELS: Record<string, string> = {
  // caps
  caps: "supply caps closed",
  caps_fail_closed: "supply caps closed",
  // rates and carry
  rate_inversion_p25: "borrow rate above yield",
  marginal_rates_carry: "carry negative at the margin",
  funding_p25_floor: "perp funding too negative",
  // hedge feasibility
  wrapper_basis: "wrapper basis unhedged",
  native_perp: "no native perp to hedge with",
  hl_oi_depth: "hedge market too shallow",
  hl_min_size: "hedge below minimum size",
  no_perp_confirmed: "perp exposure unconfirmed",
  // oracle and integrity
  oracle_provenance: "oracle provenance unverified",
  oracle_staleness: "oracle data stale",
  yield_source_integrity: "yield source unverified",
  erc4626_integrity: "vault wrapper unverified",
  independent_price_feed: "no independent price feed",
  // market structure
  lt_geometry: "liquidation threshold out of range",
  emode_geometry: "e-mode geometry out of range",
  risk_feature: "venue risk flags raised",
  debt_market_open: "borrowing disabled",
  market_sanity: "market failed the sanity screen",
  capacity_floor: "capacity too small",
  borrow_liquidity: "not enough borrow liquidity",
  redemption_liquidity: "thin redemption liquidity",
  depeg_basis: "depeg risk unpriced",
  peg_class: "peg classification failed",
  same_underlying: "legs not the same underlying",
  wrapper: "wrapper unverified",
};

/**
 * EVERY GATE ID THE PRODUCT KNOWS, derived from the label map above so there
 * is one owner and a new gate cannot leave the list stale.
 *
 * It exists for the copilot's prose lint (`copilot/prose-lint.ts`), which has
 * to recognise a raw id in model prose in order to withhold it. A lint holding
 * a hand-typed copy of these strings would go out of date on the exact day a
 * new scanner gate started leaking into an answer.
 */
export const GATE_IDS: readonly string[] = Object.keys(GATE_LABELS);

/** Human label for a scanner gate id; unknown ids humanize, never leak. */
export function gateLabel(gate: string | null | undefined): string {
  if (!gate) return "screened out";
  return GATE_LABELS[gate] ?? gate.replace(/_/g, " ");
}

/** Venue id to display name (falls back to the raw id, humanized). */
export function venueLabel(venue: string): string {
  return VENUE_LABELS[venue as CanvasVenueId] ?? venue.replace(/-/g, " ");
}

/**
 * The venue as a PROSE NOUN — the chip label's first segment, before the
 * ` · ` qualifier: `Hyperliquid`, `Morpho Blue`, `Aave v3`. A chip label
 * interpolated mid-sentence reads as a typographic accident ("No launch rail
 * on Hyperliquid · funding yet" was live copy); prose takes the noun, chips
 * keep the chip.
 */
export function venueNoun(venue: string): string {
  return venueLabel(venue).split("·")[0].trim();
}

const CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  999: "HyperEVM",
  8453: "Base",
  80094: "Berachain",
};

export function chainLabel(chainId: number): string {
  return CHAIN_LABELS[chainId] ?? `chain ${chainId}`;
}

/** Every chain name a venue label can carry as its qualifier. */
const CHAIN_NAMES: ReadonlySet<string> = new Set(Object.values(CHAIN_LABELS));

/**
 * The venue as it must be named IN A VERDICT — the prose noun, plus the chain
 * qualifier whenever that qualifier names a chain: `Morpho Blue · Ethereum`,
 * `Morpho Blue · Base`, `Aave v3 · Base`, `Dolomite · Berachain`.
 *
 * WHY THIS IS NOT `venueNoun` (planner ruling R5, 2026-08-24). `venueNoun`
 * drops everything after the ` · ` so a sentence reads cleanly, and it is
 * shared prose vocabulary with many readers. That is right for a summary
 * ("held against a HYPE short on Hyperliquid") and WRONG for a refusal: the
 * builder deploys Morpho Blue on three chains, the rail exists on Base and
 * HyperEVM and does not exist on Ethereum, so `no launch rail on Morpho Blue`
 * refuses a venue the product elsewhere launches. A verdict has to identify
 * the exact venue it refuses, which means it has to keep the chain.
 *
 * `hyperliquid-funding` keeps the bare noun on purpose: its qualifier is
 * `funding`, a lane kind and not a chain, and Hyperliquid names its own chain
 * already. So the funding rail's published sentence is unchanged, and the
 * mapping is still injective across every venue id (proved in
 * `rail-verdict-uniqueness.test.ts`).
 */
export function venueVerdictNoun(venue: string): string {
  const [head, ...rest] = venueLabel(venue)
    .split("·")
    .map((seg) => seg.trim());
  const qualifier = rest.join(" · ");
  return qualifier && CHAIN_NAMES.has(qualifier) ? `${head} · ${qualifier}` : head;
}

/** "1 loop" / "3 loops" — never "1 loop(s)". */
export function pluralLoops(n: number): string {
  return `${n} ${n === 1 ? "loop" : "loops"}`;
}

/** "1 market" / "3 markets" (floor-hint copy). */
export function pluralMarkets(n: number): string {
  return `${n} ${n === 1 ? "market" : "markets"}`;
}
