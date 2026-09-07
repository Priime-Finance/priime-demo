"use client";

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * DiscoverPanel (IT4_DOCK_SPEC §3, mockup register 2026-08-20) — the market
 * catalog in the 360px context dock. The dock lists ALL scanned
 * opportunities as-is: no economics floor, no launchability fences, no
 * stale-scan wall-of-warnings. Hedged and unhedged stay separate sections
 * (ECON-M) and each card carries its class as a simple informational tag.
 * Every row is pickable; one serif status line carries the register.
 *
 * CAPACITY_SPEC §2 (2026-08-22): a market that cannot absorb one minimum
 * deposit is not pickable, but it is not hidden either — the highest headline
 * in the whole catalog is un-investable, and deleting it silently makes the
 * product unfalsifiable. Failing rows are DEMOTED into one collapsed
 * "Not accepting deposits" group at the bottom of the panel, drained of the
 * blue pickable register, keeping the meta rhythm with a three-word reason in
 * place of the capacity string. No amber, no dashed borders, no warning
 * icons: this is an absence, not a warning.
 *
 * ══ RECETTE ITEM 7 (2026-08-22) — THE CARD QUOTES WHAT THE LANE LANDS ON ══
 *
 * The catalog could not be shopped. Every card printed `headlineApr`, the
 * market at ITS OWN MAXIMUM leverage, while `installDefaults` builds the lane
 * at the dial's own default — 0.8 of the house ceiling. On live data those are two
 * different machines, and on six of the twenty-three priced rows they do not
 * even agree on the SIGN: five Aave ETH pairs and one Dolomite pair advertise
 * a loss (cbETH/WETH −0.1%, wstETH/WETH −0.6%, WBERA/sWBERA −2.3%) and build
 * a gain (+1.7%, +1.4%, +2.2%). A shopper reading the catalog picks against
 * their own interest, and nothing on the screen tells them why.
 *
 * So the card now prints `composedNetApy(repriceAtLeverage(row, landingL))`,
 * routed through `mockQuote` — the SAME function the lane's own quote comes
 * out of — at the SAME default leverage. Card APY and lane APY are one number,
 * and `card-lane-parity.test.ts` asserts it over every fixture row rather than
 * over the 23 that happened to be live when this was written. That older claim
 * was true when it was made and silently stopped being true: see the warning on
 * `landingTarget` below.
 *
 * WHAT THE CARD DOES NOT DO: it does not quote the market at its best. The
 * ranking does (`bestApy`, derived once in `unified-list`), because ranking is
 * a question about the market and pricing is a question about the vault. And
 * the landing is the dial's DEFAULT, never its ceiling: quoting at the ceiling
 * to make the numbers larger is the same defect wearing a different leverage.
 *
 * THREE GROUPS, not two. `acceptsDeposits` was already the gate for one dead
 * group; `isNeverPositive` now feeds a second, "Modeled below zero", in the
 * same three-word grammar and the same drained register. Its members are the
 * rows the model scores negative at EVERY reachable leverage — there is no
 * dial position that builds them, so they are an absence, not an option.
 *
 * ══ FIVE GROUPS (2026-08-23) — AND THE LIST STOPPED DELETING ══════════════
 *
 * Two more absences arrived with the funding venue, and one of them was
 * already live on production with no funding venue deployed.
 *
 *  · "Nothing to hold" — a measured perp book with no registered spot leg.
 *    Twenty of the twenty-four funding books have none, four of them print the
 *    IDENTICAL administered ceiling, and a market with no deposit asset has no
 *    APY at all, so the headline is BLANK rather than demoted.
 *  · "Not measured yet" — a shortlisted row the scan could not price. The
 *    `priced` filter used to delete these outright, and its own comment
 *    justified that by a shape (`loopLeverage: 0`) that no longer exists in
 *    the payload: the three Dolomite rows it removes today come back with
 *    `economics: null`. The whole justification for scanning 1,151 markets is
 *    to be honest about what is not there.
 *
 * NOTHING LEAVES THE LIST NOW. Every scanned row renders in exactly one place,
 * and the routing has one owner (`discoverAbsence`) which the fixture sweep
 * checks for conservation.
 *
 * ══ P0-7 (2026-08-22) — THE CATALOG WAS THE DEAD END, NOT THE MODULE LIST ══
 *
 * Three of the four products could not be built by hand, and the cause was
 * here: this panel listed `buildUnifiedList` and nothing else, while the two
 * hand-authored markets lived in `TEMPLATE_CANDIDATES`, reachable only by
 * exact id from a `?template=` link. A lane that pressed `Auto center` or
 * `Covered call` could pin nothing that would price — every row on the screen
 * came back `market-family-mismatch`, blanked the APY and closed the publish
 * gate. Offering a market a lane cannot price is the same defect as offering
 * a module that cannot reach a publishable vault.
 *
 * So the panel now renders what the LANE can price, in two registers that are
 * never mixed:
 *
 *  · the live scan sections, unchanged, shown while `loop` survives — every
 *    scan row is a supply/borrow market and the loop family is the only thing
 *    that can price one;
 *  · the MODELED group (`modeledRows`), one row per family the lane can still
 *    be, below the scan rows and above the two dead groups. Below, because
 *    these rows are not launchable and actionability outranks everything in
 *    this list; a modeled 11.8% must never sit above a live market.
 *
 * The lane's families arrive as a prop when the caller knows them and fall
 * back to what THIS panel can prove from the pin it already holds. The
 * fallback never guesses a default: an unpinned lane is offered every modeled
 * row, which is the blank lane's own ruling read as a catalog.
 */

