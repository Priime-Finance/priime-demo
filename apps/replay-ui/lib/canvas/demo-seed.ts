/**
 * Demo seed (/build?demo=1) — the public preview embed on
 * build.priime.finance/preview shows the REAL builder, so a cold empty canvas
 * would read as broken behind its click-gate. This builds a ProposalPayload
 * from the LIVE opportunity catalog (never canned markets, never fabricated
 * numbers) and replays it through buildPortfolioFromProposal — the same pure
 * path a copilot APPLY takes — so every clamp and derivation is identical to
 * a hand-built canvas. Pure; the RackCanvas effect decides when to apply it
 * (only on a pristine canvas, never over a restored draft, never persisted).
 */

import { buildUnifiedList, type UnifiedRow } from "./unified-list";
import type { ProjectedVenue } from "./opportunities";
import type { ProposalPayload, ProposalLoopSnapshot } from "./copilot/tools";
import { leverageModuleInstalls } from "./leverage-module";
import { laneEconomicsFor, strategyForRow } from "./copilot/lane-frame";
import { proposalLoopComposition } from "./copilot/apply";

type SourcedVenue = ProjectedVenue & { source?: string };

function snapshotOf(r: UnifiedRow): ProposalLoopSnapshot {
  return {
    venue: r.venue,
    venueLabel: r.venueLabel,
    pair: r.pair,
    cls: r.cls,
    hlCoin: r.hlCoin,
    lt: r.lt,
    loopLeverage: r.economics?.loopLeverage ?? null,
    contentHash: r.contentHash,
    launchable: r.launchable,
    stale: r.stale,
    snapshot: r.snapshot,
  };
}

/**
 * Launchable first, then eligible, ranking already actionability-first.
 * Fresh venue docs outrank stale/snapshot ones: a stale menu row is the most
 * likely to have left the live scan, and the preview must not open on a
 * gone-state lane. Never two loops on the same pair (compile would refuse
 * the duplicate market).
 */
function pickBest(rows: UnifiedRow[], excludeIds: Set<string>, excludePairs: Set<string>): UnifiedRow | null {
  const usable = rows.filter(
    (r) => r.launchable && !excludeIds.has(r.id) && !excludePairs.has(r.pair),
  );
  const fresh = usable.filter((r) => !r.stale && !r.snapshot);
  return (
    fresh.find((r) => r.eligible) ??
    fresh[0] ??
    usable.find((r) => r.eligible) ??
    usable[0] ??
    null
  );
}

function toLoop(r: UnifiedRow): ProposalPayload["loops"][number] {
  const strategy = strategyForRow(r);
  const leverageModule = leverageModuleInstalls(r) && strategy === "loop";
  const hedge = strategy === "collar" ? false : r.cls === "A";
  const compound = true;
  return {
    candidateId: r.id,
    strategy,
    /* No leverage named: the lane lands on the market's own default from
       `landingLeverage`, which is the leverage the catalog card quotes. */
    leverage: null,
    /* THE MODULE RULING, the same owner the validator and the templates read:
       a demo lane on a subtracting market holds no leverage module. */
    leverageModule,
    hedge,
    compound,
    snapshot: snapshotOf(r),
    /* The same one owner the copilot's own blueprint reads. The demo card is a
       product surface, so its number is the PRODUCT number. */
    lane: laneEconomicsFor(
      r,
      { leverage: null, leverageModule, hedge, compound },
      proposalLoopComposition({ hedge, compound }),
    ),
  };
}

/**
 * The demo portfolio: best hedged + best unhedged loop on distinct markets
 * (the full product story: delta-neutral lane, unhedged lane, capital router
 * between them). Falls back to the top two distinct rows of whichever class
 * exists, then to a single loop, then to null (catalog empty or unlaunchable —
 * the canvas just cold-starts honestly).
 */
export function buildDemoProposal(venues: SourcedVenue[]): ProposalPayload | null {
  const { hedged, unhedged } = buildUnifiedList(venues);
  const picked: UnifiedRow[] = [];
  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();
  const take = (r: UnifiedRow | null) => {
    if (!r) return;
    picked.push(r);
    seenIds.add(r.id);
    seenPairs.add(r.pair);
  };

  take(pickBest(hedged, seenIds, seenPairs));
  take(pickBest(unhedged, seenIds, seenPairs));
  if (picked.length < 2) take(pickBest([...hedged, ...unhedged], seenIds, seenPairs));
  if (picked.length === 0) return null;

  return {
    proposalId: "demo-seed",
    title: "Demo portfolio",
    rationale: "Assembled from the live scan for the public preview.",
    loops: picked.map(toLoop),
    allocationsBps: picked.length === 2 ? [6000, 4000] : [10000],
    notes: [],
  };
}
