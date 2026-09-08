/**
 * THE BLUEPRINT CARD CANNOT PRINT A NUMBER IT DID NOT PRODUCE.
 *
 * Ported from LIVE lib/canvas/__tests__/copilot-card-prose.test.ts
 * (build.priime.finance eb6d33a) with the import paths rehomed. The system
 * prompt tells the model to state no APY on a propose turn. An instruction
 * is a hope. This is the fact: the panel gathers the percentages it is about
 * to render and withholds a title or a rationale that states any other one,
 * so the walk's worst turn cannot present even if the model ignores every
 * word of the prompt.
 *
 * Two halves, and both are needed:
 *   · the comparison itself, unit-tested here on the exact shapes the walk
 *     produced;
 *   · a source scan proving the panel actually routes both free-hand strings
 *     through it, because a helper nothing calls is a helper that passes its
 *     own tests forever.
 *
 * WHAT THIS DOES NOT DO. It never substitutes a value and never repairs a
 * sentence. Which lane a stray figure was meant for is not recoverable from
 * the string, so there is nothing correct to put in its place.
 *
 * Demo addition (WP2 report): both card feet print the review sheet's own
 * strings, `modeled net APY · ` + apyCaption(), so the explain card and the
 * blueprint card carry the fee caption the sheet and the record print.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cardPrintedPercents, proseAgreesWithCard, statedPercents } from "@/lib/canvas/copilot/card-prose";

describe("statedPercents reads the shapes that actually reach this card", () => {
  it("a plain product number", () => {
    expect(statedPercents("net 6.3% modeled")).toEqual(["6.3%"]);
  });

  it("the two-leverage sentence, with its signed percentage-point delta", () => {
    /* Verbatim from the review sheet on wstETH/WETH. Both halves are claims
       the card prints, so a rationale quoting it correctly must survive. */
    const line = "3.1% this market, hedged, at its 4.10x · −0.7pp your leverage: 2.75x";
    expect(statedPercents(line)).toEqual(["3.1%", "-0.7pp"]);
  });

  it("the funding line, whose owner string carries the window", () => {
    /* NOT A PIN ON A LIVE RATE. This is the parser's INPUT, chosen to have
       the owner's SHAPE: a rate, then a percentile, then a window. Nothing
       here asserts what the rate is. */
    expect(statedPercents("10.22% p25 over 30d")).toEqual(["10.22%"]);
  });

  it("the fee caption", () => {
    expect(statedPercents("net of venue costs and the 20% compute fee")).toEqual(["20%"]);
  });

  it("a sentence with no percentage in it states none", () => {
    expect(statedPercents("A funding carry on kHYPE, hedged, at no leverage.")).toEqual([]);
    expect(statedPercents("")).toEqual([]);
  });

  it("trailing digits that are not percentages are not read as percentages", () => {
    expect(statedPercents("seated at 2.75x on a 30d window")).toEqual([]);
  });

  it("the sign is part of the claim, and both minus glyphs mean the same one", () => {
    expect(statedPercents("−0.7pp")).toEqual(statedPercents("-0.7pp"));
    expect(statedPercents("−0.7pp")).not.toEqual(statedPercents("0.7pp"));
  });

  it("the magnitude is compared as a number, so trailing zeros are the same claim", () => {
    expect(statedPercents("6.30%")).toEqual(statedPercents("6.3%"));
    expect(statedPercents("6.3%")).not.toEqual(statedPercents("6.4%"));
  });
});

