/**
 * THE EXOGENOUS RISK MODULE — the derivation, and nothing else.
 *
 * ══ WHAT THIS FILE IS FOR ══════════════════════════════════════════════════
 *
 * The canvas already publishes, on every lane of every family, a register row
 * that says four external dependencies are NOT watched (`register.ts`,
 * `DECLARED_BLIND_ID`). That row is a declared absence. This module's whole
 * job is to promote it: to name, per lane, exactly the outside parties THAT
 * lane's own capital route actually has, and to pair each one with a written
 * response. Installing the module makes a number the product already
 * publishes — `skipBarLabel`'s count of what a vault does not measure — move,
 * on a counter that cannot be gamed because every member of it is derived.
 *
 * ══ THE LAW THIS FILE IS WRITTEN AGAINST ═══════════════════════════════════
 *
 * `modules.ts` R1 deleted the `deltaBandPct` dial because "a hand-typed OPTION
 * SET is the same defect one level up": its three options were unexecutable on
 * the machine they claimed to configure. A picker listing every bridge in DeFi
 * is that defect wearing a new hat — it would offer a builder rails their lane
 * never touches.
 *
 * So NOTHING here is a menu. The dependency SET is a pure function of the
 * lane's route, recomputed every render and never stored, and the RAIL on each
 * crossing is a function of that crossing's two chains, read off the bridge
 * modules the product actually ships (`lib/bridge/*`). Change the market, eject
 * the hedge, and the list changes on the same frame, because there was never a
 * list to go stale. What the builder owns is not membership — it is where the
 * ANSWERED line falls across their own derived set.
 *
 * ══ THE THREE THINGS THIS FILE MAY NOT DO ══════════════════════════════════
 *
 *  1. IT MAY NOT PRICE. `QUOTE_AFFECTING_PARAMS["exogenous-risk"]` is empty
 *     and it must stay empty. The per-event cost of a response is measured
 *     (`economics.executionDragApr`); the annual total needs an incident
 *     frequency the payload does not carry, and a quote is annual. L11: named,
 *     never sized.
 *
 *  2. IT MAY NOT CLAIM A RUNNING WATCHER. Every ACT line below is a subjectless
 *     imperative with no tense and no agent — `Route around it, do not get
 *     stuck.` That grammar states a DESIGNED response and cannot be read as a
 *     guarantee that something is executing it right now. It is the same
 *     register `priime.finance/risk` publishes and the same register the
 *     proactive-risk article labels as "design mapping of watch signal to act
 *     response". Do not add an agent, a tense, or a cadence to these strings.
 *
 *  3. IT MAY NOT IMPLY COVERAGE IT DOES NOT HAVE. A class with no gate behind
 *     it carries `signal: []` and renders as an absence at full ink, never
 *     dimmed. Two of the four externally-readable invariant families come out
 *     of this file with NO signal, and that is the finding, not a gap to
 *     paper over:
 *
 *       BACKING       minted supply vs locked backing        → NO GATE
 *       AUTHORITY     proxy implementation, queued proposal  → NO GATE
 *       CONSERVATION  reserves vs share accounting           → covered
 *       PRICE         a feed against a reference             → covered
 *
 * ══ WHERE THE WORDS COME FROM ══════════════════════════════════════════════
 *
 * FIVE of the fourteen WATCH/ACT pairs are REUSED CHARACTER FOR CHARACTER from
 * the nine classes already live at `priime.finance/risk` (marked `[PUB]`
 * below): Oracle divergence, Stablecoin depeg, Partner pause, Bridge lag,
 * Contract upgrade. A SIXTH, `Compute lag`, reuses the published NAME and
 * WATCH verbatim and rewrites only its ACT, for the reason stated at the line
 * — so it is a half-reuse and is counted as one, not as six. Two spellings of
 * one class across two surfaces is the coherence break this house refuses, so
 * a class that fits is copied, not rewritten. EIGHT are new because the
 * published nine have no member for them, and each names the lane it
 * protects. (5 + 1 + 8 = 14. The published `Funding flip`, `TVL drain` and
 * `Slippage creep` are deliberately not carried; see below.)
 *
 * ⚠ COUNT YOUR OWN SETS. The published proactive-risk article captions a
 * six-row table `Five risk surfaces`; that is the defect this paragraph is
 * written to avoid repeating, and `__tests__/exogenous.test.ts` asserts the
 * arithmetic rather than trusting this comment.
 */

/* eslint-disable @typescript-eslint/no-base-to-string --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import type { AxisLane } from "./axes";
import { chainLabel, GATE_IDS } from "./labels";
import type { ProjectedCandidate } from "./opportunities";
/* THE PERP VENUE COMES FROM THE MODULE THAT MEASURED IT. `perp-books.ts` is
   the single owner of "whose book does `hlCoin` name", and its own header
   states the refusal that makes the fact load-bearing: no other venue's book
   has been measured, so no other venue's name may be printed beside a short.
   Values, not types — the point is that the id has ONE home. */
import { FUNDING_VENUE_ID, MEASURED_PERP_VENUE_ID } from "./perp-books";
import { chainIdForVenue } from "./pricing-params";
import { isHandAuthored, type ModuleKey } from "./types";
/* THE CHAIN IDS COME FROM ONE HOME, never from a literal here. On
   build.priime.finance the owner is the bridge module that actually builds
   the Berachain → HL quote, whose `HYPERLIQUID_LIFI_CHAIN_ID` is the id LiFi
   answers on. That module does not travel to this repo; the three values are
   carried in `lib/model-constants.ts` with their provenance lines. Type-only
   imports would not do — these are values, and the point is that they have
   ONE home. */
import {
  BERACHAIN_ID,
  HYPEREVM_ID,
  HYPERLIQUID_LIFI_CHAIN_ID,
} from "@/lib/model-constants";

// ══ THE PARTIES ════════════════════════════════════════════════════════════

/**
 * The six counterparties, and the set is CLOSED.
 *
 * Indexed by the party that acts, never by the symptom. A capital route names
 * parties; it has never named a symptom. That is also what makes two spellings
 * of one class impossible: a class is a property of a party, so it has exactly
 * one home.
 */
export type CounterpartyId =
  | "bridge"
  | "venue"
  | "asset-issuer"
  | "price-feed"
  | "hedge-venue"
  | "scan";

/**
 * ROUTE ORDER, and it is the argument.
 *
 * source chain → venue chain → issuer → feed → hedge venue → us. The order IS
 * the explanation of why each party is on this lane, which is why there is no
 * second route diagram anywhere in the product: the list already draws it.
 *
 * ⚠ NOT THE ANSWERED ORDER. The line the builder moves cuts through the
 * EVIDENCE ordering (`TIER_ORDER`), not through this one — see `answeredSet`.
 * Two encodings of one set share the plate, so they answer different
 * questions: the strip says WHICH, the keys say HOW MANY.
 */
export const COUNTERPARTY_ORDER: readonly CounterpartyId[] = [
  "bridge",
  "venue",
  "asset-issuer",
  "price-feed",
  "hedge-venue",
  "scan",
];

