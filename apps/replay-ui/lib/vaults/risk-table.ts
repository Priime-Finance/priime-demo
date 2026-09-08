/**
 * THE RISK TABLE, FOR A PUBLISHED RECORD — the one call a vault page makes.
 *
 * ══ WHY THIS FILE AND NOT `store.ts` ═══════════════════════════════════════
 *
 * `lib/canvas/risk-table.ts` owns the SHAPE and every row helper; it is pure
 * canvas and knows nothing about a record. This file is the adapter: it turns
 * one `VaultRecord` into the inputs those helpers take, and it is the only
 * place that decides which producer a family runs. Four families, one return
 * type, so the render layer branches on data and never on a strategy name.
 *
 * ══ THE THREE THINGS THE PROJECTION CANNOT CARRY ═══════════════════════════
 *
 * `laneInputForVault` is the one author of what a lane IS, and it deliberately
 * drops three published dials on the floor because no lane-side reader needed
 * them: the delta band, the margin ladder edges, and the vault's own held TVL.
 * All three are decision-relevant here — the band is residual directional
 * exposure, the ladder edges RECOVER the coin's maintenance margin (and with
 * it the short's own liquidation, which shipped as `not measured` on records
 * where it is exactly derivable), and the held TVL is what turns a gross
 * capacity into the room a depositor actually has left.
 *
 * They travel as `published`, on the input, rather than by widening the
 * projection: a record's own fields reaching the table without the lane having
 * to pretend to be a canvas.
 */

import {
  assembleRiskTable,
  counterpartyRows,
  fundingRiskRows,
  laneModeled,
  laneRiskRows,
  NO_BLOCK_NOTE,
  type RiskFamily,
  type RiskRow,
  type RiskTable,
} from "@/lib/canvas/risk-table";
import { dependenciesOf } from "@/lib/canvas/exogenous";
import { isModeledBinding } from "@/lib/canvas/capacity";
import { fundingRiskInputFor } from "./funding-register";
import {
  deleverageDrift,
  exogenousInputForVault,
  placedKeysOf,
  railsArmed,
  registerInputForVault,
  type VaultRecord,
} from "./store";

/**
 * WHAT A PUBLISHED RECORD DOES NOT CARRY — ONE SENTENCE, EVERY FAMILY.
 *
 * Supplied HERE because only this adapter knows what a record is not.
 * `store.ts` `laneInputForVault` writes `fundingP25Apr` and
 * `borrowApyMarginal` as NaN on purpose, so a published record can never
 * measure them and the whole Yield group comes back unmeasured. Three rows
 * each confessing that separately, over a footer already counting them, is one
 * absence stated four times; this is the sentence that says it once, and every
 * producer that can state the same absence in a ROW takes the same string, so
 * a row and the fold above it cannot spell one state two ways.
 *
 * ══ ⚠ IT USED TO POINT AT THE CANVAS, AND THAT WAS FALSE ON A RECORD ═══════
 * It read `measured on the canvas, absent from this record`, on the reasoning
 * that the dock two clicks away shows the same three rows with figures. That
 * holds on a SCANNED row and not on a hand-authored one: the canvas twin of
 * `aerodrome-rangekeeper` (`template:dn-lp:aerodrome-base:weth-usdc`) answers
 * `Funding on ETH · not measured` itself — measured, not assumed. So the
 * moment the fold reached the dn-LP record the sentence became a claim about
 * another surface that that surface does not honour.
 *
 * The pointer is retired rather than made conditional. Two spellings of one
 * absence, chosen by whether a record happens to pin a block, is the defect
 * this ruling closes, not a fix for it — and what the reader needs is what
 * this record does not carry, which is what it now says.
 *
 * The canvas passes nothing and takes its own record-free default: a builder
 * composing a lane has published nothing, so `on this record` was a noun
 * leaking from one surface onto the other.
 */
const ABSENT_FROM_THIS_RECORD = "not published on this record";

/** The record's own family word, mapped onto the table's. Read off the record
 *  and never off the projected candidate: `handAuthoredTerms` only knows the
 *  two template rows, so a projection answers "loop" for every published
 *  vault — which is how a delta-neutral LP once rendered a pair gap and a
 *  lending freeze on a position that borrows nothing. */
