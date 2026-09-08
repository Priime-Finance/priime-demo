/**
 * THE FUNDING-CLASS REGISTER PRODUCER (recette 2026-08-23, I4/I8).
 *
 * ══ WHY THIS FILE EXISTS ═══════════════════════════════════════════════════
 *
 * The three funding vault pages rendered NO "What defeats the reaction"
 * register at all: `registerInputForVault` refuses to project a perp market
 * into a collateral/debt lane (correctly — projected as a loop it produced
 * three false mechanisms), and refusing left the pages with one sentence
 * about the guard while the lane holds a short, a margin rule and a reserve.
 * Null-over-fabrication was the right taste; a null register on a lane that
 * measurably holds three defeatable mechanisms was the wrong altitude.
 *
 * So this producer builds the register the way the loop producers do, but
 * from the RECORD, which is the only thing a funding vault owns: no lane, no
 * candidate, no projection. Every row is derived from a field the record (or
 * its automation object, the same one the instruments print) actually
 * carries, and every quantity is one the product already ratified for the
 * funding lane class:
 *
 *   · the short's own margin ratio, `1/L_h` — funding-demo calls it "the
 *     only exactly measurable risk quantity a funding lane carries today";
 *   · the margin reserve, as the published fraction of short notional (the
 *     refill-count denomination is a leverage-tier assumption the funding
 *     coins do not share, so it is NOT restated here);
 *   · the guard floor and its de-allocation window;
 *   · the published capacity, read the other way as the exit.
 *
 * A quantity the record does not carry produces a BLIND row (rendered as
 * `not measured` behind the skip bar) or no row at all — never a number.
 *
 * ══ ONE SCHEMA, ONE RENDERER ═══════════════════════════════════════════════
 *
 * Entries are `RegisterEntry` objects validated by the canvas register's own
 * `validateEntry` — one schema owner, one drop discipline — and rendered by
 * the vault page's existing `RegisterRow`/group/skip-bar machinery. The
 * payload a `measured` entry's `fieldPath` resolves against is the record
 * itself (wrapped as `{ record }`), because for a record-produced register
 * the record IS the block-pinned payload.
 */

import { fmtCapacityUsd } from "@/lib/canvas/capacity";
import { pct } from "@/lib/canvas/format";
import {
  declaredBlindEntry,
  exogenousEntries,
  registerEntry,
  sortEntries,
  validateEntry,
  type RegisterEntry,
  type RegisterInput,
  type RegisterReaction,
} from "@/lib/canvas/register";
import { guardResponse, marginRuleResponse, type RiskFundingInput } from "@/lib/canvas/risk-table";
import { exogenousInputForVault, placedKeysOf, railsArmed, type VaultRecord } from "./store";

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * The payload a funding entry's `fieldPath` resolves against. `validateEntry`
 * walks dot paths over the object it is handed; handing it the record keeps
 * the schema gate real (an entry whose field went missing is DROPPED) without
 * fabricating the `AxisLane` a funding record does not hold.
 *
 * ⚠ AND IT CARRIES THE DEPENDENCY LANE TOO (recette 2026-09-02, DEF-02). The
 * promoted exogenous rows are produced by `register.exogenousEntries`, whose
 * measured tier resolves `lane.candidate.failedGates` — the gates the record
 * froze at its own block. A payload holding only `{ record }` cannot resolve
 * that path, so every measured party row would have been DROPPED by the
 * schema gate and the fix would have shipped as a quieter version of the same
 * silence. Same lane the rows were derived from, from the same author
 * (`exogenousInputForVault`), so the gate checks the object that produced
 * them; `record` stays alongside, because the six record-built entries below
 * resolve against it.
 */
export function fundingRegisterPayload(v: VaultRecord): RegisterInput {
  const lane = exogenousInputForVault(v);
  return { ...(lane ?? {}), record: v } as unknown as RegisterInput;
}

