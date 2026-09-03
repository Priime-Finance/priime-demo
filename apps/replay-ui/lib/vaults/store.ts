/**
 * Vault store — single-vault shape.
 *
 * There is exactly ONE vault in this demo: the desk's own attested USDe loop
 * (`hero.ts`). It always exists, and its NAV, share price and quorum come off
 * the captured journals, never from here.
 *
 * What this file owns is the *published envelope*: the composition the user
 * last published from the canvas (name, summary, module chips, parameters,
 * modeled APY, automation instrument parameters). Publishing again replaces
 * it. That envelope is the only thing persisted, under one localStorage key,
 * and every number it carries is labeled "modeled" at the render site.
 *
 * Register discipline: nothing here ever produces a NAV, a share value or a
 * quorum. Those are attested and live in `attested.ts` / `rows.ts`.
 */

/** Only one composition survives the strip: the leveraged loop. */
export type StrategyKind = "loop";

export interface VaultRecord {
  slug: string;
  name: string;
  strategy: StrategyKind;
  /** "Leveraged loop". */
  strategyLabel: string;
  /** One-line description shown on the vault page. */
  summary: string;
  venue: string;
  market: string;
  /** Composed module names, in spine order. */
  modules: string[];
  /** One line per module for the vault page. */
  moduleLines: { name: string; line: string }[];
  /** The parameters that matter, label/value pairs. */
  params: { label: string; value: string }[];
  /** Modeled net APY as a fraction (0.124 = 12.4%). */
  modeledApy: number;
  /** The desk's own capital backing the vault, USD. */
  baseTvlUsd: number;
  baseDepositors: number;
  curator: string;
  /** ISO date of inception. */
  createdAt: string;
  /** Automation instrument parameters, fixed at publish time. */
  automations?: VaultAutomations;
}

// ── automations schema ─────────────────────────────────────────────────────

/**
 * Dynamic-leverage protection envelope. Thresholds are health factors
 * (liquidation at 1.00), derived proportionally from the market's assumed
 * liquidation LTV and the vault's target leverage, then frozen into the
 * envelope so the published parameters never drift.
 */
interface LeverageAutomation {
  targetLeverage: number;
  /** Assumed liquidation LTV for the loop market, as a fraction. */
  liqLtv: number;
  /** Health factor below which the cascade picks a fast unwind. */
  emergencyHf: number;
  /** Below this (and above emergency): sell a slice, repay borrow. */
  deleverHf: number;
  /** The health factor the target leverage models to. */
  targetHf: number;
  /** Above this: room to add a layer. */
  leverUpHf: number;
  /** Right edge of the plotted envelope axis. */
  axisMaxHf: number;
  cadence: string;
  cooldown: string;
}

/** Dynamic-hedge instrument: net-delta band plus margin maintenance. */
interface HedgeAutomation {
  venue: string;
  /** Net delta band, ± percent of position notional. */
  deltaBandPct: number;
  marginTrimBelowPct: number;
  marginRestorePct: number;
  /** Consecutive negative funding periods before de-allocating the venue. */
  fundingDeallocPeriods: number;
  cadence: string;
}

/** Auto-compound harvest meter parameters. */
interface CompoundAutomation {
  cadenceHours: number;
  thresholdUsd: number;
}

interface VaultAutomations {
  leverage: LeverageAutomation | null;
  hedge: HedgeAutomation | null;
  compound: CompoundAutomation | null;
}

const LS_PUBLISHED = "priime:vault:published:v1";
export const VAULTS_EVENT = "priime:vaults-changed";

// ── deterministic PRNG ─────────────────────────────────────────────────────

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── the published envelope ─────────────────────────────────────────────────

/**
 * What the canvas publishes onto the vault. Everything else about the vault
 * (slug, capital, inception, curator, and every attested number) belongs to
 * the hero record and is never overwritten from here.
 */
export interface PublishedEnvelope {
  name: string;
  strategy: StrategyKind;
  strategyLabel: string;
  summary: string;
  venue: string;
  market: string;
  modules: string[];
  moduleLines: { name: string; line: string }[];
  params: { label: string; value: string }[];
  modeledApy: number;
  automations: VaultAutomations;
  /** ISO timestamp of the publish that produced this envelope. */
  publishedAt: string;
}

/** The publish draft the canvas hands to PublishFlow. */
export interface PublishInput {
  name: string;
  strategy: StrategyKind;
  strategyLabel: string;
  summary: string;
  venue: string;
  market: string;
  modules: string[];
  moduleLines: { name: string; line: string }[];
  params: { label: string; value: string }[];
  modeledApy: number;
  /** Computed at publish time from the canvas graph (PublishFlow). */
  automations?: VaultAutomations;
}