describe("proseAgreesWithCard withholds exactly the walk's failures", () => {
  /* The card as it rendered on the walk's worst turn: a funding lane on kHYPE
     whose lane line printed `net 6.3% modeled`, under a fee caption. */
  const printed = cardPrintedPercents([
    "net 6.3% modeled",
    "10.22% p25 over 30d",
    "no launch rail on Hyperliquid, modeled design only",
    "net of venue costs and the 20% compute fee",
    null,
    undefined,
    "",
  ]);

  it("B1: another market's number, stated for this lane, is withheld", () => {
    expect(proseAgreesWithCard("kHYPE funding models 5.75% vault APY.", printed)).toBe(false);
  });

  it("S2: the pre-compound figure, over a card priced with compounding, is withheld", () => {
    expect(proseAgreesWithCard("This lane models 6.18% net, modeled.", printed)).toBe(false);
  });

  it("the card's own number is not withheld", () => {
    expect(proseAgreesWithCard("This lane models 6.3% net, modeled.", printed)).toBe(true);
    expect(proseAgreesWithCard("Rounded, that is 6.30%.", printed)).toBe(true);
  });

  it("a verbatim line quoted back is not withheld", () => {
    expect(proseAgreesWithCard("Funding runs 10.22% p25 over 30d.", printed)).toBe(true);
    expect(proseAgreesWithCard("The compute fee is 20% of yield, at harvest.", printed)).toBe(true);
  });

  it("prose with no number always agrees, because judgment is welcome", () => {
    expect(proseAgreesWithCard("A funding carry on kHYPE, hedged, at no leverage.", printed)).toBe(true);
    expect(proseAgreesWithCard("", printed)).toBe(true);
    expect(proseAgreesWithCard(null, printed)).toBe(true);
    expect(proseAgreesWithCard(undefined, printed)).toBe(true);
  });

  it("one bad figure in an otherwise clean sentence withholds the sentence", () => {
    expect(
      proseAgreesWithCard("Funding runs 10.22% p25 over 30d, so the lane nets 5.75%.", printed),
    ).toBe(false);
  });

  it("NON-VACUITY: the printed set is real and a near miss still fails", () => {
    expect(printed.size).toBeGreaterThan(2);
    expect(proseAgreesWithCard("6.4%", printed)).toBe(false);
    expect(proseAgreesWithCard("6.3%", printed)).toBe(true);
  });
});

describe("the panel routes both free-hand strings through the check", () => {
  /* A source scan, because the alternative is mounting a client component to
     assert on a string it did not render. What matters is the WIRING: the
     model's two strings must not reach JSX unguarded. */
  const PANEL = join(__dirname, "..", "components", "canvas", "CopilotPanel.tsx");
  const src = readFileSync(PANEL, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

  it("NON-VACUITY: the scan is reading the panel", () => {
    expect(code).toContain("cop-blueprint");
    expect(code).toContain("renderProposal");
  });

  it("the title and the rationale are gated, and the raw fields are not rendered", () => {
    expect(code).toMatch(/proseAgreesWithCard\(pay\.title,\s*printed\)/);
    expect(code).toMatch(/proseAgreesWithCard\(pay\.rationale,\s*printed\)/);
    expect(code).toMatch(/<b>\{title\}<\/b>/);
    expect(code).toMatch(/\{rationale \? <div className="cop-bp-rationale">\{rationale\}<\/div>/);
    expect(code).not.toMatch(/<b>\{pay\.title\}<\/b>/);
    expect(code).not.toMatch(/\{pay\.rationale\}/);
  });

  it("the printed set is gathered from the lane's own product number and its verbatim lines", () => {
    expect(code).toMatch(/cardPrintedPercents\(\[/);
    for (const needle of [
      "l.lane.vaultApy",
      "l.lane.marketLeverageLine",
      "l.lane.fundingLine",
      "l.lane.railVerdict",
      "apyCaption()",
    ]) {
      expect(code, needle).toContain(needle);
    }
  });

  it("a server correction still has somewhere to print", () => {
    expect(code).toMatch(/pay\.notes\.map\(/);
    expect(code).toMatch(/\.\.\.pay\.notes,/);
  });

  it("the transcript declares an applied proposal to be history, not state", () => {
    expect(code).toContain("the canvas context block is the current state");
    expect(code).toContain("the user may have re-dialled any lane since");
    expect(code).toContain("(offered, not applied)");
    expect(code).not.toMatch(/\?\s*" \(applied\)"\s*:/);
  });

  it("both card feet print the review sheet's own strings, once each", () => {
    /* The explain card and the blueprint card each carry one foot reading
       `modeled net APY · ` + apyCaption(), the two strings the review sheet,
       the directory card and the published record print. Two feet, two
       classes, the same words. */
    const feet = code.match(/modeled net APY · \{apyCaption\(\)\}/g) ?? [];
    expect(feet).toHaveLength(2);
    expect(code).toMatch(/className="cop-card-foot">modeled net APY · \{apyCaption\(\)\}/);
    expect(code).toMatch(/className="cop-bp-foot">modeled net APY · \{apyCaption\(\)\}/);
  });
});