/**
 * Every register entry a funding RECORD can prove, ordered, schema-checked,
 * with failures dropped. Empty for a non-funding record or one holding no
 * basis engine — the page then renders no register, exactly as before.
 */
export function fundingRegisterFor(v: VaultRecord): RegisterEntry[] {
  if (v.strategy !== "funding") return [];
  const h = v.automations?.hedge;
  if (!h) return [];

  const venue = h.venue || v.venue;
  /* The perp's base coin. The record publishes it (`hlCoin`); a record from
     before that field falls back to the market's own name — `ETH-USD` names
     the ETH perp by definition. A noun read off a published string, never a
     number. */
  const coin = (typeof h.coin === "string" && h.coin) || v.market.split(/[-/]/)[0] || null;
  if (!coin) return [];

  const lh = finite(h.leverage) ? h.leverage : null;
  const marginRatio = lh !== null && lh > 0 ? pct(1 / lh, 1) : null;
  const reserve = finite(h.reserveFraction) ? h.reserveFraction : null;
  const floor = finite(h.fundingFloorApr) ? h.fundingFloorApr : null;
  const cadence = h.cadence ?? null;

  /* The margin rule is the funding lane's whole reaction: below the trim line
     it trims the short, back to the restore line. Both edges are the ones the
     instrument card and the Parameters panel already print from this same
     automation object, so the register cannot disagree with the page above
     it. */
  const written = marginRuleResponse({
    trimBelowPct: h.marginTrimBelowPct,
    restorePct: h.marginRestorePct,
    cadence,
    armed: railsArmed(v),
  });
  const marginRule: RegisterReaction | null = written
    ? { trigger: written.trigger, cadence: written.cadence }
    : marginRatio !== null
      ? { trigger: marginRatio, cadence }
      : null;

  const drafts: (RegisterEntry | null)[] = [];

  // ── Faster than we act ────────────────────────────────────────────────────

  /* The refill. The reserve is stated as what it is — the published share of
     the short's notional held idle — not as a refill count, because the
     count's denominator is a leverage-tier constant the funding coins do not
     share. */
  if (reserve !== null) {
    drafts.push(
      registerEntry({
        id: "refills",
        mechanism: `Refilling the ${coin} short's margin`,
        /* ⚠ THE FOUNDER QUOTED THE LOOP FAMILY'S TWIN OF THIS ROW BACK AT US.
           `The reserve holds that share of the short. Then someone has to
           act.` puts the value's DENOMINATOR ("that share of the short") in a
           sentence, to the LEFT of the value it frames — which is what made
           `15%` read as a number inside a paragraph, and at 390 the value
           rendered physically inside the sentence. The frame is a column now
           and it is the same noun the loop family's reserve row carries, so
           one dial stops having two spellings. */
        consequence: "then a person acts",
        denominator: "of short notional",
        defeats: "reaction",
        reaction: marginRule,
        evidence: {
          tier: "measured",
          fieldPath: "record.automations.hedge.reserveFraction",
          value: pct(reserve, 0),
        },
      }),
    );
  }

  /* The exit. The published capacity read the other way: how much has to
     cross the perp book on the way out. */
  if (finite(v.capacityUsd)) {
    drafts.push(
      registerEntry({
        id: "exit-at-cap",
        /* THE BINDING IS A NOUN. `The exit crosses the HYPE perp book at
           Hyperliquid.` is a sentence built entirely out of nouns the label
           can hold, so the label holds them. */
        mechanism: `Unwinding ${v.market} through the ${coin} perp book at ${venue}`,
        consequence: "past it the exit crosses the book",
        denominator: "deposit room at this composition",
        defeats: "reaction",
        reaction: marginRule,
        evidence: {
          tier: "measured",
          fieldPath: "record.capacityUsd",
          value: fmtCapacityUsd(v.capacityUsd),
        },
      }),
    );
  }

  // ── Acts and still loses ──────────────────────────────────────────────────

  /* The short leg, named whole. It is the carry engine AND a position a
     third party can close; the value is its own margin ratio where the
     record carries the dial, and an honest absence where it does not. */
  drafts.push(
    registerEntry(
      marginRatio !== null
        ? {
            /* THE VENUE MOVES INTO THE LABEL AND THE CLOSABILITY STAYS AS THE
               CLAUSE. `On Hyperliquid, that leg can be closed against you.`
               carried a noun and a fact; the noun belongs beside the leg it
               names. The structured table says this in its FIRST section, on
               a family that had no statement of what can be closed at all. */
            id: "short-closed",
            mechanism: `The ${coin} short on ${venue} that collects the funding`,
            consequence: "that leg can be closed against you",
            denominator: "of the short's own notional",
            defeats: "position",
            reaction: null,
            evidence: {
              tier: "measured",
              fieldPath: "record.automations.hedge.leverage",
              value: marginRatio,
            },
          }
        : {
            id: "short-closed",
            mechanism: `The ${coin} short on ${venue} that collects the funding`,
            consequence: "that leg can be closed against you",
            denominator: "the short's margin ratio is not published here",
            defeats: "position",
            reaction: null,
            evidence: { tier: "blind" },
          },
    ),
  );

  /* The venue freeze. True by the shape of the venue, carries no number, and
     it stops the exit row above from reading as the whole of the exit
     problem. */
  drafts.push(
    registerEntry({
      id: "venue-freeze",
      mechanism: `${venue} freezing the ${coin} book`,
      /* Same clause the loop family carries, from the same ruling: the two
         facts stated as two rather than through the not-X-but-Y frame. */
      consequence: "the exit stops, the position stays",
      denominator: "no level to watch",
      defeats: "position",
      reaction: null,
      evidence: { tier: "structural" },
    }),
  );

  // ── Takes the yield, not the capital ──────────────────────────────────────

  /* The guard. The floor is the record's own published dial; the window is
     the same automation field the Parameters panel prints. Nothing
     liquidates; the carry stops. */
  if (floor !== null) {
    const guard = guardResponse({
      periods: h.fundingDeallocPeriods,
      cadence,
      armed: railsArmed(v),
    });
    drafts.push(
      registerEntry({
        id: "funding-inverts",
        mechanism: `Funding on ${coin} turning negative`,
        /* ⚠ THE SENTENCE HELD THE WRITTEN RESPONSE, IN PROSE, IN THE ONE
           COLUMN THAT HAS NO ROOM FOR IT. `The guard closes the short after 3
           periods under it. The carry stops with it.` is an ACTION and a
           consequence welded together; the action belongs in the response
           column, from `guardResponse` — the one owner of that spelling, which
           the structured table calls on both families — and what is left is
           the consequence. */
        consequence: "the carry stops, the deposit stays",
        denominator: "APR floor, published setting",
        defeats: "yield",
        reaction: guard ? { trigger: guard.trigger, cadence: guard.cadence } : null,
        evidence: {
          tier: "measured",
          fieldPath: "record.automations.hedge.fundingFloorApr",
          value: pct(floor, 1),
        },
      }),
    );
  }

  /* The vintage, blind. The record was priced from the funding venue table;
     the table's age never crosses to this page, and saying so outranks
     letting a reader infer the print is checked.

     ⚠ RETIRED BY THE STRUCTURED TABLE (2026-09-02). It is an AS-OF wearing a
     mechanism's clothes: it names no mechanism, defeats nothing, carries no
     quantity, and its whole content is "this record pins no block" — stated
     behind the skip bar, which is the one place a depositor never opens.
     `lib/canvas/risk-table.ts` states it where a provenance belongs, as the
     table's own stamp (`NO_BLOCK_NOTE`), visible, once. It may not leave this
     file before the renderer swaps: until then it is the ONLY vintage
     statement on the three funding pages, and deleting it would remove the
     claim rather than move it. */
  drafts.push(
    registerEntry({
    id: "funding-print",
    mechanism: `The funding print behind ${v.market}`,
    /* THE SENTENCE IS THE FOOTER'S JOB, AND THE TABLE'S FOOTER DOES IT ONCE.
       `The record was priced from one read of the venue table. The rate at
       open is not the rate you are reading.` sat one line above a footer that
       says the same thing — the provenance printed twice, adjacent, at 390.
       Here it is the frame of an absence and nothing more. */
    consequence: null,
    denominator: "no block pinned on this record",
    defeats: "yield",
    reaction: null,
    evidence: { tier: "blind" },
    }),
  );

  /* THE DECLARED-BLIND ROW, IMPORTED, NEVER RETYPED (S2 Wave 2 seam,
     2026-08-24).

     W2-C5 put the exogenous-dependency row (`DECLARED_BLIND_MECHANISM`, in
     `lib/canvas/register.ts`) on every lane the CANVAS register produces —
     oracle, bridge, stablecoin and RPC state, stated as unwatched rather than
     left to be inferred. This file is the second register producer — the
     funding records build their own array from the record and never call
     `registerFor` — so the three funding vault pages were the only published
     records with no declared-blind row, which is exactly the surface where a
     reader is most likely to assume a perp venue's oracle is watched.

     `declaredBlindEntry` is imported by name rather than restated. A second
     copy of the sentence is how the wall arrives by the back door: two
     producers drift, and the row stops being a fact about the product and
     starts being decoration on two pages. It carries `v.market` — the same
     token the canvas row interpolates — so the sentence is about THIS book.

     AND GUARDED THE WAY `registerFor` GUARDS IT (recette 2026-09-01, EXO-D1).
     The row's contract is "these dependencies are unwatched", and a rack
     published funding record can seat the watcher: the overlay travels as a
     module NAME (nothing passes through it, so no automation proves it).
     Pushed unconditionally, the row's unwatched claim sat four lines from
     `Also installed · Exogenous risk` — the exact contradiction the loop path
     closed in `placedKeysOf`. So the branch asks that same author rather than
     growing a second name check here.

     ⚠ AND WITHHOLDING BOTH FORMS WAS NOT THE HONEST THIRD OPTION (recette
     2026-09-02, DEF-02).
     ------------------------------------------------------------------------
     EXO-D1 stopped at "a watched funding record prints NEITHER form", on the
     ground that the promoted rows need a lane and a funding record holds
     none. The premise was wrong, and the consequence was the defect the
     branch above exists to prevent, one level quieter: the module list said
     `Exogenous risk · Watches the parties this lane depends on` while the
     register — "the artifact a depositor keeps" — named no party, carried no
     evidence, and did not even say the four dependencies were unwatched.
     Silence where a coverage claim was just made is `exogenous.ts` charter
     rule 3 broken, and it read to a depositor exactly like coverage.

     The premise's error: `registerInputForVault` refuses a funding record
     because the loop MECHANISMS are sentences about a collateral/debt pair.
     `dependenciesOf` reads no pair. It reads the venue, the route, the held
     asset's yield and the scan — every one of which a rack-published funding
     record publishes — and its own predicate drops the price feed on a lane
     with no debt leg rather than inventing one. So the lane exists for THIS
     purpose and not for the other, and `store.exogenousInputForVault` is the
     one author of it, shared with the loop path so the two cannot form two
     opinions about one record's parties.

     Exclusive, exactly as `registerFor`'s own ternary is exclusive: promoted
     rows or the constant sentence, never both and never neither. */
  const exoInput = placedKeysOf(v).includes("exogenous-risk")
    ? exogenousInputForVault(v)
    : null;
  if (exoInput) drafts.push(...exogenousEntries(exoInput));
  else drafts.push(declaredBlindEntry(v.market));

  /* One schema owner: the canvas register's own gate, run over the record
     payload. A failing entry is dropped, never repaired. */
  const payload = fundingRegisterPayload(v);
  const kept: RegisterEntry[] = [];
  for (const d of drafts) {
    if (!d) continue;
    if (validateEntry(d, payload).length > 0) continue;
    kept.push(d);
  }
  /* AND ONE ORDER OWNER, for the same reason (DEF-02, 2026-09-02). The pushes
     above are hand-ordered, which was enough while every row was hand-written;
     the promoted party rows are DERIVED and their tiers come from what the
     scan read, so no push order can place them. `sortEntries` is the same
     function `registerFor` files its own entries with, so the two classes the
     vault page renders through one set of components cannot order one group
     two ways. */
  return sortEntries(kept);
}