/**
 * How each party is named on a surface.
 *
 * THREE DEPARTURES FROM THE INTERNAL VOCABULARY, each argued:
 *
 *  · `The scan`, not "us". The product's register is second person about the
 *    builder's lane; a row labelled "us" inserts the company into a list of
 *    outside parties. `The scan` is the object that actually degrades, it is
 *    the noun every field behind it belongs to, and the canvas already owns
 *    the word (`scanRef`, `scan-vintage`).
 *
 *  · `The venue`, not "the lending venue", which is false on a funding lane
 *    and on a collar lane. The venue / hedge venue split is the product's own
 *    and already coexists in `register.ts` without confusion.
 *
 *  · `The bridge`, not "the capital route". THIS IS A COLLISION FIX, NOT
 *    TASTE: `review-gating.ts` already ships `the capital router` as a live
 *    noun for the multi-lane orchestrator, one character away, on the same
 *    surface.
 *
 * The definite article is load-bearing. Without it the column reads as a
 * taxonomy, and this set is deliberately not a taxonomy: it names the parties
 * on THIS lane.
 */
export const PARTY_LABEL: Record<CounterpartyId, string> = {
  bridge: "The bridge",
  venue: "The venue",
  "asset-issuer": "The asset issuer",
  "price-feed": "The price feed",
  "hedge-venue": "The hedge venue",
  scan: "The scan",
};

// ══ THE WATCH / ACT PAIRS ══════════════════════════════════════════════════

/**
 * One class: a mechanism, the quantity you read on it, and the written
 * response. The PAIR is the atom — a surface showing only the watch half
 * throws away the half that says why watching is worth anything.
 *
 * `signal` is the list of scanner gate ids that read this class on a live row.
 * EMPTY MEANS NO SIGNAL, and it is rendered as an absence rather than omitted:
 * `feed-age` in `register.ts` sets the precedent, and its reason holds here
 * exactly — deleting the row lets a reader infer coverage, which is the
 * opposite of what we know.
 */
export interface RiskClass {
  /** The class name. `[PUB]` classes carry the published spelling verbatim. */
  name: string;
  /** The quantity that moves. Present tense, no agent. */
  watch: string;
  /** The designed response. Subjectless imperative: a design, not a promise. */
  act: string;
  /** Scanner gate ids that read this class. Empty = no signal behind it. */
  signal: readonly string[];
}

/**
 * FOURTEEN PAIRS. Five reused character for character from the published nine,
 * eight new, and one (`Compute lag`) reusing the published name and watch with
 * its ACT rewritten and the reason at the line. 5 + 8 + 1 = 14.
 *
 * THREE OF THE EIGHT ARRIVED WITH THE EXIT ROUTE (WP-7, 2026-09-03) and each
 * one is a mechanism that had no home before it: `Unsettled balance` and
 * `Custody release` under the hedge venue, `Redemption window` under the asset
 * issuer. None of them adds a party. Off-exchange settlement REDIRECTS a hop
 * on `COUNTERPARTY_ORDER` rather than adding one — the margin sits with the
 * custodian INSTEAD OF the venue — so there is no seventh `CounterpartyId` and
 * the route diagram the list already draws is unchanged.
 *
 * THREE PUBLISHED CLASSES ARE DELIBERATELY NOT CARRIED, and reporting what was
 * refused is part of the work:
 *
 *   04 Funding flip   — already priced on the canvas (`funding-inverts` plus
 *                       the two guard dials). A second spelling inside one
 *                       product is the defect this module exists to close.
 *   05 TVL drain      — the LEVEL is owned by `exit-at-cap` on `capacityUsd`;
 *                       the TREND is not observable from a block-pinned scan.
 *   07 Slippage creep — same split, owned by `capacityBindingLabel` and
 *                       `hl_oi_depth`.
 */
