/**
 * THE CARD SPEAKS ONE NUMBER PER LANE (2026-08-24, the live walk).
 *
 * The blueprint card renders two strings the model wrote free-hand, `title`
 * and `rationale`, directly above and beside numbers the SERVER computed. On
 * the production walk that produced a card whose rationale said the kHYPE
 * funding lane "models 5.75% vault APY" while the lane line under it printed
 * `net 6.3% modeled`, and a second card whose prose said 6.18 pct over a lane
 * priced at 6.3%. Both are the same shape of failure: a number the model
 * reached for, rendered inside the frame of a number it did not have.
 *
 * `prose-lint.ts` already catches the house-style hits (the em dash, the
 * misspelled brand, the class letter, an ASCII minus on a signed value). It
 * cannot catch this one, because 5.75% is a perfectly well-formed percentage.
 * The only thing wrong with it is that the card does not print it.
 *
 * So this module compares, and only compares. It computes no APY, holds no
 * fee, converts no frame and knows nothing about leverage: it reads the
 * ALREADY FORMATTED strings the card is about to render, collects the
 * percentages in them, and answers whether a sentence states any percentage
 * that is not among them. The panel withholds the sentence when it does. That
 * makes the invariant structural rather than instructed:
 *
 *     a percentage rendered on the blueprint card is a percentage the card
 *     itself produced.
 *
 * ⚠ WHY WITHHOLD RATHER THAN CORRECT. There is no correct value to
 * substitute: the model's sentence is about a lane, and which lane a stray
 * figure was meant for is not recoverable from the string. Rewriting it would
 * invent a second author for the model's judgment. Dropping it costs a
 * sentence of rationale and keeps the numbers whole, and the card's own rows
 * carry every fact the sentence was decorating.
 */

/**
 * A percentage or percentage-point token, in any of the shapes that reach this
 * panel: `6.3%`, `−0.7pp`, `+2%`, `12 %`.
 *
 * `pp` is in the set because the two-leverage sentence states its delta in
 * percentage points, and that sentence renders on the card verbatim. A
 * rationale that quotes it correctly must not be withheld for doing so.
 */
const TOKEN_SOURCE = String.raw`([+−-]?)\s*(\d+(?:\.\d+)?)\s*(%|pp\b)`;

/** A fresh matcher per call. The word boundary rides on `pp` alone: `%` is not
 *  a word character, so `\b` after it would demand a letter or a digit next
 *  and `6.3% modeled` would state no percentage at all. */
const token = () => new RegExp(TOKEN_SOURCE, "gi");

/**
 * One token, reduced to the fact it asserts: a sign, a magnitude and a unit.
 *
 * Numeric rather than textual, so `6.30%` and `6.3%` are the same claim and
 * `6.3%` and `6.4%` are not. The sign is carried because a signed delta means
 * the opposite thing without it, and both the product's U+2212 and a plain
 * hyphen normalize to the same negative.
 */
function claimOf(sign: string, digits: string, unit: string): string | null {
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  const neg = sign === "-" || sign === "−";
  return `${neg ? "-" : ""}${n}${unit.toLowerCase()}`;
}

/** Every percentage claim a string states. Order preserved, duplicates kept. */
export function statedPercents(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(token())) {
    const c = claimOf(m[1] ?? "", m[2], m[3].trim());
    if (c !== null) out.push(c);
  }
  return out;
}

/**
 * Every percentage claim the card itself prints, gathered from the strings the
 * card is actually about to render.
 *
 * The caller passes the rendered strings, not the underlying numbers, and that
 * is deliberate: the card rounds through `pct` on its way to the screen, so a
 * comparison against the unrounded fraction would accept a figure the reader
 * never sees. What the reader sees is the whole test.
 */
export function cardPrintedPercents(rendered: readonly (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const s of rendered) {
    if (typeof s !== "string" || s.length === 0) continue;
    for (const c of statedPercents(s)) out.add(c);
  }
  return out;
}

/**
 * Does this sentence state only percentages the card prints?
 *
 * A sentence with no percentage in it always agrees: the model's judgment is
 * welcome, its arithmetic is not. This is a one-way check by construction, and
 * that asymmetry is right. The card printing a number the prose omits is the
 * normal case and the intended one.
 */
export function proseAgreesWithCard(
  prose: string | null | undefined,
  printed: ReadonlySet<string>,
): boolean {
  if (typeof prose !== "string" || prose.length === 0) return true;
  for (const c of statedPercents(prose)) if (!printed.has(c)) return false;
  return true;
}