function isEnvelope(v: unknown): v is PublishedEnvelope {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Partial<PublishedEnvelope>;
  return (
    typeof e.name === "string" &&
    Array.isArray(e.modules) &&
    Array.isArray(e.moduleLines) &&
    Array.isArray(e.params) &&
    typeof e.modeledApy === "number"
  );
}

/** The last published envelope, or null when the canvas has never published. */
export function loadPublished(): PublishedEnvelope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_PUBLISHED);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) return null;
    // Envelopes written before the automations field existed backfill on read.
    return { ...parsed, automations: parsed.automations ?? deriveAutomations(parsed) };
  } catch {
    return null;
  }
}

/** Persist a published envelope, replacing whatever was there. */
export function publishEnvelope(input: PublishInput): PublishedEnvelope {
  const envelope: PublishedEnvelope = {
    ...input,
    automations: input.automations ?? deriveAutomations(input),
    publishedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LS_PUBLISHED, JSON.stringify(envelope));
    window.dispatchEvent(new Event(VAULTS_EVENT));
  } catch {
    /* private mode: the celebration still lands, the envelope just does not persist */
  }
  return envelope;
}

// ── automations derivation (deterministic) ─────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Assumed liquidation LTV for a loop market: stable/stable pairs carry the
 * widest band, correlated staked pairs next, uncorrelated pairs the tightest.
 * A modeled assumption, frozen into the envelope.
 */
export function guessLiqLtv(market: string): number {
  const [a = "", b = ""] = market.split("/").map((s) => s.trim());
  const stable = (s: string) => /usd|dai/i.test(s);
  if (a && b && stable(a) && stable(b)) return 0.915;
  const coreB = b.replace(/^w/i, "").toUpperCase();
  if (a && coreB && a.toUpperCase().includes(coreB)) return 0.945;
  return 0.86;
}

/** Zone thresholds derived proportionally from the modeled target health factor. */
function deriveLeverageZones(targetLeverage: number, liqLtv: number): LeverageAutomation {
  const t = Math.max(1.15, targetLeverage);
  const targetHf = round2((liqLtv * t) / (t - 1));
  const span = targetHf - 1;
  return {
    targetLeverage,
    liqLtv,
    emergencyHf: round2(1 + span * 0.28),
    deleverHf: round2(1 + span * 0.55),
    targetHf,
    leverUpHf: round2(1 + span * 1.35),
    axisMaxHf: round2(1 + span * 1.75),
    cadence: "every block",
    cooldown: "1 min",
  };
}

/**
 * Default automations for a publish draft. Honest config: the leverage
 * envelope exists iff the Dynamic leverage module is installed, the hedge iff
 * a Dynamic hedge module is, compound iff Auto-compound is.
 */
export function deriveAutomations(
  v: Pick<VaultRecord, "venue" | "market" | "modules" | "params">,
): VaultAutomations {
  const has = (name: string) => v.modules.some((m) => m.toLowerCase() === name.toLowerCase());
  const param = (frag: string) =>
    v.params.find((p) => p.label.toLowerCase().includes(frag))?.value ?? "";

  let leverage: LeverageAutomation | null = null;
  if (has("Dynamic leverage")) {
    const target = Number.parseFloat(param("target leverage")) || 3;
    leverage = deriveLeverageZones(target, guessLiqLtv(v.market));
  }

  let hedge: HedgeAutomation | null = null;
  if (has("Dynamic hedge")) {
    const fromParam = param("hedge venue");
    const venue = fromParam ? venueParts(fromParam).venue : "Hyperliquid";
    hedge = {
      venue,
      deltaBandPct: 0.5,
      marginTrimBelowPct: 13,
      marginRestorePct: 28,
      fundingDeallocPeriods: 3,
      cadence: "every 5 min",
    };
  }

  let compound: CompoundAutomation | null = null;
  if (has("Auto-compound")) {
    const cadenceHours = Number.parseInt(param("compound cadence"), 10) || 24;
    compound = { cadenceHours, thresholdUsd: 25 };
  }

  return { leverage, hedge, compound };
}

/**
 * Objective risk grade: measurable rows derived from the vault's own published
 * parameters, plus one sentence naming the dominant risk. Never a subjective
 * adjective; every figure is recomputable from the envelope.
 */