import { useMemo, useState } from "react";
import {
  type CanvasVenueId,
  selectionState,
  VENUE_LABELS,
} from "@/lib/canvas/opportunities";
import {
  capacityBindingLabel,
  capacityBindingSentence,
  isModeledBinding,
  fmtCapacityUsd,
  laneCapacityUsd,
} from "@/lib/canvas/capacity";
import {
  buildUnifiedList,
  discoverAbsence,
  dualLeverageLine,
  modeledRows,
  seatedLeverage,
  type ClassFilter,
  type ModeledRow,
  type UnifiedRow,
} from "@/lib/canvas/unified-list";
import { COMING_SOON, isLiveMarket, isLiveVenue } from "@/lib/demo-scope";
import { CATALOG_COMPOSITION, composedNetApy, mockQuote } from "@/lib/canvas/mock-quote";
import { getDef } from "@/lib/canvas/modules";
import { FAMILY_LABEL, laneFamilies, type LaneFamily } from "@/lib/canvas/graph-ops";
import {
  COLLAR_DEFAULT_DIALS,
  collarForfeit,
  collarForfeitLine,
  familiesForCandidateId,
} from "@/lib/canvas/templates";
import { carry, lev, pct } from "@/lib/canvas/format";
import {
  fundingEscrowLine,
  fundingLegChips,
  fundingRevenueLine,
  isFundingRow,
} from "@/lib/canvas/funding-card";
import type { ModuleKey, ParamValue } from "@/lib/canvas/types";
import type { DiscoverReason } from "@/lib/canvas/dock-state";
import type { OpportunitiesPayload } from "../types";

const VENUE_ORDER: CanvasVenueId[] = [
  "morpho-blue-hyperevm",
  "morpho-blue-base",
  "morpho-blue-ethereum",
  "aave-v3-base",
  "hyperliquid-funding",
  "dolomite-berachain",
];

/**
 * The leverage a pick will land on, mirroring RackCanvas step for step:
 *
 *   onSelectMarket → setLeverage(landingLeverage(lt, preset, scan L0))
 *                  → dispatch param, clamped by the safety-buffer descriptor
 *   mockQuote      → clampLeverage(target, lt, preset)
 *   repriceAtLeverage → min(applied, scan L0)
 *
 * The last two steps are NOT repeated here: `mockQuote` performs them, and it
 * owns the `lt` fallback a row without a liquidation threshold gets. Repeating
 * either would put a second copy of the lane's arithmetic in a component,
 * which is the failure mode this whole wave exists to close.
 *
 * ⚠ THE HANDOFF THIS FILE CARRIED IS CLOSED (2026-08-22). The card used to
 * quote at one named stop, and the docblock here admitted the lane's actual
 * stop was unreachable — so a lane parked lower was quoted higher in
 * the catalog. With the adjectives gone there is one landing per market, from
 * one owner, and the card and the lane call it with the same arguments. The
 * scan's own L0 is passed now (A4): storing a leverage above the leverage that
 * repriced is exactly the defect A4 named.
 */