// ══ THE STRUCTURED TABLE'S FUNDING INPUT (2026-09-02) ══════════════════════

/**
 * THE RECORD, AS THE PRIMITIVES THE SHARED ROW HELPERS TAKE.
 *
 * ── WHY IT IS A PROJECTION AND NOT A SECOND PRODUCER ──────────────────────
 * `lib/canvas/risk-table.ts` builds every row type from primitives precisely
 * so the funding family and the three lane families cannot spell one dial two
 * ways — which is exactly what happened to the margin reserve, printed as a
 * refill COUNT (`1.00`) on a loop page and as a SHARE (`15%`) on a funding
 * page, at the identical stored value of 0.15. This function's whole job is to
 * name the record's fields; not one row is written here.
 *
 * ── THE TWO LADDER EDGES ARE THE POINT ────────────────────────────────────
 * `marginTrimBelowPct` and `marginRestorePct` are carried through because
 * `coinMaxLeverageFromMarginRule` inverts them back to the coin's maintenance
 * margin, which is the number `Short's own liquidation` needed and never had.
 * On `hype-funding-harvest` and `basis-desk-one` the two edges pin the same MM
 * and the cell prints a real adverse-move figure; on `btc-carry-collector`
 * they disagree and it prints `not measured`, which is the same refusal the
 * old row made — only now it is made for a stated reason.
 *
 * Null for a non-funding record, or one carrying no basis engine: the page
 * then renders no funding table, exactly as it rendered no funding register.
 */
