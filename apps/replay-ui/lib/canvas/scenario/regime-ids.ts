/**
 * THE SIX REGIMES, AND NOTHING ELSE.
 *
 * This file is DELIBERATELY IMPORT-FREE. The regime switcher (WP-9 / F.1) is a
 * client control, and every other file in this package reaches either the
 * committed scan fixture or `strategy-factory/venues/hyperliquid-funding`,
 * whose module graph pulls `node:crypto` through `hl-scan`. A client component
 * that only needs the list of regimes imports THIS file and nothing deeper.
 *
 * ── THE SEED TOKENS ───────────────────────────────────────────────────────
 * Section E writes the seeds as leetspeak tokens (`0xD3AD`, `0xC0MP`, `0x1NV`,
 * `0xTA1L`, `0xFL1P`, `0xW8`). Exactly one of them (`0xD3AD`) is a legal hex
 * literal; the other five contain letters that are not hex digits. Rather than
 * pick a number beside the spec's token and lose the spec's own value, the
 * token is carried verbatim and the number is DERIVED from it by one function
 * with two branches:
 *
 *   - a legal hex literal is its own value, so `0xD3AD` is exactly 54189;
 *   - anything else is FNV-1a over the token's bytes.
 *
 * Both branches are pure and reproducible from the token alone, so the record
 * can print the token a reader recognises next to the number the generator
 * actually ran on.
 */

export type RegimeId =
  | "dead-band"
  | "compression"
  | "inversion"
  | "right-tail"
  | "whipsaw"
  | "settlement-stress";

/** Render order, and the order the switcher draws. Dead band is the default
 *  on load (section E), because it is the state 66% of live books print. */
export const REGIME_IDS: readonly RegimeId[] = [
  "dead-band",
  "compression",
  "inversion",
  "right-tail",
  "whipsaw",
  "settlement-stress",
] as const;

export const DEFAULT_REGIME: RegimeId = "dead-band";

/** Rendered verbatim. No em dash, no risk adjective, no disclaimer clause. */
export const REGIME_LABEL: Record<RegimeId, string> = {
  "dead-band": "Dead band",
  compression: "Compression",
  inversion: "Inversion",
  "right-tail": "Right tail",
  whipsaw: "Whipsaw",
  "settlement-stress": "Settlement stress",
};

/**
 * What the regime is FOR, in one present-tense sentence naming the mechanism
 * it exercises. These are the strings a panel puts under the switcher; they
 * state what the run does, never how risky it is.
 */
export const REGIME_MECHANISM: Record<RegimeId, string> = {
  "dead-band":
    "The premium stays inside the venue's clamp, so every book prints the administered rate and the streak advances on an unchanged number.",
  compression:
    "The premium drifts below the clamp, so funding decays past the treasury rate and the two published series cross once.",
  inversion:
    "The premium sits below the clamp on every book at once, so the funding percentile goes negative and the router looks for a peer.",
  "right-tail":
    "The premium rises above the clamp, so funding prints above the administered rate while the book it prints on thins.",
  whipsaw:
    "The premium crosses the rule threshold in runs of growing length, so sustain, cooldown and the turnover budget each get to refuse.",
  "settlement-stress":
    "The premium inverts while the destination's publication clock holds, so weight in flight is visible and earns nothing until it lands.",
};

/** The spec's own token for each regime's seed, carried verbatim. */
export const REGIME_SEED_TOKEN: Record<RegimeId, string> = {
  "dead-band": "0xD3AD",
  compression: "0xC0MP",
  inversion: "0x1NV",
  "right-tail": "0xTA1L",
  whipsaw: "0xFL1P",
  "settlement-stress": "0xW8",
};

const HEX_LITERAL = /^0x[0-9a-fA-F]+$/;

/** FNV-1a, 32 bit. Pure, no table, byte-identical on every engine. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A token's seed: its own hex value when it is one, else FNV-1a over it. */
export function seedOf(token: string): number {
  return HEX_LITERAL.test(token) ? Number.parseInt(token.slice(2), 16) >>> 0 : fnv1a32(token);
}

/** The seed each regime runs on by default. Derived from the token above. */
export const REGIME_SEED: Record<RegimeId, number> = {
  "dead-band": seedOf(REGIME_SEED_TOKEN["dead-band"]),
  compression: seedOf(REGIME_SEED_TOKEN.compression),
  inversion: seedOf(REGIME_SEED_TOKEN.inversion),
  "right-tail": seedOf(REGIME_SEED_TOKEN["right-tail"]),
  whipsaw: seedOf(REGIME_SEED_TOKEN.whipsaw),
  "settlement-stress": seedOf(REGIME_SEED_TOKEN["settlement-stress"]),
};

export function isRegimeId(v: unknown): v is RegimeId {
  return typeof v === "string" && (REGIME_IDS as readonly string[]).includes(v);
}