export const CLASSES: Record<CounterpartyId, readonly RiskClass[]> = {
  "price-feed": [
    {
      // [PUB] priime.finance/risk, class 01, all three fields verbatim.
      name: "Oracle divergence",
      watch: "A price feed drifting from DEX spot.",
      act: "Pause and re-source before acting on a bad price.",
      signal: ["oracle_provenance", "oracle_staleness", "independent_price_feed"],
    },
  ],
  venue: [
    {
      // [PUB] class 03, verbatim.
      name: "Partner pause",
      watch: "A venue or pool pausing deposits.",
      act: "Route around it, do not get stuck.",
      signal: ["debt_market_open", "risk_feature"],
    },
    {
      /* NEW, and it is the Dolomite question answered: Partner pause does NOT
         cover this. Market 41's `maxSupplyWei` sat at 1 wei for roughly a
         week; deposits and regrows reverted, unwinds were fine, and NOTHING
         PAUSED. A venue parameter changed and a live strategy broke quietly.
         The ACT line is our own operating experience stated flat. */
      name: "Parameter change",
      watch: "Deposits reverting with nothing paused anywhere.",
      act: "Stop new deposits into the leg and let the open one run.",
      /* ⚠ `capacity_floor` and `borrow_liquidity` WERE HERE and were removed
         (gate fix, 2026-08-27). Both are `cap >= MIN_CAPACITY_USD` — OUR OWN
         size floor against OUR OWN constant (`simulate-v2.ts`), which is the
         same class of gate as `hl_oi_depth` and `hl_min_size`, both already
         exempt three blocks down for exactly that reason. A market being too
         small for us is not a party changing its mind, and the LEVEL is
         already owned by `exit-at-cap` on `capacityUsd` — so carrying it here
         was the second-spelling defect this module exists to close.
         What it cost on screen: `capacity_floor` fails on 22 of the 24 live
         funding rows and on 9 of 9 Dolomite rows, so the venue lamp sat at
         `crossed` — the loudest mark on the plate, documented as "a quantity
         crossed a line that should never have been crossed" — on nearly every
         pickable row, drowning the one true signal underneath it: the
         `caps_fail_closed` freeze that is this module's own headline evidence. */
      signal: ["caps", "caps_fail_closed", "market_sanity"],
    },
    {
      /* [PUB] class 09, verbatim — and it is the AUTHORITY family, which has
         NO GATE in our scanner. A malicious proposal is queued in public
         before it executes, so the lead time is the timelock rather than
         seconds, and we read none of it. Named, never sized. */
      name: "Contract upgrade",
      watch: "A partner contract changing behavior.",
      act: "De-risk before the new code goes live.",
      signal: [],
    },
  ],
  "hedge-venue": [
    {
      /* NEW. The published nine contain no counterparty or custody class, and
         this is the party holding the largest single share of every deposited
         dollar. `offChainVenues` already argues it in code: "its own custody,
         its own uptime and its own withdrawal path, none of which the yield
         model prices." No gate reads a withdrawal queue. */
      name: "Escrow freeze",
      watch: "A perp venue stalling withdrawals or halting the book.",
      act: "Stop adding to the leg until the book clears.",
      signal: [],
    },
    {
      /* NEW (WP-7). THE EXIT RESIDUAL, HALF ONE. `Escrow freeze` is the venue
         refusing to pay; this is the venue not having paid YET, which is the
         normal state of every perp leg between settlements and is therefore
         the exposure that never goes away rather than the one that arrives.
         A short's gain sits as a balance at the venue until the settlement
         cycle moves it, and a lane that counts unsettled gain as margin is
         sizing against a number the venue has not delivered.
         NO GATE: the canvas payload carries a funding percentile and a book
         depth and no settlement cadence at all, so `signal` is empty and the
         row renders as an absence at full ink. Rule 3 of this file's charter. */
      name: "Unsettled balance",
      watch: "A balance the venue owes between settlement cycles.",
      act: "Count only settled margin when sizing the leg.",
      signal: [],
    },
    {
      /* NEW (WP-7). THE EXIT RESIDUAL, HALF TWO, AND IT IS WHY THERE IS NO
         SEVENTH PARTY. Off-exchange settlement does not ADD a hop to
         `COUNTERPARTY_ORDER`: it REDIRECTS one, because the margin sits with a
         custodian INSTEAD OF the venue rather than as well as it. The party
         that has to act for the leg to close is the same slot on the route
         either way, so the class belongs to the hedge venue and a custodian
         gets no row of its own. `COUNTERPARTY_ORDER` is the capital route, and
         a route with two names for one hop is the second-spelling defect this
         module exists to close.
         NO GATE, and none is imaginable from a block-pinned scan: whether a
         custodian will release margin is not a quantity anything reads. */
      name: "Custody release",
      watch: "Margin sitting with a party that has to release it.",
      act: "Keep an exit that does not need that party to act.",
      signal: [],
    },
  ],
  "asset-issuer": [
    {
      // [PUB] class 02, verbatim.
      name: "Stablecoin depeg",
      watch: "A stablecoin losing its peg.",
      act: "Exit the exposure early, before the slide.",
      signal: ["depeg_basis", "peg_class"],
    },
    {
      /* NEW. `thick` is the direct antonym of our own gate label `thin
         redemption liquidity`. The redemption queue backing up is folded in
         here rather than given its own class, because a backing queue is WHY
         the basis widens: one mechanism, one row. */
      name: "Basis widening",
      watch: "An LST trading under what it redeems for.",
      act: "Cut the leg while the exit is still thick.",
      signal: ["wrapper_basis", "redemption_liquidity", "erc4626_integrity", "yield_source_integrity"],
    },
    {
      /* NEW (WP-7), AND IT IS THE ONE CLASS ON THIS LANE THAT IS TIME-VALUED.
         The two classes above are about PRICE: what the asset is worth against
         its peg, and what it trades at against its redemption. This one is
         about the CLOCK: an issuer that redeems on its own calendar rather
         than on demand, so the position is neither in the market nor in hand
         between the request and the cash. That is a different mechanism, so it
         is a different class rather than a sentence bolted onto `Basis
         widening`.
         GATED ON THE LANE'S OWN ROUTE, see `classesFor`: a lane that exits
         through the market has no window to wait on, and `register.ts`'s law
         is that a mechanism which does not exist on this lane is ABSENT rather
         than greyed. So no lane composed before this class existed gains it,
         which is what keeps `dependenciesAnswered` and `responseTriggers`
         byte-identical everywhere the exit route is not seated.
         NO GATE: the window's length is a `stated` reading off an issuer's own
         offering document, and no scanner reads a redemption calendar. */
      name: "Redemption window",
      watch: "An issuer paying redemptions on a schedule rather than on demand.",
      act: "Request the exit before the position has to move.",
      signal: [],
    },
  ],
  bridge: [
    {
      // [PUB] class 06, verbatim. The one bridge quantity the payload carries.
      name: "Bridge lag",
      watch: "Cross-chain messaging slowing down.",
      act: "Hold cross-chain actions until it clears.",
      signal: [],
    },
    {
      /* NEW, and it is the BACKING family — the largest externally observable
         damage class of the year, with NO GATE anywhere in our scanner.
         A bridge that mints unbacked wrapped tokens has not hacked the lending
         market that takes them as collateral; it has POISONED it, and the
         exploit signature is readable from outside, on chain, from the moment
         it happens. We do not read it. That is the honest state. */
      name: "Backing gap",
      watch: "Wrapped supply above the collateral behind it.",
      act: "Stop taking the wrapped asset as collateral.",
      signal: [],
    },
  ],
  scan: [
    {
      /* ⚠ THE ONE DEVIATION FROM THE PUBLISHED SET, and the deviation is
         reported rather than absorbed. Class 08's published ACT is `Fail safe
         before a tick is missed.` The canvas runs no tick, and shipping that
         line verbatim would claim a mechanism this surface does not have. The
         class NAME and WATCH ship verbatim; the ACT is rewritten. */
      name: "Compute lag",
      watch: "Off-chain compute latency degrading.",
      act: "Refuse the price until the read lands.",
      signal: [],
    },
    {
      /* NEW. We have the incident: a dead RPC endpoint took three config
         locations to fix. The canvas payload carries no endpoint health, so
         this class has no signal either — but the class is real and the
         absence is the point. */
      name: "Read failure",
      watch: "A data source answering slower, or not answering.",
      act: "Hold new positions until a second source agrees.",
      signal: [],
    },
  ],
};

/**
 * THE INVARIANT FAMILY each class breaks, and the quantity a third party can
 * read from outside the exploited system.
 *
 * Declared so the coverage finding is CHECKABLE rather than asserted in a
 * comment: `__tests__/exogenous.test.ts` walks this map against `CLASSES` and
 * names any family with no gate behind it anywhere.
 */
export type InvariantFamily = "backing" | "authority" | "conservation" | "price";

/**
 * PARTIAL ON PURPOSE, and the absences carry the argument.
 *
 * A class earns a family only where its break VIOLATES AN INVARIANT a third
 * party can read from outside the exploited system. `Bridge lag`, `Compute
 * lag` and `Read failure` are DEGRADATION — a rail getting slower breaks no
 * promise — so they name no family, and mapping them to one would inflate the
 * coverage claim below with rows that were never evidence for it.
 */
export const CLASS_FAMILY: Partial<Record<string, InvariantFamily>> = {
  /* BACKING — minted supply against locked backing. Broken by an unbacked
     mint, an infinite mint, a spoofed cross-chain message, a forged proof. */
  "Backing gap": "backing",
  /* AUTHORITY — the proxy implementation, the admin set, the queued proposal.
     Broken by an upgrade hijack, improper access control, a malicious
     proposal. Two of its three classes ARE gated; the queued proposal is not,
     and it is the most detectable class of all because it sits in public
     before it executes. That split is why the coverage finding is stated per
     class rather than per family. */
  "Contract upgrade": "authority",
  "Partner pause": "authority",
  "Parameter change": "authority",
  /* CONSERVATION — reserves against share accounting. Broken by incorrect
     share accounting, withdrawal logic flaws, arithmetic errors. */
  "Escrow freeze": "conservation",
  "Basis widening": "conservation",
  /* The two exit residuals are the same invariant as `Escrow freeze` — a
     balance owed against a balance delivered — read at two different moments:
     one before the cycle settles it, one when the party holding it will not
     move it. Neither is gated, which is why `conservation` stays PARTIAL: the
     basis is read, the perp venue's own accounting is not. */
  "Unsettled balance": "conservation",
  "Custody release": "conservation",
  /* ⚠ `Redemption window` NAMES NO FAMILY, on the same ground as `Bridge lag`
     and `Compute lag`: a schedule is not a break. An issuer paying on its own
     calendar violates no invariant a third party can read from outside — it is
     the promise, kept slowly. Mapping it to `conservation` would inflate the
     coverage claim with a row that was never evidence for it, which is the
     defect the partial map at the top of this block exists to prevent. What
     the window costs is priced elsewhere and as time: the `exitCost` axis. */
  /* PRICE — a feed against an independent reference, spot against TWAP. */
  "Stablecoin depeg": "price",
  "Oracle divergence": "price",
};

/**
 * THE SENTENCE A FAMILY WITH NO LIVE SIGNAL GETS.
 *
 * Shape borrowed from `feed-age`'s own published line, which the register
 * renders ANYWAY for the reason stated there: deleting it would let a reader
 * infer that the feed is checked, which is the opposite of what we know. Same
 * precedent, same call. Not shipped as a caveat wall: it is one line, in the
 * row it belongs to, in the register's own grammar.
 */
