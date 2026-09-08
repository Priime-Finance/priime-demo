/**
 * THE LANE'S PARAMETER CONTEXT — the one narrowing argument.
 *
 * ══ WHY THIS MOVED OUT OF `RackCanvas` (D3, 2026-08-24) ════════════════════
 *
 * `descriptorsFor(key, ctx)` is the single owner of a market's dial bounds and
 * `graph-ops.updateParam` already clamped against it, with a `ctx` built by a
 * private function inside `components/canvas/RackCanvas.tsx`. The CONTROLS did
 * not: `PlateControls` rendered `getDef(key).params` — the STRUCTURAL envelope,
 * the widest bound any market could ever justify — so the slider published
 * `max="3.75"` (`STRUCTURAL_MAX_LEVERAGE`, the house trim cap at the catalog's
 * loosest lt on the loosest preset) while the clamp it fed enforced 3.50 on
 * `morpho-blue-base cbETH/WETH`. Measured on production: ArrowRight at 3.50 was
 * a no-op, a click on the far right of the track landed on 3.50, and a native
 * setter write of 3.75 snapped back. A dead zone at the right end of the track,
 * and a maximum announced to assistive technology that the control refuses to
 * honour.
 *
 * The attribute and the clamp were two readings of one bound, and the fix is
 * not a second clamp in the component: it is for both of them to read the SAME
 * `descriptorsFor(key, ctx)` with the SAME `ctx`. A pure derivation over the
 * graph cannot live in a client component if two surfaces have to share it —
 * the same reasoning, and the same move, as `pricingParamsFor`.
 *
 * `paramContextFor` resolves the lane's candidate exactly the way
 * `laneComputed` does, so the bounds a dial is drawn from, the bounds it is
 * clamped against, and the row it is priced from can never be three different
 * markets.
 *
 * ⚠ `scanLeverage` IS THE SCAN'S OWN CEILING, NEVER A REPRICED ROW. The
 * catalog row's `economics.loopLeverage` is the highest leverage the scan
 * priced; `reprice.candidate` has already been through `repriceAtLeverage`,
 * which caps at that ceiling and reports the APPLIED leverage in the same
 * field. Building this context from the repriced candidate would make the
 * lane's current position its own ceiling and ratchet the dial's max down to
 * wherever the user last left it — the FRAME M hazard, one level up.
 *
 * `coinMaxLeverage` rides in off the row itself (D3, 2026-09-01): the scan's
 * `native_perp` gate states the venue's own limit for the book, the projection
 * carries it as `row.coinMaxLeverage`, and forwarding it is what lets
 * `hedgeLeverageCeiling` narrow the hedge dial to the placed book (HYPE at
 * venue maxLev 10 caps at 4.0x, BERA at maxLev 5 caps at 3.5x — both were
 * offered the ETH-tier structural 5 before this). `fundingP25Aprs` is the same
 * move for the funding-floor dial (D4): the row's measured funding
 * percentiles, headline plus archived windows, SIGNED — recette v2 (DEF-01)
 * found `fundingFloorAprBounds` reducing `|p25|` over them, which read a
 * book's POSITIVE carry as if it were a measured drawdown. The sign is the
 * evidence, so it is forwarded intact and the consumer filters.
 *
 * `minViableOrderUsd` stays
 * deliberately absent: no payload field states it, so the harvest floor keeps
 * the house `HL_MIN_ORDER_USD` rather than a number this surface would have
 * to invent.
 *
 * `issuerRedemption` is the same move again for the treasury family (WP-3,
 * BASIS CARRY + TREASURY FLOOR): the routes a picked issuer publishes and the
 * settlement window it publishes with them, read off the row and forwarded so
 * `redemption-route`'s option set narrows to the routes that issuer actually
 * runs and its settlement record pins to that issuer's own window. It is the
 * clearest case in the file for why the bound has to travel with the market:
 * a route the issuer does not offer is not a slower choice, it is a choice
 * that cannot be executed at all.
 */