/**
 * THE LEVERAGE THE LANE WILL ACTUALLY BUILD (2026-08-23).
 *
 * ⚠ THIS FUNCTION AND THE GHOST-BAY RULING LANDED THE SAME DAY AND DID NOT
 * KNOW ABOUT EACH OTHER. `landingTarget` was written when the leverage module
 * was always installed, so the landing stop was always reachable. The ghost-bay
 * ruling then made the rack WITHHOLD that module wherever its slope is
 * non-positive, and `pricingParamsFor` prices a loop lane with no
 * `safety-buffer` at `PRODUCT_MIN_LEVERAGE`. The card kept quoting the landing
 * stop the lane refuses to install.
 *
 * Measured over the committed fixtures: the card and the lane disagreed on
 * 17 of 31 rows, worst gap 43.84pp. Every launchable row read 0.00pp, which is
 * why it went unseen. On the BTC row this wave admits it FLIPPED THE SIGN:
 * the card read −0.0% at 2.00x while the lane read +2.1% with no borrow leg,
 * which is the catalog advising against its own product.
 *
 * THE PREDICATE IS THE RACK'S OWN, not a proxy for it. `bestAtFloor` looks
 * like the answer and is not: `card-lane-parity.test.ts` case 3 finds rows
 * (weETH/WETH@e7) where the rack withholds the control while `bestAtFloor` is
 * false, so keying off it would leave the card quoting an unreachable leverage
 * on exactly those rows. `leverageModuleInstalls` is the function the rack
 * itself calls, and `pricingParamsFor` prices a loop lane with no
 * `safety-buffer` at `PRODUCT_MIN_LEVERAGE`. One predicate, both surfaces.
 *
 * ⚠ THE FUNCTION MOVED TO `unified-list.ts` (2026-08-24, THE PICKER'S TWO
 * NUMBERS). It was a component-local derivation of the leverage the LANE will
 * build at, and the dual-number rule needs the identical number from a place
 * vitest can import — the same argument `rack-row.ts` and `leverage-module.ts`
 * already carry for the same move. `landingTarget` is `seatedLeverage` now,
 * byte-identical in behaviour at the catalog preset, and this file reads it
 * rather than holding a second copy.
 */
const landingTarget = (row: UnifiedRow): number => seatedLeverage(row);

/** Everything one card prints, derived ONCE per row. */
interface CardView {
  /** `composedNetApy` at the landing leverage — identical to the lane's. */
  apy: number | null;
  /** The leverage that APY is quoted at, after every clamp. */
  leverage: number | null;
  /** `cy − bo`, the spread that explains the sign. */
  spread: string | null;
  /** The marginal borrow rate itself: on a yield-negative row it is WHY. */
  borrow: number | null;
  /** Reconciled GROUP capacity, floored, through the one usd formatter. */
  capacity: string;
  /** What that capacity is limited by, in nouns. */
  binds: string;
  /** How many catalog rows draw on that one resource. */
  shared: number;
  /** `LT 93%` when another row shares this pair AND venue; else null. */
  lt: string | null;
  /** A strictly better row on the same pair, quoted in THIS card's frame. */
  beatenBy: string | null;
  /**
   * `12.0% at 1.00x · −18.0% at the 2.75x default` — THE PICKER'S TWO NUMBERS.
   *
   * Set only on a row where one of the market's two leverages publishes and
   * the other does not, so the reader learns the market's leverage behaviour
   * before pressing instead of by hitting a dead primary action. Built whole
   * by `dualLeverageLine`; this component never holds either number.
   */
  dual: string | null;

  // ── THE FUNDING ROW'S OWN IDENTITY (2026-08-23) ────────────────────────
  //
  // A funding row is the same OBJECT as a loop row — four fixed lines, one
  // headline, one capacity — and its headline is produced by a different, and
  // equally short, arithmetic identity. All three are null on every loop row,
  // and `RowBody` falls through to the shipped run wherever they are.

  /** `funding 10.19% over 30d + spot 1.97% − drag 0.75%`, from `funding-card.ts`.
   *  It replaces the `carry / borrow` pair, which is a LENDING identity and
   *  on a funding row prints the spot leg against a zero borrow and never the
   *  funding percentile, which is the entire revenue. */
  fundingBody: string | null;
  /** `67% of each dollar` — f_b, in the slot the leverage occupies, in the
   *  funding canvas's own words. `at 1.00x` is forbidden here: it advertises
   *  a dial the market does not have. */
  fundingEscrow: string | null;
  /** The two legs, as the two chips `.mt-meta` already renders: the asset
   *  held and where it lives, then the short and where it runs. Null on a
   *  loop row; one chip on a book with no spot leg to name. */
  legChips: string[] | null;
}

