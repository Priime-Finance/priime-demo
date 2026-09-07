import { NextResponse } from "next/server";
import type { RepriceData } from "@/components/canvas/types";
import { liveVenues } from "@/lib/canvas/catalog-server";
import { catalogRow } from "@/lib/canvas/mock-quote";
import {
  clampLeverage,
  deriveHfBands,
  MIN_DEPOSIT_USD,
  validateBands,
  type RiskPreset,
} from "@/lib/canvas/param-schema";

export const dynamic = "force-dynamic";

/**
 * THE QUOTE, ANSWERED (docs/plans/LATEST_UI_PORT_SPEC.md 2.17, the recorded
 * fallback). This route answered 501 and the canvas fell to its offline mock
 * quote, which priced the lane correctly; but the live canvas keeps the failed
 * re-quote as a fact about the lane, and its honesty backstop
 * (`quote-fell-back`, lib/canvas/tips.ts) then mounts a card with a `Re-quote`
 * key that can only fail again. A control that cannot succeed is the failure
 * register, so the route now answers.
 *
 * THE CONTRACT IS THE LIVE RAIL'S, not the mock quote's. The live route
 * (build.priime.finance `app/api/canvas/reprice`) returns the market's row AT
 * ITS OWN CEILING, in the scan frame, and the canvas prices the lane from it
 * client-side: `laneQuote` runs `repriceAtLeverage(candidate, appliedLeverage,
 * composition)` on whatever this route returns (RackCanvas.tsx, "ONE FRAME").
 * Returning `mockQuote(...)` here, whose `candidate` is already repriced at
 * the lane's leverage, made the canvas reprice a repriced row: the header and
 * the terminus printed the unlevered number while the lane read 4.3%, and the
 * dock called the market's own seat 2.50x. So `candidate` is the catalog row
 * itself, `appliedLeverage` is the request clamped to the house cap and capped
 * at the market's seat, exactly as the live rail seats it, and the bands are
 * derived at that leverage. The number the canvas prints is then the same
 * number the offline path prints, which `tests/reprice-route.test.ts` pins.
 *
 * Only the live list is served: a market outside it is `gone` to this rail
 * (404), which is what the client's failure classifier already means by a 404.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "malformed request body" }, { status: 400 });
  }
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
  if (!candidateId) {
    return NextResponse.json({ ok: false, error: "candidateId required" }, { status: 400 });
  }
  const hit = catalogRow(liveVenues(Date.now()), candidateId);
  if (!hit) {
    return NextResponse.json({ ok: false, error: "market not in the live list" }, { status: 404 });
  }
  const row = hit.row;
  const preset: RiskPreset = body.riskPreset === "conservative" ? "conservative" : "standard";
  const requestedL =
    typeof body.targetLeverage === "number" && Number.isFinite(body.targetLeverage)
      ? body.targetLeverage
      : undefined;
  /* The same lt fallback `mockQuote` uses, so the two paths clamp alike. */
  const lt = typeof row.lt === "number" && row.lt > 0 ? row.lt : 0.86;
  const clampedL = requestedL !== undefined ? clampLeverage(requestedL, lt, preset) : undefined;
  const houseL = row.economics?.loopLeverage ?? null;
  /* The position actually opened: the clamped request, capped at the market's
     own ceiling, the live rail's own line. */
  const L =
    clampedL !== undefined && houseL !== null ? Math.min(clampedL, houseL) : (houseL ?? clampedL ?? 3);
  const hf = deriveHfBands(preset, L, lt);
  /* An N1 market has no perp leg, so there is no margin band to validate. */
  const violations = validateBands(hf, null, L, lt, {
    storedLeverage: requestedL ?? null,
    coinMaxLeverage: null,
    preset,
  });
  const payload: RepriceData = {
    ok: true,
    repricedAtMs: Date.now(),
    blockNumber: hit.blockNumber,
    candidate: row,
    requestedLeverage: requestedL ?? null,
    appliedLeverage: row.economics ? L : null,
    bands: { hf, margin: null },
    minDepositUsd: MIN_DEPOSIT_USD,
    violations,
  };
  return NextResponse.json(payload);
}