export function riskFamilyOf(v: VaultRecord): RiskFamily {
  if (v.strategy === "funding") return "funding";
  if (v.strategy === "dnlp") return "dnlp";
  if (v.strategy === "collar") return "collar";
  /* A TREASURY LANE DOES NOT BORROW, so it must never fall through to the loop
     register. `RiskFamily` has carried "treasury" since WP-2 and no branch
     could return it, which is the exact failure this function's docblock
     already names about the delta-neutral LP: a register rendering a pair gap
     and a lending freeze on a position that borrows nothing. */
  if (v.strategy === "treasury") return "treasury";
  return "loop";
}

/**
 * THE TABLE. Null only where the record carries no automations at all, which
 * is a record that has not been published rather than one with nothing to say.
 */
export function riskTableForVault(v: VaultRecord): RiskTable | null {
  const family = riskFamilyOf(v);
  const armed = railsArmed(v);
  const parties = counterpartyRowsFor(v);
  const partiesAreRows = parties.length > 0;

  if (family === "funding") {
    const input = fundingRiskInputFor(v);
    if (!input) return null;
    /* ONE SPELLING OF THE ABSENCE, ROW AND FOLD ALIKE. The same string reaches
       the producer and `assembleRiskTable`, so a row that states its own
       absence and a group that folds several cannot say it two ways — which is
       exactly what shipped: `lower-quartile APR, not published on this record`
       on the funding and dn-LP records, `measured on the canvas, absent from
       this record` on the hedged loop records, for ONE unpublished dial. */
    return assembleRiskTable([...fundingRiskRows({ ...input, absenceElsewhere: ABSENT_FROM_THIS_RECORD }), ...parties], {
      family,
      armed,
      partiesAreRows,
      /* VERIFIED ON ALL THREE FUNDING SEEDS: `buildFundingSeed` writes no
         `blockNumber` and no `chainId`. The absence is stated rather than left
         blank — a record that says nothing about its vintage is not the same
         object as one whose vintage the reader has not been shown. */
      asOfNote: NO_BLOCK_NOTE,
      modeled: isModeledBinding(v.capacityBinding),
      absenceElsewhere: ABSENT_FROM_THIS_RECORD,
    });
  }

  const laneInput = registerInputForVault(v);
  if (!laneInput) return null;
  const a = v.automations;
  const rows = laneRiskRows({
    lane: laneInput.lane,
    family,
    blockNumber: laneInput.blockNumber,
    armed,
    cadence: { leverage: a?.leverage?.cadence ?? null, hedge: a?.hedge?.cadence ?? null },
    /* THE RECORD'S OWN DRIFT, never the preset's re-derivation over unrounded
       bands: `steady-eth-loop` prints 3.65pp everywhere on its page and the
       preset path answers 3.66pp for the same quantity. Three states, the
       record reader's own — a number is the owner's, `null` means the record
       cannot prove one and no trim row renders. */
    trimDrift: a?.leverage ? deleverageDrift(a.leverage) : null,
    absenceElsewhere: ABSENT_FROM_THIS_RECORD,
    published: {
      deltaBandPct: a?.hedge?.deltaBandPct ?? null,
      marginTrimBelowPct: a?.hedge?.marginTrimBelowPct ?? null,
      marginRestorePct: a?.hedge?.marginRestorePct ?? null,
      fundingDeallocPeriods: a?.hedge?.fundingDeallocPeriods ?? null,
      heldUsd: typeof v.baseTvlUsd === "number" ? v.baseTvlUsd : null,
    },
  });
  return assembleRiskTable([...rows, ...parties], {
    family,
    armed,
    partiesAreRows,
    modeled: laneModeled(laneInput.lane) || isModeledBinding(v.capacityBinding),
    absenceElsewhere: ABSENT_FROM_THIS_RECORD,
  });
}

/**
 * The counterparty rows, or none.
 *
 * Exclusive, exactly as the register's own branch is: a record carrying the
 * overlay states its parties one row per CLASS, and a record without it takes
 * the footer's one product-level line. Never both, and never neither — silence
 * where a coverage claim was just made reads to a depositor exactly like
 * coverage.
 */
function counterpartyRowsFor(v: VaultRecord): RiskRow[] {
  if (!placedKeysOf(v).includes("exogenous-risk")) return [];
  const input = exogenousInputForVault(v);
  if (!input) return [];
  return counterpartyRows(dependenciesOf(input.lane), input.blockNumber);
}
