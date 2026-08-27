/**
 * The four v1 module definitions (BC-P1).
 *
 * Params here are the STRUCTURAL v1 set with hard clamps. BC-P2 wires the
 * liquidity-source catalog to the Strategy Factory scanner KV; BC-P3 replaces
 * raw band numbers with the derived risk-dial scheme (lib/canvas/param-schema.ts)
 * — nothing outside this file assumes these exact params.
 */

import type { ModuleDef, ModuleKey } from "./types";

export const MODULE_DEFS: Record<ModuleKey, ModuleDef> = {
  "liquidity-source": {
    key: "liquidity-source",
    name: "Liquidity source",
    tagline: "Pick the venue and the loop market",
    description:
      "Screens live loop opportunities on the venues you select and pins the market this vault will run on.",
    rank: 0,
    optional: false,
    params: [
      {
        // UX_ITERATION_3 §1: venue is no longer a user-facing select — the
        // unified discovery list sets it from the picked row (venue = chip
        // on the row). Options stay as the clamp allowlist.
        field: "venue",
        friendlyLabel: "Venue",
        type: "select",
        default: "morpho-blue-hyperevm",
        options: [
          { value: "morpho-blue-hyperevm", label: "Morpho Blue · HyperEVM" },
          { value: "morpho-blue-base", label: "Morpho Blue · Base" },
          { value: "aave-v3-base", label: "Aave v3 · Base" },
          { value: "dolomite-berachain", label: "Dolomite · Berachain" },
          // template mock venues (modeled rows, never scanned)
          { value: "aerodrome-base", label: "Aerodrome · Base" },
          { value: "options-base", label: "Options venue · Base" },
        ],
        hidden: true,
        help: "Where the loop borrows and supplies. Set from the market you pick.",
      },
      {
        field: "candidateId",
        friendlyLabel: "Market",
        type: "select",
        default: "",
        options: [],
        hidden: true,
      },
      { field: "pairLabel", friendlyLabel: "Pair", type: "select", default: "", options: [], hidden: true },
      { field: "contentHash", friendlyLabel: "Doc pin", type: "select", default: "", options: [], hidden: true },
      { field: "cls", friendlyLabel: "Class", type: "select", default: "", options: [], hidden: true },
      { field: "hlCoin", friendlyLabel: "Hedge coin", type: "select", default: "", options: [], hidden: true },
    ],
  },

  "safety-buffer": {
    key: "safety-buffer",
    name: "Dynamic leverage",
    tagline: "Levers up when safe, trims when tight",
    description:
      "Runs the loop at your target leverage: levers up when safe, trims when tight, emergency-deleverages before liquidation. Bands come from the venue's own liquidation parameters.",
    rank: 1,
    optional: false,
    params: [
      {
        // UX_ITERATION_3 §3: derived by the lane risk dial; editable only
        // behind the ADVANCED disclosure (touching it flips the dial to Custom).
        field: "riskPreset",
        friendlyLabel: "Risk profile",
        type: "segmented",
        default: "standard",
        options: [
          { value: "conservative", label: "Conservative", shortLabel: "Wider", numeric: 0.75 },
          { value: "standard", label: "Standard", shortLabel: "Std", numeric: 1.0 },
          { value: "aggressive", label: "Aggressive", shortLabel: "Tighter", numeric: 1.25 },
        ],
        advanced: true,
        help: "Derives the full band set from the venue's liquidation parameters. You never tune raw thresholds.",
      },
      {
        field: "targetLeverage",
        friendlyLabel: "Target leverage",
        type: "slider",
        default: 3,
        min: 1.5,
        max: 5,
        step: 0.25,
        recommendedMin: 2,
        recommendedMax: 3.5,
        unit: "x",
        advanced: true,
        help: "The loop's steady-state leverage. Hard-capped by the venue's max.",
      },
    ],
  },

  hedge: {
    key: "hedge",
    name: "Dynamic hedge",
    tagline: "Delta-neutral via perp short, margin maintained",
    description:
      "Shorts the collateral's perp so price moves cancel. Maintains margin bands and a reserve that auto-refills.",
    rank: 2,
    optional: true,
    params: [
      {
        field: "hedgeLeverage",
        friendlyLabel: "Hedge leverage",
        type: "slider",
        default: 3,
        min: 1,
        max: 5,
        step: 0.5,
        recommendedMin: 2,
        recommendedMax: 4,
        unit: "x",
        advanced: true,
        help: "Leverage on the perp short. Lower needs more margin; higher trims capacity headroom.",
      },
      {
        field: "reserveFraction",
        friendlyLabel: "Margin reserve",
        type: "slider",
        default: 0.1,
        min: 0.1,
        max: 0.3,
        step: 0.05,
        recommendedMin: 0.1,
        recommendedMax: 0.2,
        unit: "of short",
        advanced: true,
        help: "Idle margin kept aside to absorb funding and drawdown before a refill fires.",
      },
    ],
  },

  "auto-compound": {
    key: "auto-compound",
    name: "Auto-compound",
    tagline: "Recapture yield back into the loop",
    description:
      "When earned yield loosens the health factor, the leverage module pulls it back to target so returns compound instead of idling.",
    rank: 3,
    optional: true,
    params: [
      {
        field: "cadence",
        friendlyLabel: "Cadence",
        type: "select",
        default: "24h",
        options: [
          { value: "6h", label: "Every 6 hours", shortLabel: "6h" },
          { value: "24h", label: "Daily", shortLabel: "24h" },
          { value: "72h", label: "Every 3 days", shortLabel: "72h" },
        ],
        help: "How often the recapture check runs. Each action costs gas, so denser is not always better.",
      },
      {
        field: "minActionUsd",
        friendlyLabel: "Minimum action size",
        type: "number",
        default: 25,
        min: 5,
        max: 500,
        step: 5,
        unit: "USD",
        help: "Skip recapture below this size so fees never eat the gain.",
      },
    ],
  },
};

const SPINE_ORDER: ModuleKey[] = [
  "liquidity-source",
  "safety-buffer",
  "hedge",
  "auto-compound",
];

/** Every module key in display order (publish chips, module lists). One
 *  composition survives the strip, so this IS the spine. */
export const DISPLAY_ORDER: ModuleKey[] = SPINE_ORDER;

export function getDef(key: ModuleKey): ModuleDef {
  return MODULE_DEFS[key];
}
