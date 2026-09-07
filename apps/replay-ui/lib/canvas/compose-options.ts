/**
 * COMPOSE PRESENTATION (COMPOSE_PANEL_SPEC §3.6) — the panel's view of what a
 * lane holds, can take, and refuses.
 *
 * ⚠ THIS FILE DOES NOT DECIDE ADDABILITY. `graph-ops.addableModules()` is the
 * ONE derivation (model-core wave, 2026-08-22) and this module delegates to it
 * verbatim. What lives here is strictly PRESENTATION on top of that answer:
 * the refusal sentences (one per validateGraph issue code), whether a seated
 * module may be removed, the hedge's signed value on THIS lane, and the sort.
 * If you find yourself adding a condition about WHETHER a module can be
 * placed, it belongs in graph-ops, not here.
 *
 * Before the consolidation there were THREE opinions about what was addable:
 * `FAMILY_CHAINS`, `validateGraph()`, and a hand-rolled expression in the dock
 * (`hedgedClass && !hasHedge && (hasSafety || family === "dnlp")`). A third
 * opinion is how the next drift starts, so the hand-rolled one is gone and
 * every surface — the compose panel, the ghost slots, the mobile sheet, any
 * future copilot surface — reads the one derivation.
 *
 * TWO INVARIANTS, both tested:
 *
 *  T5 — every blocked reason is derived from a `validateGraph()` issue that
 *       the simulated addition actually raises. The panel cannot invent a
 *       refusal the validator would not make, and it cannot go quiet about
 *       one the validator would.
 *
 *  T6 — no module is ever OFFERED whose addition would introduce a new
 *       validation issue. This is not hypothetical: `laneFamily()` is derived
 *       from the placed module set, so adding auto-center to a loop lane
 *       flips it to family "dnlp", whose chain excludes safety-buffer, so the
 *       installed leverage module falls outside `chainSet` and raises
 *       `family-mismatch` — the user's working lane becomes unpublishable in
 *       one click WHILE still showing a confident APY (only
 *       `unhedged-class-forbids-hedge` blanks the number). Padding the panel
 *       to fill the dock is exactly how that self-destruct button ships.
 *
 * ══ THE UNCOMMITTED LANE (§2 M1/M4, §4D, 2026-08-22) ══════════════════════
 *
 * A BLANK LANE IS A LANE, NOT AN UNFINISHED LOOP. This file used to open with
 * `const family = src.family` — `laneFamily()`, which is TOTAL and answers
 * `"loop"` for an empty node set — and then read the loop's chain, the loop's
 * required set and the loop's own word out of it. Every one of those three was
 * an assertion the builder had not made: the shelf sorted by the loop chain
 * (so `safety-buffer` scored 1 and the other three anchors tied at 99), the
 * required line said `required to launch a loop lane`, and the skip bar said
 * `1 module does not fit a loop lane` on a canvas holding nothing.
 *
 * `committedFamily()` is now the ONE accessor, and `null` from it is a fact,
 * not an absence: the lane has not chosen. Read `bound` below before reaching
 * for any family word, family chain or family model. `family` survives on the
 * result as a pass-through of `laneFamily()` for the consumers that already
 * knew their lane was bound; nothing in this file reads it any more.
 *
 * THE CHAIN RECEIPT, and its retirement: adding a hedge to a loop lane with no
 * safety-buffer USED to seat two plates, so the add key had to say
 * `adds dynamic leverage too`. `hedge-requires-safety-buffer` was deleted
 * 2026-08-22, `implies` is `[]` on every lane, and the receipt renders only if
 * a future rule brings a real prerequisite back.
 */

