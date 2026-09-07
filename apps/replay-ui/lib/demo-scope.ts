/**
 * THE ONE OWNER of what is live, what is coming soon, and the label.
 *
 * Every surface in this build reads its register from here: the store, the
 * seeds, the dock, the directory, the copilot route and the review gate. It is
 * a LEAF module (no imports at all, so the strict gate over the demo files
 * never reaches the kit through it) and it holds no derivation of its own: a
 * module, market or strategy flips from coming soon to live by editing one
 * array below and nothing else. The ids are the kit's own vocabulary
 * (`CanvasVenueId`, `ModuleKey`, `StrategyKind`), spelled as strings here;
 * `tests/demo-scope.test.ts` pins them against the kit.
 *
 * LIVE is exactly one workflow: the USDe/USDC recursive loop on Morpho Blue,
 * Base, composed from Liquidity source + Dynamic leverage + Auto-compound and
 * published onto the ONE record at `HERO_SLUG`. Everything else the kit ships
 * is COMING SOON, and it says so in this register.
 *
 * docs/plans/LATEST_UI_PORT_SPEC.md A.2, B.1.
 */

/** Slug of the attested vault, the one record every publish writes onto. */
export const HERO_SLUG = "verifiable-usde-loop";

/**
 * The Morpho Blue market the loop runs on, as it appears in the catalog
 * snapshot (`lib/canvas/fixtures/morpho-blue-base.json`).
 */
export const HERO_MARKET_ID = "morpho-blue-base:8453:USDe-USDC:0x54cf9be5";

/**
 * The register, exact. `label` is the tag (sentence case, two words, no dot);
 * `prose` is the form a sentence uses. Never `Soon`, never `Not yet`, never
 * `(coming soon)`, never `Incubating · modeled` (a different truth).
 */
export const COMING_SOON = { label: "Coming soon", prose: "coming soon" } as const;

export interface DemoScope {
  liveMarketId: string;
  /** `CanvasVenueId` values. */
  liveVenues: readonly string[];
  /** `ModuleKey` values. */
  liveModules: readonly string[];
  /** `StrategyKind` values. */
  liveStrategies: readonly string[];
  liveSlug: string;
}

export const DEMO_SCOPE: DemoScope = {
  liveMarketId: HERO_MARKET_ID,
  liveVenues: ["morpho-blue-base"],
  liveModules: ["liquidity-source", "safety-buffer", "auto-compound"],
  liveStrategies: ["loop"],
  liveSlug: HERO_SLUG,
};

export function isLiveMarket(id: string): boolean {
  return id === DEMO_SCOPE.liveMarketId;
}

export function isLiveVenue(id: string): boolean {
  return DEMO_SCOPE.liveVenues.includes(id);
}

export function isLiveModule(key: string): boolean {
  return DEMO_SCOPE.liveModules.includes(key);
}

export function isLiveStrategy(kind: string): boolean {
  return DEMO_SCOPE.liveStrategies.includes(kind);
}

/** The review gate's reason when a lane holds a module that is not live. */
export const REVIEW_REASON_COMING_SOON = "a coming-soon module is on this lane";

/**
 * The copilot route's rejection when the model names a market outside the
 * one-row list. The live unknown-id string reads as a scan problem; this one
 * reads as the register.
 */
export const COPILOT_REJECT_COMING_SOON =
  "that market is coming soon; only the USDe/USDC loop is live in this build";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * THE SHELF COUNT, scoped. `1 source, 2 modules, 1 strategy · 10 coming soon`
 * over the shelf the kit ships, derived from the kit's own totals (the number
 * of module keys in `DISPLAY_ORDER` and of strategy kinds in `STRATEGIES`,
 * passed in by the non-leaf owner `lib/canvas/shelf-count.ts`) and from the
 * live lists above. Nothing here is typed as a figure.
 *
 * `liquidity-source` is the shelf's one source row; every other key is a
 * module. The live shelf's own count (`shelfCountLabel`, GhostSlot.tsx) reads
 * the module definitions for that split; this leaf cannot, so it reads the
 * key.
 */
export function shelfCountScoped(totalModuleKeys: number, totalStrategies: number): string {
  const liveSources = DEMO_SCOPE.liveModules.filter((k) => k === "liquidity-source").length;
  const liveModules = DEMO_SCOPE.liveModules.length - liveSources;
  const liveStrategies = DEMO_SCOPE.liveStrategies.length;
  const comingSoon =
    Math.max(0, totalModuleKeys - DEMO_SCOPE.liveModules.length) +
    Math.max(0, totalStrategies - liveStrategies);
  return `${plural(liveSources, "source", "sources")}, ${plural(liveModules, "module", "modules")}, ${plural(liveStrategies, "strategy", "strategies")} · ${comingSoon} ${COMING_SOON.prose}`;
}
