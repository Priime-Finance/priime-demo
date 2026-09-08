/**
 * §9.9 · THE TWO STRINGS THE MODEL WRITES INTO THE PRODUCT'S OWN FURNITURE.
 * Ported from build.priime.finance eb6d33a `lib/canvas/__tests__/copilot-prose-lint.test.ts`.
 *
 * The register is taught as RULES, and that is the right instrument for prose
 * in the stream: rewriting a sentence mid-answer produces a sentence nobody
 * wrote. But a blueprint's `title` and `rationale` are not prose, they are
 * FIELDS the client renders inside a card, and a field is exactly where a
 * mechanical check belongs. A card is the product speaking in its own
 * furniture, so it holds the product's bytes.
 *
 * The table below is the whole contract, and it is written as PAIRS: every
 * banned shape sits beside the legal shape closest to it, because a lint that
 * only proves it catches things is half a lint. `Priime` beside `Prime`,
 * `riskPreset` beside `wrapper_basis`, U+2212 beside the ASCII hyphen.
 */
import { describe, expect, it } from "vitest";

import { proseLintHits, sanitizeModelProse } from "@/lib/canvas/copilot/prose-lint";
import { GATE_IDS } from "@/lib/canvas/labels";

const EM_DASH = "—";

describe("§9.9 proseLintHits", () => {
  const DIRTY: [string, string][] = [
    ["an em dash", `Two lanes on Base ${EM_DASH} one hedged`],
    ["the brand, misspelled", "Prime Build blueprint"],
    ["a risk adjective", "a conservative lane on wstETH"],
    ["another risk adjective", "The safer of the two"],
    ["a graded title", "Balanced two-lane portfolio"],
    ["the class letter", "Both are class A markets"],
    ["the class letter, lowercase", "both are class n1"],
    ["an ASCII minus", "-3.2% modeled"],
    ["an ASCII minus after a space", "models -19.4% at the default"],
    ["a raw gate id", "screened out by wrapper_basis"],
    ["another raw gate id", "caps_fail_closed on this venue"],
  ];

  const CLEAN: [string, string][] = [
    ["the brand", "Priime Build blueprint"],
    ["a stored enum name", "riskPreset is the user's own control"],
    ["U+2212", "−3.2% modeled"],
    ["a hyphenated word", "Two-lane delta-neutral on Base"],
    ["a negative in prose without a sign", "models 19.4% below zero"],
    ["an ordinary snake_case word that is not a gate", "the market_list is not a gate id"],
    ["the word class in an innocent place", "a first class market"],
    ["a rebalanced hedge", "Hedge rebalanced at the cadence"],
  ];

  for (const [what, s] of DIRTY) {
    it(`hits ${what}`, () => {
      expect(proseLintHits(s), s).not.toEqual([]);
    });
  }

  for (const [what, s] of CLEAN) {
    it(`passes ${what}`, () => {
      expect(proseLintHits(s), s).toEqual([]);
    });
  }

  it("reports the offender, not just a verdict", () => {
    expect(proseLintHits("Prime Build")).toContain("Prime");
    expect(proseLintHits("screened out by wrapper_basis")).toContain("wrapper_basis");
  });

  it("every gate id in the owner's list is caught", () => {
    expect(GATE_IDS.length).toBeGreaterThan(10);
    for (const id of GATE_IDS) {
      if (!id.includes("_")) continue; // `caps` and `wrapper` are ordinary words
      expect(proseLintHits(`screened out by ${id}`), id).toContain(id);
    }
  });

  it("empty and non-string inputs are clean, never a throw", () => {
    expect(proseLintHits("")).toEqual([]);
    expect(proseLintHits(undefined as unknown as string)).toEqual([]);
  });
});

describe("§9.9 sanitizeModelProse", () => {
  it("a clean string survives whole", () => {
    const s = "Two lanes on Base, both modeled.";
    expect(sanitizeModelProse(s, "Portfolio blueprint")).toBe(s);
  });

  it("a dirty FIRST sentence falls back", () => {
    expect(sanitizeModelProse("A conservative two-lane blueprint.", "Portfolio blueprint")).toBe(
      "Portfolio blueprint",
    );
    expect(sanitizeModelProse("Prime Build blueprint", "Portfolio blueprint")).toBe(
      "Portfolio blueprint",
    );
  });

  it("a clean head is KEPT and the dirty tail is dropped, never rewritten", () => {
    const out = sanitizeModelProse(
      "Two lanes on Base, both modeled. The second is a conservative one.",
      "Portfolio blueprint",
    );
    expect(out).toBe("Two lanes on Base, both modeled.");
    /* STRIPS, never paraphrases. A rewritten sentence is one nobody wrote, and
       a card that quietly reworded the model would be a third author of the
       product's copy. */
    expect(proseLintHits(out)).toEqual([]);
  });

  it("an empty or blank string falls back", () => {
    expect(sanitizeModelProse("", "Portfolio blueprint")).toBe("Portfolio blueprint");
    expect(sanitizeModelProse("   ", "")).toBe("");
  });

  it("NON-VACUITY: the output of every dirty case is clean", () => {
    for (const [, s] of [
      ["", `A conservative lane ${EM_DASH} modeled.`],
      ["", "Prime Build: -3.2% modeled."],
      ["", "class A only, screened by wrapper_basis."],
    ] as [string, string][]) {
      expect(proseLintHits(sanitizeModelProse(s, "Portfolio blueprint")), s).toEqual([]);
    }
  });
});
