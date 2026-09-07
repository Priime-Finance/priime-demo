"use client";

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/prefer-optional-chain --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * ComposePanel (COMPOSE_PANEL_SPEC §3) — what this lane is made of, what else
 * it can take, and what each addition is worth.
 *
 * THE COMPLAINT THIS ANSWERS: "when I'm here like this, how can I add a hedge
 * or tweak the strategy?" Standing on a composed lane with nothing selected,
 * the dock used to fall back to the market catalog forever, so the modules a
 * lane can take had no home in the default state and TUNING had no entry
 * point at all. `compose` now REPLACES the catalog the moment a lane exists
 * (lib/canvas/dock-state.ts), and the catalog stays one key away.
 *
 * THREE GROUPS, THREE SHAPES — the single most important craft decision here.
 * If all three rendered as boxes the panel would be an undifferentiated stack
 * of eleven cards in a 328px column. So state is signalled by MATERIAL, never
 * by colour alone:
 *   INSTALLED   one white ENCLOSED list  — inventory you own
 *   ADDABLE     separated DASHED bays    — the canvas's own ghost-slot idiom
 *   BLOCKED     no container at all      — the skip register
 *
 * THE NUMBER GRAMMAR (§1), three machines, three forms, three owners:
 *   FRAME M  the market at its own leverage — always welded to that leverage
 *            (`6.1% at 4.10x`), mute mono, NEVER in a value slot.
 *   FRAME C  the counterfactual — only ever an ARROW PAIR attached to the
 *            control that would cause it. No arrow, no counterfactual.
 *   FRAME L  the lane as composed — the hero, and the only frame allowed to
 *            stand alone. Byte-identical on every surface that prints it.
 *
 * Pill / arrow / hero. The old chimera (the market's class word welded to the
 * lane's repriced number) described a machine that existed nowhere and it
 * leaves the product entirely.
 *
 * EVERY number here comes out of publishedNetApy / candidateApy / hedgeValue /
 * repriceAtLeverage on THIS lane's repriced candidate (mock-quote §A3), and
 * every string comes out of lib/canvas/format.ts. No surface computes its own.
 *
 * RECONCILED with the capacity work that landed 2026-08-22: the lane variant's
 * Composition card (With hedge / Without hedge) was the shipped form of the
 * add/eject control. Its SUBSTANCE survives here — both sides of the choice
 * visible, from the same three functions, next to the control that changes
 * them — in the spec's typographic form: the add bay's triple carries both
 * endpoints, and the eject cross carries the reversed pair. Rendering both
 * would be two controls for one idea. The lane capacity line survives
 * verbatim.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { LoopId, ModuleKey, PortfolioGraph } from "@/lib/canvas/types";
import { addModule, nodeFor } from "@/lib/canvas/graph-ops";
import { getDef, MODULE_DEFS } from "@/lib/canvas/modules";
import type { Control } from "@/lib/canvas/dominance";
import { candidateApy, composedTerms, publishedNetApy,
  type ComposedTerms,
  type LaneComposition,
} from "@/lib/canvas/mock-quote";
import {
  collarForfeitLine,
  laneCollarForfeit,
  type CollarForfeit,
} from "@/lib/canvas/templates";
import {
  composeOptionsFor,
  FAMILY_LABEL,
  shelfHead,
  shelfRows,
  STRATEGY_LABEL,
  type ComposeAddable,
  type ShelfRow as ShelfRowModel,
} from "@/lib/canvas/compose-options";
import {
  capacityBindingLabel,
  fmtCapacityUsd,
  laneCapacityUsd,
} from "@/lib/canvas/capacity";
import { shelfCountLabel } from "@/components/canvas/GhostSlot";
import { COMING_SOON, DEMO_SCOPE, isLiveModule } from "@/lib/demo-scope";
import { venueLabel } from "@/lib/canvas/labels";
import { ARROW, deltaTriple, lev, MINUS, pct, pp, ppMag } from "@/lib/canvas/format";
import { hedgeEconomics, hedgeHero, type HedgeEconomics } from "@/lib/canvas/hedge-econ";
import {
  adverseMoveLine,
  adverseMoveShort,
  adverseMoveValue,
  driftBeforeTrim,
  liquidationDistance,
} from "@/lib/canvas/liquidation";
import { pricingParamsFor } from "@/lib/canvas/pricing-params";
import type { AxisLane } from "@/lib/canvas/axes";
import type { RiskPreset } from "@/lib/canvas/param-schema";
import {
  reclaim,
  reclaimHeld,
  registerFor,
  riskTableForRegisterInput,
  REGISTER_TITLE,
  VERDICT_TITLE,
  type RegisterInput,
} from "@/lib/canvas/register";
import { liquidationVerdict, type LiquidationVerdict } from "@/lib/canvas/liquidation-lines";
/* THE TABLE ITSELF — the canvas twin of the record's `riskTableForVault`, so
   the dock and the vault page lay out ONE typed object instead of each
   inventing a table around one prose field. The ENTRY POINT is
   `riskTableForRegisterInput` in `register.ts`, not `riskTableForLane` here:
   that file is already the one owner of the lane's family and of the exogenous
   placement ternary, and a second reader of either in this component would be
   a second answer to a question `registerFor` has already answered. */
import {
  readingStamp,
  RISK_NOT_MEASURED,
  type RiskParty,
  type RiskRow,
  type RiskSectionAbsence,
} from "@/lib/canvas/risk-table";
import { watchViewOf } from "@/lib/canvas/exogenous";
import { matchStopIndex, notchMove, type LeverageStopView } from "@/lib/canvas/leverage-stops";
import type { ProjectedCandidate } from "@/lib/canvas/opportunities";
import type { DockLaneView } from "./LanePanel";

/* ── Copy register (§9): every line is a MECHANISM statement or a number,
      never a disclaimer.

      REWRITTEN 2026-08-22 (§7B). Five of the seven were written for a lane
      that ALREADY EXISTED, and this shelf is now where a builder chooses
      between peers on a lane that holds nothing. `Runs the loop` asserted the
      family from inside the shelf; `Re-levers` assumed leverage exists; `the
      position` and `the range` named things that do not exist yet. Each line
      now says what the module BUILDS. The semicolon goes: the law allows
      commas, periods and colons. ── */
const MECHANISM: Record<ModuleKey, string> = {
  "liquidity-source": "Pins the venue and the market this lane runs on.",
  "safety-buffer": "Recursively borrows and re-supplies, at your target leverage.",
  hedge: "Shorts the collateral on the perp so price moves cancel.",
  "auto-compound": "Puts earned yield back to work instead of letting it idle.",
  "auto-center": "Runs a concentrated LP and recenters it as price walks.",
  "covered-call": "Writes calls above spot. The premium is the income.",
  "protective-put": "Buys a floor under the holding, funded by the calls.",
  "exogenous-risk": "Names each party this lane depends on, and what to read on it.",
  /* ⚠ PLACEHOLDER — WP-3 owns the final line. Present tense, one sentence,
     says what the module BUILDS rather than asserting a lane that exists. */
  "redemption-route": "Routes the issuer position back to cash, and prices the wait.",
};

/** The hedge names the INSTRUMENT when the lane knows it — the perp coin
 *  (`hlCoin`), never the collateral symbol. There is no kHYPE perp: a kHYPE
 *  lane shorts HYPE, and every sibling surface already says so ("short HYPE ·
 *  Hyperliquid"). Printing the collateral here named a market that does not
 *  exist (recette 2026-08-23, F11). */
function mechanismFor(key: ModuleKey, cand: ProjectedCandidate | null): string {
  if (key === "hedge" && cand?.hlCoin) {
    return `Shorts ${cand.hlCoin} on the perp so price moves cancel.`;
  }
  return MECHANISM[key];
}

/** `Add dynamic hedge` — sentence case, matching `.bc-root .hm-key{text-transform:none}`. */
function addLabel(key: ModuleKey): string {
  return `Add ${getDef(key).name.toLowerCase()}`;
}

/**
 * `names 6 dependencies · nothing reads 3 of them` — the watcher bay's own
 * fact, and it is the fact the PRESS produces rather than a coverage score.
 *
 * ══ IT SAID `answers 2 of 6 dependencies` (recette fix, 2026-08-27) ═══════
 *
 * Two things were wrong with that line, and the second one is the one that
 * mattered.
 *
 *  1. IT WAS A COVERAGE CLAIM THE MODULE DOES NOT DELIVER. `answers` counts
 *     the parties that carry a WRITTEN RESPONSE. On the delta-neutral LP
 *     template it read `answers 2 of 5` while the scan had read NOTHING on
 *     that lane — no gate ran, every party came back blind. A number that
 *     says "answers" over an empty evidence set is exactly the coverage this
 *     module's charter (rule 3) forbids it from implying.
 *
 *  2. IT WAS THE WRONG UNIT, BESIDE A COUNTER IN ANOTHER UNIT. Pressing this
 *     key raises `skipBarLabel`'s count of what the vault does not measure —
 *     2 → 4 on the leveraged-loop template, 1 → 5 on the delta-neutral LP —
 *     because ONE blind row standing for four LUMPED dependencies is replaced
 *     by one row per party. The arithmetic is honest and the enumeration is
 *     truer: the pre-press number was undercounting by aggregation. But a
 *     builder who presses a key called "exogenous risk" and watches an
 *     unmeasured counter go up has been told the opposite of what happened,
 *     and the panel's own line offered `answers 2` as the thing that would
 *     improve. Two numbers in two units, one of them rising, and the bay
 *     pointed at the other one.
 *
 * THE RESOLUTION IS NOT TO MAKE THE NUMBERS AGREE. They are different
 * quantities and forcing agreement would mean either re-lumping the parties
 * (deleting the module's whole value) or promoting rows to `measured` that no
 * gate reads (inventing coverage). It is to state, BEFORE the press, the two
 * integers the press actually produces — how many parties this route has, and
 * how many of them nothing in this product reads. Then the bar's rise arrives
 * as the number the panel already quoted, and the builder reads the press as
 * what it is: an enumeration arriving, not a measurement leaving.
 *
 * Derived on the spot from the lane the panel is already holding, through the
 * one owner (`watchViewOf`), so the shelf and the plate cannot state two
 * counts for one lane.
 */
function shelfCoverage(cand: ProjectedCandidate, hasHedge: boolean): string {
  const placed: ModuleKey[] = hasHedge
    ? ["liquidity-source", "hedge", "exogenous-risk"]
    : ["liquidity-source", "exogenous-risk"];
  const view = watchViewOf({ candidate: cand, placed, params: {} });
  if (view.named === 0) return "";
  const noun = view.named === 1 ? "dependency" : "dependencies";
  if (view.unreadCount === 0) return `names ${view.named} ${noun} on this route`;
  return `names ${view.named} ${noun} · nothing reads ${view.unreadCount} of them`;
}

/* ── The 9px cross. ONE cross in the product, not two: the exact SVG the
      header notice uses (ProgressRail), in a 24px hit box. ── */
function CrossGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden focusable="false">
      <path d="M1 1L8 8M8 1L1 8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg className={className} width="8" height="8" viewBox="0 0 8 8" aria-hidden focusable="false">
      <path d="M2.5 1L5.5 4L2.5 7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * THE COLLAR'S COMPANION FACT FOR ONE LANE (QNT-R2-3), RE-EXPORTED.
 *
 * The body MOVED to `lib/canvas/templates.ts` (G7, 2026-09-02), beside
 * `collarForfeit` and `collarForfeitLine`, because the copilot — the sixth
 * surface that prints the collar's figure, and the one this ruling missed —
 * builds its lane frame on the server and may not import a `"use client"`
 * module. One graph read of the collar's dials, two panels reading it. The
 * re-export keeps this file's name for it, which is where the dock, its tests
 * and `dock-explainers.test.ts` all look.
 */
export { laneCollarForfeit };

/** One row of the bridge ladder: an ENDPOINT, a TERM, or the RUNG an endpoint
 *  is restated on between two terms. */
export interface LadderRow {
  n: string;
  label: string;
  kind: "end" | "term" | "rung";
}

/**
 * THE LADDER, AS A PURE FUNCTION — lifted out of `Bridge` so the arithmetic a
 * builder reads can be moved and watched rather than asserted about by grep.
 * `terms` is `composedTerms(cand, hasHedge, comp)`: every number below is one
 * of its fields or a difference of two of them, and no branch here re-derives
 * a quantity that file owns.
 */
export function bridgeLadder(
  cand: ProjectedCandidate | null,
  scan: { apr: number | null; lev: number | null } | null,
  hasHedge: boolean,
  terms: ComposedTerms,
  /**
   * Whether this lane's family seats a LEVERAGE DIAL — `opts.chain` (the
   * committed family's own chain, delivered by `compose-options`) containing
   * `safety-buffer`. Passed in rather than derived here because this panel is
   * held away from the total family derivation by `compose-options.test.ts`:
   * a surface that speaks to the builder reads the family through
   * `composeOptionsFor`, never off the chain table directly.
   */
  levered: boolean,
): LadderRow[] {
  const composed = terms.published;
  /* THE CLASS WORD FOLLOWS THE COMPOSITION, NOT THE ROW (WI-8 ruling,
     2026-08-24). `cls` is the MARKET's class, pinned at pick time and
     permanent; on a class-A lane whose hedge has been ejected the rung
     `this market, hedged, at your leverage` described a machine the lane no
     longer holds — the chimera this file's own header banned, one card down.
     A hedge-ejected lane's rungs carry NO class word (the base endpoints are
     the market's own arithmetic, and asserting `unhedged` of them would be
     the same chimera mirrored); the ejection is attributed by its own step,
     or — when its pp-term is below the material threshold — on the leverage
     step's label, because attribution is a fact, not a magnitude. */
  /* D-MTX-2 — AND NEITHER THE CLASS WORD NOR THE LEVERAGE SURVIVES A FAMILY
     THAT HAS NEITHER (2026-09-02). `this market, unhedged, at its 1.00x` on a
     collar advertises a leverage dial the family does not have (no
     `safety-buffer` on its chain, `loopLeverage: 1` by construction) and
     spends its only adjective on `unhedged`, which is true and useless where
     the put IS the protection. Discover already ruled on exactly this row and
     said it in two moves — the leverage slot reads `modeled`, and the class
     pill gives way to the family — so this rung reuses that spelling rather
     than inventing a third. The lane's committed family owns whether the
     dial exists (`levered`, above); nothing here hand-lists a family. */
  const hedgeEjected = cand?.cls === "A" && !hasHedge;
  const classWord = !levered
    ? null
    : cand?.cls === "N1"
      ? "unhedged"
      : hedgeEjected
        ? null
        : "hedged";
  const classClause = classWord ? `, ${classWord},` : "";
  const atLane = candidateApy(cand);
  const laneLev = cand?.economics?.loopLeverage ?? null;
  const scanApr = scan?.apr ?? null;
  const scanLev = scan?.lev ?? null;

  // The self-consistency law, applied to the whole ladder: every term is the
  // difference of the PRINTED endpoints, so the column adds up on screen.
  const r = (v: number | null) => (v === null ? null : Number((v * 100).toFixed(1)));
  const rScan = r(scanApr);
  const rLane = r(atLane);
  const rComposed = r(composed);

  /* FOUR STEPS, AND EACH WEARS ITS OWN NAME.
     `composed − atLane` is the hedge decision PLUS the fee PLUS the
     compounding delta. It was printed as one row labelled `no hedge
     installed`, so on every hedged market the compounding delta wore the
     hedge's label while the same panel named the hedge three more times. The
     steps come from `composedTerms`, the one derivation `publishedNetApy` is
     itself built on, so the ladder can never disagree with the number it ends
     on. */
  const rCore = r(terms.core);
  /* THE FEE COMES BEFORE THE COMPOUND STEP, BECAUSE THAT IS THE ORDER THE
     PUBLISHED NUMBER IS BUILT IN (QNT-R2-1, 2026-09-02).
     -----------------------------------------------------------------------
     The ladder used to run `core → total → published`, where `total` is
     `core + compoundDelta(CORE)` — the PRE-fee compounding, which is not the
     compounding that happens: R1 re-deposits only the depositor's remainder,
     so `published = afterFee + compoundDelta(AFTERFEE)`. Two consequences,
     and they cancelled into a correct endpoint so neither was visible:
       · the auto-compound rung printed the pre-fee lift, ~60-80% larger than
         the lift actually inside the number two rows below it;
       · the fee rung, forced to absorb the difference between the two
         compoundings, printed 22.1% of a market whose schedule says 20%.
     `terms.afterFee` is `core − fee` computed ONCE, by the function that
     applies the fee — this file may not spell `applyComputeFee` itself, and
     `hedge-one-frame.test.ts` holds every reader of the hedge object to that.
     So the fee rung is exactly the schedule's cut of the endpoint printed
     above it, and the compound rung is exactly `published − afterFee`, the
     lift the auto-compound plate hero reads from the same field. `terms.total`
     is no longer read here: it is the venue-frame total, and this ladder ends
     on the product number. */
  const rAfterFee = r(terms.afterFee);
  const material = (a: number | null, b: number | null) =>
    a !== null && b !== null && Math.abs(b - a) >= 0.05 ? b - a : null;

  const levTerm = material(rScan, rLane);
  const hedgeTerm = material(rLane, rCore);
  const feeTerm = material(rCore, rAfterFee);
  const compoundTerm = material(rAfterFee, rComposed);

  /* Each step carries the endpoint it LANDS on, so a rung is always the
     printed value both neighbours are differences of, and the column adds up
     on screen whichever steps are material. A step is material exactly when
     its two 1dp endpoints differ, so dropping an immaterial one cannot break
     the column. */
  const steps: { term: number | null; at: string; rung: string }[] = [
    {
      term: levTerm,
      at: pct(atLane),
      rung: `this market${classClause} at your leverage`,
    },
    {
      term: hedgeTerm,
      at: pct(terms.core),
      rung: `this market at your leverage, unhedged`,
    },
    {
      term: feeTerm,
      at: pct(terms.afterFee),
      rung: "your lane, after the compute fee",
    },
    { term: compoundTerm, at: pct(composed), rung: "" },
  ];
  /* THE EJECTION IS ATTRIBUTED WHENEVER THE COMPOSITION EJECTS THE HEDGE
     (WI-8). Its own step carries the attribution when the pp-term is
     material; below the 0.05 threshold the step would vanish and take the
     fact with it, so the attribution joins the leverage step's label instead. */
  const levLabel =
    hedgeEjected && hedgeTerm === null && levTerm !== null
      ? `your leverage: ${lev(laneLev)} · no hedge installed`
      : `your leverage: ${lev(laneLev)}`;
  const labels = [levLabel, "no hedge installed", "compute fee", "auto-compound"];
  const anyTerm = steps.some((x) => x.term !== null);

  const rows: LadderRow[] = [];
  if (rScan !== null && anyTerm) {
    rows.push({
      n: pct(scanApr),
      /* D-MTX-2: `at its 1.00x` only where a leverage dial exists to be at.
         On the unlevered families the frame word is Discover's — `modeled` —
         in the same slot, welded to the same number. */
      label: levered
        ? `this market${classClause} at its ${lev(scanLev)}`
        : "this market, modeled",
      kind: "end",
    });
  }
  steps.forEach((step, i) => {
    if (step.term === null) return;
    rows.push({ n: pp(step.term / 100), label: labels[i], kind: "term" });
    // A rung only where a FURTHER step follows: the last endpoint is the
    // published number, and it is pushed once below as the closing END row.
    if (steps.slice(i + 1).some((x) => x.term !== null)) {
      rows.push({ n: step.at, label: step.rung, kind: "rung" });
    }
  });
  rows.push({ n: pct(composed), label: "your lane as composed", kind: "end" });
  return rows;
}

/* ══ THE BRIDGE (§4.2) — a lane-level PROVENANCE block ═════════════════════
   Term 2 (the hedge) IS a module delta and is restated verbatim on the add
   key. Term 1 (the leverage move) is NOT a module — no card can carry it —
   which is why the ladder exists at all rather than being split across two
   controls. The aligned decimals ARE the structure: no rules, no zebra, no
   borders between rows. Only the two ENDPOINTS render ink 600; the middle
   rung is a rung, not a value. NO BLUE ANYWHERE IN THIS CARD: its job is
   truth, not action. ══════════════════════════════════════════════════════ */
function Bridge({
  cand,
  scan,
  hasHedge,
  comp,
  forfeit,
  levered,
  repricing,
  blockNumber,
  pair,
}: {
  cand: ProjectedCandidate | null;
  scan: { apr: number | null; lev: number | null } | null;
  hasHedge: boolean;
  /** This lane's family seats `safety-buffer` — see `bridgeLadder`. */
  levered: boolean;
  /**
   * QNT-R2-3 — the collar's companion fact at THIS lane's own dials, or null
   * off the collar family. Derived by `laneCollarForfeit` from the same graph
   * read `Lane.tsx` makes for the lane header 40px away, so the two surfaces
   * print one sentence rather than two paraphrases.
   */
  forfeit: CollarForfeit | null;
  /**
   * THE LANE'S COMPOSITION, AND IT IS NOT OPTIONAL HERE.
   *
   * This card called `composedNetApy(cand, hasHedge)` with no composition, so
   * `compoundDelta` dropped out of its total. Measured on the live kHYPE row:
   * 0.08505010220156918 with the composition against 0.0821238202247191
   * without, 0.293pp apart. The lane header read 9.5% while this card read
   * 9.1%, under the one label that promises the composition is included, and
   * `contributions.ts:178` uses the composed figure as `truth`, so the card
   * disagreed with the ledger printed directly beneath it.
   */
  comp: LaneComposition | null;
  repricing: boolean;
  blockNumber: number | null;
  pair: string;
}) {
  const [open, setOpen] = useState(false);
  const terms = composedTerms(cand, hasHedge, comp);
  /* THE LADDER ENDS ON THE PRODUCT NUMBER (S1, 2026-08-24, ruling R1). It
     ended on `terms.total` — the VENUE frame — under the label `your lane as
     composed`, while the lane header above it prints `terms.published`. Two
     spellings of one quantity, one card apart. The ladder now runs one rung
     further and ends where the header does. */
  const composed = terms?.published ?? null;
  if (composed === null && !repricing) return null;

  const register = blockNumber ? `modeled · block ${blockNumber}` : "modeled";

  if (repricing || terms === null || composed === null) {
    // Fixed height, so nothing below jumps while the quote lands.
    return (
      <div className="dock-readouts cpz-bridge">
        <div className="cpz-bridge-quoting">quoting…</div>
        <div className="dock-ro-register">{register}</div>
      </div>
    );
  }

  const rows = bridgeLadder(cand, scan, hasHedge, terms, levered);

  // Both terms immaterial: one ink row and the register. Never an empty ladder.
  const laddered = rows.length > 1;

  /* MOBILE (§12): on an 812px viewport the 62dvh sheet leaves ~455px of
     scroll against a ~526px budget, which puts the add key ~70px below the
     fold — the founder's question answered off-screen. So on the sheet the
     ladder renders COLLAPSED to its two ENDPOINT rows (the two OWNED numbers)
     and the explanation earns a tap. ONE DOM, CSS-driven: the term and rung
     rows are hidden by the media query, never removed, so desktop reads the
     full ladder with no branch and no second element. */
  return (
    <div className="dock-readouts cpz-bridge" data-open={open ? "true" : "false"}>
      {pair ? (
        <div className="cpz-bridge-h">
          <b>{pair}</b>
          {cand ? <i className="mt-venuechip">{venueLabel(cand.venue)}</i> : null}
        </div>
      ) : null}
      <div className="cpz-ladder">
        {rows.map((row, i) => (
          <div key={`${row.kind}:${i}`} className={`cpz-rung cpz-rung--${row.kind}`}>
            <span className="cpz-rung-n">{row.n}</span>
            <span className="cpz-rung-l">{row.label}</span>
          </div>
        ))}
      </div>
      {/* QNT-R2-3 — THE COLLAR'S CASH FLOW NEVER PRINTS WITHOUT THE UPSIDE IT
          WAS PAID FOR (quant ledger, 2026-08-27). The premium IS the price of
          the upside sold above the strike, so the ledger rules the two print
          together or not at all, on EVERY surface that prints the figure. The
          lane header, the plate, the review sheet, the published card, the
          directory and the record all carried the line; this ladder printed
          the number 40px away from the header and carried nothing, which made
          the dock the one recruiting surface where the omission was live.
          Same quiet register as the capacity line above: a fact beside the
          number, never a warning. */}
      {forfeit ? (
        <div className="dock-lane-cap">{collarForfeitLine(forfeit)}</div>
      ) : null}
      {laddered ? (
        <button
          type="button"
          className="cpz-bridge-more"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide the steps" : "How it gets there"}
          <Chevron className="cpz-bridge-chev" />
        </button>
      ) : null}
      <div className="dock-ro-register">{register}</div>
    </div>
  );
}

/* ══ THE RISK CONTROL (founder ruling 2026-08-22) ══════════════════════════

   WHAT IT REPLACED: a segmented control whose cells were adjectives. The
   founder's objection is that an adjective "can mean anything for each user"
   — and on this product it also means a different POSITION on every market,
   because the ceiling is derived from each venue's own liquidation threshold.
   Measured across the live catalog, one adjective named leverages from 1.75x
   to 2.75x and cushions from 32.7% to 42.9%.

   WHAT IT IS NOW: the same ratified capsule geometry (hairline pills on the
   page ground, active pill solid #2B5CFF — `.rk-risk` / `.rk-riskk.on`,
   untouched), with every cell LABELLED BY THE ADVERSE PAIR MOVE IT SURVIVES.
   That number is exact, derived from the venue's own threshold at the
   leverage the model landed on, and comparable market to market. A depositor
   cannot check "Balanced". They can check "33%".

   AND THE TRADE, BESIDE IT. A risk control showing only risk is half a
   decision. Three absolute modeled APYs on ONE market — never a per-notch
   exchange rate, which the shadow-price panel rejected because one notch is
   15.9pp of distance on one venue and 40.0pp on another. On 7 of 15 live rows
   the rightmost cell carries a LOWER number than the leftmost: less cushion
   and less yield. The control prints that plainly. Hiding it would be the
   adjective's false promise rewritten in digits.

   THREE STATES, AND ONLY THREE:
     · on a stop      — pill lit, caption names the applied leverage
     · off the ladder — capsule renders with NO pill lit, and the caption
                        PREFIXES the actual value, so the user sees their own
                        31% sitting between the 33% and 25% cells. There is no
                        "Custom" cell: a cell that cannot be pressed to any
                        effect is a status light wearing a button's clothes,
                        and with the cushions printed the axis explains an
                        off-ladder position on its own.
     · collapsed      — every stop resolves to one leverage (2 of 15 live
                        rows scan at L0 ≈ 1.05). Three keys with one outcome
                        is not an instrument, so ONE readout renders instead.

   NO MARKET, NO CONTROL. Before a market is pinned there is no threshold, no
   ceiling, no cushion and no APY, so `stops` is empty and this returns null.
   No placeholder number, no greyed dash, no default adjective.
   ═══════════════════════════════════════════════════════════════════════ */
/**
 * ⚠ THE HEAD THAT REPLACED `Distance to liquidation` (D1, law L6).
 *
 * The cells still print `liquidation.adverseMoveValue`, and they should: that
 * quantity is nearly comparable across markets (24.4% to 27.5% at the top stop
 * on 15 rows), which is what makes it the one number able to carry a
 * cross-market label — a depositor cannot check "Balanced", they can check
 * "33%". What was wrong was never the number, it was the HEAD calling it the
 * risk. It is the room the reaction has to work in, and the caption underneath
 * now opens on the reaction and closes on the line.
 *
 * 22 characters, inside the `.mt-sec-h` budget. This string is the aria-label
 * too, so the accessibility tree and the visible head cannot drift.
 */
const ROOM_HEAD = "Room the trim works in";

function RiskStops({
  stops,
  lt,
  preset,
  storedLeverage,
  appliedLeverage,
  laneLabel,
  onSet,
}: {
  stops: LeverageStopView[];
  lt: number | null;
  /** The band derivation's own input. The trim distance is undefined without
   *  it, and a caption that opened on the line needed no such input — which is
   *  how the pre-empting number stayed off this control for so long. */
  preset: RiskPreset;
  storedLeverage: number;
  appliedLeverage: number | null;
  laneLabel: string;
  onSet: (leverage: number) => void;
}) {
  if (stops.length === 0) return null;
  const active = matchStopIndex(stops, storedLeverage);
  /* THE CAPTION IS THE LANE'S ACTUAL POSITION, one derivation for both
     states. On a stop it agrees with the lit cell by construction; off the
     ladder it is the only thing carrying the value, and it sits visibly
     between two cells the user can read.

     ON A STOP IT READS THAT STOP'S OWN CELL, never `appliedLeverage`.
     Measured in the browser 2026-08-22: `appliedLeverage` is the leverage the
     last SETTLED quote priced, so for the ~510ms a reprice is in flight it
     still names the position the user just left. The pill lights instantly,
     so every click spent half a second showing a lit `24%` above a caption
     reading `33% adverse pair move · 2.75x applied` — two different cushions
     on one control, and the caption is the half inside the `aria-live`
     region, so the stale one is also the value a screen reader announced.

     Reading `stops[active]` closes it by construction rather than by timing:
     the cell's label and the caption become the SAME `LiqDistance` from the
     same `laneLeverageStops` call, and no in-flight window can separate two
     readings of one object. Nothing is given up by dropping the applied
     leverage here — `leverageStopLevels` already caps every stop at the row's
     own scan ceiling, so a STOP is never a value `repriceAtLeverage` caps.
     Off the ladder the leverage came from the slider, whose range is NOT
     capped at that ceiling, so the applied value is the honest one there and
     that branch is unchanged. */
  const on = active >= 0 ? stops[active] : null;
  const shown = on ? on.leverage : (appliedLeverage ?? storedLeverage);
  /* ⚠ D1 / LAW L6 (2026-08-22). THE REACTION LEADS THIS CAPTION, and the line
     it defends trails it.

     `deriveHfBands` places the trim at `target − presetSpread` and
     `presetSpread` is strictly positive on all three presets, so the trim
     fires strictly before the liquidation line on every market at every
     setting — by construction, not by measurement. A caption that opened on
     the line was describing a machine with the automations removed: not the
     machine we sell, not the machine we published, not the machine the money
     is in. Both quantities are still here and both still come from
     `liquidation.ts`; only the ORDER changed, and the order was the claim.

     `ppMag(d, 2)` and not `pct(d, 0)`: the drift is a DIFFERENCE of two
     distances, so it is percentage POINTS (R2), and the live drifts run from
     0.04pp to 5.12pp — at 0 dp the smallest of them prints `0%`, which is not
     a rounding, it is the claim that we trim on no move at all. */
  const drift = driftBeforeTrim(preset, shown, lt);
  const caption = [
    typeof drift === "number" ? `trims ${ppMag(drift, 2)} before it` : null,
    adverseMoveLine(on ? on.distance : liquidationDistance(lt, shown)),
    `${lev(shown)} applied`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (stops.length === 1) {
    const only = stops[0];
    const v = adverseMoveValue(only.distance);
    if (v === null) return null;
    return (
      <>
        <div className="mt-sec-h">{ROOM_HEAD}</div>
        <div className="dock-ro-rows">
          <div className="dock-ro-row">
            <span>{`adverse pair move · one leverage priced (${lev(only.leverage)})`}</span>
            <b>{v}</b>
          </div>
        </div>
        <div className="dock-ro-register" style={{ marginTop: 4 }}>
          {caption}
        </div>
      </>
    );
  }

  /* The trade row is WITHHELD WHOLE when any cell is unpriced. Three cells
     with one dash invites a comparison between a number and an absence. */
  const trade = stops.every((s) => s.netApy !== null) ? stops : null;

  return (
    <>
      <div className="mt-sec-h">{ROOM_HEAD}</div>
      {/* THE TRADE SITS INSIDE THE PILL'S OWN COLUMN, not in a grid beside it.

          It shipped as a separate `repeat(n, 1fr) auto` grid spanning the
          panel while the capsule stayed a content-width flex row, so the two
          never resolved the same tracks. Measured in the browser 2026-08-22 at
          a 319px dock: pill centres 1134 / 1199 / 1251 against value centres
          1131 / 1209 / 1287, so the third value sat 36px right of the pill it
          labels — a 47px pill, meaning the number had left its own cell
          entirely and read as belonging to the kicker. An axis that does not
          land under what it labels is not an axis.

          Making both rows one rigid n-column grid was rejected: the columns
          then have to be `minmax(0, 1fr)` for the two to resolve identically,
          which forfeits `.dock-risk`'s `flex-wrap` and clips `no debt` (73px
          of min-content against a 72.7px track at this width, and worse as the
          dock narrows). Nesting each value UNDER its own pill needs no shared
          track at all: alignment is structural, the capsule keeps its ratified
          content-width flex geometry, and it still wraps. The kicker sits
          outside the radiogroup, so the group owns radios and nothing else. */}
      <div className="dock-risk">
        <div className="rk-risk" role="radiogroup" aria-label={`${ROOM_HEAD} on ${laneLabel}`}>
          {stops.map((s, i) => {
            const label = adverseMoveValue(s.distance);
            return (
              <div key={s.leverage} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={i === active}
                  className={`rk-riskk${i === active ? " on" : ""}`}
                  data-key={`lev-${s.leverage}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSet(s.leverage);
                  }}
                >
                  {label ?? lev(s.leverage)}
                </button>
                {trade ? (
                  /* The type register is `.dock-ro-row`'s own, as before; only
                     the layout is the column's. */
                  <span className="dock-ro-row" style={{ display: "block", textAlign: "center" }}>
                    {pct(s.netApy)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {trade ? (
          <span className="dock-ro-row" style={{ display: "block", alignSelf: "flex-end" }}>
            net APY modeled
          </span>
        ) : null}
      </div>
      <div className="dock-ro-register" style={{ marginTop: 4 }} aria-live="polite">
        {caption}
      </div>
    </>
  );
}

/* ══ ONE INSTALLED ROW ═════════════════════════════════════════════════════
   The WHOLE ROW is the tune control — a real <button>, firing focus on the
   module. The word "Tune" never appears: that is the second half of the
   founder's ask ("or tweak the strategy") getting an entry point at zero copy
   cost, and today it has none from the default state.

   REJECTED: the literal `name / number / [Tune] / [Remove]` reading. Four
   modules x two 38px `.hm-key`s is eight dark #0c0a09 plates stacked in a
   328px cream column — a wall of black that breaks one-loud-beat on its own.
   ═══════════════════════════════════════════════════════════════════════ */
function InstalledRow({
  loopId: _loopId,
  moduleKey,
  value,
  removable,
  isNew,
  laneLabel,
  onFocusModule,
  onEject,
  rowRef,
}: {
  loopId: LoopId;
  moduleKey: ModuleKey;
  value: string | null;
  removable: boolean;
  isNew: boolean;
  laneLabel: string;
  onFocusModule: () => void;
  onEject: (origin: DOMRect | null) => void;
  rowRef?: (el: HTMLButtonElement | null) => void;
}) {
  const name = getDef(moduleKey).name;
  return (
    <div className={`cpz-row${isNew ? " is-new" : ""}`} data-module={moduleKey}>
      <button
        type="button"
        className="cpz-row-main"
        onClick={onFocusModule}
        aria-label={`Tune ${name} on ${laneLabel}`}
        ref={rowRef}
      >
        <span className="cpz-row-nm">
          <i className="rail-dot" aria-hidden />
          {name}
        </span>
        {/* title= carries the full string: the value is the column that
            truncates when the row runs out of room (DL-6). */}
        <span className="cpz-row-v" title={value ?? undefined}>
          {value ?? ""}
        </span>
        <Chevron className="cpz-row-chev" />
      </button>
      <span className="cpz-row-x">
        {removable ? (
          <button
            type="button"
            className="rail-notice-x cpz-x"
            aria-label={`Remove ${name} from ${laneLabel}`}
            onClick={(e) => onEject(e.currentTarget.getBoundingClientRect())}
          >
            <CrossGlyph />
          </button>
        ) : (
          /* The reason is STATED, so the missing control never reads as a
             bug. Required modules are NOT greyed: they are not disabled,
             they are tunable — the row above still focuses them. */
          <i className="cpz-req">required</i>
        )}
      </span>
    </div>
  );
}

/* ══ ONE ADD BAY (§3.4) — an EMPTY BAY, not a card ═════════════════════════
   `background:transparent` on a dashed tan border IS the canvas's own
   `.rk-slot` / `.rk-addlane` ghost language, verbatim, because an addable
   module IS a ghost bay.

   REJECTED: dressing addable modules as `.mt-card`. A `.mt-card` is a MARKET.
   Markets and modules must never wear the same costume — that is the whole
   ownership discipline this change exists to install.

   NO ICONS: there is no module iconography in this product, the plates ARE
   the icons, and seven new glyphs would be a second visual language for the
   same seven objects.
   ═══════════════════════════════════════════════════════════════════════ */
function AddBay({
  item,
  cand,
  hedge,
  hasHedge,
  familyWord,
  lit,
  onAdd,
  keyRef,
}: {
  item: ComposeAddable;
  cand: ProjectedCandidate | null;
  /** The lane's hedge economics, or null when there is nothing provable. */
  hedge: HedgeEconomics | null;
  /** Whether the lane runs the short leg. The watcher bay's own fact needs it:
   *  the margin crossing onto the perp venue is a leg of the capital route,
   *  so installing the hedge is what puts a bridge and a hedge venue on the
   *  derived list. */
  hasHedge: boolean;
  /** The committed family's own word, or NULL while the lane is still open. */
  familyWord: string | null;
  lit: boolean;
  onAdd: (origin: DOMRect | null) => void;
  keyRef?: (el: HTMLButtonElement | null) => void;
}) {
  const key = item.key;
  const def = getDef(key);

  /* THE CONSEQUENCE RULE: a number appears only as a TRIPLE, never as a
     floating delta. `+2.2pp` is the claim, `3.0% → 5.2%` is the receipt, and
     neither may be read without the other. A bare `+2.2pp` beside a module
     name is precisely the orphan-number class this workstream kills. */
  /* THE LEVERAGE BAY (design ruling 2026-08-23) reads its own triple off the
     key — `from` the lane with no borrow leg, `to` the landing the press
     seats, both priced in lib on the UNREPRICED row — in the same slot and
     the same form the hedge bay prints its hero pair. Where the market ruled
     the module dominated the bay wears the negative register whether or not
     a triple could be priced: gray dashed, `Add anyway`, ink target. */
  /* ⚠ ONE FRAME ACROSS BOTH BAYS (C6, 2026-08-24). The two triples sit in the
     same slot, in the same shape, and a reader compares them — so both are the
     PRODUCT frame or the shelf is offering a pre-fee gain beside a post-fee
     one. `item.triple` is `leverageBayTriple`, which moved to the product frame
     with the stops family in Wave 1; the hedge's took the bare venue endpoints
     and did not. `hedge.product` is `publishedNetApy` at each endpoint, so
     `to` is what the lane header will read after the press. */
  const triple =
    key === "hedge" && hedge && hedge.material
      ? deltaTriple(hedge.product.withoutApy, hedge.product.withApy)
      : key === "safety-buffer" && item.triple
        ? deltaTriple(item.triple.from, item.triple.to)
        : null;
  const negative = (triple !== null && triple.value < 0) || item.dominated;

  let consequence: React.ReactNode = null;
  if (item.consequence) {
    /* UNBOUND (§4D): what this press COSTS, and nothing else. No number
       appears anywhere on this shelf — nothing is priced before a market, and
       a plate printing a delta here is the orphan-number class the product
       already banned. Non-null only while the lane has chosen nothing, so this
       branch cannot suppress a triple on a lane that has one.

       `data-consequence="would-be"` is the P2-1 marker, added in the wave
       audit 2026-08-22. These lines are the ONE place a family word may appear
       on a blank canvas, because each states what pressing this key WOULD make
       the lane, never what it is. The blank-canvas assertion greps rail, rack
       and dock for `loop`, `leverag*`, `collar`, `delta-neutral` and `range`
       and allows hits only inside this attribute, so without the marker the
       test cannot tell a would-be from a claim and has to be written as a
       hand-kept string allowlist that rots. Do not put it on any other line. */
    consequence = (
      <span className="cpz-fact" data-consequence="would-be">
        {item.consequence}
      </span>
    );
  } else if (triple) {
    consequence = (
      <span className="cpz-triple">
        {triple.delta} modeled · {triple.from} {ARROW}{" "}
        {/* THE ONE BLUE TOKEN IN THE PANEL: ink is what IS, blue is what
            WOULD BE. A negative target keeps ink — a module that would cost
            12.6pp does not get the punctuation colour. */}
        <b className={negative ? undefined : "cpz-target"}>{triple.to}</b>
      </span>
    );
  } else if (item.required && familyWord) {
    consequence = <span className="cpz-fact">required to launch a {familyWord} lane</span>;
  } else if (key === "auto-compound") {
    /* A RULING, not timidity: netApy = L·cy − (L−1)·bo … is a SIMPLE annual
       rate and auto-compound appears nowhere in composedNetApy — the number
       is byte-identical with and without it. Any "+x%" here would be
       fabricated and would re-open the exact trap the rest of this change
       closes. So the panel says so out loud. */
    consequence = <span className="cpz-fact">compounding is not priced into the modeled APY</span>;
  } else if (key === "hedge" && cand) {
    consequence = <span className="cpz-fact">funding does not move the modeled APY here</span>;
  } else if (key === "exogenous-risk" && cand) {
    /* NOT `.cpz-bay--neg`, and not a triple: `QUOTE_AFFECTING_PARAMS` for this
       module is empty, so the press prints no APY delta and takes the panel's
       existing NON-PRICING fact register instead — the same slot
       `required to launch a {familyWord} lane` uses.

       The fact is a PAIR OF INTEGERS that moves per market, which is what a
       fact slot is for: a single-chain unhedged lane derives four parties, a
       hedged cross-chain lane derives six. It is derived on the spot from the
       lane the panel is already holding, so the shelf and the plate cannot
       disagree about the count.

       ⚠ BOTH INTEGERS ARE ABOUT THE ENUMERATION, never about coverage — see
       `shelfCoverage`. The second one is the count that is ABOUT TO RISE in
       the skip bar below, quoted before the press instead of after it. */
    consequence = <span className="cpz-fact">{shelfCoverage(cand, hasHedge)}</span>;
  }

  /* ONE mechanism sentence once a market is pinned. The leverage key's names
     the two rates its sign is made of (`Borrows WHYPE at 3.66% to hold kHYPE
     at 1.97%.`), which is the whole answer to "why does more leverage give
     less", in the place he presses. The hedge's negative line is unchanged. */
  const mech =
    item.mechanism ??
    (negative && key === "hedge"
      ? "This market's funding does not pay for the escrow."
      : mechanismFor(key, cand));

  return (
    <div className={`cpz-bay${negative ? " cpz-bay--neg" : ""}`} data-module={key}>
      <div className="cpz-bay-nm">{def.name}</div>
      <div className="cpz-bay-mech">{mech}</div>
      {consequence ? <div className="cpz-bay-rule" aria-hidden /> : null}
      {consequence ? <div className="cpz-bay-cons">{consequence}</div> : null}
      <div className="hm-keys cpz-bay-keys">
        <button
          type="button"
          className={`hm-key${lit ? " lit" : ""}`}
          data-key={`add-${key}`}
          ref={keyRef}
          onClick={(e) => onAdd(e.currentTarget.getBoundingClientRect())}
        >
          <span className="hm-led" />
          {negative ? "Add anyway" : addLabel(key)}
        </button>
      </div>
      {item.implies.length > 0 ? (
        /* Without this the user presses one button and TWO plates appear. */
        <div className="cpz-bay-chain">
          adds {item.implies.map((k) => MODULE_DEFS[k].name.toLowerCase()).join(" and ")} too
        </div>
      ) : null}
    </div>
  );
}

/* ══ THE SHELF ROW (PO ruling 2026-08-23) — the blank lane's compact bay ═══
   Founder: "only a small list of modules when starting from scratch". Measured
   at the founder viewport (1594×949, dock open): 692px visible, 1355px of
   content, three 156–174px cards above the fold while the canvas ghost bay
   beside them said `6 to choose from`. The set was right; the panel hid it.

   SAME MATERIAL, LESS OF IT. It is still a `.cpz-bay` — dashed, transparent,
   the canvas's own ghost idiom, because an addable module IS a ghost bay —
   with the WHOLE ROW as the add control (the `InstalledRow` precedent: one
   `.cpz-row-main` button, a 24px side column) instead of a 38px key under a
   two-line description. Name, the descriptor's one-line `tagline`, and the
   consequence fact in the slot it already owned. The two-line description is
   not deleted: it sits behind the plate's own `?` (`.hm-help` / `.hm-helppop`,
   the exact affordance `HwPlate` uses for the same text).

   THE BLOCKED KEY IS A ROW, not a count behind a chevron. `Auto-compound ·
   there is nothing to compound yet.` is the seventh row, dimmed through the
   existing `.cpz-bay--neg` register, its refusal in the fact slot, and it
   does not add. Seven rows at ≤72px sit inside the fold; the head above them
   states the same count the ghost bay states.

   INLINE GEOMETRY, NOT A NEW CLASS: this wave holds no stylesheet. Every
   colour, face and weight is an existing token; only the box is set here. ══ */
function ShelfRow({
  row,
  lit,
  laneLabel,
  helpOpen,
  onToggleHelp,
  onAdd,
  keyRef,
  soon,
}: {
  row: ShelfRowModel;
  lit: boolean;
  laneLabel: string;
  helpOpen: boolean;
  onToggleHelp: () => void;
  onAdd: (origin: DOMRect | null) => void;
  keyRef?: (el: HTMLButtonElement | null) => void;
  /** COMING SOON (docs/plans/LATEST_UI_PORT_SPEC.md B.1): the module is on the
   *  shelf to be read, not seated. Outranks `blocked`. */
  soon?: boolean;
}) {
  const def = getDef(row.key);
  const helpId = `shelf-help-${row.key}`;
  if (soon) {
    /* THE SOON ROW. Same material, same geometry, and the press withheld on the
       element that would carry it. The tagline stays (it is what the row is
       for); the value triple and the consequence go, because a number on a
       module that cannot seat is a promise about a lane that cannot exist.
       The tag sits in the fact slot as a direct child of the row, outside the
       dimmed group, and the `?` help stays pressable: the founder wants these
       read. `data-soon-help` on the wrapper, the key and the popover so the
       owner block exempts all three from the dim. */
    return (
      <div
        className="cpz-bay cpz-shelf-row"
        data-module={row.key}
        data-shelf-row="soon"
        data-soon
        aria-disabled="true"
        tabIndex={-1}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr auto 24px",
          alignItems: "center",
          columnGap: 6,
          padding: "8px 8px 8px 12px",
          marginTop: 0,
        }}
      >
        <button
          type="button"
          className="cpz-row-main"
          data-soon-press
          aria-disabled="true"
          tabIndex={-1}
          style={{ display: "block", minHeight: 0, cursor: "default", background: "none" }}
        >
          <span style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span className="cpz-bay-nm" style={{ flex: "0 0 auto" }}>
              {def.name}
            </span>
          </span>
          <span className="cpz-bay-mech" style={{ display: "block", marginTop: 3 }}>
            {row.tagline}
          </span>
        </button>
        <span className="soon-tag" style={{ justifySelf: "end", alignSelf: "start" }}>
          {COMING_SOON.label}
        </span>
        <span className="cpz-row-x" data-soon-help>
          <button
            type="button"
            className="hm-help"
            data-soon-help
            aria-label={`About ${def.name}`}
            aria-expanded={helpOpen}
            aria-controls={helpOpen ? helpId : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onToggleHelp();
            }}
            style={{ marginLeft: 0 }}
          >
            ?
          </button>
        </span>
        {helpOpen ? (
          <div
            className="hm-helppop"
            data-soon-help
            id={helpId}
            role="note"
            onClick={(e) => e.stopPropagation()}
            style={{ top: "calc(100% - 4px)" }}
          >
            {def.description}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div
      className={`cpz-bay cpz-shelf-row${row.addable ? "" : " cpz-bay--neg"}`}
      data-module={row.key}
      data-shelf-row={row.addable ? "addable" : "blocked"}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "1fr 24px",
        alignItems: "center",
        columnGap: 6,
        padding: "8px 8px 8px 12px",
        marginTop: 0,
        opacity: row.addable ? 1 : 0.62,
      }}
    >
      <button
        type="button"
        className={`cpz-row-main${lit ? " lit" : ""}`}
        data-key={row.addable ? `add-${row.key}` : undefined}
        aria-label={row.addable ? `Add ${def.name.toLowerCase()} to ${laneLabel}` : undefined}
        aria-disabled={row.addable ? undefined : true}
        ref={keyRef}
        onClick={(e) => {
          if (!row.addable) return;
          onAdd(e.currentTarget.getBoundingClientRect());
        }}
        style={{
          display: "block",
          minHeight: 0,
          cursor: row.addable ? "pointer" : "default",
          background: "none",
        }}
      >
        <span style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <span className="cpz-bay-nm" style={{ flex: "0 0 auto" }}>
            {def.name}
          </span>
          {row.fact ? (
            /* `data-consequence="would-be"` is the P2-1 marker the blank-canvas
               assertion allows a family word inside: each fact states what
               pressing the key WOULD make the lane, never what it is. The
               refusal sentence on a blocked row is not a would-be and does not
               carry it. */
            <span
              className="cpz-bay-cons"
              data-consequence={row.addable ? "would-be" : undefined}
              style={{ flex: "1 1 auto", minWidth: 0, textAlign: "right", lineHeight: 1.35 }}
            >
              {row.fact}
            </span>
          ) : null}
        </span>
        <span className="cpz-bay-mech" style={{ display: "block", marginTop: 3 }}>
          {row.tagline}
        </span>
      </button>
      <span className="cpz-row-x">
        <button
          type="button"
          className="hm-help"
          aria-label={`About ${def.name}`}
          aria-expanded={helpOpen}
          aria-controls={helpOpen ? helpId : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggleHelp();
          }}
          style={{ marginLeft: 0 }}
        >
          ?
        </button>
      </span>
      {helpOpen ? (
        <div
          className="hm-helppop"
          id={helpId}
          role="note"
          onClick={(e) => e.stopPropagation()}
          style={{ top: "calc(100% - 4px)" }}
        >
          {def.description}
        </div>
      ) : null}
    </div>
  );
}

/* ══ GROUP 3 (§3.5) — THE SKIP REGISTER ════════════════════════════════════
   Shown, not filtered: the founder asked what modules make sense with THIS
   strategy, an empty space answers nothing, and "no perp to hedge with" is
   the single fact that explains why his APY behaves differently market to
   market. Collapsed, it costs nothing when he does not care.

   Nothing in here is styled as clickable, there is no refusal animation, and
   there is no section header: these rows are not errors, and a refusal
   animation on a row you merely READ implies you transgressed by reading it.
   ═══════════════════════════════════════════════════════════════════════ */
function BlockedGroup({
  reasons,
  familyWord,
}: {
  reasons: { key: ModuleKey; code: string; sentence: string }[];
  /** The committed family's own word, or NULL while the lane is still open. */
  familyWord: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (reasons.length === 0) return null;
  const n = reasons.length;
  /* THE BAR BRANCHES ON THE CODES, NOT ON THE FAMILY (§2C S4). "does not fit a
     loop lane" is a true sentence about a foreign module and a FALSE one about
     a module that is merely not available yet — and on a blank canvas the only
     blocked module is `auto-compound`, which fits every family perfectly and
     is waiting for something to compound. That lane read `1 module does not
     fit a loop lane`: the loudest unearned family word on the screen. */
  const misfitOnly = reasons.every((r) => r.code.endsWith("family-mismatch"));
  const bar =
    misfitOnly && familyWord
      ? `${n === 1 ? "1 module does not" : `${n} modules do not`} fit a ${familyWord} lane`
      : `${n === 1 ? "1 module is" : `${n} modules are`} not available yet`;
  return (
    <div className="cpz-skip" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="cpz-skip-bar"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {bar}
        <Chevron className="cpz-skip-chev" />
      </button>
      {open ? (
        <div className="cpz-skip-body">
          {reasons.map((r) => (
            <div key={r.key} className="cpz-skip-row">
              <div className="cpz-skip-nm">
                <i className="rail-dot" aria-hidden />
                {getDef(r.key).name}
              </div>
              {/* The sentence arrives as its own field. It used to be recovered
                  from the name with `reason.split(" — ")`, a parsing contract
                  carried in a delimiter the copy law bans. */}
              <div className="cpz-skip-why">{r.sentence}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── the ONE live value each installed module contributes (§3.3). All of it
      is data already quoted; no new arithmetic, and NEVER a percentage on the
      liquidity source — the pair is already in the bridge head and on the
      plate, and three printings in one column is noise. ── */
function installedValue(
  key: ModuleKey,
  lane: DockLaneView,
  cand: ProjectedCandidate | null,
  /* THE LANE'S COMPOSITION (C6, 2026-08-24). `hedge-econ`'s own contract asks
     every caller holding a LANE to pass it — "omit it only when all you hold
     is an un-repriced catalog row" — and this row held a lane and passed
     nothing. Measured on kHYPE/WHYPE at 2.00x with auto-compound on 24h: this
     row read `pays 5.5pp` while the plate 200px away read `pays 5.6pp`, because
     the product frame's compound step is evaluated at the lane's cadence and a
     caller who passes no composition has no cadence to evaluate it at. */
  comp: LaneComposition | null,
): string | null {
  const node = nodeFor(lane.loop, key);
  const params = node?.data.params ?? {};
  if (key === "liquidity-source") return cand ? venueLabel(cand.venue) : null;
  if (key === "safety-buffer") {
    const L = cand?.economics?.loopLeverage ?? null;
    /* ⚠ ONE OWNER (2026-08-22). This row printed `HF 1.49` beside the
       leverage. A health factor is the VENUE's unit for the same geometry,
       not a depositor's: nobody can check 1.49, and everybody can check 33%.
       The cushion comes from `liquidation.ts`, the same call the lane header,
       the dock readouts and the vault page make, so a row that once read
       `HF 1.49` and a page that read `33% adverse pair move` can no longer be
       two spellings of one fact that drift apart. A quote that cannot derive
       it prints the leverage alone rather than a confident zero. */
    const cushion = adverseMoveShort(liquidationDistance(cand?.lt, L));
    return L === null ? null : [lev(L), cushion].filter(Boolean).join(" · ");
  }
  if (key === "hedge") {
    /* ⚠ SOLE ACCESSOR (model-core wave 2026-08-22). This row used to read the
       raw p25 funding rate off the compile economics block and print it with
       its own verb —
       one of the three independent call sites that produced a screen where
       the same hedge "earned 8.7%" in one place and "cost 7.7%" in another:
       two DIFFERENT quantities (a funding RATE and a net value in POINTS)
       wearing one verb. `hedgeHero` is the plate's own hero string, so this
       row and the plate 200px away are structurally incapable of disagreeing,
       and it returns a mute glyph rather than a number it cannot prove. */
    const h = hedgeEconomics(cand, comp);
    return h ? hedgeHero(h) : null;
  }
  if (key === "auto-compound") return String(params.cadence ?? "24h");
  if (key === "auto-center") return `±${String(params.rangePct ?? "2.5")}%`;
  if (key === "covered-call") return `+${String(params.strikePct ?? "15")}%`;
  if (key === "protective-put") return `${MINUS}${String(params.floorPct ?? "12")}%`;
  return null;
}

/* ══ THE RISK REGISTER, IN THE DOCK — THE SAME TABLE (rework 2026-09-02) ════
   THIS IS THE SURFACE THE FOUNDER PASTED, and the first pass fixed the other
   one. Two proofs it was this panel: his paste carries
   `Funding on HYPE turning negative · 10.9%`, an entry a published record can
   never reach (`laneInputForVault` writes `borrowApyMarginal: NaN`, so the
   row is dropped and `pre-emption.test.ts` pins that it is); and his rows run
   the why-sentence and the reaction together on ONE line —
   `The exit crosses the kHYPE market on Morpho Blue · HyperEVM. 33.3%` —
   which is `RegisterEntryRow`'s `.dk-comp-d` and nothing else. The vault page
   put the reaction in its own cell.

   SO BOTH RENDERERS TAKE THE SAME TYPED TABLE. They had already diverged in
   shape, which is what happens when a model offers one prose field and each
   component invents its own layout: the dock concatenated `why` and the
   reaction into one Fraunces-italic line while the page used a five-cell grid.
   `riskTableForLane` is the canvas twin of `riskTableForVault`, so the fix
   lives in the row model and neither component lays it out its own way.

   THE DOCK IS THE TRANSPOSED CASE BY DEFAULT. The panel is ~380px, so the
   response never gets a column of its own: it takes line two, carrying its own
   head as a label. That is the same rule the vault page applies at 390 — and
   it is the fix for the defect the review found there, where the response
   VALUE rendered under a collapsed header as a nameless right-aligned number.

   WHAT LEAVES THIS PANEL, and each is retired by the table rather than hidden:
     · the skip bar. A blind spot behind a chevron is a blind spot a depositor
       never sees, and the two rows inside it were the two most honest rows in
       the register. Every reading state is now in the open, in one column.
     · the comma-joined counterparty row. One row per CLASS, each with its own
       coverage state, so `clear` can no longer cover a class nothing reads —
       and the ~130-character space-joined action cell that starved the layout
       goes with it.
     · the as-of rows. One stamp, in the product's `modeled · block n` grammar.

   ⚠ THE VERDICT BLOCK STAYS, pinned by
   `lib/canvas/__tests__/liquidation-verdict-wiring.test.ts` — see the same
   note on `AutomationsSection`. The legacy `registerFor` call survives for one
   number: the reaction tally the bridge sentence prints. ── */

/** The heads. The dock prints two and labels the third on its own line. */
const DK_COL_MECHANISM = "Mechanism";
const DK_COL_READING = "Reading";
const DK_COL_RESPONSE = "Written response";

/** The response count, said once in the footer. The cell itself is EMPTY where
 *  a mechanism has no written rule: `none written` per row is thirteen
 *  identical strings down one column on a hedged loop, which is the same
 *  chrome the register's own wall gate bans in the other direction. */
const DK_RESPONSES_NOUN = "written responses";

/** The one coverage state that inverts to ink. */
const DK_FAILING = "failing";

/** THE AS-OF, PER ROW, DROPPED AGAINST THE CARD'S OWN STAMP. `readingStamp`
 *  emits `modeled · block 41,563,811`; printing it on every row would wall one
 *  block number down the panel, so it prints only where it says something the
 *  footer does not — a modeled figure among read ones, or a row read at
 *  another block. */
function dkStamp(row: RiskRow, footerAsOf: string | null): string | null {
  const s = readingStamp(row);
  return s === null || s === footerAsOf ? null : s;
}

function RiskTableRow({ row, footerAsOf }: { row: RiskRow; footerAsOf: string | null }) {
  const rd = row.reading;
  const r = row.response;
  const has = rd.state === "measured" || rd.state === "stated";
  const stamp = dkStamp(row, footerAsOf);
  return (
    <tr className="dk-brk-row" role="row">
      <td className="dk-brk-mech" role="cell">
        {row.mechanism}
        {row.consequence ? <span className="dk-brk-cl">{row.consequence}</span> : null}
      </td>
      <td className="dk-brk-read" role="cell" data-state={rd.state} data-h={DK_COL_READING}>
        {has ? (
          <>
            {row.coverage === DK_FAILING ? (
              <span className="dk-brk-fail">{rd.value}</span>
            ) : (
              <span className="dk-brk-val">{rd.value}</span>
            )}
            {rd.denominator ? <span className="dk-brk-den">{rd.denominator}</span> : null}
          </>
        ) : rd.state === "unmeasured" ? (
          <>
            <span className="dk-brk-abs">{RISK_NOT_MEASURED}</span>
            {rd.denominator ? <span className="dk-brk-den">{rd.denominator}</span> : null}
          </>
        ) : (
          <span className="dk-brk-abs">{rd.denominator}</span>
        )}
        {stamp ? <span className="dk-brk-stamp">{stamp}</span> : null}
      </td>
      <td className={`dk-brk-act${r ? "" : " dk-brk-act--none"}`} role="cell" data-h={DK_COL_RESPONSE}>
        {r ? (
          <>
            <span className="dk-brk-trig">{r.trigger}</span>
            {r.cadence ? <em>{r.cadence}</em> : null}
          </>
        ) : null}
      </td>
    </tr>
  );
}

/* ── ONE ABSENCE, ONCE, AT GROUP LEVEL ─────────────────────────────────────
   Non-null only where every row of a group is an unmeasured reading that named
   its own quantity AND the surface can say where the reading IS taken. That is
   a record surface today; the dock passes no `absenceElsewhere`, so nothing
   folds here and every row states its own absence exactly as before. The
   renderer is present so the two surfaces cannot drift the day it does. ── */
function SectionAbsenceRow({ absence }: { absence: RiskSectionAbsence }) {
  return (
    <tr className="dk-brk-row" role="row">
      <td className="dk-brk-mech" role="cell">
        {absence.mechanism}
      </td>
      <td className="dk-brk-read" role="cell" data-state="unmeasured" data-h={DK_COL_READING}>
        <span className="dk-brk-abs">{RISK_NOT_MEASURED}</span>
        <span className="dk-brk-den">{absence.denominator}</span>
      </td>
      <td className="dk-brk-act dk-brk-act--none" role="cell" data-h={DK_COL_RESPONSE} />
    </tr>
  );
}

/** ONE ROUTE SENTENCE PER PARTY, over the classes that belong to it. It used
 *  to print per class, which is how one sentence came to appear three times
 *  under three comma-joined names. */
function partyRuns(rows: readonly RiskRow[]): { party: RiskParty | null; rows: RiskRow[] }[] {
  const out: { party: RiskParty | null; rows: RiskRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    /* ⚠ BOTH SIDES NORMALISED TO null. `last.party?.id` is `undefined` on a
       run with no party and `r.party?.id ?? null` is `null`, so the raw
       comparison was false on EVERY partyless row: each row became its own
       run, and every run in a section then carried the section's id as its
       key. React reported four duplicate keys per record. */
    const id = r.party?.id ?? null;
    if (last && (last.party?.id ?? null) === id) {
      last.rows.push(r);
      continue;
    }
    out.push({ party: r.party, rows: [r] });
  }
  return out;
}

/* ══ THE LIQUIDATION VERDICT (L9) ══════════════════════════════════════════
   `What can be closed`, the register's preamble and never a fourth readout.

   IT IS ITS OWN SECTION AT REGISTER ALTITUDE, immediately above the register's
   own head, and it renders from INSIDE `RegisterBlock` so it is adjacent to
   the rows that carry the levels. That adjacency is the whole hand-off now:
   the bridge sentence that used to print the register's `defeats: "reaction"`
   tally is retired (re-review #4), because it reprinted the headline's cushion
   a third time and counted a total no column on the screen marks. This block
   takes no count from the register any more, and no argument at all.

   IT RENDERS IFF THE POSITION HOLDS A LEG TO CLAIM (G7 major, 2026-09-02).
   `none` — no borrow, no short — used to render one sentence here, on the
   reasoning that a section a reader meets on one composition and not on
   another teaches that its absence means something. On the two published
   records that reach it, that sentence was the THIRD statement of an absence
   the table already carries twice with denominators, so `liquidationVerdict`
   returns null there and this block does not render. The gate is unchanged:
   `verdict ? … : null`, and nothing else.

   ⚠ THE TWO ROWS ARE GONE (parent ruling, 2026-09-02). This block printed
   `Short margin ratio · 33.3%` and `Short's own liquidation · not measured` as
   `.dock-ro-row`s, while the register table below printed the same two facts
   as `short-margin` and `short-line` — each with a denominator, a field path
   and an as-of, and `short-line` with the value DERIVED from the record's
   published margin ladder. Two printings of one number, one of them wrong.

   ⚠ AND THE HEADLINE WENT THE SAME WAY (re-review #4, 2026-09-02). It read
   `This liquidates if kHYPE loses 24% against WHYPE. We trim 4.24pp before
   that.` and the bridge under it read `Three things could reach 24% before the
   trim does.`, sixteen lines above `Deposit liquidation line · 24%` and `Trim
   fires · 4.24pp`. Two quantities, each twice, one screenshot. The producer
   composes the block from ONE FIGURE-FREE CLAIM PER LEG now, so this component
   renders at most two sentences and the bridge element is gone with the
   sentence.

   THE SEAM: the verdict says WHICH LEGS CAN BE CLOSED, in words; the table
   says AT WHAT LEVEL. No reading is printed here at all, which is what makes
   a contradiction structurally impossible rather than merely unlikely. ── */
function VerdictBlock({ verdict }: { verdict: LiquidationVerdict }) {
  return (
    <div className="cpz-verdict" style={{ marginBottom: 10 }}>
      <div className="cpz-verdict-h">{verdict.headline}</div>
      {/* UPRIGHT, NOT THE FRAUNCES ITALIC. `.dk-comp-d` is the panel's
          explain-line register and the verdict is not an explanation of the
          thing above it — it is the first claim of the block. Two type
          registers stacked on one card is what made the dock read as prose. */}
      {verdict.note ? <div className="dk-brk-note">{verdict.note}</div> : null}
    </div>
  );
}

function RegisterBlock({ input }: { input: RegisterInput }) {
  const entries = registerFor(input);
  // Nothing priced means nothing can be defeated. No heading, no ghost.
  if (entries.length === 0) return null;
  /* Computed AFTER the empty gate on purpose. A blank lane holds no leg, so
     `liquidationVerdict` returns null there on its own now — but the ordering
     stays, because the register's gate is the one that decides whether this
     card exists at all and a claim rendered above a card that does not is a
     claim about a vault that does not exist. */
  const verdict = liquidationVerdict(input.lane);

  /* THE TABLE. One call, off the SAME `RegisterInput` the legacy register
     reads, so the family, the block, the arming state and the exogenous
     placement ternary all keep the single owner they already had. */
  const table = riskTableForRegisterInput(input);
  if (!table || table.sections.length === 0) return null;
  const foot = table.footer;
  const gaps = Math.max(0, foot.readable - foot.measured);
  const responses = table.sections.reduce(
    (n, g) => n + g.rows.filter((r) => r.response !== null).length,
    0,
  );
  /* Both counts, once each. They replace the skip drawer and the `none
     written` wall, and neither renders at zero. */
  const counts = [
    gaps > 0 ? `${gaps} reading${gaps === 1 ? "" : "s"} not taken` : "",
    responses > 0 ? `${responses} ${DK_RESPONSES_NOUN}` : "",
  ].filter((x) => x.length > 0);

  return (
    <>
      {verdict ? (
        <>
          <div className="mt-sec-h">{VERDICT_TITLE}</div>
          <VerdictBlock verdict={verdict} />
        </>
      ) : null}
      <div className="mt-sec-h">{REGISTER_TITLE}</div>
      {/* THE ARMING STATE AS THE TABLE'S CAPTION. It is what makes the head
          `Written response` honest on a product where watchers detect and
          actuation is roadmap, and a caption governs the heads beneath it in a
          way one amber row among nine never could. */}
      {table.arming ? (
        <div className="dk-brk-cap" role="status">
          <i aria-hidden />
          <span>{table.arming.label}</span>
          <b>{table.arming.value}</b>
          <em>{table.arming.note}</em>
        </div>
      ) : null}
      <table className="dk-brk" role="table">
        <thead>
          <tr className="dk-brk-hrow" role="row">
            <th role="columnheader" scope="col">
              {DK_COL_MECHANISM}
            </th>
            <th role="columnheader" scope="col">
              {DK_COL_READING}
            </th>
          </tr>
        </thead>
        <tbody>
          {table.sections.map((sec) => (
            <Fragment key={sec.section}>
              <tr className="dk-brk-grprow" role="row">
                <th className="dk-brk-grp" colSpan={2} scope="colgroup" role="columnheader">
                  {sec.heading}
                </th>
              </tr>
              {/* The rows the fold left standing, then the group's ONE absence
                  line. `sec.shown` is the model's own answer to what a renderer
                  walks, so this component decides nothing about which rows an
                  absence covers. */}
              {partyRuns(sec.shown).map((run) => (
                <Fragment key={`run:${run.party?.id ?? sec.section}`}>
                  {run.party ? (
                    <tr className="dk-brk-partyrow" role="row">
                      <th className="dk-brk-party" colSpan={2} scope="colgroup" role="columnheader">
                        <b>{run.party.label}</b>
                        <span>{run.party.because}</span>
                      </th>
                    </tr>
                  ) : null}
                  {run.rows.map((r) => (
                    <RiskTableRow key={r.id} row={r} footerAsOf={foot.asOf} />
                  ))}
                </Fragment>
              ))}
              {sec.absence ? <SectionAbsenceRow absence={sec.absence} /> : null}
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="dk-brk-foot">
        <span>{counts.join(" · ")}</span>
        <span className="dk-brk-asof">{foot.asOf ?? foot.asOfNote}</span>
      </div>
      {foot.unwatched ? <div className="dk-brk-unwatched">{foot.unwatched}</div> : null}
    </>
  );
}

/* ══ THE RECLAIM READOUT (P0-E, law L10) ═══════════════════════════════════
   Removing a control converts a question into a claim, and the claim has a
   price: the verdict, the setting with its objective, the runner-up with its
   signed cost, and the first defeat entry. It is a READOUT — not prose, not a
   disclosure, not a modal — and it renders in the vacated space in the same
   `.dock-ro-row` register the control used.

   IT RENDERS NOTHING WHEN IT CANNOT PROVE ITSELF. `reclaim` returns null when
   its stated cost does not equal the cost the pricing path produces, and null
   here means the CONTROL comes back, never that the space goes silent.

   ⚠ AND IT NEEDS THE UNREPRICED SCAN ROW — see `scanRowFor` on the props. ── */
/**
 * THE COUNTERFACTUAL LANE — the domain the reclaim's sweep has to be entered
 * on, and the second half of the seam `scanRowFor` opens (audit fix,
 * 2026-08-22).
 *
 * ⚠ THE TWO GATES WERE MUTUALLY EXCLUSIVE, SO THE READOUT WAS UNREACHABLE.
 * This block renders exactly where the module is ABSENT, and `rendersOn`
 * refuses a param control whose module is not in `lane.placed` — so
 * `controlRemoved` was false on every lane that reaches here, `reclaim`
 * returned null on every market, and P0-E's whole deliverable was dark behind
 * a unit test that only ever measured lanes with the module installed.
 *
 * The question the block answers is a COUNTERFACTUAL — "what would this dial
 * have done here, and what did the runner-up cost?" — so its domain is the
 * lane WITH the module. It is built through `addModule`, the same owner a
 * hand-install from the shelf goes through, so the seated defaults are the
 * ones a builder would actually get rather than a second spelling of them,
 * and `pricingParamsFor` prices it exactly as `mockQuote` would.
 *
 * The lane the readout DESCRIBES is still the shipped one: `reclaim` reads its
 * verdict row and its defeat row off the winning setting's lane, so a
 * counterfactual entered at a levered default never publishes a borrow leg the
 * record does not carry.
 */
function reclaimInputFor(
  portfolio: PortfolioGraph,
  loopId: LoopId,
  scanRow: ProjectedCandidate,
  base: RegisterInput,
): RegisterInput | null {
  const loop = addModule(portfolio, loopId, "safety-buffer").loops.find((l) => l.id === loopId);
  if (!loop) return null;
  const comp = pricingParamsFor(loop);
  return {
    ...base,
    lane: {
      candidate: scanRow,
      placed: loop.nodes.map((n) => n.data.defKey),
      params: Object.fromEntries(
        loop.nodes.map((n) => [n.data.defKey, n.data.params]),
      ) as AxisLane["params"],
      comp,
      appliedLeverage: comp.targetLeverage,
      preset: comp.riskPreset,
      tvlUsd: DOCK_TVL_USD,
    },
  };
}

function ReclaimBlock({
  input,
  control,
  held,
}: {
  input: RegisterInput;
  control: Control;
  /** The setting the lane HOLDS, when the module is installed: rows 2 and 3
   *  re-point at it (`reclaimHeld`). Absent, the block is the counterfactual
   *  `reclaim` renders where the module is not on the lane. */
  held?: number;
}) {
  const r = typeof held === "number" ? reclaimHeld(control, input, held) : reclaim(control, input);
  if (!r) return null;
  return (
    <>
      <div className="mt-sec-h">{RECLAIM_HEAD}</div>
      <div className="dock-ro-rows">
        {r.rows.map((row) => (
          <div key={row.label} className="dock-ro-row">
            <span>{row.label}</span>
            <b>{row.value}</b>
          </div>
        ))}
      </div>
    </>
  );
}

/** It may never contain the bare word "optimised", any "we have chosen the
 *  best settings for you", any risk adjective, any reassurance, any
 *  completeness claim, or any explanation that risk exists. Naming the
 *  arithmetic is the whole of the head's job. */
const RECLAIM_HEAD = "What the model set, and what it cost";

/**
 * The size the action-count axis is evaluated at.
 *
 * ⚠ HANDOFF, and it is a second owner until it lands: `modules.ts:116` holds
 * `REFERENCE_TVL_USD = 25_000` PRIVATELY, and `__tests__/fixture-lanes.ts`
 * already re-types it as `FIXTURE_TVL_USD` for the same reason. One export
 * from `modules.ts` collapses all three. It is not in this pass's allowlist,
 * so the constant is named here and the duplicate is stated rather than
 * hidden. Nothing this panel renders currently reads it — the loop register
 * takes no action count — so a drift would be inert today and loud the moment
 * the compound firing count reaches a register entry.
 */
const DOCK_TVL_USD = 25_000;

export interface ComposePanelProps {
  lanes: DockLaneView[];
  scopeLoopId: LoopId | null;
  /** The last lane compose WAS scoped to, remembered by the dock across this
   *  panel's remounts. Stands in for `scopeLoopId` at mount when the dock is
   *  unscoped, so re-entering compose never snaps back to Lane 1. */
  lastScopedLoopId?: LoopId | null;
  portfolio: PortfolioGraph;
  portfolioApy: number | null;
  vaultCapacityUsd: number | null;
  /** The ghost add-a-lane is offered only when every lane is launch-shaped. */
  showAddLane: boolean;
  onFocusModule: (loopId: LoopId, key: ModuleKey) => void;
  onFocusOrchestrator: () => void;
  /** One leverage stop, written straight to the safety-buffer param. */
  onSetLeverage: (loopId: LoopId, leverage: number) => void;
  onAddModule: (loopId: LoopId, key: ModuleKey, origin: DOMRect | null) => void;
  onEjectModule: (loopId: LoopId, key: ModuleKey, origin: DOMRect | null) => void;
  onInstallDefaults: (loopId: LoopId) => void;
  onSwap: (loopId: LoopId) => void;
  onRemoveLoop: (loopId: LoopId) => void;
  onAddLane: () => void;
  /**
   * ⚠ FRAME M, AND THE ONE SEAM THIS PANEL CANNOT CLOSE ON ITS OWN.
   *
   * The UNREPRICED scan row behind a lane — `catalogRow(oppData, candidateId)`
   * in `RackCanvas`, which is the only place that document is in hand. The
   * dominance sweep MUST be entered from it: `repriceAtLeverage` caps at the
   * row's own `economics.loopLeverage`, so repricing an already-repriced row
   * makes that lane's current leverage the ceiling and every setting above it
   * collapses onto it — the sweep then reports a real trade as a tie, silently
   * and in the depositor's favour.
   *
   * `lane.reprice.candidate` is that already-repriced row, which is why this
   * panel may not simply use what it already holds. Until `RackCanvas` threads
   * this in, the reclaim readout renders NOTHING, which is the correct failure:
   * a block that cannot prove its own arithmetic prints nothing and the
   * control comes back.
   */
  scanRowFor?: (loopId: LoopId) => ProjectedCandidate | null;
}

export default function ComposePanel(props: ComposePanelProps) {
  const { lanes, scopeLoopId, portfolio } = props;
  const multi = lanes.length >= 2;
  const orchOn = portfolio.orchestrator.enabled && lanes.length >= 2;

  /* THE ACCORDION IS THE TARGETING MECHANISM: every add key lives inside a
     named lane card and inherits that card's loopId. No dropdown, no "active
     lane". REJECTED: a flat module list with a lane selector — a mis-set
     selector silently installs a hedge on the WRONG lane and moves the
     portfolio number with no visible cause, the exact class of confusion this
     workstream exists to kill. */
  /* `lastScopedLoopId` AHEAD OF `lanes[0]`: falling back to the first lane on
     an unscoped mount is how "I can only see lane 1" reached the dock. It is
     still only a fallback — a mount that carries a scope uses the scope. */
  const [expanded, setExpanded] = useState<LoopId | null>(
    scopeLoopId ?? props.lastScopedLoopId ?? lanes[0]?.loop.id ?? null,
  );
  useEffect(() => {
    if (scopeLoopId) setExpanded(scopeLoopId);
  }, [scopeLoopId]);
  const openLane = multi ? (expanded ?? lanes[0]?.loop.id ?? null) : (lanes[0]?.loop.id ?? null);

  /* SCROLL THE SCOPED CARD INTO VIEW — but only when it is not already fully
     visible, because the dock's own doctrine is that a scope move is not a new
     screen and must not yank the reader to the top. Measured before this
     landed, in a 670px `.dock-scroll` with `scrollTop` pinned at 0: Lane 1's
     card starts at 120px, Lane 2's at 281px and Lane 3's at 441px — so
     selecting Lane 3 showed the user Lane 1, then Lane 2, then 229px of the
     lane they actually asked for. */
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!scopeLoopId) return;
    const el = cardRefs.current[scopeLoopId];
    const box = el?.closest<HTMLElement>(".dock-scroll");
    if (!el || !box) return;
    const top = el.offsetTop - box.offsetTop;
    const visible = top >= box.scrollTop && top + el.offsetHeight <= box.scrollTop + box.clientHeight;
    if (visible) return;
    box.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
  }, [scopeLoopId, openLane]);

  /* JUST-ADDED / JUST-REMOVED (§5.5): one beat, 600ms, no new loop. */
  const [justChanged, setJustChanged] = useState<{ loopId: LoopId; key: ModuleKey; dir: 1 | -1 } | null>(null);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteChange = useCallback((loopId: LoopId, key: ModuleKey, dir: 1 | -1) => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
    setJustChanged({ loopId, key, dir });
    changeTimer.current = setTimeout(() => setJustChanged(null), 600);
  }, []);
  useEffect(() => () => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
  }, []);

  /* FOCUS AFTER AN ADD → the newly created Installed row, so the next Enter
     TUNES the thing just added. Never auto-focus the module panel: that swaps
     the whole dock out from under a user mid-read.
     FOCUS AFTER A REMOVE → the addable bay that just appeared. Symmetric, and
     it puts undo one keystroke away. */
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const bayRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pendingFocus = useRef<{ kind: "row" | "bay"; id: string } | null>(null);
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    const el = p.kind === "row" ? rowRefs.current[p.id] : bayRefs.current[p.id];
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  });

  const [announce, setAnnounce] = useState("");
  /** THE ONE OPEN HELP on the blank-lane shelf, `${loopId}:${key}`. */
  const [shelfHelp, setShelfHelp] = useState<string | null>(null);

  /* §3.7 — HOLD THE LAST GOOD CANDIDATE (kept from the capacity work).
     Clicking an add or eject control mutates the lane graph, which triggers a
     re-quote, which sets `lane.repricing`. Gating this block on a live
     `reprice.ok` would delete the bay the user just clicked out from under
     their finger and reappear it ~400ms later. Stale for 400ms is fine; the
     numbers are labeled modeled. The held candidate is scoped to the lane's
     CURRENT market, so a swap never shows the previous market's numbers. */
  const heldRef = useRef<Record<string, { id: string; cand: ProjectedCandidate }>>({});
  const laneCards = lanes.map((lane) => {
    const loopId = lane.loop.id;
    const ok = lane.reprice?.ok === true ? lane.reprice : null;
    const src = nodeFor(lane.loop, "liquidity-source");
    const pair = String(src?.data.params.pairLabel ?? "");
    const candidateId = String(src?.data.params.candidateId ?? "");
    const hasHedge = !!nodeFor(lane.loop, "hedge");
    const live = ok?.candidate ?? null;
    if (live) heldRef.current[loopId] = { id: candidateId, cand: live };
    const held = heldRef.current[loopId];
    const cand: ProjectedCandidate | null =
      live ?? (held?.id === candidateId ? held.cand : null);
    /* THE MARKET BEHIND THE LANE reaches the shelf (design ruling 2026-08-23):
       the UNREPRICED row for the leverage bay's triple, the lane's composition
       so that triple prices the lane as composed, and the sign of the market
       so a dominated key is never `required` here while the rack already
       knows it is not. Before this the shelf ran `addableModules(loop)` with
       no market at all, and printed `required to launch a loop lane` on a bay
       the lane demonstrably launches without. */
    const pricing = pricingParamsFor(lane.loop);
    const scanRow = props.scanRowFor?.(loopId) ?? null;
    const opts = composeOptionsFor(lane.loop, cand, {
      scanRow,
      comp: pricing,
      preset: pricing.riskPreset,
    });
    return { lane, loopId, ok, pair, hasHedge, cand, opts, pricing, scanRow };
  });

  return (
    <div className="dock-compose" onClick={(e) => e.stopPropagation()}>
      {/* ONE aria-live region on the panel root, never per card. Spelled-out
          percent: screen readers mangle U+2192 and "pp". The header receipt
          must NOT also be live or the change is announced twice. */}
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      {/* §3.2.1 — NO portfolio strip at one lane: the header hero already
          prints that number 40px away. */}
      {multi ? (
        <div className="cpz-pf">
          <span className="cpz-pf-k">Your portfolio</span>
          <b>{pct(props.portfolioApy)}</b>
          {props.vaultCapacityUsd !== null ? (
            <span className="cpz-pf-cap">{fmtCapacityUsd(props.vaultCapacityUsd)} capacity</span>
          ) : null}
        </div>
      ) : null}

      {/* §3.2.2 — the router AUTO-INSTALLS (the user never chooses it), so it
          appears in INVENTORY, never under Add. No LED: it is not a key. */}
      {orchOn ? (
        <div className="cpz-inv cpz-inv--router">
          <div className="cpz-row">
            <button type="button" className="cpz-row-main" onClick={props.onFocusOrchestrator}>
              <span className="cpz-row-nm">
                <i className="rail-dot" aria-hidden />
                Capital router
              </span>
              <span className="cpz-row-v">{`governs ${lanes.length} lane${lanes.length === 1 ? "" : "s"}`}</span>
              <Chevron className="cpz-row-chev" />
            </button>
            <span className="cpz-row-x" />
          </div>
        </div>
      ) : null}

      {laneCards.map(({ lane, loopId, ok, pair, hasHedge, cand, opts, pricing, scanRow }, laneIndex) => {
        const open = openLane === loopId;
        /* THE ONE ACCESSOR. `bound` is null while the lane has chosen nothing,
           and every family word below gates on it. Nothing in this component
           reads `laneFamily()` any more: that derivation is TOTAL, so on a
           blank lane it answered "loop" and this panel printed it three
           times — the required line, the skip bar and the collapsed dot row. */
        const bound = opts.bound;
        /* The STRATEGY word outranks the family word where the lane has
           committed to one (funding launch rail, ruling 2): a funding lane is
           bound to the loop FAMILY, and "required to launch a loop lane"
           beside a hedge that finishes a funding carry named the wrong
           product. On every other lane the two words coincide. */
        const familyWord = opts.boundStrategy
          ? STRATEGY_LABEL[opts.boundStrategy]
          : bound
            ? FAMILY_LABEL[bound]
            : null;
        /* ONE hedge object per lane, read once and threaded. Never a second
           call site, and never a raw `economics` read below this line.
           THE COMPOSITION IS PASSED (C6, 2026-08-24): `cand` is the lane's
           REPRICED candidate and `pricing` is the composition it was repriced
           at, so this is the same object the plate builds — same f_b, same
           compound cadence, same product frame. Passing nothing left the bay's
           triple and the eject announcement 0.1pp away from the plate hero on
           any lane running auto-compound. */
        const hedge = hedgeEconomics(cand, pricing);
        /* ── THE LANE, AS THE LAW READS IT (P0-B's `AxisLane`) ─────────────
           One construction, threaded to both the register and the reclaim, so
           the two cannot describe different lanes. Every field comes from an
           owner: the composition from `pricingParamsFor` (the same object
           `mockQuote` prices with), the leverage from the MODEL rather than
           the dial, and the preset from the composition's own field. */
        const preset = pricing.riskPreset;
        const axisLane: AxisLane = {
          candidate: cand,
          placed: lane.loop.nodes.map((n) => n.data.defKey),
          params: Object.fromEntries(
            lane.loop.nodes.map((n) => [n.data.defKey, n.data.params]),
          ) as AxisLane["params"],
          comp: pricing,
          appliedLeverage: lane.appliedLeverage ?? lane.storedLeverage,
          preset,
          tvlUsd: DOCK_TVL_USD,
        };
        const registerInput: RegisterInput = {
          lane: axisLane,
          blockNumber: ok?.blockNumber ?? null,
          /* No rail runs a canvas lane: `compile.ts` writes `railsReady:
             false` unconditionally, and a surface claiming otherwise would be
             claiming a deployment that does not exist. */
          railsReady: false,
          /* The canvas holds the compound cadence and nothing else. The trim
             and the margin cadences are PUBLISHED quantities and live on the
             record, so the vault page states them and this one does not
             invent them. A null cadence prints the trigger alone. */
          cadence: { compound: String(pricing.compound?.cadence ?? "") || null },
        };
        /* ⚠ The sweep is entered from the UNREPRICED row or not at all —
           `scanRow` above, from `scanRowFor`. */
        const notch = notchMove(cand, hasHedge, pricing);
        /* THE PRODUCT NUMBER (S1, 2026-08-24, R1): this is announced to a
           screen reader as the lane's modeled APY, so it is the number the
           lane header prints, not the venue fact behind it. */
        const composed = publishedNetApy(cand, hasHedge, pricing);
        /* The lane's composition, passed — the same `pricing` the register's
           capacity axis and `vaultCapacity` read, so the three print one
           number for one lane. */
        const laneCap = laneCapacityUsd(cand, hasHedge, pricing);
        const missingRequired = opts.addable.filter((a) => a.required);
        const spineIncomplete = !!nodeFor(lane.loop, "liquidity-source") && missingRequired.length > 0;
        /* ONE LIT KEY IN THE PANEL, EVER. Install defaults when the spine is
           incomplete; else a REQUIRED-but-missing module; else none. A
           positive-value optional module NEVER lights its key — it is a
           standing offer, not an alarm. */
        const installDefaultsLit = spineIncomplete && bound === "loop";
        /* GATED ON BOUND (§2D O6). On a blank canvas this lit the source key
           in the dock while the rack pulsed ghost bay 01: two blue beats for
           one idea on the calmest screen in the product. One lit key on screen,
           ever — and before the lane has chosen, the board carries the beat. */
        const litAddKey =
          installDefaultsLit || !bound ? null : (missingRequired[0]?.key ?? null);

        const body = (
          <>
            {installDefaultsLit ? (
              <div className="hm-keys cpz-defaults">
                <button
                  type="button"
                  className="hm-key lit"
                  data-key="install-defaults"
                  onClick={() => props.onInstallDefaults(loopId)}
                >
                  <span className="hm-led" />
                  Install defaults
                </button>
              </div>
            ) : null}

            {/* §4.4 — capacity belongs to the LANE (shipped 2026-08-22), and
                it reads the REPRICED candidate, so a leverage move updates
                it. Preserved verbatim from the capacity work. */}
            {laneCap !== null ? (
              <div className="dock-lane-cap">
                <b>{fmtCapacityUsd(laneCap)}</b> capacity · {capacityBindingLabel(cand, hasHedge)}
              </div>
            ) : null}
            {/* ⚠ ONE OWNER (2026-08-22). This printed a CATEGORY —
                "leverage is yield-negative in this market today" — which
                states the sign of a derivative, says nothing about its size,
                and carries the word `today` that `tips.ts` bans from every
                string it asserts over. `notchMove` prices the dial's own step
                and is the same call the lane header makes, so the two cannot
                drift. Amber belongs to a cost; a notch that ADDS is not a
                warning and does not wear one. */}
            {notch ? (
              <span className={notch.costs ? "rk-riskline" : "dock-lane-cap"}>{notch.text}</span>
            ) : null}

            <Bridge
              cand={cand}
              scan={lane.scan}
              hasHedge={hasHedge}
              comp={pricing}
              forfeit={laneCollarForfeit(lane.loop)}
              /* THE FAMILY FACT, THROUGH `opts` (the compose-options gate):
                 the committed family's own chain, which is what says whether
                 this lane has a leverage dial at all. */
              levered={opts.chain.includes("safety-buffer")}
              repricing={lane.repricing}
              blockNumber={ok?.blockNumber ?? null}
              pair={pair}
            />

            {/* The reclaim readout sits where the control would have been,
                so a builder reading top to bottom meets the answer in the
                slot the question used to occupy. */}
            {(() => {
              if (!scanRow || nodeFor(lane.loop, "safety-buffer")) return null;
              const input = reclaimInputFor(portfolio, loopId, scanRow, registerInput);
              return input ? (
                <ReclaimBlock
                  input={input}
                  control={{ kind: "param", module: "safety-buffer", field: "targetLeverage" }}
                />
              ) : null;
            })()}

            <RiskStops
              stops={lane.stops}
              lt={lane.lt}
              preset={preset}
              storedLeverage={lane.storedLeverage}
              appliedLeverage={lane.appliedLeverage}
              laneLabel={lane.loop.label}
              onSet={(leverage) => props.onSetLeverage(loopId, leverage)}
            />

            {/* THE READOUT STAYS WHILE THE MODULE IS HELD (design ruling
                2026-08-23). It used to return null the moment the plate
                seated — `if (!scanRow || nodeFor(lane.loop, "safety-buffer"))`
                above — so the one sentence that explains the corner vanished
                exactly when he was staring at the dial. Under the capsule,
                re-pointed at the position the lane holds: `Corner · no debt ·
                the highest modeled net APY here` / `You hold · 2.00x · 1.2pp
                less · 42% adverse pair move`. On a trading row `reclaimHeld`
                returns null and nothing renders; the notch line is the trade. */}
            {(() => {
              if (!scanRow || !nodeFor(lane.loop, "safety-buffer")) return null;
              const input: RegisterInput = {
                ...registerInput,
                lane: { ...axisLane, candidate: scanRow, appliedLeverage: pricing.targetLeverage },
              };
              return (
                <ReclaimBlock
                  input={input}
                  control={{ kind: "param", module: "safety-buffer", field: "targetLeverage" }}
                  held={pricing.targetLeverage}
                />
              );
            })()}

            {/* SUPPRESSED WHOLE WHEN EMPTY (§2D O5). On a blank lane this
                rendered the header, an empty bordered `.cpz-inv` box and the
                hint `Tap a module to tune it.` above nothing at all — the
                largest single blank-canvas defect in the panel, and the fix is
                a deletion. The addable group already ruled "never an empty
                bordered box"; the same rule applies here. */}
            {opts.installed.length > 0 ? (
              <>
                <div className="mt-sec-h">Installed</div>
                <div className="cpz-inv">
                  {opts.installed.map((m) => {
                    const isNew =
                      justChanged?.dir === 1 &&
                      justChanged.loopId === loopId &&
                      justChanged.key === m.key;
                    return (
                      <InstalledRow
                        key={m.key}
                        loopId={loopId}
                        moduleKey={m.key}
                        laneLabel={lane.loop.label}
                        value={installedValue(m.key, lane, cand, pricing)}
                        removable={m.removable}
                        isNew={isNew}
                        onFocusModule={() => props.onFocusModule(loopId, m.key)}
                        onEject={(origin) => {
                          const name = getDef(m.key).name;
                          /* ONE FEE FRAME ACROSS THE ARROW, AND THE FRAME IS
                             THE OBJECT'S (C6, 2026-08-24). This spelled
                             `applyComputeFee` on both ends, which made this
                             component a second owner of R1's ordering beside
                             `RackCanvas.composedPair` — and it dropped the
                             compound step, so the `before` it announced was not
                             the `composed` the same block prints for every
                             other module. `hedge.product` is `publishedNetApy`
                             at each endpoint, so both branches now speak the
                             one number the header carries. */
                          const before =
                            m.key === "hedge" && hedge ? hedge.product.withApy : composed;
                          const after =
                            m.key === "hedge" && hedge ? hedge.product.withoutApy : before;
                          props.onEjectModule(loopId, m.key, origin);
                          noteChange(loopId, m.key, -1);
                          pendingFocus.current = { kind: "bay", id: `${loopId}:${m.key}` };
                          setAnnounce(
                            after !== null && before !== null && after !== before
                              ? `${name} removed. Modeled ${(before * 100).toFixed(1)} percent to ${(after * 100).toFixed(1)} percent.`
                              : `${name} removed.`,
                          );
                        }}
                        rowRef={(el) => {
                          rowRefs.current[`${loopId}:${m.key}`] = el;
                        }}
                      />
                    );
                  })}
                </div>
                <div className="mt-status cpz-hint">Tap a module to tune it.</div>
              </>
            ) : null}

            {/* §7C. `Add to this lane` presumes a lane that already does
                something. Before the lane has chosen, the shelf is not an
                addendum: it IS the question, and the header asks it — and
                (PO ruling 2026-08-23) states the count the canvas ghost bay
                states, so the two surfaces agree at first glance.

                W2-C3 (2026-08-24): that count is `shelfCountLabel`, the one
                owner, which counts the rows this shelf actually renders below
                — `1 source, 6 modules, 4 strategies` over seven rows, with
                the liquidity source named as a source instead of being
                counted as a module. `shelfHead(opts)` still owns the title. */}
            {bound ? (
              <div className="mt-sec-h">Add to this lane</div>
            ) : (
              (() => {
                const head = shelfHead(opts);
                const count = shelfCountLabel(opts);
                return (
                  <div className="mt-sec-h" data-shelf-head>
                    {head.title}
                    <span className="cpz-fact" style={{ fontStyle: "normal", fontSize: 11 }}>
                      · {count}
                    </span>
                  </div>
                );
              })()
            )}
            {!bound ? (
              /* THE COMPACT SHELF (PO ruling 2026-08-23): every addable key
                 and every blocked key, as rows, all inside the fold. One
                 container, so the lane's 13px gap applies once and the rows
                 sit 8px apart. */
              <div className="cpz-shelf" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* LIVE FIRST (docs/plans/LATEST_UI_PORT_SPEC.md 2.4): the rows this
                  build seats, in their live order, then every other row in its
                  live order under the soon register. Coming soon outranks
                  blocked: the hedge on an N1 market reads the tag, not the
                  refusal. */}
              {(() => {
                const rows = shelfRows(opts);
                return [...rows.filter((r) => isLiveModule(r.key)), ...rows.filter((r) => !isLiveModule(r.key))];
              })().map((row) => (
                <ShelfRow
                  key={row.key}
                  row={row}
                  soon={!isLiveModule(row.key)}
                  lit={litAddKey === row.key}
                  laneLabel={lane.loop.label}
                  helpOpen={shelfHelp === `${loopId}:${row.key}`}
                  onToggleHelp={() =>
                    setShelfHelp((h) => (h === `${loopId}:${row.key}` ? null : `${loopId}:${row.key}`))
                  }
                  onAdd={(origin) => {
                    const name = getDef(row.key).name;
                    props.onAddModule(loopId, row.key, origin);
                    noteChange(loopId, row.key, 1);
                    pendingFocus.current = { kind: "row", id: `${loopId}:${row.key}` };
                    setAnnounce(`${name} added.`);
                  }}
                  keyRef={(el) => {
                    bayRefs.current[`${loopId}:${row.key}`] = el;
                  }}
                />
              ))}
              </div>
            ) : (() => {
              /* THE BOUND SHELF, SCOPED. Live addable modules keep their bays;
                 every coming-soon key (addable or blocked) is one soon row
                 after them, in its live order. */
              const liveAddable = opts.addable.filter((a) => isLiveModule(a.key));
              const soonRows: ShelfRowModel[] = [
                ...opts.addable.filter((a) => !isLiveModule(a.key)),
                ...opts.blocked.filter((b) => !isLiveModule(b.key)),
              ].map((m) => ({ key: m.key, tagline: MODULE_DEFS[m.key].tagline, fact: null, addable: false }));
              const soonList =
                soonRows.length > 0 ? (
                  <div className="cpz-shelf" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {soonRows.map((row) => (
                      <ShelfRow
                        key={row.key}
                        row={row}
                        soon
                        lit={false}
                        laneLabel={lane.loop.label}
                        helpOpen={shelfHelp === `${loopId}:${row.key}`}
                        onToggleHelp={() =>
                          setShelfHelp((h) => (h === `${loopId}:${row.key}` ? null : `${loopId}:${row.key}`))
                        }
                        onAdd={() => {}}
                      />
                    ))}
                  </div>
                ) : null;
              if (liveAddable.length === 0) {
                return soonList ?? (
                  /* Never an empty bordered box. */
                  <div className="mt-status cpz-full">This lane holds every module its family runs.</div>
                );
              }
              return (
                <>
                  {liveAddable.map((item) => (
                <AddBay
                  key={item.key}
                  item={item}
                  cand={cand}
                  hedge={hedge}
                  hasHedge={hasHedge}
                  familyWord={familyWord}
                  lit={litAddKey === item.key}
                  onAdd={(origin) => {
                    const name = getDef(item.key).name;
                    props.onAddModule(loopId, item.key, origin);
                    noteChange(loopId, item.key, 1);
                    pendingFocus.current = { kind: "row", id: `${loopId}:${item.key}` };
                    /* The announcement is the bay's own triple, spoken. Same
                       frame, same call, same two endpoints (C6). */
                    const t =
                      item.key === "hedge" && hedge && hedge.material
                        ? deltaTriple(hedge.product.withoutApy, hedge.product.withApy)
                        : null;
                    setAnnounce(
                      t
                        ? `${name} added. Modeled ${t.from.replace("%", "")} percent to ${t.to.replace("%", "")} percent.`
                        : `${name} added.`,
                    );
                  }}
                  keyRef={(el) => {
                    bayRefs.current[`${loopId}:${item.key}`] = el;
                  }}
                />
                  ))}
                  {soonList}
                </>
              );
            })()}

            {/* §5.5 step 6 — the register opens beneath the composition, in
                the same rows the cascade uses on the vault page. */}
            <RegisterBlock input={registerInput} />

            {/* Unbound, the blocked keys are already ROWS on the shelf above;
                a second listing behind a bar would count them twice. */}
            {bound ? (
              <BlockedGroup
                reasons={opts.blocked.filter((b) => isLiveModule(b.key)).map((b) => ({
                  key: b.key,
                  code: b.code,
                  sentence: b.sentence,
                }))}
                familyWord={familyWord}
              />
            ) : null}

            {/* §7C. The shelf answers what the vault DOES; the market is the
                other half of the same question, and on an open lane the two
                are one sentence with a section break in it. */}
            {bound ? null : <div className="mt-sec-h">And the market it runs on</div>}

            <div className="hm-keys cpz-acts">
              {/* The catalog is never orphaned. */}
              <button
                type="button"
                className="hm-key"
                data-key="browse-markets"
                onClick={() => props.onSwap(loopId)}
              >
                <span className="hm-led" />
                Browse markets
              </button>
              {lanes.length > 1 ? (
                <button
                  type="button"
                  className="hm-key pc-eject"
                  data-key="remove-lane"
                  onClick={() => props.onRemoveLoop(loopId)}
                >
                  <span className="hm-led" />
                  Remove lane
                </button>
              ) : null}
            </div>
          </>
        );

        if (!multi) {
          /* SINGLE LANE: no wrapper, no chevron, no accordion chrome. The
             dock body IS the lane and its name lives in the head kicker. A
             collapse control for a set of one is chrome pretending there is
             a choice. */
          return (
            <section key={loopId} className="cpz-lane" data-single="true">
              {body}
            </section>
          );
        }

        return (
          <section
            key={loopId}
            ref={(n) => {
              cardRefs.current[loopId] = n;
            }}
            className="cpz-lane"
            data-expanded={open ? "true" : "false"}
            style={{ ["--i" as string]: laneIndex }}
          >
            <button
              type="button"
              className="cpz-lane-head"
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : loopId)}
            >
              <b>{lane.loop.label}</b>
              <span className="cpz-lane-apy">{pct(lane.netApy)}</span>
              <Chevron className="cpz-lane-chev" />
            </button>
            {open ? (
              body
            ) : opts.chain.length > 0 ? (
              /* Collapsed summary is the existing checklist DOT ROW, not
                 module chips: four chips at 328px wrap to three lines and
                 invent a fifth token shape.

                 IT READS THE COMMITTED CHAIN (§2D O7). It read
                 `FAMILY_CHAINS[laneFamily]`, so in a multi-lane portfolio a
                 lane that had chosen nothing printed the loop chain — four
                 `todo` dots naming a strategy nobody picked. `opts.chain` is
                 the committed family's chain when bound, and ONLY the placed
                 modules while open, which is why an empty one renders nothing
                 rather than an empty row. */
              <div className="dock-checklist cpz-dots">
                {opts.chain.map((k) => (
                  <div key={k} className={`rail-step ${nodeFor(lane.loop, k) ? "done" : "todo"}`}>
                    <span className="rail-dot" />
                    {getDef(k).name}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}

      {props.showAddLane && DEMO_SCOPE.liveStrategies.length === 1 ? (
        /* COMING SOON: a second lane is the capital router. Same ghost, the
           press withheld, the tag under the label (the canvas ghost's twin). */
        <div
          className="cpz-addlane"
          data-soon
          aria-disabled="true"
          tabIndex={-1}
          style={{ flexDirection: "column", gap: 6, height: "auto", minHeight: 48, padding: "10px 0" }}
        >
          <button
            type="button"
            data-soon-press
            aria-disabled="true"
            tabIndex={-1}
            style={{
              font: "inherit",
              letterSpacing: "inherit",
              textTransform: "inherit",
              color: "inherit",
              background: "none",
              border: 0,
              padding: 0,
              cursor: "default",
            }}
          >
            ＋ Add a lane
          </button>
          <span className="soon-tag">{COMING_SOON.label}</span>
        </div>
      ) : props.showAddLane ? (
        <button type="button" className="cpz-addlane" onClick={props.onAddLane}>
          ＋ Add a lane
        </button>
      ) : null}
    </div>
  );
}