import type { LoopGraph, ModuleKey, ModuleNode } from "./types";
import {
  addableModules,
  committedFamily,
  committedStrategy,
  FAMILY_CHAINS,
  FAMILY_LABEL,
  FAMILY_REQUIRED_GROUPS,
  laneStrategies,
  nodeFor,
  OVERLAY_KEYS,
  STRATEGY_LABEL,
  type LaneFamily,
} from "./graph-ops";
import type { StrategyKind } from "@/lib/vaults/store";
import { familiesForCandidateId } from "./templates";
import { DISPLAY_ORDER, MODULE_DEFS } from "./modules";
import { hedgeEconomics } from "./hedge-econ";
import type { ProjectedCandidate } from "./opportunities";
import { dominatedModules, verdictRow } from "./leverage-module";
import { leverageBayTriple, leverageMechanism } from "./leverage-bay";
import type { LaneComposition } from "./mock-quote";
import type { RiskPreset } from "./param-schema";

/**
 * How a family names itself. ONE OWNER, and it is `graph-ops`, beside
 * `FAMILY_CHAINS` where the family is declared (§2C S2).
 *
 * It lived here as a private copy spelling the collar `treasury-collar` while
 * `graph-ops` spelled it `collar`, so the dock and the validator described one
 * lane with two words. Re-exported rather than moved out of reach: the panel
 * imports this module already, and the import must never run the other way.
 */
export { FAMILY_LABEL, STRATEGY_LABEL } from "./graph-ops";

/** The family each module belongs to, derived from FAMILY_CHAINS itself so a
 *  new family cannot leave this map stale. Shared modules list every home. */
const HOME_FAMILIES: Record<ModuleKey, LaneFamily[]> = (() => {
  const out = {} as Record<ModuleKey, LaneFamily[]>;
  for (const key of DISPLAY_ORDER) {
    out[key] = (Object.keys(FAMILY_CHAINS) as LaneFamily[]).filter((f) =>
      FAMILY_CHAINS[f].includes(key),
    );
  }
  return out;
})();

export interface ComposeInstalled {
  key: ModuleKey;
  /** Removing it would leave a required group unsatisfied: no cross renders. */
  required: boolean;
  /** Optional AND not required here — the only removable case. */
  removable: boolean;
}

export interface ComposeAddable {
  key: ModuleKey;
  /** Required by the family and missing: this is what blocks publishing. */
  required: boolean;
  /** Modules the add installs ALONGSIDE this one (the chain receipt). */
  implies: ModuleKey[];
  /** Signed modeled value of the module on THIS lane; null when unpriced. */
  valueDelta: number | null;
  /**
   * THE MARKET RULED IT OUT (design ruling 2026-08-23). True on exactly the
   * keys `dominatedModules(verdictRow)` names: every setting the module offers
   * on this market is beaten on all three declared axes, so the bay wears the
   * `.cpz-bay--neg` register, keys `Add anyway`, and is never `required`. It
   * is still OFFERED: the dock is the override; only the rack's ghost bay is
   * gone. False on a blank lane, always.
   */
  dominated: boolean;
  /**
   * The two endpoints of the press, for the modules whose press moves the
   * lane's number without a market-level hero to read it from. Today that is
   * `safety-buffer` only: `from` is the lane with no borrow leg, `to` is the
   * lane at the landing the press seats, both `composedNetApy` on the
   * UNREPRICED scan row. Null on every other key, and null where nothing can
   * be promised (no scan row, no debt market, a landing at the floor).
   */
  triple: { from: number; to: number } | null;
  /**
   * ONE mechanism sentence once a market is pinned, for the keys whose
   * mechanism names the market's own numbers. `safety-buffer`: `Borrows WHYPE
   * at 3.66% to hold kHYPE at 1.97%.` Null lets the panel print the module's
   * market-free line.
   */
  mechanism: string | null;
  /**
   * What pressing this key COSTS the builder, on an UNBOUND lane only (§4D).
   *
   * `keeps every strategy open` · `keeps 3 of the 4 strategies open` ·
   * `makes this a treasury collar lane`. Generated from `laneStrategies` and
   * `STRATEGY_LABEL`, never hand-written, so a fifth strategy cannot leave the
   * copy stale — and it is the KEY the §4D order prints about itself, which is
   * what keeps a ranked shelf from reading as a recommendation.
   *
   * Null on a bound lane, where the required line is the honest one instead.
   */
  consequence: string | null;
}