function viewFor(
  row: UnifiedRow,
  winnerApy: (id: string) => number | null,
  /** True when the group intro states the one escrow share for every priced
   *  funding card (F16/D2): the per-card slot then stays quiet. */
  escrowInIntro = false,
): CardView {
  const hasHedge = row.cls === "A";
  const q = mockQuote({ row, blockNumber: 0 }, landingTarget(row), "standard");
  const cand = q.ok === true ? q.candidate : null;
  const e = row.economics;
  const dom = row.dominatedBy ?? null;
  /* THE WINNER'S APY IS RE-QUOTED, never read off `dominatedBy.bestApy`.
     `bestApy` is the market at its optimum and every card here is the vault at
     its landing stop; printing one beside the other would put two frames in
     one sentence, which is the exact defect the founder photographed. */
  const domApy = dom ? winnerApy(dom.id) : null;
  return {
    apy: composedNetApy(cand, hasHedge),
    /* A funding market has no leverage dial (`repriceAtLeverage` returns its
       row untouched), so its slot must never fall through to `at 1.00x` —
       that would advertise a control the market does not have. Null keeps the
       slot quiet when the escrow line has moved to the group intro. */
    leverage: isFundingRow(row) ? null : (cand?.economics?.loopLeverage ?? null),
    spread: carry(e?.collateralYieldApy, e?.borrowApyMarginal),
    borrow: typeof e?.borrowApyMarginal === "number" ? e.borrowApyMarginal : null,
    // The row is ALREADY reconciled to its resource group's minimum by
    // `buildUnifiedList`; `laneCapacityUsd` is the accessor that states it —
    // at the SAME composition the card's APY is priced at (`mockQuote` with no
    // comp = `CATALOG_COMPOSITION`). Without it a lending row stated its room
    // at the scan's 0.75 and a funding row on the same book at 0.6742.
    capacity: fmtCapacityUsd(laneCapacityUsd(row, hasHedge, CATALOG_COMPOSITION)),
    binds: capacityBindingLabel(row, hasHedge),
    shared: row.capacitySharedCount ?? 1,
    lt: row.ltDiscriminator ?? null,
    beatenBy:
      dom && domApy !== null ? `${dom.venueLabel} pays ${pct(domApy)} here` : null,
    /* WHOLE, FROM THE OWNER. The two rates and the two leverages are derived
       and formatted in `unified-list`, so a component can never pick its own
       glyph for either — the weld `single-owner.test.ts` refuses. */
    dual: dualLeverageLine(row),
    /* ALL THREE FROM `funding-card.ts`, never derived here. A component that
       held the raw funding percentile would be picking its own glyph for it,
       which is the weld `single-owner.test.ts` refuses outright — including in
       a comment, which is why the field is not named on this line. */
    fundingBody: fundingRevenueLine(row),
    fundingEscrow: escrowInIntro ? null : fundingEscrowLine(row),
    legChips: fundingLegChips(row),
  };
}

/* The local `byBestApy` comparator is GONE (P-H4, 2026-08-24): the ranking it
   carried moved into `buildUnifiedList` itself (`byBestReachable`, the
   DiscoverPanel handoff landed at the owner), so the list this panel renders,
   the demoted groups below it and the copilot's context rows are ONE order. */

export function discoverKicker(reason: DiscoverReason, laneLabel: string | null): string {
  // The `idle` branch is gone with the mode: a composed canvas with nothing
  // selected lands in Compose now, never back in the catalog.
  if (reason === "empty") return "Pick your first market";
  if (reason === "add") return `Pick a market${laneLabel ? ` · ${laneLabel}` : ""}`;
  return `Swap market${laneLabel ? ` · ${laneLabel}` : ""}`;
}

/**
 * ONE ROW, FOUR FIXED LINES (COMPOSE_PANEL_SPEC §4.1, extended by item 7).
 *
 * `.mt-meta` used to be a single wrapping flex row of five tokens, which
 * ragged-wrapped to three lines at 328px. The restructure puts the landing
 * leverage DIRECTLY under the headline in the right column rather than in the
 * chip soup: the leverage is WELDED to the number it qualifies, which is what
 * makes the source plate's sub-line recognisable as the same object.
 *
 * `carry` = cy − bo is the single most decision-relevant quantity that was
 * absent, and it explains all three cbETH/WETH rows at once — Morpho borrows
 * WETH at 1.65% for a positive carry, both Aave rows borrow at 4.27% for a
 * negative one. Item 7 puts that 4.27% ITSELF on the card beside the spread:
 * the spread carries the sign, the borrow rate says where the sign came from,
 * and on the seven Aave ETH rows it is the whole story.
 *
 * LINE FOUR is the capacity, and it is the RESOURCE's, not the row's. Ten of
 * the fifteen depositable rows draw on one ETH perp book; two scanners quote
 * that book 1.17x apart and `buildUnifiedList` has already rewritten every
 * member down to the group minimum. The card states the reconciled figure, the
 * noun that binds it, and how many rows share it — because "$198K" on ten
 * cards is only honest once it is visibly ONE $198K.
 *
 * TWO-PILL CEILING: when `ltDiscriminator` is set (2+ rows sharing pair AND
 * venue) the LT pill REPLACES the class pill — the class is already stated by
 * the section header two lines up. Never three pills. The discriminator is
 * `unified-list`'s, not a second collision scan: it is derived over the WHOLE
 * payload, so a venue chip can no longer make a chip appear or vanish.
 *
 * DO NOT render `failedGates`: all three cbETH rows carry the identical pair
 * including the launchable one, so it does not discriminate. `launchable` is
 * the reliable signal.
 */