export function riskGrade(v: VaultRecord): {
  rows: { label: string; value: string }[];
  sentence: string;
} {
  const a = v.automations;
  const rows: { label: string; value: string }[] = [];
  if (a?.leverage) {
    // The published target HF, not a recompute: a reader working from the
    // on-page figure must land on the same distance.
    const hf = a.leverage.targetHf;
    const dd = Math.max(0, (1 - 1 / hf) * 100);
    rows.push({ label: "Distance to liquidation", value: `${dd.toFixed(0)}% adverse pair move` });
    rows.push({ label: "Auto-deleverage begins", value: `${a.leverage.deleverHf.toFixed(2)}x health` });
    const sentence =
      `Main risk: ${v.market} pair drawdown. Liquidation sits ${dd.toFixed(0)}% of adverse pair move away; ` +
      `the cascade starts trimming at ${a.leverage.deleverHf.toFixed(2)}x health, ` +
      `emergency unwind at ${a.leverage.emergencyHf.toFixed(2)}x.`;
    return { rows, sentence };
  }
  if (a?.hedge) {
    rows.push({ label: "Delta band", value: `±${a.hedge.deltaBandPct.toFixed(1)}%` });
    rows.push({
      label: "Margin restore",
      value: `${String(a.hedge.marginTrimBelowPct)}% → ${String(a.hedge.marginRestorePct)}%`,
    });
    const sentence =
      `Main risk: hedge slippage during fast price moves. Net delta rebalances inside ±${a.hedge.deltaBandPct.toFixed(1)}%; ` +
      `a gap wider than the band is unhedged exposure until the next rebalance.`;
    return { rows, sentence };
  }
  return { rows, sentence: "Main risk: market drawdown on the underlying position. No leverage installed." };
}

/** Number of installed automation instruments. */
export function automationCount(v: VaultRecord): number {
  const a = v.automations;
  if (!a) return 0;
  return [a.leverage, a.hedge, a.compound].filter(Boolean).length;
}

/** Split "Morpho Blue · Base" into venue + chain; single-name venues map honestly. */
export function venueParts(venue: string): { venue: string; chain: string } {
  const ix = venue.indexOf("·");
  if (ix >= 0) return { venue: venue.slice(0, ix).trim(), chain: venue.slice(ix + 1).trim() };
  if (/hyperliquid/i.test(venue))
    return { venue, chain: venue.includes("+") ? "Cross-venue" : "Hyperliquid L1" };
  return { venue, chain: venue.includes("+") ? "Cross-venue" : "Multi-venue" };
}

// ── live derivation helpers (deterministic, slug + clock seeded) ───────────

const DAY_MS = 86400e3;
const HOUR_MS = 3600e3;

/** Most recent compound tick: slug-anchored inside the cadence window. */
function lastCompoundMs(v: VaultRecord, nowMs = Date.now()): number {
  const cadMs = (v.automations?.compound?.cadenceHours ?? 24) * HOUR_MS;
  const offset = hashString(v.slug + ":cmp") % cadMs;
  const last = Math.floor((nowMs - offset) / cadMs) * cadMs + offset;
  return Math.max(Date.parse(v.createdAt), last);
}

/** Dollars accrued since the last compound: capital × APY × elapsed time. */
export function accruedSinceCompound(v: VaultRecord, nowMs = Date.now(), tvlUsd?: number): number {
  const tvl = tvlUsd ?? v.baseTvlUsd;
  const elapsed = Math.max(0, nowMs - lastCompoundMs(v, nowMs));
  return (tvl * v.modeledApy * elapsed) / (365 * DAY_MS);
}

interface ActionTimes {
  leverage: number;
  hedge: number;
  compound: number;
  nextCompoundCheck: number;
}

/**
 * Deterministic recent action timestamps. Each clock derives from the same
 * anchors the instrument publishes: hedge from its 5-min cadence grid (always
 * within one interval of "now"), leverage from its rebalance period.
 */
export function lastActionTimes(v: VaultRecord, nowMs = Date.now()): ActionTimes {
  const created = Date.parse(v.createdAt);
  const hedGrid = 5 * 60e3;
  const hed = Math.floor(nowMs / hedGrid) * hedGrid - (hashString(v.slug + ":hed") % hedGrid);
  const period = (52 + (hashString(v.slug + ":lp") % 26)) * HOUR_MS;
  const offset = hashString(v.slug + ":lo") % period;
  const lev = Math.floor((nowMs - offset) / period) * period + offset;
  const cmp = lastCompoundMs(v, nowMs);
  const cadMs = (v.automations?.compound?.cadenceHours ?? 24) * HOUR_MS;
  return {
    leverage: Math.max(created, lev),
    hedge: Math.max(created, hed),
    compound: cmp,
    nextCompoundCheck: cmp + cadMs,
  };
}

// ── formatting ─────────────────────────────────────────────────────────────

export function fmtUsd(v: number): string {
  let s: string;
  if (v >= 1e9) s = `$${(v / 1e9).toFixed(2)}B`;
  else if (v >= 1e6) s = `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
  else if (v >= 1e3) s = `$${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}K`;
  else s = `$${v.toFixed(0)}`;
  // "$25.0K" reads "$25K"; "$4.2M" stays "$4.2M".
  return s.replace(/\.0([KMB])$/, "$1");
}

export function fmtUsdFull(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function fmtPct(v: number, dp = 1): string {
  return `${(v * 100).toFixed(dp)}%`;
}