export interface ComposeBlocked {
  key: ModuleKey;
  /** The `validateGraph()` issue code the refusal mirrors, one-to-one. */
  code: string;
  /** `Dynamic hedge` — the module, for the skip register's own name column. */
  name: string;
  /** `this market has no perp to hedge with.` — the refusal, name stripped. */
  sentence: string;
  /**
   * ⚠ DEPRECATED, and it is a DERIVED view of the two fields above — never a
   * second string. `${name} — ${sentence}`, the shape `refusalFor` used to
   * return whole and `BlockedGroup` used to take apart again with
   * `reason.split(" — ")`. That split was a contract carried in a delimiter,
   * and the delimiter was a user-facing em dash in six sentences.
   *
   * Nothing in the product renders this. It survives for
   * `lib/canvas/__tests__/plate-frames.test.ts`, whose T5 assertions still
   * read it (that file is owned by another item in this wave).
   *
   * HANDOFF: delete this field once those two assertions read `sentence`.
   */
  reason: string;
}

export interface ComposeOptions {
  /** `laneFamily()` — TOTAL, and unchanged. Nothing in this file reads it. */
  family: LaneFamily;
  /**
   * The families still consistent with everything the lane has EXPRESSED, its
   * module set and the market it pinned (`committedFamilies`). Pass-through,
   * never a new derivation. Length > 1 means the lane has chosen nothing yet.
   */
  families: LaneFamily[];
  /**
   * The single family the lane has committed to, or NULL while it is open.
   * `committedFamily()`, passed through so no surface re-derives it — and the
   * null is the signal every family word, chain and model must gate on.
   */
  bound: LaneFamily | null;
  /**
   * The STRATEGIES still consistent with everything the lane has expressed
   * (`laneStrategies` — the funding launch rail's layer above the families,
   * 2026-08-24). The shelf head counts THESE, not the families: the loop
   * family holds two products (the levered loop and the funding carry), and a
   * head that said "3 strategies" over a shelf whose presses can still reach
   * four was under-counting the choice.
   */
  strategies: StrategyKind[];
  /**
   * The single strategy the lane has committed to, or NULL while it is open.
   * `committedStrategy()`, passed through so no surface re-derives it. Where
   * a surface needs a product word for a bound lane (the required line, the
   * publish record), this outranks the family word: a funding lane is bound
   * to the loop FAMILY and the word the builder chose is "funding carry".
   */
  boundStrategy: StrategyKind | null;
  /**
   * The chain a checklist may walk: the committed family's own chain when
   * bound, and ONLY THE PLACED MODULES while unbound (§2D O7). The collapsed
   * dot row used to print the loop chain for a lane that had chosen nothing.
   */
  chain: ModuleKey[];
  installed: ComposeInstalled[];
  addable: ComposeAddable[];
  blocked: ComposeBlocked[];
  /** The keys the pinned market ruled dominated. `[]` on a blank lane. */
  dominated: ModuleKey[];
}

/**
 * THE MARKET BEHIND THE LANE, threaded in from the one place it is in hand
 * (`RackCanvas.scanRowFor`). Optional, and every field optional, so the
 * panel's blank-lane and cold-catalog paths are byte-identical to before.
 *
 * ⚠ `scanRow` IS THE UNREPRICED CATALOG ROW. It feeds the triple's ceiling
 * (`landingLeverage` on the row's own `loopLeverage`). The SIGN — which keys
 * are dominated — falls back to `candidate` through `verdictRow` when the
 * catalog has gone quiet, because the sign is reprice-invariant and the
 * ceiling is not.
 */
export interface ComposeMarket {
  scanRow?: ProjectedCandidate | null;
  /** The lane's composition, so the triple prices the lane as composed. */
  comp?: LaneComposition | null;
  preset?: RiskPreset;
}

/** What a refusal knows about the lane it is refusing on. */
interface RefusalContext {
  /** The module being refused. */
  key: ModuleKey;
  /** The lane's committed family, or null while it is open. */
  lane: LaneFamily | null;
  /** The pinned market's pair label, `""` when nothing is pinned. */
  pair: string;
  /** The family the pinned market can be priced as, or null. */
  market: LaneFamily | null;
  /** What is already seated on the lane. Named when the lane has no family
   *  word to name instead — see `family-mismatch` below. */
  placed: ModuleKey[];
}