function RowBody({
  c,
  v,
  reason,
  noDeposit,
  soon,
}: {
  c: UnifiedRow;
  v: CardView;
  /** Three words in place of the capacity string. Capacity-dead rows only. */
  reason?: string | null;
  /**
   * THE MARKET HAS NO DEPOSIT ASSET, so two numbers stop existing rather than
   * being demoted. Used by exactly one group: `Nothing to hold`.
   *
   *  · the HEADLINE. No asset, no deposit, no APY. De-blueing a 6.9% is not
   *    the same claim as not making it — and seven of those rows print the
   *    IDENTICAL administered ceiling, which is a constant, not a market.
   *  · the ESCROW. `67% of each dollar` qualifies a headline, and with no
   *    headline it qualifies nothing; it would also be describing the escrow
   *    of a dollar that cannot be placed.
   *
   * The revenue line stays in full. The funding measurement is real and it is
   * the whole point of scanning 1,151 markets.
   */
  noDeposit?: boolean;
  /** COMING SOON (B.1): stamps the number and the chips for the owner block. */
  soon?: boolean;
}) {
  const chip = soon ? { "data-soon-chip": "" } : {};
  return (
    <>
      <span className="mt-pair">
        {c.pair}
        {v.lt ? <i className="mt-lltv"> · {v.lt}</i> : null}
      </span>
      <span className="mt-apy" {...(soon ? { "data-soon-num": "" } : {})}>
        {pct(noDeposit ? null : v.apy)}
      </span>
      <span className="mt-lev">
        {noDeposit ? "" : (v.fundingEscrow ?? (v.leverage ? `at ${lev(v.leverage)}` : ""))}
      </span>
      <span className="mt-meta">
        {v.legChips ? (
          v.legChips.map((t) => (
            <i className="mt-venuechip" key={t} {...chip}>
              {t}
            </i>
          ))
        ) : (
          <>
            <i className="mt-venuechip" {...chip}>
              {c.venueLabel}
            </i>
            {v.lt ? null : (
              <i className="mt-venuechip" {...chip}>
                {c.cls === "N1" ? "unhedged" : "hedged"}
              </i>
            )}
          </>
        )}
      </span>
      <span className="mt-econ">
        {v.fundingBody ?? (
          <>
            {v.spread ? `carry ${v.spread}` : null}
            {v.spread && v.borrow !== null ? " · " : null}
            {v.borrow !== null ? `borrow ${pct(v.borrow, 2)}` : null}
          </>
        )}
      </span>
      <span className="mt-econ">
        {reason ? (
          reason
        ) : (
          <>
            {v.capacity}
            {v.binds ? (isModeledBinding(v.binds) ? ` ${v.binds}` : ` in ${v.binds}`) : null}
            {v.shared >= 2 ? `, shared by ${v.shared}` : null}
          </>
        )}
      </span>
      {/* THE PICKER'S TWO NUMBERS. Directly under the capacity line, because
          it qualifies the headline two lines up: one of the two rates in it
          IS the headline, and the other is the one the reader would otherwise
          meet only after pressing. Withheld on a market with no deposit asset
          for the same reason the headline is (see `noDeposit`): there is no
          dollar to place at either leverage. */}
      {!noDeposit && v.dual ? <span className="mt-econ">{v.dual}</span> : null}
      {v.beatenBy ? <span className="mt-econ">{v.beatenBy}</span> : null}
    </>
  );
}

/** `[a, b, c]` → `a, b and c`. Two names is the only case that ships today. */
function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Module keys as the names the shelf prints, from the descriptor that owns
 *  them. A second spelling of a module name is a second owner. */
function moduleNames(keys: readonly ModuleKey[]): string {
  return andList(keys.map((k) => getDef(k).name));
}

/**
 * A MODELED ROW (P0-7). Same `.mt-card` geometry, same pickable blue — these
 * rows ARE pickable and that is the entire point of the item — with four
 * differences, each of which states something the scan rows cannot state.
 *
 *  · `.mt-lev` reads `modeled` where a scan row reads `at 2.75x`. The slot is
 *    welded to the headline and says what frame the number is in; an LP and a
 *    collar are unlevered, so printing `at 1.00x` there would advertise a
 *    dial that does not exist on this family.
 *  · the class pill is replaced by the FAMILY, because "unhedged" is a true
 *    but useless thing to say about a collar (the put IS the protection) and
 *    the family is what tells the builder which lane the row fits.
 *  · one line names the composition the number is priced at, which is also
 *    the composition the lane must reach to publish on it. Same two modules
 *    read from one owner.
 *  · no carry, no borrow, no dominance. There is no borrow leg on either row
 *    and nothing to be dominated by: one row per family.
 *
 * NO NUMBER IS INVENTED HERE. `composedNetApy` and `laneCapacityUsd` are the
 * same two accessors the lane header calls, on the same row the lane will
 * pin, so the card and the lane print one number by construction.
 *
 *  · AND THE COLLAR CARRIES ITS FORGONE UPSIDE (QNT-R2-3, 2026-09-02). The
 *    quant ledger's collar ruling is that the premium IS the price of the
 *    upside sold above the strike, so the cash flow prints with that upside
 *    beside it or it lies by omission — on EVERY surface that prints the
 *    figure. This is the recruiting surface: the row a builder picks the
 *    family FROM, showing 11.8% against a family whose expected total return
 *    under the same table is negative at 60 days. `collarForfeit` at the
 *    dials this row is priced at (`COLLAR_DEFAULT_DIALS`, which is what
 *    `COLLAR_CANDIDATE` is built from) and `collarForfeitLine` for the words:
 *    one derivation, the same one the lane header and the record read.
 */
