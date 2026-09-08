/**
 * THE COPILOT'S PROSE LINT (2026-08-24, spec §5.5). Pure, unit-tested.
 *
 * The system prompt states the product's register as RULES, and rules are the
 * right instrument for prose the user reads in the stream: a filter that
 * rewrote an answer mid-stream would produce a sentence nobody wrote. But two
 * strings the model emits are not prose at all, they are FIELDS the client
 * renders inside a card — a blueprint's `title` and its `rationale` — and a
 * field is exactly where a mechanical check belongs. A card is the product
 * speaking in its own furniture, so it holds the product's bytes.
 *
 * SIX HITS, each one a rule the product already enforces everywhere else:
 *
 *  · the em dash, which the house style does not use;
 *  · `Prime`, which is not the brand (`Priime` is, and it cannot match here
 *    because "Priime" does not contain "Prime" as a substring at all);
 *  · the banned risk adjectives, the founder's ratified ban, verbatim from
 *    `no-risk-adjectives.test.ts` so there is ONE vocabulary;
 *  · a raw scanner gate id, restricted to `labels.GATE_IDS` so an ordinary
 *    snake_case word in prose is not a false positive;
 *  · the internal class letters, which the product spells `delta-neutral` and
 *    `unhedged`;
 *  · an ASCII hyphen used as a minus sign, where the product uses U+2212.
 *
 * The regexes are REGEX LITERALS and not string constants, which is what keeps
 * this file legal under the adjective ban it enforces: the scanner reads
 * string literals and JSX runs, and a pattern is neither.
 */

/* eslint-disable @typescript-eslint/prefer-optional-chain, @typescript-eslint/prefer-regexp-exec --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { GATE_IDS } from "@/lib/canvas/labels";

/** The em dash. House style has no use for one. */
const EM_DASH = /—/;

/** The brand, misspelled. `\b` on both ends, so `Priime` cannot match. */
const WRONG_BRAND = /\bPrime\b/;

/** The ratified ban, byte-identical with `no-risk-adjectives.test.ts`. */
const RISK_ADJECTIVE =
  /\b(safer|balanced|conservative|aggressive|defensive|moderate|low[ -]risk|high[ -]risk|risk profile|risk level|risk grade)\b/i;

/** The SHAPE of a raw id. Membership in `GATE_IDS` is what makes it a hit. */
const SNAKE_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/** The internal class letters, in the two spellings the model might reach for. */
const CLASS_LETTER = /\bclass\s+(A|N1)\b/i;

/** An ASCII hyphen doing a minus sign's job. `format.ts` owns U+2212. */
const ASCII_MINUS = /(^|[\s(])-\d/;

const GATE_ID_SET = new Set(GATE_IDS);

/**
 * Every offending substring in `s`. An empty array means clean.
 *
 * Returns the OFFENDERS rather than a boolean because a lint that only says
 * "no" cannot tell a new leak from an old one, and because the register line
 * the panel appends names what it withheld.
 */
export function proseLintHits(s: string): string[] {
  if (typeof s !== "string" || s.length === 0) return [];
  const hits: string[] = [];
  const push = (m: RegExpMatchArray | null) => {
    if (m && m[0]) hits.push(m[0].trim());
  };
  push(s.match(EM_DASH));
  push(s.match(WRONG_BRAND));
  push(s.match(RISK_ADJECTIVE));
  push(s.match(CLASS_LETTER));
  push(s.match(ASCII_MINUS));
  for (const m of s.matchAll(SNAKE_TOKEN)) {
    if (GATE_ID_SET.has(m[0])) hits.push(m[0]);
  }
  return hits;
}

/** Sentence split that keeps the terminator with its sentence. */
function sentencesOf(s: string): string[] {
  return s.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0);
}

/**
 * The clean head of `s`, or `fallback` when the very first sentence is dirty.
 *
 * It STRIPS rather than rewrites: a rewritten sentence is one nobody wrote,
 * and a card that quietly paraphrases the model is a third author of the
 * product's copy. Dropping the tail keeps whatever the model said that was
 * already the product's own register, and drops the rest.
 */
export function sanitizeModelProse(s: string, fallback: string): string {
  if (typeof s !== "string" || s.trim().length === 0) return fallback;
  if (proseLintHits(s).length === 0) return s.trim();
  const kept: string[] = [];
  for (const sentence of sentencesOf(s)) {
    if (proseLintHits(sentence).length > 0) break;
    kept.push(sentence.trim());
  }
  const out = kept.join(" ").trim();
  return out.length > 0 ? out : fallback;
}