import { catalogRow } from "./mock-quote";
import type { IssuerRedemption, ParamContext } from "./modules";
import type { ProjectedCandidate } from "./opportunities";
import { pricingParamsFor } from "./pricing-params";
import {
  fastestExitRoute,
  issuerRedemptionTerms,
  settlementDaysOf,
  templateCatalogHit,
} from "./templates";
import type { LoopGraph, LoopId, PortfolioGraph } from "./types";
import type { OpportunitiesPayload } from "@/components/canvas/types";

/** Every funding percentile the row measured: the headline p25 the row is
 *  priced on plus each archived window's own p25. Null where the row carries
 *  none, so the funding-floor dial keeps its structural envelope. */
function measuredFundingP25s(row: ProjectedCandidate | null): readonly number[] | null {
  const e = row?.economics;
  if (!e) return null;
  const vals = [e.fundingP25Apr, ...(e.fundingWindows ?? []).map((w) => w.p25Apr)].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  return vals.length > 0 ? vals : null;
}

/**
 * THE REDEMPTION FACTS THE PICKED ROW PUBLISHES about its issuer, reduced to
 * what a descriptor needs, or null on every row that is not an issuer position
 * (WP-3).
 *
 * ONE OWNER, AND IT IS NOT THIS FILE. `templates.ts` fetched the six issuers'
 * own documents (founder ruling H-7) and owns all three reductions over them:
 * `issuerRedemptionTerms` resolves the row, `fastestExitRoute` decides which
 * door a lane leaves by unless the builder picks another, and
 * `settlementDaysOf` states the window the hidden record pins. This function
 * calls them and forwards the answers; it computes no minimum of its own, and
 * a second `Math.min` over `routes` here would be a second opinion about which
 * door is quickest.
 *
 * WHY THE REDUCTION HAPPENS HERE RATHER THAN IN `modules.ts`: `templates.ts`
 * imports `defaultValueFor` from `modules.ts`, so that dependency runs one way
 * and the descriptor file can never read a row. This file already imports
 * both, which is why it is where the market meets the envelope.
 *
 * NOTHING IS INVENTED. A row that carries no redemption terms gets `null`, not
 * a house route set and not a house window: a lane whose market publishes no
 * redemption machinery is a lane with no route to choose, and the control is
 * correctly absent rather than wide.
 */
function issuerRedemptionOf(candidateId: string): IssuerRedemption | null {
  const terms = issuerRedemptionTerms(candidateId);
  if (!terms || terms.routes.length === 0) return null;
  return {
    routes: terms.routes.map((r) => ({ id: r.id, label: r.label })),
    settlementDays: settlementDaysOf(terms),
    defaultRouteId: fastestExitRoute(terms).id,
  };
}

/** The picked market's own parameter bounds for one lane (R6). */
export function paramContextForLoop(
  loop: LoopGraph | null | undefined,
  opp: OpportunitiesPayload | null,
): ParamContext {
  if (!loop) return {};
  const params = pricingParamsFor(loop);
  const row =
    (catalogRow(opp, params.candidateId) ?? templateCatalogHit(params.candidateId))?.row ?? null;
  return {
    lt: row?.lt ?? null,
    scanLeverage: row?.economics?.loopLeverage ?? null,
    preset: params.riskPreset,
    netCarryApr: row?.economics?.netCarryOnEquityApy ?? null,
    coinMaxLeverage: row?.coinMaxLeverage ?? null,
    fundingP25Aprs: measuredFundingP25s(row),
    /* ALWAYS SET, `null` INCLUDED (X1). A seated lane STATES that its market
       publishes no redemption machinery; only a caller with no lane at all
       omits the field, and only then does `exitPath` draw its structural
       envelope. Collapsing the two would put a two-route control on every
       market in the catalog. */
    issuerRedemption: issuerRedemptionOf(params.candidateId),
  };
}

/** The same, addressed by lane id over the whole portfolio. */
export function paramContextFor(
  p: PortfolioGraph,
  opp: OpportunitiesPayload | null,
  loopId: LoopId,
): ParamContext {
  return paramContextForLoop(
    p.loops.find((l) => l.id === loopId),
    opp,
  );
}