/**
 * The sentence a refusal that nobody wrote gets.
 *
 * The forward-compatible fallback used to be `${code.replace(/-/g," ")}`,
 * which is how `Auto center — market family mismatch` reached production: a
 * machine string in a user's face, quoted by the founder, on a code that is
 * reachable in two presses. A fallback must be a SENTENCE, and the test below
 * asserts no code `addableModules()` can actually produce reaches it.
 */
export const REFUSAL_FALLBACK = "not available on this lane.";

/**
 * ONE BRANCH PER VALIDATOR CODE (§7D), so a panel refusal and a validator
 * refusal cannot describe different worlds.
 *
 * Each sentence states the WORLD THAT WOULD ACCEPT the module, in the fewest
 * words, with no taxonomy — and reads correctly with the module's name
 * stripped off the front, because the skip register prints the name in its own
 * column. No em dash: the name and the sentence are two fields, not one string
 * with a delimiter contract inside it.
 */
const REFUSALS: Record<string, (ctx: RefusalContext) => string> = {
  "unhedged-class-forbids-hedge": () => "this market has no perp to hedge with.",

  "compound-requires-carry": () => "there is nothing to compound yet.",

  "duplicate-module": () => "already on this lane.",

  "missing-source": () => "pick a market for this lane first.",

  /* THE MODULE is foreign to the lane. Both facts, and no route: `showAddLane`
     only renders once every lane is launch-shaped, so "add a lane to run an
     LP" would point at nothing on the lane where this fires.

     AND THE OPEN-LANE BRANCH, which is not a defensive fallback — it is a
     state the product reaches. `family-mismatch` arrives here from TWO places
     in `addableModules`: the family gate on a bound lane, and a fresh code the
     simulation raised. The second fires on an UNBOUND lane, e.g.
     {liquidity-source, hedge} — loop and dnlp both still standing — being
     offered `covered-call`, whose arrival would strand the hedge. That lane
     has no family word, and inventing one to complete this sentence is exactly
     the unearned assertion this wave deletes. So it names what the module
     collides WITH, which is a fact the lane can prove. */
  "family-mismatch": (ctx) => {
    const homes = HOME_FAMILIES[ctx.key];
    const home = homes.length > 0 ? FAMILY_LABEL[homes[0]] : null;
    if (ctx.lane && home) {
      return `this lane is a ${FAMILY_LABEL[ctx.lane]}. It runs on a ${home} lane.`;
    }
    /* AND WITH NO MARKET PINNED, THE MARKET IS THE GAP. On an open lane the
       clash sentence asserted permanent facts a market has not decided yet —
       {hedge, exogenous-risk} pressed with covered-call read `cannot share a
       lane with dynamic hedge and exogenous risk.`, naming the overlay, which
       collides with nothing (graph-ops's own rule), as a collision. The first
       press the product asks of every lane is the market, and `missing-source`
       already owns that sentence; the clash register speaks only once a
       pinned market makes the collision a fact. */
    if (!ctx.pair) return REFUSALS["missing-source"](ctx);
    const clash = ctx.placed.filter(
      (k) => !OVERLAY_KEYS.has(k) && !homes.some((f) => FAMILY_CHAINS[f].includes(k)),
    );
    if (clash.length === 0) return REFUSAL_FALLBACK;
    const names = clash.map((k) => MODULE_DEFS[k].name.toLowerCase()).join(" and ");
    return `cannot share a lane with ${names}.`;
  },

  /* THE MARKET is foreign to the module — the founder's quoted string, which
     had NO BRANCH AT ALL and printed `market family mismatch`. The lane's own
     modules are fine here; it is the pinned row that cannot be priced that
     way, and the sentence names the row rather than the lane. */
  "market-family-mismatch": (ctx) => {
    const m = ctx.market ? FAMILY_LABEL[ctx.market] : null;
    if (!m) return REFUSAL_FALLBACK;
    if (ctx.pair) return `${ctx.pair} can only be priced as a ${m}.`;
    return `this lane's market can only be priced as a ${m}.`;
  },
};