function ModeledRowBody({ c, soon }: { c: ModeledRow; soon?: boolean }) {
  const hasHedge = c.cls === "A";
  const forfeit = c.family === "collar" ? collarForfeit(COLLAR_DEFAULT_DIALS) : null;
  const chip = soon ? { "data-soon-chip": "" } : {};
  return (
    <>
      <span className="mt-pair">{c.pair}</span>
      <span className="mt-apy" {...(soon ? { "data-soon-num": "" } : {})}>
        {pct(composedNetApy(c, hasHedge))}
      </span>
      <span className="mt-lev">modeled</span>
      <span className="mt-meta">
        <i className="mt-venuechip" {...chip}>
          {c.venueLabel}
        </i>
        <i className="mt-venuechip" {...chip}>
          {FAMILY_LABEL[c.family]}
        </i>
      </span>
      <span className="mt-econ">priced with {moduleNames(c.pricedWith)}</span>
      <span className="mt-econ">
        {fmtCapacityUsd(laneCapacityUsd(c, hasHedge))}, {capacityBindingSentence(c, 1, hasHedge)}
      </span>
      {forfeit ? <span className="mt-econ">{collarForfeitLine(forfeit)}</span> : null}
    </>
  );
}

export default function DiscoverPanel({
  params,
  families,
  data,
  error,
  onSelect,
}: {
  /** The target lane's liquidity-source params (selection pin state). */
  params: Record<string, ParamValue>;
  /**
   * The lane's SURVIVING families (`committedFamilies`), when the caller
   * knows them. Optional on purpose: the dock does not pass it yet, and a
   * required prop would have made this item wait on a file it does not own.
   * Absent, the panel falls back to what the pin it already holds can prove —
   * see `laneFams`.
   */
  families?: readonly LaneFamily[] | null;
  data: OpportunitiesPayload | null;
  error: string | null;
  onSelect: (fields: Record<string, string>, row: UnifiedRow) => void;
}) {
  const [venueSet, setVenueSet] = useState<Set<CanvasVenueId> | null>(null); // null = all
  const [classFilter, setClassFilter] = useState<ClassFilter>("both");

  const venues = useMemo(() => data?.venues ?? [], [data]);

  /**
   * WHAT THIS LANE CAN STILL BE.
   *
   * The prop when the caller states it; otherwise the one fact a panel
   * holding only the source params can prove: a pinned market commits the
   * lane to the families it can be priced on. With no pin, every family
   * survives — `laneFamilies([])` is that list, read from its owner rather
   * than typed out here, so a fourth family cannot leave this stale.
   *
   * ⚠ THE FALLBACK IS INCOMPLETE AND KNOWS IT: a lane that has seated
   * `Auto center` but pinned no market is bound to `dnlp`, and no prop is
   * arriving to say so, so it is offered both modeled rows. Offering one row
   * too many is recoverable (the refusal names the mismatch); asserting a
   * family the lane never expressed is not, and that is the whole subject of
   * this wave. See HANDOFF 1.
   */
  const laneFams = useMemo<LaneFamily[]>(() => {
    if (families && families.length > 0) return [...families];
    const id = typeof params.candidateId === "string" ? params.candidateId : "";
    return id ? familiesForCandidateId(id) : laneFamilies([]);
  }, [families, params]);

  /** Every scan row is a supply/borrow market with a liquidation threshold
   *  and a perp leg, which is the loop family and nothing else. A lane that
   *  can no longer be a loop cannot price ONE of them. */
  const offersScan = laneFams.includes("loop");

  /** The hand-authored rows, every family's: on this build each is coming
   *  soon whatever the lane can price, so the list is the catalog's, not the
   *  lane's (docs/plans/LATEST_UI_PORT_SPEC.md A.3 #6). */
  const modeled = useMemo(() => modeledRows(null), []);

  /* Every priced row in the payload, UNFILTERED, keyed by id. Two jobs, both
     of which must survive a venue chip: the dominance pointer has to be able
     to quote a winner the filter is hiding, and a card's numbers must not
     change because a chip was lit. */
  const allById = useMemo(() => {
    const built = buildUnifiedList(venues, {});
    const m = new Map<string, UnifiedRow>();
    for (const r of [...built.hedged, ...built.unhedged]) m.set(r.id, r);
    return m;
  }, [venues]);

  /* ONE CardView per row per payload. `mockQuote` is two multiplies and a
     clamp, but memoising keeps the panel's numbers referentially stable across
     the filter re-renders that happen on every chip press. */
  const views = useMemo(() => {
    const cache = new Map<string, CardView>();
    const apyOf = (id: string): number | null => {
      const w = allById.get(id);
      if (!w) return null;
      const q = mockQuote({ row: w, blockNumber: 0 }, landingTarget(w), "standard");
      return q.ok === true ? composedNetApy(q.candidate, w.cls === "A") : null;
    };
    for (const [id, r] of allById) cache.set(id, viewFor(r, apyOf));
    return cache;
  }, [allById]);

  const view = useMemo(
    () =>
      (c: UnifiedRow): CardView =>
        views.get(c.id) ?? viewFor(c, () => null),
    [views],
  );

  const list = useMemo(() => {
    const built = buildUnifiedList(venues, {
      venueFilter: venueSet ?? "all",
      classFilter,
    });
    /* ══ THE FILTER STOPPED DELETING AND STARTED ROUTING (2026-08-23) ══
       This held `const priced = (r) => (r.economics?.loopLeverage ?? 0) > 0`,
       and its own §4.1 comment justified it by saying the rows it removed
       "come back with `loopLeverage: 0`". MEASURED against the live payload:
       none do. The three Dolomite rows it deletes today (WBERA/iBGT,
       iBERA/iBGT, sWBERA/iBGT) come back with `economics: null` and are
       removed by the `??` branch, not by the `> 0` branch — so the comment
       described a shape that no longer exists and the deletion it authorised
       was hitting a different set of rows than the one it was written for.

       The distinction it was reaching for is real and is kept: a MEASURED
       zero is a judgement, an UNMEASURED row is an absence. But an absence is
       something to state, not something to delete — the whole justification
       for scanning 1,151 markets is to be honest about what is not there.
       Unpriced rows now route into their own group (`Not measured yet`) in
       `split` below, and nothing leaves this list. */
    /* ITEM 7 / P-H4 — the rank IS the list's own since 2026-08-24:
       `buildUnifiedList` orders by the best reachable APY (`byBestReachable`),
       the handoff this panel used to carry, landed at the owner. No local
       re-sort: the copilot's context rows and this panel read one order. */
    return built;
  }, [venues, venueSet, classFilter]);

  // Selection pin against the SELECTED venue's doc — used only to highlight
  // the picked row; never to warn.
  const selDoc = useMemo(() => {
    const v = String(params.venue ?? "");
    return venues.find((d) => d.venue === v) ?? null;
  }, [venues, params]);
  const sel = useMemo(() => selectionState(params, selDoc), [params, selDoc]);
  /* A modeled row belongs to no venue DOCUMENT, so `selectionState` cannot
     see it and returns `none` for a lane that has pinned one. The ring is
     resolved against the modeled group directly rather than by teaching the
     pin checker about documents that do not exist: there is nothing to
     re-verify on a row with no scan behind it. */
  const pinnedId = typeof params.candidateId === "string" ? params.candidateId : "";
  const selectedId =
    sel.kind === "valid" || sel.kind === "doc-changed"
      ? sel.candidate.id
      : modeled.some((r) => r.id === pinnedId)
        ? pinnedId
        : "";

  /* ══ THE PARTITION, TWO-WAY (docs/plans/LATEST_UI_PORT_SPEC.md 2.3) ══
     Every absence-free row the live dock would render as pickable (launch or
     eyes-open) across every venue, plus the modeled rows, is a row here. The
     ONE live market is the pickable section; every other row sits under one
     expanded `Coming soon` head in the live catalog order. The absence groups
     (no capacity, below zero, nothing to hold, not measured) are not rendered:
     chrome for four groups behind one live row. `discoverAbsence` stays the
     routing's one owner, so nothing with an absence is ever listed as soon. */
  const split = useMemo(() => {
    const live: UnifiedRow[] = [];
    const soonScan: UnifiedRow[] = [];
    for (const r of [...list.hedged, ...list.unhedged]) {
      if (discoverAbsence(r) !== null) continue;
      if (isLiveMarket(r.id)) live.push(r);
      else soonScan.push(r);
    }
    /* The modeled rows are scan-free, so the class filter is applied here by
       hand, the same way the list applied it to the scan rows; the venue
       filter holds only live venues and a modeled row belongs to none. */
    const soonModeled = modeled.filter((c) => {
      if (isLiveMarket(c.id)) return false;
      if (venueSet !== null && !venueSet.has(c.venue)) return false;
      if (classFilter === "hedged") return c.cls === "A";
      if (classFilter === "unhedged") return c.cls === "N1";
      return true;
    });
    return { live, soonScan, soonModeled };
  }, [list, modeled, venueSet, classFilter]);

  const soonCount = split.soonScan.length + split.soonModeled.length;

  const toggleVenue = (v: CanvasVenueId) => {
    setVenueSet((prev) => {
      if (prev === null) return new Set([v]);
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next.size === 0 ? null : next;
    });
  };

  const toggleClass = (c: Exclude<ClassFilter, "both">) => {
    setClassFilter((prev) => (prev === c ? "both" : c));
  };

  const pick = (c: UnifiedRow) => {
    onSelect(
      {
        venue: c.venue,
        candidateId: c.id,
        pairLabel: c.pair,
        contentHash: c.contentHash,
        cls: c.cls,
        hlCoin: c.hlCoin ?? "",
      },
      c,
    );
  };

  /* The live section's head is the class the live rows are: one word per
     class, the live dock's own two titles. */
  const liveHedged = split.live.filter((c) => c.cls === "A");
  const liveUnhedged = split.live.filter((c) => c.cls !== "A");
  const liveSection = (title: string, rows: UnifiedRow[]) =>
    rows.length === 0 ? null : (
      <div>
        <div className="mt-sec-h">{title}</div>
        {rows.map((c, i) => (
          <button
            key={c.id}
            className={`mt-card${selectedId === c.id ? " sel" : ""}`}
            style={{ "--i": i } as React.CSSProperties}
            onClick={() => pick(c)}
          >
            <RowBody c={c} v={view(c)} />
          </button>
        ))}
      </div>
    );

  return (
    <div className="dock-discover" onClick={(e) => e.stopPropagation()}>
      {offersScan ? (
        <>
        <div className="mt-filters">
          {/* §6 live bug: these were div[role=button][tabIndex=0] whose
              onKeyDown fired on " " WITHOUT preventDefault, so Space scrolled
              .dock-scroll AND fired the filter. Real buttons.
              ONLY VENUES WITH A LIVE ROW GET A KEY (A.3 #5): the absent venues
              appear as rows under the soon head, never as dimmed keys. */}
          <button
            type="button"
            className={`hm-key${venueSet === null ? " lit" : ""}`}
            data-key="all"
            onClick={() => setVenueSet(null)}
          >
            <span className="hm-led" />
            All markets
          </button>
          {VENUE_ORDER.filter((v) => isLiveVenue(v)).map((v) => (
            <button
              key={v}
              type="button"
              className={`hm-key${venueSet?.has(v) ? " lit" : ""}`}
              data-key={v}
              onClick={() => toggleVenue(v)}
            >
              <span className="hm-led" />
              {VENUE_LABELS[v]}
            </button>
          ))}
        </div>
        <div className="mt-filters mt-filters--class">
          <button
            type="button"
            className={`hm-key${classFilter === "hedged" ? " lit" : ""}`}
            data-key="hedged"
            onClick={() => toggleClass("hedged")}
          >
            <span className="hm-led" />
            Hedged
          </button>
          <button
            type="button"
            className={`hm-key${classFilter === "unhedged" ? " lit" : ""}`}
            data-key="unhedged"
            onClick={() => toggleClass("unhedged")}
          >
            <span className="hm-led" />
            Unhedged
          </button>
        </div>

        {/* ONE register line (A.3 #31). Nothing on this build is scanned: the
            row's number is the vault at the leverage this pick builds at, from
            the market's typed inputs, and the carry the venue pays in
            incentives is not in it. */}
        <div className="mt-status">
          Modeled from typed inputs at the leverage this pick builds at. The carry is
          incentive-paid and the scan does not credit it.
        </div>

        {error ? <div className="mt-empty">{error}</div> : null}
        {!data && !error ? <div className="mt-empty">loading markets…</div> : null}
        </>
      ) : null}

      {/* ORDER IS THE ARGUMENT: the pickable row, then everything that is
          coming soon, expanded, under one head. */}
      <div className="mt-body">
        {offersScan && data ? (
          <>
            {classFilter !== "unhedged" ? liveSection("Hedged (delta-neutral)", liveHedged) : null}
            {classFilter !== "hedged" ? liveSection("Unhedged", liveUnhedged) : null}
          </>
        ) : null}

        {soonCount > 0 ? (
          <div className="mt-soon">
            <div className="mt-sec-h">
              {COMING_SOON.label}
              <span className="mt-dead-n">
                · {soonCount} {soonCount === 1 ? "market" : "markets"}
              </span>
            </div>
            {(offersScan && data ? split.soonScan : []).map((c, i) => (
              <div
                key={c.id}
                className="mt-card"
                data-soon
                aria-disabled="true"
                tabIndex={-1}
                style={{ "--i": i } as React.CSSProperties}
              >
                <RowBody c={c} v={view(c)} soon />
              </div>
            ))}
            {split.soonModeled.map((c, i) => (
              <div
                key={c.id}
                className="mt-card"
                data-soon
                aria-disabled="true"
                tabIndex={-1}
                style={{ "--i": split.soonScan.length + i } as React.CSSProperties}
              >
                <ModeledRowBody c={c} soon />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
