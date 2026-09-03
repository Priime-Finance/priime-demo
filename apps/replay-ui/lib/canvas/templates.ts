/**
 * Template registry.
 *
 * `/build?template=<id>` opens the canvas preloaded with a composition. After
 * the single-flow strip there is exactly one: the leveraged loop, seeded from
 * the demo market in the catalog. The funding-carry, delta-neutral-LP and
 * treasury-collar templates are gone with the strategies they mocked.
 *
 * Honesty rules: every number the seed lands on comes from the catalog scan
 * (modeled, deterministic, no Math.random anywhere).
 */

import type { PortfolioGraph } from "./types";
import type { ProjectedVenue } from "./opportunities";
import { renameLoop } from "./graph-ops";
import { buildUnifiedList, type UnifiedRow } from "./unified-list";
import { buildPortfolioFromProposal } from "./copilot/apply";
import type { ProposalLoopSnapshot } from "./copilot/tools";
import type { RiskStop } from "./risk-dial";
import type { StrategyKind } from "@/lib/vaults/store";

type TemplateId = "leveraged-loop";

/** Seed the canvas from the live catalog (deterministic pick). */
interface CatalogSeed {
  kind: "catalog-pick";
  /** Preferred market when present: [pair, venue]. */
  prefer: { pair: string; venue: string };
}

type TemplateSeed = CatalogSeed;

interface CanvasTemplate {
  id: TemplateId;
  /** Display name ("Leveraged loop"). */
  name: string;
  /** Canvas header line ("Leveraged loop · template"). */
  header: string;
  /** Publish strategy kind for a single-lane publish of this template. */
  strategy: StrategyKind;
  seed: TemplateSeed;
}

// ── The registry ───────────────────────────────────────────────────────────

const CANVAS_TEMPLATES: Record<TemplateId, CanvasTemplate> = {
  "leveraged-loop": {
    id: "leveraged-loop",
    name: "Leveraged loop",
    header: "Leveraged loop · template",
    strategy: "loop",
    // The demo market, which is also the only market in the catalog.
    seed: { kind: "catalog-pick", prefer: { pair: "USDe/USDC", venue: "morpho-blue-base" } },
  },
};

/** Unknown ids fall back to null → the normal empty canvas, never an error. */
export function templateById(id: string | null | undefined): CanvasTemplate | null {
  if (!id) return null;
  return (CANVAS_TEMPLATES as Record<string, CanvasTemplate>)[id] ?? null;
}

// ── Canvas seeding ─────────────────────────────────────────────────────────

interface BuiltTemplate {
  portfolio: PortfolioGraph;
  riskStops: Record<string, RiskStop | "custom">;
  /** Every node id added — for the snap animation. */
  nodeIds: string[];
}

function snapshotOf(r: UnifiedRow): ProposalLoopSnapshot {
  return {
    venue: r.venue,
    venueLabel: r.venueLabel,
    pair: r.pair,
    cls: r.cls,
    hlCoin: r.hlCoin,
    lt: r.lt,
    headlineAprPct: typeof r.headlineApr === "number" ? r.headlineApr * 100 : null,
    contentHash: r.contentHash,
    launchable: r.launchable,
    stale: r.stale,
    snapshot: r.snapshot,
  };
}

/** The APY the Install-defaults composition (no hedge) actually models:
 *  hedged rows price funding INTO the headline, and composedNetApy strips
 *  it back out when the hedge is absent — so the pick must rank by the
 *  hedgeless number, or a funding-heavy market seeds a negative lane. */
function hedgelessApy(r: UnifiedRow): number {
  const base = typeof r.headlineApr === "number" ? r.headlineApr : -Infinity;
  return base - (r.economics?.fundingP25Apr ?? 0);
}

/** Deterministic best looping candidate: the launchable row with the best
 *  composed (hedgeless) APY; freshness breaks ties. */
function pickBestLoopRow(rows: UnifiedRow[]): UnifiedRow | null {
  const usable = rows.filter((r) => r.launchable);
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => {
    const d = hedgelessApy(b) - hedgelessApy(a);
    if (d !== 0) return d;
    const freshA = !a.stale && !a.snapshot ? 0 : 1;
    const freshB = !b.stale && !b.snapshot ? 0 : 1;
    return freshA - freshB;
  })[0]!;
}

type SourcedVenue = ProjectedVenue & { source?: "kv" | "process-cache" | "snapshot" };

/**
 * Build the seeded portfolio for a template. Pure: the RackCanvas effect
 * decides when to apply it. Returns null when the catalog offers no usable row
 * (the canvas cold-starts honestly).
 */
export function buildTemplatePortfolio(
  t: CanvasTemplate,
  venues: SourcedVenue[],
): BuiltTemplate | null {
  const { hedged, unhedged } = buildUnifiedList(venues);
  // Both sections: the demo market carries no perp leg, so it lands unhedged.
  const rows = [...hedged, ...unhedged];
  const prefer = t.seed.prefer;
  // The preferred market wins whenever it is present and launchable (the
  // mock-quote fallback prices it even off a stale doc, so staleness does
  // not disqualify it); otherwise the composed-APY ranking decides.
  const preferred = rows.find(
    (r) => r.launchable && r.pair === prefer.pair && r.venue === prefer.venue,
  );
  const pick = preferred ?? pickBestLoopRow(rows);
  if (!pick) return null;
  // Install-defaults composition: market + dynamic leverage + auto-compound;
  // the hedge never self-installs.
  const built = buildPortfolioFromProposal({
    proposalId: `template:${t.id}`,
    title: t.name,
    rationale: "Seeded from the template deep link.",
    loops: [
      { candidateId: pick.id, riskStop: "balanced", hedge: false, compound: true, snapshot: snapshotOf(pick) },
    ],
    allocationsBps: [10000],
    notes: [],
  });
  const loopId = built.portfolio.loops[0]?.id;
  const portfolio = loopId ? renameLoop(built.portfolio, loopId, t.name) : built.portfolio;
  return { portfolio, riskStops: built.riskStops, nodeIds: built.nodeIds };
}