/** Every code with an explicit branch. Derived from the table, so the claim
 *  and the dispatch cannot drift; the test sweeps `addableModules()` and fails
 *  when a reachable code is missing from it. */
export const REFUSAL_CODES: readonly string[] = Object.keys(REFUSALS);

/**
 * Turn a `validateGraph()` issue code into the panel's refusal, as the two
 * fields the skip register actually renders.
 *
 * RETURNS A PAIR, not a sentence with the name glued on (§2D O2). The glued
 * form made `" — "` a parsing contract between this function and
 * `BlockedGroup`, and put six em dashes on a user surface that bans them.
 */
export function refusalFor(
  key: ModuleKey,
  code: string,
  ctx: Omit<RefusalContext, "key">,
): { name: string; sentence: string } {
  const make = REFUSALS[code];
  return {
    name: MODULE_DEFS[key].name,
    sentence: make ? make({ ...ctx, key }) : REFUSAL_FALLBACK,
  };
}

/** A throwaway node carrying `key`, for asking `laneFamilies` what a press
 *  would leave standing. Only `data.defKey` is read. */
function ghostNode(key: ModuleKey): ModuleNode {
  return {
    id: `compose-ghost:${key}`,
    type: "priimeModule",
    position: { x: 0, y: 0 },
    data: { defKey: key, params: {} },
  };
}

/**
 * The consequence line for one press on an UNBOUND lane (§4D).
 *
 * `after` is what would still be standing; `total` is what stands now.
 *
 * IN STRATEGY SPACE since 2026-08-24 (funding launch rail, ruling 2): the
 * word "strategy" in these lines now counts what the product publishes as a
 * strategy, so the hedge on a blank lane reads `keeps 3 of the 4 strategies
 * open` (it rules out only the collar) and the leverage module still reads
 * `makes this a loop lane` (it rules the funding carry out along with the
 * other two families' products).
 */
function consequenceLine(after: StrategyKind[], total: number): string {
  if (after.length >= total) return "keeps every strategy open";
  if (after.length === 1) return `makes this a ${STRATEGY_LABEL[after[0]]} lane`;
  return `keeps ${after.length} of the ${total} strategies open`;
}

/**
 * WOULD TAKING THIS SEATED MODULE OFF LEAVE A REQUIRED GROUP UNSATISFIED?
 *
 * The one predicate behind `ComposeInstalled.required`, exported (2026-08-23)
 * so the plate's own eject key and the dock's cross read the same lock: a
 * module that is the only member holding one of a surviving family's required
 * groups is LOCKED on both surfaces, and one that is not is removable on both.
 * Unbound, a group of ANY surviving family counts — the lane must stay
 * finishable whichever product it turns out to be.
 */
export function requiredInstalled(loop: LoopGraph, key: ModuleKey): boolean {
  const src = addableModules(loop);
  const surviving = src.families.length > 0 ? src.families : [src.family];
  const placed = new Set(loop.nodes.map((n) => n.data.defKey));
  return surviving.some((f) =>
    FAMILY_REQUIRED_GROUPS[f].some(
      (group) => group.includes(key) && !group.some((m) => m !== key && placed.has(m)),
    ),
  );
}

/**
 * The panel's view. `candidate` is the lane's REPRICED candidate (the same
 * object `composedNetApy` reads), so the hedge's value is evaluated at THIS
 * lane's leverage — never a cached "this market's hedge is worth +1.9pp" from
 * the scan row, which is wrong on every lane that touched the dial.
 *
 * `hedgeEconomics()` is the sole accessor for that number: it returns null
 * rather than print one it cannot prove, and a null here simply means the bay
 * carries its mechanism sentence and no triple.
 */
