/**
 * The vault. There is exactly one, it always exists, and its NAV is attested
 * rather than modeled.
 *
 * This is the repo's own demo, "the vault that cannot lie": a USDe/USDC
 * recursive loop on Morpho Blue, Base, running the desk's own ~$500, whose
 * NAV, strike ledger and quorum are replayed from the captured NAV-strike
 * journals.
 *
 * The record below is the vault's standing identity. What the canvas
 * publishes is an *envelope* over it (`store.ts`): name, summary, module
 * chips, parameters, modeled APY and the automation instrument parameters.
 * `resolveVault()` is the merge, and it is the only way any surface should
 * obtain the vault.
 *
 * Register discipline, enforced at every call site:
 * - the projected APY is *modeled* and labeled so;
 * - the NAV, the share price, the strike ledger and the quorum are *attested*
 *   and are never labeled modeled;
 * - the attested numbers are replayed captures, not live polling, and the page
 *   says so.
 */

import { automationCount, loadPublished, type VaultRecord } from "./store";

/** Slug of the attested vault. The route itself is the static `/vault`. */
export const HERO_SLUG = "verifiable-usde-loop";

/**
 * The Morpho Blue market the loop runs on, as it appears in the catalog
 * snapshot (`lib/canvas/fixtures/morpho-blue-base.json`).
 */
export const HERO_MARKET_ID = "morpho-blue-base:8453:USDe-USDC:0x54cf9be5";

export const HERO_VAULT: VaultRecord = {
  slug: HERO_SLUG,
  name: "Verifiable USDe Loop",
  strategy: "loop",
  strategyLabel: "Leveraged loop",
  summary:
    "USDe looped against USDC on Morpho Blue, Base. Three operators re-execute the NAV independently and the quorum attests it on chain.",
  venue: "Morpho Blue · Base",
  market: "USDe/USDC",
  modules: ["Liquidity source", "Dynamic leverage", "Auto-compound", "NAV attestation"],
  moduleLines: [
    { name: "Liquidity source", line: "Pins the USDe/USDC loop market on Morpho Blue, Base." },
    { name: "Dynamic leverage", line: "Holds 5.0x against the market's 91.5% liquidation LTV." },
    { name: "Auto-compound", line: "Sweeps accrued carry back into the loop every 24h." },
    {
      name: "NAV attestation",
      line: "Three operators re-execute the NAV each strike; 2 of 3 must agree before it settles.",
    },
  ],
  params: [
    { label: "Target leverage", value: "5.0x" },
    { label: "Liquidation LTV", value: "91.5%" },
    { label: "Health factor floor", value: "1.08x" },
    { label: "Min net spread", value: "0.25%" },
    { label: "Compound cadence", value: "24h" },
  ],
  /** Modeled, like every projection in this UI: ~8% net at 5x on the loop's carry. */
  modeledApy: 0.08,
  /**
   * The desk's own capital, per the demo spec. The attestation for $500 is
   * byte-for-byte the same proof as for $50M, and the directory says $500.
   */
  baseTvlUsd: 500,
  baseDepositors: 1,
  curator: "Priime Labs",
  createdAt: "2026-08-18",
  automations: {
    leverage: {
      targetLeverage: 5.0,
      liqLtv: 0.915,
      emergencyHf: 1.04,
      deleverHf: 1.08,
      targetHf: 1.14,
      leverUpHf: 1.19,
      axisMaxHf: 1.25,
      cadence: "every block",
      cooldown: "1 min",
    },
    hedge: null,
    compound: { cadenceHours: 24, thresholdUsd: 25 },
  },
};

/**
 * The vault as the page should render it: the standing record with the last
 * published envelope laid over it. Nothing attested passes through here — NAV,
 * share price and quorum are read from the journals at the call site.
 *
 * SSR-safe: with no envelope in localStorage (server render, first paint, or a
 * browser that has never published) this is exactly `HERO_VAULT`.
 */
export function resolveVault(): VaultRecord {
  const published = loadPublished();
  if (!published) return HERO_VAULT;
  const { publishedAt: _publishedAt, ...envelope } = published;
  return { ...HERO_VAULT, ...envelope };
}

/**
 * Installed instrument count. The vault carries one more than its modeled
 * automations: the operator quorum that attests the NAV.
 */
export function automationCountFor(v: VaultRecord): number {
  return automationCount(v) + 1;
}
