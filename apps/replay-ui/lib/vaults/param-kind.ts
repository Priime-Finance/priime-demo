/**
 * THE THREE TYPE REGISTERS OF A KEY/VALUE ROW, decided in one place.
 *
 * The app has one mono and it is the DATA register: figures with their
 * units, hashes, addresses, block numbers, timestamps, the market pair. A
 * row whose value is a sentence is not data, and printing it in the mono is
 * what made the Parameters table read as nine right-aligned monospaced
 * sentences (founder, 2026-09-08: "not a big fan of the typescript font;
 * you can use it sporadically; but not as main").
 *
 *   reading  the value is a datum. Stays in the mono, tabular.
 *   phrase   the value is a few words. Sans, stays on the row, right-aligned.
 *   prose    the value is a sentence. Sans, stacked left, wraps.
 *
 * The mechanism this replaces was a hardcoded `p.label === "Main risk"` test
 * in VaultDetail: the escape hatch existed and was granted to exactly one
 * label, so every row added after it printed as a monospaced sentence by
 * default. Mono stays the DEFAULT here, which is what stops a numeric row
 * ever regressing out of the data register; the escape is what is granted.
 *
 * ENUMERATED, NOT SNIFFED. A label the product ships is named below. The
 * fallback exists only for a row added later and is deliberately dumb, so a
 * new row that lands in the wrong register is a missing entry here rather
 * than a string heuristic quietly deciding the page's typography.
 */

/** Values that stay in the mono because they are readings. */
const READING_LABELS: ReadonlySet<string> = new Set([
  "Loop market",
  "Floor market",
  "Liquidation LTV",
  "Protection envelope",
  "Compound cadence",
  "Harvest threshold",
  "Capacity",
  "Remaining capacity",
  "Min deposit",
  "Move bar",
  "Sustain",
  "Re-arm",
  "Moves",
  "Applied leverage",
  "Health bands",
  "Read at",
]);

/** Values that are whole sentences: stacked left in the sans, and they wrap. */
const PROSE_LABELS: ReadonlySet<string> = new Set(["Main risk", "Floor rate source"]);

/**
 * Values that are a few words: the sans, but they stay on the row.
 * Everything the product ships today that is neither a reading nor a
 * sentence, named so the fallback never has to decide for a shipped row.
 */
const PHRASE_LABELS: ReadonlySet<string> = new Set([
  "Loop venue",
  "Floor venue",
  "Exit route",
  "Exit settlement",
  "Compute fee",
  "Management fee",
  "Withdrawal",
  "Move size",
]);

/** A value long enough that it is a sentence whatever its label says. */
const PROSE_CHARS = 60;

/**
 * The register of one LABELLED row. Labels first, because the label is what
 * the product controls and the value is what a market moves.
 */
export function paramKind(label: string, value: string): "reading" | "phrase" | "prose" {
  if (READING_LABELS.has(label)) return "reading";
  if (PROSE_LABELS.has(label)) return "prose";
  if (PHRASE_LABELS.has(label)) return "phrase";
  // A hash or a digest is a reading however long it runs: a sha256 is 71
  // characters and would otherwise stack as prose (seen on the Attestation
  // table, 2026-09-08). It wraps inside its column instead.
  if (/^(0x|sha256:)/.test(value.trimStart())) return "reading";
  // A row added after this pass. Length decides prose; otherwise the same
  // first-character rule the unlabelled surfaces use.
  if (value.length > PROSE_CHARS) return "prose";
  return valueKind(value);
}

/**
 * The register of a value with NO label to read: the instrument feet, the
 * big readouts, the attestation rows. A datum announces itself in its first
 * character, a phrase begins with a word.
 *
 * `MINUS` here is U+2212, the sign the product prints; the ASCII hyphen is
 * accepted because a raw `toFixed` result can still reach a foot.
 */
export function valueKind(value: string): "reading" | "phrase" {
  const head = value.trimStart();
  if (head.length === 0) return "reading";
  if (head.startsWith("0x") || head.startsWith("sha256:")) return "reading";
  // A calendar date is a timestamp, and timestamps are data: `Sep 8, 2026`
  // (the page's own date format) and an ISO day both read in mono.
  if (/^[A-Z][a-z]{2} \d{1,2}, \d{4}\b/.test(head) || /^\d{4}-\d{2}-\d{2}\b/.test(head)) return "reading";
  const c = head[0] ?? "";
  if (c >= "0" && c <= "9") return "reading";
  if (c === "$" || c === "€" || c === "£" || c === "¥") return "reading";
  if (c === "+" || c === "−" || c === "-") return "reading";
  if (c === "±") return "reading";
  return "phrase";
}

/** The register of one row, as the row schema carries it. */
export type ParamKind = "reading" | "phrase" | "prose";

/**
 * Stamp a built row list with its registers, once, at the end of the fold.
 * Every key/value surface that has labels runs its rows through here, so the
 * record, the router panel and the review sheet cannot disagree about how
 * the same string is set.
 */
export function withParamKinds<T extends { label: string; value: string }>(
  rows: readonly T[],
): (T & { kind: ParamKind })[] {
  return rows.map((r) => ({ ...r, kind: paramKind(r.label, r.value) }));
}