export const NO_SIGNAL_LINE: Partial<Record<InvariantFamily, string>> = {
  backing: "Nothing on this lane reads supply against backing.",
  authority: "Nothing on this lane reads a queued proposal.",
};

// ══ THE ROUTE ══════════════════════════════════════════════════════════════

/**
 * The venue as a prose noun, WITHOUT its chain qualifier.
 *
 * `venueVerdictNoun` keeps the chain because a refusal has to identify the
 * exact venue it refuses. This sentence is not a refusal, and the qualifier
 * carries a digit (`Aave v3`, `Morpho Blue · Base`) into a line the register's
 * numeric-residue gate strips payload nouns from. So it takes the head and
 * drops the digits with it.
 */
function venueProseNoun(venue: string): string {
  const head = VENUE_PROSE[venue];
  if (head) return head;
  return venue
    .split("-")
    .filter((s) => !/\d/.test(s))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/** Digit-free prose nouns for the venues the catalog carries. The scanner's
 *  own ids are the keys, so a new venue degrades through the humanizer above
 *  rather than through a hand-written default. */
const VENUE_PROSE: Record<string, string> = {
  "aave-v3-base": "Aave",
  "morpho-blue-base": "Morpho Blue",
  "morpho-blue-ethereum": "Morpho Blue",
  "morpho-blue-hyperevm": "Morpho Blue",
  "hyperliquid-funding": "Hyperliquid",
  "dolomite-berachain": "Dolomite",
  "aerodrome-base": "Aerodrome",
  "options-base": "The options venue",
};

/**
 * WHERE THE PERP MARGIN SETTLES, on the ONE perp venue this product has
 * measured a book on. It names no chain of its own in prose, and its numeric
 * id must never reach a string.
 *
 * ⚠ THIS IS NO LONGER THE ANSWER TO "WHICH VENUE IS THIS LANE'S HEDGE VENUE".
 * `hedgeVenueNounOf` is, and every prose site in this file reads that. This
 * constant is the DEFAULT that derivation falls to, and it stays exported
 * because a surface asking "what is the measured perp venue called" is asking
 * a different question from "where does THIS row settle" — the first has one
 * answer for the whole product, the second has one per row.
 *
 * DERIVED, not typed. `perp-books.ts` is the single owner of the fact that
 * `hlCoin` names one venue's book and that every other venue's book is refused
 * (`MEASURED_PERP_VENUE_ID`, and its own header states the refusal). Renaming
 * that id moves this noun with it; typing `"Hyperliquid"` here would leave the
 * two to drift, which is the second-spelling defect this module exists to
 * close.
 */
export const HEDGE_VENUE_LABEL = venueProseNoun(MEASURED_PERP_VENUE_ID);

/**
 * WHICH VENUE HOLDS THE MARGIN BEHIND THIS ROW'S SHORT, read off the row.
 *
 * ⚠ THIS WAS A MODULE CONSTANT AND IT WAS A BUG (WP-7, 2026-09-03). Every
 * prose site interpolated `HEDGE_VENUE_LABEL` directly, so the sentence
 * `The margin behind the ETH short sits on Hyperliquid.` was true by
 * coincidence rather than by derivation: the first row whose short settles
 * anywhere else publishes a named counterparty it does not have, in the one
 * module whose entire argument is that the party list is derived and therefore
 * checkable. A hard-coded party in a derived party list is the defect wearing
 * the module's own uniform.
 *
 * TWO BRANCHES, and neither types a venue name:
 *
 *  · THE ROW'S OWN VENUE, where the row IS the perp venue's own row. The
 *    funding catalog's rows carry the perp venue in `candidate.venue`
 *    (`FUNDING_VENUE_ID`, owned by `perp-books.ts`), and on such a row the
 *    collateral and the margin sit at one company — which is exactly the fold
 *    `dependenciesOf` makes. A second funding catalog on a second venue is
 *    registered in `perp-books.ts` and this sentence follows it with no edit
 *    here.
 *
 *  · OTHERWISE the book `hlCoin` names, and `perp-books.ts` owns whose book
 *    that is. A loop lane's collateral sits on its lending venue and its
 *    margin sits on the perp venue, which is the crossing `routeLegsOf`
 *    already draws.
 *
 * ⚠ WHAT IT CANNOT DO YET, stated rather than papered over: no field on
 * `ProjectedCandidate` names a perp venue, so a CeFi leg is derivable only
 * once its venue is registered as a funding venue or as a measured book. Until
 * then the two branches agree, and the derivation is what makes them separable
 * the day they do not.
 */
export function hedgeVenueNounOf(candidate: ProjectedCandidate): string {
  if (candidate.venue === FUNDING_VENUE_ID) return venueProseNoun(candidate.venue);
  return HEDGE_VENUE_LABEL;
}

/** One crossing on this lane's capital route. */
export interface RouteLeg {
  from: number | null;
  /** Null on the hedge leg: HyperCore is named, never numbered. */
  to: number | null;
  /** The rail this crossing runs on, derived from the two chains. */
  rail: string;
  /** Where the dollar lands, in prose. */
  toLabel: string;
}

/**
 * THE RAIL A CROSSING RUNS ON, derived from the crossing itself.
 *
 * Every branch is a fact about a module this repo ships, and there is no
 * branch for a rail we do not use:
 *
 *   HyperEVM → HyperCore  `hyperevm-to-hl.ts` — an ERC20 transfer to the
 *                         system address credits Spot, then CoreWriter
 *                         `usdClassTransfer` moves Spot to Perp. Both legs
 *                         are agent-signable; the REVERSE needs the user's
 *                         master signature, which is why the close is
 *                         two-phase.
 *   Berachain → HyperCore `bera-to-hyperevm.ts` — verified live against
 *                         li.quest, tool `relaydepository`, 2 to 3 seconds.
 *   → Berachain           Stargate V2's bus route, the tool a LiFi quote
 *                         returns for USDC into Berachain.
 *   anything else         LiFi, the aggregator, diamond-pinned on every
 *                         source chain so a hostile quote is refused.
 *
 * This is NOT a catalog of bridges. It is a function of a route, and a lane
 * with no crossing calls it zero times.
 *
 * ⚠ WHERE THE SOURCE CHAIN IS UNKNOWN IT NAMES THE AGGREGATOR, and that is a
 * true sentence rather than a fallback. `chainIdForVenue` publishes null for
 * `dolomite-berachain` — deliberately, on the ground that the canvas has no
 * source for Berachain's id — so a Dolomite lane's margin leg reads `LiFi`
 * rather than `Relay`. Both name something this repo does: `bera-to-hyperevm`
 * reaches Relay THROUGH a li.quest quote, so LiFi is the rail we call and
 * Relay is the tool it returns. Naming the caller when we cannot name the tool
 * is the honest degradation.
 *
 * HANDOFF, and it is a finding rather than a fix to smuggle in here: the "no
 * source" premise is false today. `BERACHAIN_ID` is exported by
 * `lib/bridge/bera-to-hyperevm.ts`, `BERA_CHAIN_ID` by `lib/bridge/lifi.ts`,
 * and `labels.CHAIN_LABELS` already keys Berachain's id in a map the canvas
 * ships. That is the same class of owner the `aave-v3-base` entry was restored
 * from. Adding the mapping would also change `publishedModelRecord.chainId` on
 * every Dolomite record, which is a published field and a decision that
 * belongs to its own change.
 */
export function railForLeg(from: number | null, to: number | null): string {
  const toHedgeVenue = to === null || to === HYPERLIQUID_LIFI_CHAIN_ID;
  if (toHedgeVenue && from === HYPEREVM_ID) return "HyperCore";
  if (toHedgeVenue && from === BERACHAIN_ID) return "Relay";
  if (!toHedgeVenue && to === BERACHAIN_ID) return "Stargate";
  return "LiFi";
}

/**
 * THE LANE'S CROSSINGS, in the order capital makes them.
 *
 * Two legs are derivable from what the canvas already holds, and neither is
 * assumed:
 *
 *  · DELIVERY. A funding row's spot leg carries its own chain
 *    (`economics.spotLeg.chainId`) and it is frequently not the venue's —
 *    wstETH is on mainnet while the short settles on HyperCore. Different
 *    chains, one crossing.
 *
 *  · MARGIN. A hedged lane has to put margin on the perp venue, which is off
 *    the venue's chain by construction. No hedge, no leg.
 *
 * A single-chain unhedged lane returns `[]`, and its bridge row does not
 * render at all. That is the founder's picker, derived: the rails a lane needs
 * are a function of the lane's capital route.
 */
export function routeLegsOf(
  candidate: ProjectedCandidate | null | undefined,
  hasHedge: boolean,
): RouteLeg[] {
  if (!candidate) return [];
  const venueChain = chainIdForVenue(candidate.venue);
  const spotChain = candidate.economics?.spotLeg?.chainId ?? null;
  const out: RouteLeg[] = [];
  if (spotChain !== null && venueChain !== null && spotChain !== venueChain) {
    out.push({
      from: spotChain,
      to: venueChain,
      rail: railForLeg(spotChain, venueChain),
      toLabel: "",
    });
  }
  if (hasHedge) {
    out.push({
      from: venueChain,
      to: null,
      rail: railForLeg(venueChain, null),
      /* THE LEG LANDS ON THE ROW'S OWN HEDGE VENUE, not on a constant. The
         rail is still a function of the two chains; only the destination's
         NAME moves with the row. */
      toLabel: hedgeVenueNounOf(candidate),
    });
  }
  return out;
}

// ══ THE POSTURE CONTROL ════════════════════════════════════════════════════

/**
 * Three stops, and the cells print COUNTS.
 *
 * `Low | Medium | High` is the ratified adjective ban wearing a new coat, and
 * it is refused without discussion. What a stop actually does is partition the
 * lane's OWN derived set into the parties that get a written response and the
 * parties that get a name only, so the two halves always sum to the set size
 * and moving the line moves both numbers in opposite directions. That is a
 * property no adjective can have and the reason a depositor can check it.
 *
 * The stored VALUES are tier words rather than grades, because the line cuts
 * through the EVIDENCE ordering: `measured` answers the parties this lane
 * holds a complete reading of, `named` reaches the ones the product holds an
 * instrument for, `all` reaches everything the lane depends on.
 *
 * ⚠ THE STOPS WERE THIRDS (recette fix, 2026-08-27). The paragraph above
 * described the design; `answeredCountAt` implemented `ceil(n/3) | ceil(2n/3)
 * | n` — pure arithmetic over the PARTY COUNT, with no reference to any
 * evidence. So the stop labelled `Read` answered two parties on the
 * delta-neutral LP template, a hand-authored row the scan never touched at
 * all, and `MODULE_DEFS` own `defaultRationale` — "the default answers only
 * the parties a quantity is actually read on" — was false on every modeled
 * lane in the product. A stop is a THRESHOLD ON EVIDENCE now
 * (`DependencyReach`), so the count is a consequence of the set instead of the
 * set being a consequence of the count, and the word on the cell is the
 * predicate that produced it.
 */
export type PostureStop = "measured" | "named" | "all";

export const POSTURE_STOPS: readonly PostureStop[] = ["measured", "named", "all"];

export const POSTURE_FIELD = "posture";

/**
 * HOW FAR THIS PRODUCT'S OWN INSTRUMENTS REACH ONE PARTY, on one lane.
 *
 * Three values, strictly ordered, each a predicate on the row's own classes
 * and the row's own scan. Nothing here is a rank table and nothing here is
 * arithmetic: `partial` is not "between" the other two by decree, it is
 * between them because its predicate is strictly weaker than one and strictly
 * stronger than the other.
 *
 *   read     Every class this party can exhibit on this lane names a gate the
 *            scan actually ran. No mechanism of this party is unreadable here.
 *   partial  At least one class names a gate this product runs, AND this lane
 *            does not hold a complete reading of the party. Two routes in, and
 *            they are one statement: a SCANNED row whose party carries a class
 *            with no gate behind it (the venue's `Contract upgrade`), and a
 *            MODELED row, which carries gates on paper and was never scanned.
 *            Both say: the instrument exists, the reading does not.
 *   unread   No class of this party names any gate, on any lane, ever. The
 *            bridge, the hedge venue and the scan live here permanently, and
 *            that is the charter's rule 3 FINDING rather than a gap.
 *
 * ⚠ NOT A SECOND SPELLING OF `tier`, and the difference is load-bearing.
 * `tier` is what the REGISTER publishes about a party (`measured` where a gate
 * read it, `blind` otherwise) and it is the only input to the skip bar's count
 * of what a vault does not measure. `reach` is what the CONTROL partitions on.
 * They answer different questions on purpose: WHAT WE MEASURED MAY NOT DEPEND
 * ON WHERE THE BUILDER PUT THE ANSWERED LINE, so no stop of this control can
 * ever move a row between `measured` and `blind`, and none does — the skip bar
 * is byte-identical at all three stops, by construction and by test.
 */
export type DependencyReach = "read" | "partial" | "unread";

/** Widest reach first. The stop takes a PREFIX of this, which is what makes
 *  `measured ⊆ named ⊆ all` impossible to violate rather than asserted. */
export const REACH_ORDER: readonly DependencyReach[] = ["read", "partial", "unread"];

const STOP_REACH: Record<PostureStop, number> = { measured: 1, named: 2, all: 3 };

/** Whether a stop answers a party of this reach. */
export function stopAdmits(stop: PostureStop, reach: DependencyReach): boolean {
  return REACH_ORDER.indexOf(reach) < STOP_REACH[stop];
}

/**
 * The per-party `Hold` fields — one per counterparty SLOT, fixed forever
 * because the enumeration above is closed.
 *
 * NEVER A LIST, and that is the load-bearing schema decision. `clampAgainst`
 * polices a boolean exactly, so no stored value can ever be invalid; and a
 * hold on a party the lane does not have is INERT rather than stale, because
 * every renderer iterates the DERIVED set and never the stored keys. Nothing
 * goes stale because nothing was ever a list — which is why this design does
 * not depend on `reclampLoopParams`, a function written for exactly this class
 * of problem that has no callers anywhere in the product.
 */
export const HOLD_FIELD: Record<CounterpartyId, string> = {
  bridge: "holdBridge",
  venue: "holdVenue",
  "asset-issuer": "holdAssetIssuer",
  "price-feed": "holdPriceFeed",
  "hedge-venue": "holdHedgeVenue",
  scan: "holdScan",
};

/** Every hold field, in route order. Derived, so a seventh party is
 *  impossible to add here and forget there. */
export const HOLD_FIELDS: readonly string[] = COUNTERPARTY_ORDER.map((id) => HOLD_FIELD[id]);

// ══ THE DERIVED SET ════════════════════════════════════════════════════════

/** The evidence tier of a row, in the register's own vocabulary. */
export type DependencyTier = "measured" | "structural" | "blind";

/** What a row's own quantity says right now. Physical conditions, never
 *  moods: `broken` is deliberately absent — see the note on `stateOf`. */
export type DependencyState = "clear" | "failing" | "stale" | "no signal";

export interface DependencyRow {
  id: CounterpartyId;
  /** `The venue`, `The bridge` — the party, from `PARTY_LABEL`. */
  party: string;
  /**
   * Why this party is on THIS lane: a route fact interpolating the lane's own
   * nouns, never prose. This is where the second-party argument lives, and it
   * lives as six concrete per-lane sentences rather than one abstract
   * paragraph.
   */
  because: string;
  classes: readonly RiskClass[];
  /** Gate ids behind this row, deduplicated, in class order. */
  gates: readonly string[];
  /** Gate ids of this row that the scanned market is FAILING right now. */
  failing: readonly string[];
  tier: DependencyTier;
  /**
   * How far this product's instruments reach this party here. The POSTURE
   * CONTROL partitions on this and nothing else partitions on it; `tier` is
   * the register's word and stays the register's word. See `DependencyReach`
   * for why the two must not be collapsed.
   */
  reach: DependencyReach;
  state: DependencyState;
  /**
   * Distinct readable quantities this party carries: the scanner gates its own
   * classes name, and nothing else. The venue carries five; the bridge and the
   * scan carry none, because every class they hold has an empty `signal`. That
   * spread is what makes `responseTriggers` a different integer from
   * `dependenciesAnswered` rather than a restatement of it.
   */
  triggers: number;
  /** Families this row names that no signal reaches, in class order. */
  unsignalled: readonly InvariantFamily[];
}

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

/**
 * THE CLASSES A PARTY CAN ACTUALLY EXHIBIT ON THIS LANE.
 *
 * `register.ts` states the law this implements: "an entry whose mechanism does
 * not exist on this lane is ABSENT, not greyed". A catalogue of everything an
 * asset issuer has ever done is not the same object as a list of what THIS
 * issuer can do to THIS position, and printing the first while claiming the
 * second is the wall this whole module exists to avoid.
 *
 * TWO PREDICATES, both on the asset issuer, both derived rather than typed.
 *
 *  · THE DENOMINATION, on one pair of classes: the scanner gives every
 *    USD-family collateral `hlCoin: null` and every ETH/BTC/alt collateral a
 *    perp coin, on all thirty-nine pairs in the fixture catalog. So a lane
 *    with no perp coin is denominated in a PEG, where the failure is the peg
 *    breaking; a lane with one is denominated in an asset, where the failure
 *    is the wrapper trading under what it redeems for. Neither mechanism
 *    exists on the other kind of lane.
 *
 *  · THE EXIT, on `Redemption window`: a redemption calendar is a mechanism
 *    only on a lane that leaves through the issuer. A lane that leaves through
 *    the market sells the asset and never files a request, so it has no window
 *    to wait on and the class is ABSENT rather than greyed. The predicate is
 *    the lane's own seated route (`redemption-route`), which is the same shape
 *    `hasHedge` already uses to seat the hedge venue: the party set follows the
 *    capital route, and a route the builder has not composed is not one this
 *    lane has.
 */
function classesFor(
  id: CounterpartyId,
  candidate: ProjectedCandidate,
  placed: readonly ModuleKey[],
): readonly RiskClass[] {
  const list = CLASSES[id];
  if (id !== "asset-issuer") return list;
  const pegged = candidate.hlCoin === null || candidate.hlCoin.length === 0;
  const exitsThroughIssuer = placed.includes("redemption-route");
  return list.filter((k) => {
    if (k.name === "Redemption window") return exitsThroughIssuer;
    return pegged ? k.name !== "Basis widening" : k.name !== "Stablecoin depeg";
  });
}

/** The gate universe the product knows, used to prove the partition below is
 *  made of real gate ids rather than invented ones. */
export const KNOWN_GATE_IDS: ReadonlySet<string> = new Set(GATE_IDS);

/**
 * Gates that belong to NO counterparty, and why each is exempt.
 *
 * `lt_geometry` and `emode_geometry` are STRUCTURAL (a market's shape, not a
 * party's decision); `marginal_rates_carry` and `rate_inversion_p25` are
 * ENDOGENOUS (the position's own arithmetic, already owned by the leverage
 * module and the funding guard); `funding_p25_floor`, `hl_oi_depth`,
 * `hl_min_size`, `native_perp`, `no_perp_confirmed` are the hedge venue's
 * DEPTH and FUNDING, and `capacity_floor` and `borrow_liquidity` are our own
 * size floor on the lending leg — all four kinds are already priced or
 * capacity-bound on the canvas, so carrying any of them here would be the
 * second spelling this module exists to delete.
 */
export const UNASSIGNED_GATES: readonly string[] = [
  /* OUR OWN LAUNCHABILITY FLOORS (moved here 2026-08-27) — `cap >=
     MIN_CAPACITY_USD` on our own constant, not a party's decision, and the
     level is already owned by `exit-at-cap` on `capacityUsd`. Same ground as
     `hl_oi_depth` and `hl_min_size` below. */
  "capacity_floor",
  "borrow_liquidity",
  "lt_geometry",
  "emode_geometry",
  "marginal_rates_carry",
  "rate_inversion_p25",
  "funding_p25_floor",
  "hl_oi_depth",
  "hl_min_size",
  "native_perp",
  "no_perp_confirmed",
  "same_underlying",
  "wrapper",
];

/**
 * DOES THIS LANE HOLD THIS PARTY? One predicate per counterparty, each a
 * function of the payload and never of a stored flag.
 */
function partyPresent(
  id: CounterpartyId,
  candidate: ProjectedCandidate,
  hasHedge: boolean,
  legs: readonly RouteLeg[],
): boolean {
  switch (id) {
    case "bridge":
      return legs.length > 0;
    case "venue":
      return true;
    case "asset-issuer":
      /* A CLAIM ON AN ISSUER, and the payload says so without us guessing: an
         asset that pays a yield IT DOES NOT MINT is accruing on somebody
         else's feed, which is the same thing as saying somebody else owes you
         something for it. A plain spot token — PUMP, DOGE, XRP — carries no
         such promise and gets no row, which is why the predicate is the yield
         and not the mere presence of an asset. Both legs are read because a
         funding lane's held asset lives on `spotLeg` rather than on
         `collateralYieldApy`. */
      return (
        (candidate.economics?.collateralYieldApy ?? 0) > 0 ||
        (candidate.economics?.spotLeg?.apy ?? 0) > 0
      );
    case "price-feed":
      /* A THIRD-PARTY FEED IS A PARTY ONLY WHERE IT CAN LIQUIDATE. A lane with
         no debt leg has no lending oracle standing between it and a loss; the
         perp's own mark belongs to the hedge venue's row, not to a second
         one. */
      return candidate.lt !== null && candidate.debtSymbol.length > 0;
    case "hedge-venue":
      return hasHedge;
    case "scan":
      return true;
  }
}

/** The route fact for one party, interpolating the lane's own nouns. */
function becauseFor(
  id: CounterpartyId,
  candidate: ProjectedCandidate,
  legs: readonly RouteLeg[],
  venueNoun: string,
  /** The row's own hedge venue (`hedgeVenueNounOf`), never a module constant. */
  hedgeNoun: string,
  chainName: (id: number | null) => string,
): string {
  switch (id) {
    case "bridge": {
      const rails = uniq(legs.map((l) => l.rail));
      const dest = legs[legs.length - 1];
      const where = dest.toLabel || chainName(dest.to);
      if (rails.length > 1) {
        return `A dollar reaches ${where} through ${rails[0]}, then ${rails[1]}.`;
      }
      return `A dollar reaches ${where} through ${rails[0]}.`;
    }
    case "venue":
      return `${venueNoun} holds your collateral under parameters it sets.`;
    case "asset-issuer":
      return `${candidate.collateralSymbol} is worth what its issuer redeems it for.`;
    case "price-feed":
      return `The price that liquidates ${candidate.pair} is not one this lane publishes.`;
    case "hedge-venue":
      return `The margin behind the ${candidate.hlCoin ?? candidate.collateralSymbol} short sits on ${hedgeNoun}.`;
    case "scan":
      return `${candidate.pair} was read once, over one endpoint.`;
  }
}

/**
 * THE STATE, and `broken` is deliberately not in it.
 *
 * The strongest state to design is the one where a number crossed a line that
 * should never have been crossed — supply above backing. That state is
 * correct, and NO FIELD IN THE PAYLOAD CAN PRODUCE IT TODAY. A state the UI
 * can render with no producer is either dead code or a lie, so it does not
 * ship. It is written down in `DependencyState`'s own doc so nobody mints a
 * second spelling of it when the signal lands.
 */
function stateOf(tier: DependencyTier, failing: readonly string[], priced: boolean): DependencyState {
  if (tier === "blind") return "no signal";
  if (failing.length > 0) return "failing";
  if (!priced) return "stale";
  return "clear";
}

/* ⚠ TOMBSTONE — `extraTriggers` (deleted 2026-08-27, gate pass).
   ------------------------------------------------------------------------
   It promoted a party to `measured` on two facts that read NOTHING about that
   party's classes: the bridge, because `economics.spotLeg` was a non-null
   object; the scan, because `gatesTotal > 0`. Both parties carry ONLY classes
   whose `signal` is empty, so on the live `hyperliquid-funding` row the
   published register said, at `measured` tier with a resolving field path:

       Bridge lag, Backing gap       clear
       Compute lag, Read failure     clear

   — a `clear` verdict on four mechanisms nothing in this product reads, one
   of them the BACKING family this module exists to report as unsignalled. The
   dock printed `The bridge · CLEAR` immediately above its own sentence
   `Nothing on this lane reads supply against backing.`

   That is rule 3 of this file's charter broken on screen. A party is
   `measured` if and only if a CLASS of it names a gate the scan actually ran.
   A payload field that resolves is not evidence about a mechanism it does not
   read, and there is no third source of evidence to restore here. */

/**
 * THE DERIVED SET — every party this lane's capital route actually has, in
 * route order.
 *
 * NEVER STORED, recomputed every render, over exactly the inputs
 * `pricingParamsFor` already reads. Swap the market, eject the hedge, change
 * the venue: the list re-derives on the same frame, and nothing is
 * "preserved" because nothing was kept.
 *
 * A hand-authored template row carries no scanned gates at all, so every one
 * of its parties comes back `blind` / `no signal`. That is the honest reading
 * of a modeled row and not a degradation: nothing read it.
 */
export function dependenciesOf(lane: Pick<AxisLane, "candidate" | "placed">): DependencyRow[] {
  const c = lane.candidate;
  if (!c) return [];
  const hasHedge = lane.placed.includes("hedge");
  const legs = routeLegsOf(c, hasHedge);
  const failedGates = new Set(c.failedGates ?? []);
  /* A modeled row was never scanned, so no gate on it can be evidence about
     anything. `isHandAuthored` is the owner of that fact. */
  const scanned = !isHandAuthored(c.economics) && c.gatesTotal > 0;
  const venueNoun = venueProseNoun(c.venue);
  /* ONE READ OF THE ROW'S HEDGE VENUE, and every sentence below takes it from
     here. A leg whose destination is `null` lands on a VENUE rather than on a
     chain, which is the one place `chainName` is asked a question about a
     party instead of about a chain. */
  const hedgeNoun = hedgeVenueNounOf(c);
  const chainName = (id: number | null) => (id === null ? hedgeNoun : chainProse(id));

  /**
   * ⚠ ONE ROW PER PARTY, AND THE PARTY IS THE ENTITY — NOT THE SLOT (gate fix,
   * 2026-08-27).
   *
   * On a `hyperliquid-funding` lane the venue holding the collateral and the
   * venue holding the perp margin are ONE company, and the derivation listed
   * both slots. The live funding row published, on the plate and in the dock:
   *
   *     The venue        Hyperliquid holds your collateral under parameters it sets.
   *     The hedge venue  The margin behind the HYPE short sits on Hyperliquid.
   *
   * — and counted them as two of five dependencies. The whole claim this module
   * makes is that the count is derived and therefore checkable; a count that
   * names one counterparty twice fails that check on every row of the funding
   * catalogue.
   *
   * DERIVED, never a venue id typed into an `if`: the fold fires when the
   * venue's own prose noun IS the hedge venue's, through `VENUE_PROSE`, which
   * is already the single owner of that name. Add a second perp venue and the
   * fold follows it with no edit here. The `hedge-venue` slot's classes travel
   * into the surviving row, so `Escrow freeze` is not lost — only the second
   * spelling of the party is. `holdHedgeVenue` then sits inert on such a lane,
   * which is exactly what this design says a hold on an absent party does.
   */
  const venueIsHedgeVenue = hasHedge && venueNoun === hedgeNoun;

  const out: DependencyRow[] = [];
  for (const id of COUNTERPARTY_ORDER) {
    if (!partyPresent(id, c, hasHedge, legs)) continue;
    if (venueIsHedgeVenue && id === "hedge-venue") continue;
    const classes =
      venueIsHedgeVenue && id === "venue"
        ? [...classesFor("venue", c, lane.placed), ...classesFor("hedge-venue", c, lane.placed)]
        : classesFor(id, c, lane.placed);
    const gates = uniq(classes.flatMap((k) => k.signal));
    const failing = gates.filter((g) => failedGates.has(g));
    /* ONE SOURCE OF EVIDENCE, and it is the class's own gate. See the
       tombstone above `dependenciesOf` for what the second source published. */
    const hasSignal = scanned && gates.length > 0;
    const tier: DependencyTier = hasSignal ? "measured" : "blind";
    /* THE REACH, per class rather than per row. `gates` is a UNION over the
       party's classes, so `gates.length > 0` says only that SOMETHING about
       this party is instrumented — the venue clears it on `Partner pause`
       while `Contract upgrade` sits behind no gate at all. Counting the GATED
       CLASSES against the classes the party actually has is what separates a
       party this lane sees whole from one it sees in part, and it is the only
       reason the three stops land on three different integers on a scanned
       lane instead of two. */
    const gatedClasses = classes.filter((k) => k.signal.length > 0).length;
    const reach: DependencyReach =
      gates.length === 0
        ? "unread"
        : hasSignal && gatedClasses === classes.length
          ? "read"
          : "partial";
    out.push({
      id,
      party: PARTY_LABEL[id],
      because:
        venueIsHedgeVenue && id === "venue"
          ? /* The copy team wrote this sentence for exactly this lane and
               handed it over with the de-dup; it is the only line in the set
               that has to name two exposures to one party. */
            `${venueNoun} holds your collateral and the margin behind the short.`
          : becauseFor(id, c, legs, venueNoun, hedgeNoun, chainName),
      classes,
      gates,
      failing,
      tier,
      reach,
      state: stateOf(tier, failing, scanned),
      /* ZERO WHERE NOTHING WAS READ, and the guard is not decoration: a
         hand-authored row was never scanned, so its gates are not evidence
         about anything and counting them would report readable triggers on a
         party we read nothing on. `responseTriggers` sums this, and a sum of
         phantom triggers is exactly the shape of number this codebase deletes
         on sight. */
      triggers: hasSignal ? gates.length : 0,
      unsignalled: uniq(
        classes
          .filter((k) => k.signal.length === 0)
          .map((k) => CLASS_FAMILY[k.name] ?? "")
          .filter((f) => f.length > 0),
      ) as InvariantFamily[],
    });
  }
  return out;
}

/**
 * A chain in prose, THROUGH THE ONE OWNER (single-owner fix, 2026-08-27).
 *
 * This was a four-entry table byte-identical to `labels.CHAIN_LABELS` — the
 * second spelling of one fact, in a module whose entire argument is that two
 * spellings of one fact is the defect. It also degraded WORSE than silently: a
 * chain added to `labels.ts` would keep reading `another chain` here forever,
 * with nothing red to say so.
 *
 * The one thing `chainLabel` does that this sentence cannot take is its own
 * fallback, `chain 42161` — a chain id is a number wearing a name, and the
 * register's numeric-residue gate strips payload NOUNS, not payload ids. So
 * the digit is refused at the boundary and the sentence names an unnamed chain
 * as one, which is what the old table's own comment promised.
 */
function chainProse(id: number): string {
  const label = chainLabel(id);
  return /\d/.test(label) ? "another chain" : label;
}

// ══ THE ANSWERED LINE ══════════════════════════════════════════════════════

/**
 * WHICH PARTIES CARRY A WRITTEN RESPONSE.
 *
 * The stop is a THRESHOLD ON THE ROW'S OWN REACH, so the narrow stop answers
 * exactly the parties this lane holds a complete reading of — zero of them on
 * a lane the scan never touched, which is the honest answer and the one the
 * old thirds arithmetic could not produce. Each `Hold` then moves exactly one
 * party across the line, in either direction.
 *
 * ⚠ IT SORTED AND SLICED (recette fix, 2026-08-27). `[...rows].sort(byTier)`
 * then `.slice(0, ceil(n/3))` made MEMBERSHIP a function of the party COUNT
 * and of ARRAY POSITION: two parties with identical evidence could land on
 * opposite sides of the line because one was earlier in route order, and
 * adding a sixth party to a route promoted a party whose evidence had not
 * changed. A predicate has neither failure mode, and the count now falls out
 * of the set rather than defining it.
 *
 * A `Hold` CAN NEVER REMOVE A PARTY FROM THE SET. That is the whole reason the
 * completeness claim is unreachable by construction: `skipBarLabel` refuses to
 * render below one blind entry "because a bar stating that we measure
 * everything is a completeness claim", and a switch that could shrink the
 * named set would let a builder publish exactly that on a vault whose
 * dependencies had not changed.
 */
export function answeredSet(
  rows: readonly DependencyRow[],
  stop: PostureStop,
  holds: Readonly<Record<string, boolean>> = {},
): Set<CounterpartyId> {
  const out = new Set<CounterpartyId>(
    rows.filter((r) => stopAdmits(stop, r.reach)).map((r) => r.id),
  );
  for (const r of rows) {
    if (!holds[HOLD_FIELD[r.id]]) continue;
    if (out.has(r.id)) out.delete(r.id);
    else out.add(r.id);
  }
  return out;
}

/** Σ of the answered parties' distinct readable triggers. */
export function responseTriggers(
  rows: readonly DependencyRow[],
  answered: ReadonlySet<CounterpartyId>,
): number {
  return rows.filter((r) => answered.has(r.id)).reduce((s, r) => s + r.triggers, 0);
}

/** The stop a lane's stored params name, defaulted through the descriptor's
 *  own owner by the caller. An unknown string falls to the narrow stop rather
 *  than to a guess. */
export function postureOf(params: Readonly<Record<string, unknown>> | undefined): PostureStop {
  const v = String(params?.[POSTURE_FIELD] ?? "");
  return (POSTURE_STOPS as readonly string[]).includes(v) ? (v as PostureStop) : "measured";
}

/** The lane's holds, as the derivation reads them. */
export function holdsOf(
  params: Readonly<Record<string, unknown>> | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const f of HOLD_FIELDS) out[f] = params?.[f] === true;
  return out;
}

