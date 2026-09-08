/**
 * The vault. There is exactly one, it always exists, and its NAV is attested
 * rather than modeled.
 *
 * This is the repo's own demo, "the vault that cannot lie": a USDe/USDC
 * recursive loop on Morpho Blue, Base, running the desk's own $500, whose
 * NAV, strike ledger and quorum are replayed from the captured NAV-strike
 * journals.
 *
 * `heroRecord()` builds the record in the live store's own shape through the
 * live owners and nothing else: the typed inputs come from
 * `lib/demo/market.ts`, the APY from `publishedNetApy` with the fee inside,
 * the bands from `deriveHfBands`, the automations from `deriveAutomations`,
 * the NAV from the journals via `lib/vaults/rows.ts`. It types no figure a
 * surface prints.
 *
 * Register discipline, enforced at every call site:
 * - the modeled APY is *modeled* and labeled so;
 * - the NAV, the share value, the strike ledger and the quorum are *attested*
 *   and are never labeled modeled;
 * - the attested numbers are replayed captures, not live polling, and the page
 *   says so.
 */

import snapMorphoBase from "@/lib/canvas/fixtures/morpho-blue-base.json";
import { APPLIED_LEVERAGE_LABEL } from "@/lib/canvas/labels";
import { publishedNetApy, repriceAtLeverage } from "@/lib/canvas/mock-quote";
import { clampLeverage, deriveHfBands } from "@/lib/canvas/param-schema";
import { pct } from "@/lib/canvas/format";
import { HERO_MARKET_ID, HERO_SLUG } from "@/lib/demo-scope";
import { demoMarketCandidate, HERO_SEED_LEVERAGE } from "@/lib/demo/market";
import { typedRateRows } from "@/lib/canvas/router-history";

import { heroNavUsd } from "./rows";
import {
  automationCount,
  deriveAutomations,
  fmtLev,
  fmtUsd,
  hfFromBps,
  loadUserVaults,
  moduleDepositorLine,
  type VaultRecord,
} from "./store";

export { HERO_MARKET_ID, HERO_SLUG };

/** The chain and block the typed inputs are pinned to: the catalog snapshot's own. */
const HERO_CHAIN_ID: number = snapMorphoBase.chainId;
const HERO_BLOCK_NUMBER: number = snapMorphoBase.blockNumber;
const HERO_COMPOUND_CADENCE_HOURS = 24;

/** The market row and the leverage the record is priced at, from their owners. */
export function heroSource(): {
  row: ReturnType<typeof demoMarketCandidate>;
  chainId: number;
  blockNumber: number;
  coinMaxLeverage: null;
  appliedLeverage: number;
} {
  const row = demoMarketCandidate();
  const lt = row.lt ?? 0;
  return {
    row,
    chainId: HERO_CHAIN_ID,
    blockNumber: HERO_BLOCK_NUMBER,
    coinMaxLeverage: null,
    appliedLeverage: clampLeverage(HERO_SEED_LEVERAGE, lt),
  };
}

const HERO_MODULES = ["Liquidity source", "Dynamic leverage", "Auto-compound"];

/**
 * The standing record, in the live store's shape. Built on every call so a
 * change to `HERO_SEED_LEVERAGE` or to the market's typed inputs moves the
 * APY, the bands, the instrument and the parameter table together.
 */
export function heroRecord(): VaultRecord {
  const { row, chainId, blockNumber, appliedLeverage } = heroSource();
  const lt = row.lt ?? 0;
  const priced = repriceAtLeverage(row, appliedLeverage);
  const modeledApy = publishedNetApy(priced, false) ?? 0;
  const bands = deriveHfBands("standard", appliedLeverage, lt);
  const e = row.economics;
  const capacityUsd = e?.capacityUsd ?? null;

  const params: { label: string; value: string }[] = [
    { label: APPLIED_LEVERAGE_LABEL, value: fmtLev(appliedLeverage) },
    { label: "Liquidation LTV", value: pct(lt) },
    {
      label: "Health bands",
      value: `${hfFromBps(bands.hfTargetBps)} target · ${hfFromBps(bands.hfDeleverageBps)} deleverage · ${hfFromBps(bands.hfFloorBps)} floor`,
    },
    /* MEASURED, NOT TYPED, AND THE ROWS SAY WHICH (design item 22). One
       owner beside the capture: `typedRateRows` in router-history.ts. */
    ...(e ? typedRateRows(e.collateralYieldApy, e.borrowApyMarginal) : []),
    { label: "Compound cadence", value: `${HERO_COMPOUND_CADENCE_HOURS}h` },
    ...(capacityUsd !== null ? [{ label: "Capacity", value: `${fmtUsd(capacityUsd)} · modeled` }] : []),
    { label: "Read at", value: `Base · block ${blockNumber.toLocaleString("en-US")}` },
  ];

  const base = {
    slug: HERO_SLUG,
    name: "Verifiable USDe Loop",
    strategy: "loop" as const,
    strategyLabel: "Leveraged loop",
    summary:
      "USDe looped against USDC on Morpho Blue, Base. Three operators re-execute the NAV independently and the quorum attests it on chain.",
    venue: "Morpho Blue · Base",
    market: "USDe/USDC",
    modules: HERO_MODULES,
    moduleLines: HERO_MODULES.map((name) => ({ name, line: moduleDepositorLine(name) ?? "" })),
    params,
    modeledApy,
    // The desk's own capital, ATTESTED: read off the settling capture, never
    // typed. The attestation for $500 is byte for byte the same proof as for
    // any other number.
    baseTvlUsd: heroNavUsd() ?? 0,
    baseDepositors: 1,
    curator: "Priime Labs",
    createdAt: "2026-08-18",
    register: "sample" as const,
    stage: "attested" as const,
    capacityUsd,
    capacityBindingLabel: capacityUsd !== null ? "modeled" : null,
    // ── the published model record, from the owners ──────────────────────
    liqLtv: lt,
    appliedLeverage,
    hfTargetBps: bands.hfTargetBps,
    hfDeleverageBps: bands.hfDeleverageBps,
    hfFloorBps: bands.hfFloorBps,
    hedgeLeverage: null,
    reserveFraction: null,
    hlCoin: null,
    deltaBandPct: null,
    marginTrimPct: null,
    marginRestorePct: null,
    fundingFloorApr: null,
    compoundCadenceHours: HERO_COMPOUND_CADENCE_HOURS,
    capacityBinding: e?.capacityBinding ?? null,
    chainId,
    blockNumber,
    collateralYieldApy: e?.collateralYieldApy ?? null,
  };
  return { ...base, automations: deriveAutomations(base) };
}

/**
 * The vault as a page should render it: the record the user published onto
 * `HERO_SLUG` when there is one, else the standing record. Nothing attested
 * passes through here; NAV, share value and quorum are read from the journals
 * at the call site.
 *
 * SSR-safe: with nothing in localStorage (server render, first paint, or a
 * browser that has never published) this is exactly `heroRecord()`.
 */
export function resolveVault(): VaultRecord {
  return loadUserVaults().find((v) => v.slug === HERO_SLUG) ?? heroRecord();
}

/**
 * Installed instrument count. The vault carries one more than its modeled
 * automations: the operator quorum that attests the NAV.
 */
export function automationCountFor(v: VaultRecord): number {
  return automationCount(v) + 1;
}
