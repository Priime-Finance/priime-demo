/**
 * The scripted deploy config: the parameters the vault was put on with.
 *
 * Not a form the presenter fills in and not a strategy builder — it is the
 * fixed recipe the canvas's vault inspector reads back, and the source of the
 * chain id and health-factor floor the simulator runs on. Replaced wholesale
 * by the live vault config when the backend lands.
 */

/** One row of the scripted deploy parameter form. */
export interface DeployParameter {
  /** Stable key for React lists and test assertions. */
  key: "target_leverage" | "health_factor_floor" | "min_net_spread_bps";
  /** Field label as shown. */
  label: string;
  /** Machine value. */
  value: number;
  /** Preformatted value ("5.0x", "1.15", "25 bps"). */
  display: string;
  /** One-line rationale, shown as help text or read aloud. */
  help: string;
}

/** The whole deploy config: venue, market, and the three fields. */
export interface DeployFormConfig {
  /** Venue the loop runs on. We build the loop; Morpho is the venue underneath. */
  venue: string;
  /** Market description. */
  market: string;
  /** Chain the vault lives on. */
  chainId: number;
  /** The three parameters, in form order. */
  parameters: readonly DeployParameter[];
  /** Line to say out loud while the config is on screen. */
  note: string;
}

/**
 * The deploy config (spec: "Parameter form, not a canvas: target leverage,
 * health-factor floor, min net-spread threshold. No strategy builder in v1.").
 *
 * Stub values until the strategy work lands (live LTV / health-factor feed
 * replaces them): 5x leverage per the spec; HF floor and net-spread derived
 * from spec facts (91.5% LLTV at ~80% LTV => ~1.14, rounded to 1.15;
 * ~+0.9%/turn carry => 25 bps exit threshold).
 */
export const DEPLOY_FORM: DeployFormConfig = {
  venue: "Morpho Blue",
  market: "USDe/USDC, 91.5% LLTV",
  chainId: 8453,
  parameters: [
    {
      key: "target_leverage",
      label: "Target leverage",
      value: 5,
      display: "5.0x",
      help: "~8% net at 5x on the USDe/USDC recursive loop.",
    },
    {
      key: "health_factor_floor",
      label: "Health-factor floor",
      value: 1.15,
      display: "1.15",
      help: "Run at ~80% LTV against a 91.5% LLTV market; delever before this floor.",
    },
    {
      key: "min_net_spread_bps",
      label: "Min net spread",
      value: 25,
      display: "25 bps",
      help: "Carry is ~+0.9%/turn; unwind rather than loop once net spread thins to this.",
    },
  ],
  note: "The attestation for $500 is byte-for-byte the same proof as for $50M.",
};