export function composeOptionsFor(
  loop: LoopGraph,
  candidate: ProjectedCandidate | null | undefined,
  market: ComposeMarket = {},
): ComposeOptions {
  /* THE MARKET'S VERDICT ENTERS THE ONE DERIVATION (design ruling
     2026-08-23). `addableModules` already re-reads the loop's required
     OR-group once a member is dominated — the rack and the rail have read it
     that way since the ghost bay ruling — and the shelf did not, which is how
     a dominated leverage bay came to print `required to launch a loop lane`
     at the top of the shelf. Same input, same answer, on all three surfaces.
     The sign falls back to the lane's own candidate where the catalog row is
     gone; see `verdictRow`. */
  const dominated = dominatedModules(verdictRow(market.scanRow, candidate));
  // ONE derivation, delegated whole. Nothing below re-decides addability.
  const src = addableModules(loop, { dominated });
  /* THE SUBSTITUTION THIS WAVE IS MADE OF. `bound` is null while the lane is
     genuinely open; `surviving` never is (an impossible composition falls back
     to the module set, which the validator is already flagging). */
  const bound = committedFamily(loop);
  const surviving = src.families.length > 0 ? src.families : [src.family];
  /* THE STRATEGY LAYER (funding launch rail, 2026-08-24): the families'
     sibling, read from its one owner. The shelf head counts these and the
     consequence lines are priced in them. */
  const strategies = laneStrategies(loop);
  const boundStrategy = committedStrategy(loop);
  /* THE LANE'S COMPOSITION, PASSED (C6, 2026-08-24). `market.comp` is the
     same `pricingParamsFor` object the caller priced `candidate` with, and
     `hedge-econ` asks every caller holding a lane for it. Without it the bay's
     `valueDelta` sat on a different compound cadence from the plate hero the
     same panel renders. */
  const hedge = hedgeEconomics(candidate, market.comp ?? null);

  const srcNode = nodeFor(loop, "liquidity-source");
  const pair = String(srcNode?.data.params.pairLabel ?? "");
  const candidateId = String(srcNode?.data.params.candidateId ?? "");
  const marketFams = candidateId ? familiesForCandidateId(candidateId) : [];
  const placed = new Set(loop.nodes.map((n) => n.data.defKey));
  const refusalCtx = {
    lane: bound,
    pair,
    market: marketFams.length === 1 ? marketFams[0] : null,
    placed: DISPLAY_ORDER.filter((k) => placed.has(k)),
  };

  /* The chain a checklist may walk. Unbound, it is what is PLACED and nothing
     else: there is no chain to promise before the lane has chosen one. */
  const chain: ModuleKey[] = bound
    ? FAMILY_CHAINS[bound]
    : DISPLAY_ORDER.filter((k) => placed.has(k));

  const chainIdx = (k: ModuleKey) => {
    const i = chain.indexOf(k);
    return i < 0 ? 99 : i;
  };

  /* ── REQUIRED, ON A SEATED MODULE ──────────────────────────────────────
     Not "is it in the family's flat required list" — that list is a lossy
     view of the OR-groups (it carries each group's FIRST member), so on a
     funding carry it said `safety-buffer` and offered an eject cross on the
     `hedge` that is the entire lane.

     The real question is whether TAKING IT OFF would leave a required group
     unsatisfied, which is one predicate over `FAMILY_REQUIRED_GROUPS` — the
     owner — and holds on every family and every composition. Unbound, a group
     of ANY surviving family counts: the lane must stay finishable whichever
     product it turns out to be. ── */
  const isRequiredInstalled = (key: ModuleKey) => requiredInstalled(loop, key);

  /* Inventory, in the lane's own left-to-right order, so the dock's order
     equals the rack's. A module placed OUTSIDE the chain is already a
     validation issue; it still renders, because it is on the lane and the
     user must be able to take it back off. */
  const installed: ComposeInstalled[] = src.installed
    .map((key) => {
      const isRequired = isRequiredInstalled(key);
      return { key, required: isRequired, removable: MODULE_DEFS[key].optional && !isRequired };
    })
    .sort((a, b) => chainIdx(a.key) - chainIdx(b.key));

  /* Which STRATEGIES a press leaves standing. `laneStrategies` is the owner;
     the intersection with the lane's current list keeps the pinned market's
     contribution. */
  const survivingStrategiesAfter = (key: ModuleKey): StrategyKind[] => {
    const after = laneStrategies({ nodes: [...loop.nodes, ghostNode(key)] });
    return strategies.filter((s) => after.includes(s));
  };

  /* THE LEVERAGE BAY'S OWN NUMBERS, priced once per lane. The hedge's value
     comes from `hedgeEconomics` above; the leverage module has no such hero,
     so its two endpoints are priced here on the UNREPRICED row and threaded
     onto the key as a triple, and its sign lands in `valueDelta` so the band
     sort puts a subtracting bay in band 2 without a second rule. */
  const hasHedge = placed.has("hedge");
  const levTriple =
    bound === null || bound === "loop"
      ? leverageBayTriple(market.scanRow, hasHedge, market.comp ?? null, market.preset ?? "standard")
      : null;
  const levMechanism = leverageMechanism(candidate);
  const dominatedSet = new Set(dominated);

  const addable: ComposeAddable[] = src.addable.map((a) => ({
    key: a.key,
    required: a.required,
    implies: a.implies,
    dominated: dominatedSet.has(a.key),
    triple: a.key === "safety-buffer" && levTriple ? { from: levTriple.from, to: levTriple.to } : null,
    mechanism: a.key === "safety-buffer" ? levMechanism : null,
    /* ⚠ ONE FRAME ACROSS THE TWO PRICED BAYS (C6, 2026-08-24). `valueDelta`
       bands this shelf and is restated on the bay as a triple the reader can
       subtract, so both members must be the depositor's number. The leverage
       bay's endpoints came from `leverageBayTriple`, which moved to the
       PRODUCT frame with the rest of the stops family in Wave 1; the hedge's
       took `netPp` and stayed on the venue one, so a shelf sorting two bays
       against each other was comparing a post-fee delta with a pre-fee one. */
    valueDelta:
      a.key === "hedge" && hedge
        ? hedge.product.netPp
        : a.key === "safety-buffer" && levTriple
          ? levTriple.to - levTriple.from
          : null,
    consequence: bound ? null : consequenceLine(survivingStrategiesAfter(a.key), strategies.length),
  }));

  if (bound) {
    /* SORT, BOUND (§3.4): required first — they block publishing — then
       positive-value optional, then zero / negative / unpriced last. Within
       each band the committed family's own chain order. Unchanged. */
    const band = (a: ComposeAddable) =>
      a.required ? 0 : a.valueDelta !== null && a.valueDelta > 0 ? 1 : 2;
    addable.sort((a, b) => band(a) - band(b) || chainIdx(a.key) - chainIdx(b.key));
  } else {
    /* ── SORT, UNBOUND (§4D) ────────────────────────────────────────────
       On a blank lane there is no market, therefore no signed value for any
       module, therefore NO VALUE-BASED ORDERING IS PROVABLE — and ranking the
       dock by measured module value is curation, rejected twice. The order
       comes from the only thing the lane knows, which is its own module set.

       1. member of an unsatisfied required group of ANY surviving family
       2. COMMITMENT COST ascending: how many products this press rules out
       3. family declaration order, then that family's chain rank

       The point is NOT that leverage moves from second to third. It is that
       positions 3 through 6 are visibly PEERS — one anchor per product, the
       same shape of sentence, each stating what it costs to press. A ranked
       list asserts a preference; a tied group of four asserts a choice.

       Blank lane, and the acceptance criterion for this item:
         liquidity-source · hedge · safety-buffer · auto-center ·
         covered-call · protective-put
       The hedge sits ABOVE the leverage module because leverage is a COST on
       13 of 15 live rows and the shelf must not imply otherwise. ── */
    const opensGroup = (key: ModuleKey) =>
      surviving.some((f) =>
        FAMILY_REQUIRED_GROUPS[f].some(
          (group) => group.includes(key) && !group.some((m) => placed.has(m)),
        ),
      );
    /* Commitment cost counts STRATEGIES — the products a press rules out —
       since 2026-08-24. On today's shelf this preserves the §4D order exactly
       (the four anchors stay tied peers behind the hedge); what it changes is
       the FRAME, which now matches the consequence line printed beside it. */
    const cost = (key: ModuleKey) => strategies.length - survivingStrategiesAfter(key).length;
    /* Rank 3 is deterministic and alphabet-free: the first surviving family
       this module has a home in, then its position on that family's chain. */
    const homeRank = (key: ModuleKey) => {
      const i = surviving.findIndex((f) => FAMILY_CHAINS[f].includes(key));
      return i < 0 ? 99 : i;
    };
    const chainRank = (key: ModuleKey) => {
      const f = surviving[homeRank(key)];
      const i = f ? FAMILY_CHAINS[f].indexOf(key) : -1;
      return i < 0 ? 99 : i;
    };
    addable.sort(
      (a, b) =>
        Number(opensGroup(b.key)) - Number(opensGroup(a.key)) ||
        cost(a.key) - cost(b.key) ||
        homeRank(a.key) - homeRank(b.key) ||
        chainRank(a.key) - chainRank(b.key),
    );
  }

  const blocked: ComposeBlocked[] = src.blocked.map((b) => {
    const { name, sentence } = refusalFor(b.key, b.code, refusalCtx);
    return { key: b.key, code: b.code, name, sentence, reason: `${name} — ${sentence}` };
  });

  return {
    family: src.family,
    families: src.families,
    bound,
    strategies,
    boundStrategy,
    chain,
    installed,
    addable,
    blocked,
    dominated,
  };
}