export function fundingRiskInputFor(v: VaultRecord): RiskFundingInput | null {
  if (v.strategy !== "funding") return null;
  const h = v.automations?.hedge;
  if (!h) return null;
  const coin = (typeof h.coin === "string" && h.coin) || v.market.split(/[-/]/)[0] || null;
  if (!coin) return null;
  return {
    marketNoun: v.market,
    coin,
    venue: h.venue || v.venue,
    armed: railsArmed(v),
    cadence: h.cadence ?? null,
    hedgeLeverage: finite(h.leverage) ? h.leverage : null,
    reserveFraction: finite(h.reserveFraction) ? h.reserveFraction : null,
    deltaBandPct: finite(h.deltaBandPct) ? h.deltaBandPct : null,
    marginTrimBelowPct: finite(h.marginTrimBelowPct) ? h.marginTrimBelowPct : null,
    marginRestorePct: finite(h.marginRestorePct) ? h.marginRestorePct : null,
    fundingFloorApr: finite(h.fundingFloorApr) ? h.fundingFloorApr : null,
    fundingDeallocPeriods: finite(h.fundingDeallocPeriods) ? h.fundingDeallocPeriods : null,
    capacityUsd: finite(v.capacityUsd) ? v.capacityUsd : null,
    /* WHAT THE VAULT ALREADY HOLDS, so the exit row states the room LEFT
       rather than the gross book. `hype-funding-harvest` publishes $11.6K of
       capacity, holds $1.9K, and its own spec assumes a $21K average ticket:
       one average deposit is 1.8x the whole book and 2.1x what is actually
       left. Gross hides that; remaining states it. */
    heldUsd: typeof v.baseTvlUsd === "number" ? v.baseTvlUsd : null,
    /* VERIFIED: no funding seed publishes a block. The table's footer states
       the absence rather than omitting the stamp. */
    blockNumber: finite(v.blockNumber) ? v.blockNumber : null,
  };
}
