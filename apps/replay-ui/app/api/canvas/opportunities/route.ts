import { NextResponse } from "next/server";
import {
  DEMO_MARKET_ID,
  demoMarketCandidate,
  projectVenueDocV2,
} from "@/lib/canvas/opportunities";
import snapMorphoBase from "@/lib/canvas/fixtures/morpho-blue-base.json";

export const dynamic = "force-dynamic";

/**
 * The market catalog the canvas discovers.
 *
 * DEMO SCOPE FILTER (single-flow strip): the demo composes ONE vault on ONE
 * market — the USDe/USDC loop on Morpho Blue, Base (`DEMO_MARKET_ID`), which
 * is the market `lib/vaults/hero.ts` attests. The Aave v3, Morpho HyperEVM and
 * Dolomite venue snapshots are gone; the Morpho Base snapshot is still the
 * fixture of record, and it is filtered here rather than hand-edited.
 *
 * That snapshot lists USDe/USDC under `ineligible` (the scanner's v1 gate
 * excludes it: Morpho pays no supply APY on collateral, so the carry is
 * incentive-paid, exactly as the demo spec says out loud). The scan therefore
 * carries no economics row for it, so `demoMarketCandidate()` supplies a
 * modeled one pinned to the vault's own published parameters. Every number it
 * produces is labeled "modeled" wherever the canvas renders it.
 */
export function GET() {
  const now = Date.now();
  const doc = projectVenueDocV2(snapMorphoBase as never, now);
  const demoMarket = demoMarketCandidate();
  const venues = [
    {
      ...doc,
      // One market, one class: the loop needs no perp hedge, so the demo row
      // is N1 and the hedged section is empty rather than misleading.
      hedged: [],
      unhedged: [demoMarket],
    },
  ];
  return NextResponse.json({ venues, degraded: [], demoMarketId: DEMO_MARKET_ID });
}