/**
 * EVERYTHING A SURFACE NEEDS ABOUT ONE LANE'S WATCHER, from one call.
 *
 * The plate, the dock, the shelf and the register all read this, so four
 * surfaces cannot form four opinions about one lane's dependencies.
 */
export interface WatchView {
  /** The derived set, in route order. Empty before a market is pinned. */
  rows: DependencyRow[];
  answered: Set<CounterpartyId>;
  posture: PostureStop;
  /** `rows.length` — the named count. */
  named: number;
  /** `answered.size` — the count the control's cells print. */
  answeredCount: number;
  triggers: number;
  /**
   * PARTIES NOTHING IN THIS PRODUCT READS, on any lane, ever — `reach:
   * "unread"`. THE NUMBER THE SHELF OWES THE BUILDER BEFORE THEY PRESS.
   *
   * Installing this module replaces ONE blind register row standing for four
   * lumped dependencies with one row PER PARTY, so the skip bar's count of
   * what a vault does not measure RISES: 2 → 4 on the leveraged-loop template,
   * 1 → 5 on the delta-neutral LP. That rise is arithmetic on a truer
   * enumeration and it is not a regression — but a builder who presses a key
   * called "exogenous risk" and watches an unmeasured counter go up has been
   * told the opposite of what happened. So the shelf states this integer
   * BEFORE the press, in the same breath as `named`, and the rise arrives as
   * the number the panel already quoted.
   */
  unreadCount: number;
  /**
   * What each stop would answer ON THIS LANE, WITH THIS LANE'S HOLDS. The
   * cells print these, so `stopCounts[posture] === answeredCount` always.
   */
  stopCounts: Record<PostureStop, number>;
}