// ── THE SHELF (PO ruling 2026-08-23) ──────────────────────────────────────

/**
 * THE HEAD OVER THE BLANK-LANE SHELF, and the count it states.
 *
 * The canvas ghost bay says `Modules · 6 to choose from`, reading
 * `addableModules(loop).addable.length`. The panel beside it used to read as
 * three (three 156–174px cards above a 692px fold) — two surfaces disagreeing
 * at first glance about how many things fit in one socket. The head now
 * states the SAME count from the SAME derivation, beside the number of
 * strategies still open, so a reader can check the panel against the canvas
 * without scrolling either.
 *
 * `Pick what this vault does · 6 modules, 4 strategies`
 *
 * The count is STRATEGIES, not families (funding launch rail, ruling 2): the
 * loop family holds two products, and the presses on this shelf can still
 * reach all four of them.
 */
export function shelfHead(opts: ComposeOptions): { title: string; count: string } {
  const n = opts.addable.length;
  const s = opts.strategies.length;
  const modules = `${n} ${n === 1 ? "module" : "modules"}`;
  const strategies = `${s} ${s === 1 ? "strategy" : "strategies"}`;
  return { title: "Pick what this vault does", count: `${modules}, ${strategies}` };
}

/** One compact shelf row: an addable key, or a blocked one rendered dimmed
 *  with its refusal in the sentence slot. The set is every addable plus every
 *  blocked key, so nothing the ghost bay counts is folded behind a bar. */
export interface ShelfRow {
  key: ModuleKey;
  /** `MODULE_DEFS[key].tagline`, the one line. */
  tagline: string;
  /** The consequence fact (unbound) or the refusal sentence (blocked). */
  fact: string | null;
  /** False on a blocked key: the row renders dimmed and does not add. */
  addable: boolean;
}

/**
 * The seven rows of a blank-lane shelf, in the §4D commitment-cost order the
 * addable list already carries, then the blocked keys in display order. A
 * blocked key is a ROW here, not a count behind a chevron: `Auto-compound ·
 * there is nothing to compound yet.` is the fact, stated where the other six
 * are, at the same altitude.
 */
export function shelfRows(opts: ComposeOptions): ShelfRow[] {
  const out: ShelfRow[] = opts.addable.map((a) => ({
    key: a.key,
    tagline: MODULE_DEFS[a.key].tagline,
    fact: a.consequence,
    addable: true,
  }));
  for (const b of opts.blocked) {
    out.push({ key: b.key, tagline: MODULE_DEFS[b.key].tagline, fact: b.sentence, addable: false });
  }
  return out;
}
