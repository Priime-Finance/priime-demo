/**
 * WORDS THE PRODUCT UNDERSTANDS AND NEVER SAYS.
 *
 * ══ WHY THIS FILE EXISTS AS A FILE ═════════════════════════════════════════
 *
 * Founder ruling 2026-08-22 bans subjective risk adjectives from every surface
 * a user reads, and `no-risk-adjectives.test.ts` enforces it by scanning the
 * canvas and vault sources for those words in string literals and JSX text.
 *
 * But refusing to PARSE "make every lane safer" would be pedantry: a user's
 * own vocabulary is an input, and understanding it costs the product nothing.
 * The two rules only look like they conflict because they were living in one
 * file — the funding copilot's parser held its stopword list and its risk-word
 * matching a hundred lines from the strings it replies with.
 *
 * So the boundary is STRUCTURAL rather than an allowlist entry that grows.
 * Everything here is INPUT: words matched against what a user typed. Nothing
 * here is ever rendered, returned as copy, or stored on a lane, and this
 * module exports no function that builds a display string. The scanner skips
 * exactly this file, by name, and the test states this reason.
 *
 * If a future edit makes something here reach a screen, it belongs in the file
 * that renders it — and the scanner will catch it there.
 */

/** Words that can only be filler between a preposition and a venue name. */
export const VENUE_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "my", "our", "all", "both", "every", "each",
  "top", "best", "biggest", "some", "any", "these", "those", "it", "them",
  "perp", "perps", "venue", "venues", "exchange", "exchanges", "chain",
  "chains", "market", "markets", "vault", "strategy", "funding", "basis",
  "delta", "neutral", "carry", "trade", "spot", "short", "long", "usd",
  "usdt", "usdc", "risk", "safer", "safe", "conservative", "defensive",
  "balanced", "standard", "default", "max", "aggressive", "degen", "maximum",
  "ethena", "steth", "usde", "style", "like", "over", "on", "across", "using",
  "via", "with", "of", "for", "to", "in", "at",
]);

/**
 * Which of the three short-leg bundles a phrase asks for, as an INDEX into
 * `funding-demo.SHORT_LEG_PRESETS`, or null.
 *
 * THE NUMERIC FORM IS TRIED FIRST, because it is the form the product's own
 * copy uses: the canvas suggestion chip reads "Set every lane to a 2x short",
 * which names the value it sets. The adjective forms are the user's, kept so
 * their sentence still works, and they resolve to the identical bundle — there
 * is no separate "adjective path" that could drift.
 */
export function shortLegIndexFromPrompt(p: string): 0 | 1 | 2 | null {
  const byNumber = /\b([234])\s*x?\s*(?:short|leverage|perp)\b/.exec(p);
  if (byNumber) return (Number(byNumber[1]) - 2) as 0 | 1 | 2;
  if (/\b(safer|safe|conservative|defensive)\b/.test(p)) return 0;
  if (/\b(max|aggressive|degen|maximum)\b/.test(p)) return 2;
  if (/\b(balanced|standard|default)\b/.test(p)) return 1;
  return null;
}