export function watchViewOf(lane: Pick<AxisLane, "candidate" | "placed" | "params">): WatchView {
  const rows = dependenciesOf(lane);
  const params = lane.params?.["exogenous-risk"];
  const posture = postureOf(params);
  const holds = holdsOf(params);
  const answered = answeredSet(rows, posture, holds);
  /* ⚠ THE CELLS COUNT THE HOLDS TOO (gate fix, 2026-08-27).
     These were a closed-form count that ignored holds — so a single `Hold`
     desynced the lit cell from the lane's actual answered count and the plate
     printed a number the lane did not have. On a six-party lane at the top
     stop with every party held, the cell read `6` while nothing was answered
     at all. The whole reason this control is three counts rather than
     `Low | Medium | High` is that "a depositor can check it"; a cell that a
     hold can silently falsify is not checkable, and the adjective ban was
     bought for nothing. One producer for the lit cell and for every other
     cell, so the two can never disagree. */
  const stopCounts = {} as Record<PostureStop, number>;
  for (const s of POSTURE_STOPS) stopCounts[s] = answeredSet(rows, s, holds).size;
  return {
    rows,
    answered,
    posture,
    named: rows.length,
    answeredCount: answered.size,
    triggers: responseTriggers(rows, answered),
    unreadCount: rows.filter((r) => r.reach === "unread").length,
    stopCounts,
  };
}
