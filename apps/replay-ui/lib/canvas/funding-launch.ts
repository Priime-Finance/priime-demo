/**
 * THE FUNDING LAUNCH RAIL'S PUBLISH VIEW (2026-08-24) — what a rack-composed
 * funding lane says on the review sheet and writes into the published record.
 *
 * Pure, and in `lib/` for the same reason `pricing-params.ts` is: the record a
 * depositor reads has to be runnable by a test, and `RackCanvas.publishDraft`
 * is a client component a vitest cannot import. RackCanvas calls this once per
 * single-lane funding publish and spreads the result; the funding-launch-rail
 * test builds the same view from the fixture row and proves the record, the
 * register and the lane agree.
 *
 * EVERY VALUE TRACES TO A MEASURED FIELD OR A DIAL THE LANE HOLDS:
 *   · the legs come from `fundingLegChips` (the scanner's own spot-leg record
 *     and the perp coin), never re-spelled;
 *   · the funding rate + window come from `fundingRateLine` — one owner, so
 *     the review sheet, the catalog card and the plate subline publish ONE
 *     window per book (C-H6);
 *   · the escrow split comes from `hedgeEscrowCaption`, the plate's own
 *     caption, at the lane's own dials;
 *   · capacity is the caller's `laneCapacityUsd`/`vaultCapacity` figure — the
 *     lane frame, stated once (no frame chimera: the record stores lane-frame
 *     numbers only);
 *   · the venue verdict states the one fact the eyes-open demotion class
 *     requires the record to carry: measured economics, no launch rail.
 *
 * A field the row does not carry produces NO ROW — never a placeholder.
 */

import { fmtCapacityUsd } from "./capacity";
import { fundingLegChips, fundingRateLine } from "./funding-card";
import { lev, pct, usd } from "./format";
import { hedgeEscrowCaption, type HedgeEconomics } from "./hedge-econ";
import { chainLabel, venueLabel, venueNoun, venueVerdictNoun } from "./labels";
import type { ProjectedCandidate } from "./opportunities";
import type { LaneCompoundParams, LaneHedgeParams } from "./pricing-params";

export interface FundingPublishView {
  strategy: "funding";
  /** The template registry's own name for the product. */
  strategyLabel: "Funding-rate carry";
  defaultName: string;
  summary: string;
  params: { label: string; value: string }[];
  /** The eyes-open venue verdict, persisted via the `Launch rail` param row
   *  and shown on the review sheet. */
  railVerdict: string;
}

/** The verdict an eyes-open lane carries into review and into the record —
 *  ONE spelling for the funding rail and for every other measured, rail-less
 *  venue, so the review sheet and the vault page state one fact.
 *
 *  IT NAMES THE VENUE IT REFUSES, CHAIN INCLUDED (ruling R5, 2026-08-24).
 *  `venueNoun` would print `no launch rail on Morpho Blue` on a
 *  `morpho-blue-ethereum` lane, and Morpho Blue on Base IS launchable — one
 *  string refusing two different venues, one of them wrongly. `railVerdictFor`
 *  is the only reader of `venueVerdictNoun`; `venueNoun` is untouched, so the
 *  summary sentence below and every other prose reader keep their wording. */
export function railVerdictFor(venueId: string): string {
  return `no launch rail on ${venueVerdictNoun(venueId)}, modeled design only`;
}

export function fundingPublishView(args: {
  /** The lane's priced candidate (a funding row reprices to itself). */
  row: ProjectedCandidate | null;
  pair: string;
  /** The venue id (`hyperliquid-funding`), not a label. */
  venueId: string;
  hlCoin: string | null;
  hedge: LaneHedgeParams | null;
  /** The lane's hedge economics at its own composition, for the escrow. */
  hedgeEcon: HedgeEconomics | null;
  compound: LaneCompoundParams | null;
  capacityUsd: number | null;
  capacityBindingLabel: string | null;
  chainId: number | null;
  blockNumber: number | null;
}): FundingPublishView {
  const {
    row,
    pair,
    venueId,
    hlCoin,
    hedge,
    hedgeEcon,
    compound,
    capacityUsd,
    capacityBindingLabel,
    chainId,
    blockNumber,
  } = args;
  const noun = venueNoun(venueId);
  const railVerdict = railVerdictFor(venueId);

  // The two legs, from the one owner. `short X · Hyperliquid` drops its
  // leading word — the row's label already says which leg it is.
  const chips = fundingLegChips(row) ?? [];
  const legRows = chips.map((chip) =>
    chip.startsWith("short ")
      ? { label: "Short leg", value: chip.slice("short ".length) }
      : { label: "Spot leg", value: chip },
  );

  const rate = fundingRateLine(row);
  const escrow = hedgeEscrowCaption(hedgeEcon);

  const params: { label: string; value: string }[] = [
    { label: "Market", value: pair || "…" },
    { label: "Venue", value: venueLabel(venueId) },
    ...legRows,
    ...(rate ? [{ label: "Funding", value: rate }] : []),
    ...(hedge
      ? [
          { label: "Hedge leverage", value: lev(hedge.hedgeLeverage) },
          { label: "Margin reserve", value: `${pct(hedge.reserveFraction)} of short` },
          ...(escrow ? [{ label: "Escrow", value: escrow }] : []),
          { label: "Funding floor", value: `${pct(hedge.fundingFloorApr)} APR` },
          // "periods", never "epochs": the register and the risk rows
          // (store.ts riskGrade/automations) already say "N periods" for this
          // same dial on the same page — one dial, one noun (cleanup
          // 2026-08-24).
          { label: "Funding window", value: `${hedge.fundingWindowEpochs} periods` },
        ]
      : []),
    ...(compound
      ? [
          { label: "Compound cadence", value: compound.cadence },
          { label: "Harvest threshold", value: usd(compound.minActionUsd) },
        ]
      : []),
    ...(typeof capacityUsd === "number"
      ? [
          { label: "Capacity", value: fmtCapacityUsd(capacityUsd) },
          ...(capacityBindingLabel
            ? [{ label: "Capacity binding", value: capacityBindingLabel }]
            : []),
        ]
      : []),
    ...(chainId !== null && typeof blockNumber === "number" && blockNumber > 0
      ? [
          {
            label: "Read at",
            value: `${chainLabel(chainId)} block ${blockNumber.toLocaleString("en-US")}`,
          },
        ]
      : []),
    { label: "Launch rail", value: railVerdict },
  ];

  const short = hlCoin ? `a ${hlCoin} short` : "its perp short";
  return {
    strategy: "funding",
    strategyLabel: "Funding-rate carry",
    defaultName: `My ${hlCoin ?? pair} carry`,
    summary: `${pair || "A spot asset"} held against ${short} on ${noun}. The funding is the carry.`,
    params,
    railVerdict,
  };
}
