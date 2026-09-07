/**
 * THE RACK ROW (P0-3 of THE UNCOMMITTED CANVAS, 2026-08-22) — which bays a
 * lane draws, in which order, and what each one is.
 *
 * PURE, and in `lib/canvas/` rather than beside the component, for two
 * reasons. It is a question about the GRAPH — placed modules, committed
 * family, what the lane still requires — and it holds no React at all; and the
 * invariant it exists to guarantee is swept over all 128 module subsets in
 * `__tests__/lane-rack.test.ts`, which cannot import a `.tsx` (the Next
 * tsconfig keeps `jsx: "preserve"`, so vitest refuses to transform one).
 *
 * WHAT IT REPLACES. `Lane.tsx` early-returned on `!src` and drew ONE ghost, so
 * pressing `Add covered call` on a blank lane put the node in the graph, put
 * the row in the dock's Installed group, and drew NOTHING on the rack. It then
 * walked `FAMILY_CHAINS[laneFamily(nodes)]` and gated the row on a private
 * copy of `FAMILY_REQUIRED` — two more surfaces asserting the loop family on a
 * lane that had chosen nothing.
 */

import type { LoopGraph, ModuleKey } from "./types";
import {
  committedFamilies,
  committedFamily,
  FAMILY_CHAINS,
  FAMILY_REQUIRED_GROUPS,
  nodeFor,
  type LaneAddability,
} from "./graph-ops";
import { DISPLAY_ORDER } from "./modules";

/**
 * What a bay is a bay FOR. Every entry names a module and nothing else.
 *
 * S13: `liquidity-source` read `Pick a market`, an instruction wearing a
 * module's slot — the one bay on the rack that named an errand instead of the
 * hardware that goes in it, which is also why it could never be reused for the
 * plate that eventually seats there. The rack names the module; the errand
 * lives on the key INSIDE the bay (`Browse markets`).
 */
export const SLOT_LABEL: Record<ModuleKey, string> = {
  "liquidity-source": "Liquidity source",
  "safety-buffer": "Dynamic leverage",
  "auto-center": "Auto center",
  "covered-call": "Covered call",
  "protective-put": "Protective put",
  hedge: "Dynamic hedge",
  /* The module's own `MODULE_DEFS.name`, per the rule this Record is built on:
     the bay names the hardware, never the errand. `Pick an exit` would be S13
     repeated on a second bay, and `Exit` alone would be the rail's
     abbreviation (`SHORT_LABEL`) leaking onto a surface that has room for the
     whole word. */
  "redemption-route": "Redemption route",
  "auto-compound": "Auto-compound",
  "exogenous-risk": "Exogenous risk",
};

/** The one bay that names no module, because the lane has named no family.
 *  "Modules", never "Strategy module" (cleanup 2026-08-24): the shelf beside
 *  this bay counts "6 modules, 4 strategies" (`shelfHead`), so "strategy" is
 *  reserved for the 4-strategy layer and the bay counts what its own sub
 *  counts — the six modules to choose from. */
export const STRATEGY_SLOT_LABEL = "Modules";

/**
 * What a `todo` bay is WAITING ON, as a NOUN (§7E).
 *
 * `after Pick a market` quoted an instruction inside a state and read as a
 * second instruction in a quieter font. A `todo` bay is not asking for
 * anything — it is stating which position on this lane has to exist before
 * this one can — so it names that position: `after the market`.
 */
export const WAITS_ON: Record<ModuleKey, string> = {
  "liquidity-source": "the market",
  "safety-buffer": "dynamic leverage",
  "auto-center": "the range",
  "covered-call": "the call leg",
  "protective-put": "the floor",
  hedge: "the hedge",
  /* REACHABLE, unlike the overlay below, and reachable in the direction that
     matters: `redemption-route` is the treasury chain's rank-2 anchor and it
     is REQUIRED there (`FAMILY_REQUIRED_GROUPS.treasury`), so it is what
     `unmet[0]` names on a treasury lane, and the compounder one bay to its
     right renders `Auto-compound · after the exit route`.

     A NOUN NAMING A POSITION, which is what §7E asks for and what separates
     this Record from an instruction in a quieter font. `the exit route` is the
     position; `redeem first` would be an instruction and `the redemption`
     would name an event rather than a place on the lane. */
  "redemption-route": "the exit route",
  "auto-compound": "the compounder",
  /* UNREACHABLE: a `todo` bay is emitted only for members of the committed
     family's CHAIN, and an overlay is on no chain. The Record demands an
     entry; nothing can render one. */
  "exogenous-risk": "the dependencies",
};

/**
 * One bay on the rack. `strategy` is the only member carrying no module key,
 * and it is the only bay that can appear on a lane with no family.
 */
export type RackItem =
  | { kind: "plate"; key: ModuleKey }
  | { kind: "ghost"; key: ModuleKey }
  | { kind: "todo"; key: ModuleKey; after: ModuleKey | null }
  | { kind: "strategy" };

/**
 * THE RACK ROW, as a pure derivation (P0-3).
 *
 * INVARIANT, swept over all 128 module subsets in `lane-rack.test.ts`:
 * every node in the graph gets exactly one `plate`, and no plate exists
 * without a node. The rack may refuse to OFFER a module; it may never fail to
 * DRAW one the lane is holding.
 *
 * Reads `addability` rather than re-deriving it: `addableModules()` is the one
 * opinion about what a lane can take, and this function's whole job is to
 * arrange that answer in space.
 */
export function rackItems(loop: LoopGraph, addability: LaneAddability): RackItem[] {
  const placed = new Set(loop.nodes.map((n) => n.data.defKey));
  const hasMarket =
    String(nodeFor(loop, "liquidity-source")?.data.params.candidateId ?? "") !== "";

  /* Null ONLY while the lane is genuinely open — an impossible composition
     resolves to the family the validator is already reporting against, which
     is the family whose chain must keep ordering the row. */
  const bound = committedFamily(loop);
  const chain = FAMILY_CHAINS[bound ?? committedFamilies(loop)[0]];

  /** Chain position first; anything the chain does not carry sorts after it,
   *  in the product's own display order. */
  const rank = (k: ModuleKey) => {
    const i = chain.indexOf(k);
    return i >= 0 ? i : chain.length + DISPLAY_ORDER.indexOf(k);
  };

  const out: RackItem[] = [];
  // Bay 01 is the market on every lane of every family, placed or not.
  out.push(
    placed.has("liquidity-source")
      ? { kind: "plate", key: "liquidity-source" }
      : { kind: "ghost", key: "liquidity-source" },
  );

  if (!bound) {
    /* THE UNCOMMITTED ROW. One bay for the anchor the lane has not chosen,
       seated at chain index 1 because all three families seat their anchor
       there, then everything already placed. No family chain is walked, so no
       family is named. */
    out.push({ kind: "strategy" });
    for (const key of [...placed].filter((k) => k !== "liquidity-source").sort((a, b) => rank(a) - rank(b))) {
      out.push({ kind: "plate", key });
    }
    return out;
  }

  const addable = new Set(addability.addable.map((a) => a.key));
  /* What still blocks this lane's launch, from THE one derivation. On a bound
     loop lane with a market this is `[safety-buffer, hedge]` — either finishes
     it — and every optional bay downstream of it renders `todo` until one of
     them seats.

     UNLESS THE MARKET HAS SPOKEN (2026-08-22): `required` is re-read there
     over the reachable members only, so on a market whose leverage module is
     dominated this reads `[hedge]`, and where NEITHER member is reachable it
     reads `[]`. That is why no `todo` below can name the removed module: this
     list is what `after` is drawn from. */
  const unmet = addability.addable.filter((a) => a.required).map((a) => a.key);

  /* WHAT THIS MARKET PUTS OUT OF REACH (THE GHOST BAY RULING, 2026-08-22).
     Read off `addability`, which is where the market's verdict enters — the
     rack arranges an answer in space and forms none of its own, so this is a
     lookup and not a second opinion. Empty whenever no market context reached
     `addableModules`, which is the shipped row byte for byte. */
  const dominated = new Set(addability.dominated);

  /* Is the hedge a POSITION on this family, or a CHOICE? A singleton required
     group is a position the lane must hold; a multi-member group is one of
     several ways to finish, and naming one of them is steering. See the note
     at the `hedge` clause below.

     THE GROUP IS READ AFTER THE MARKET HAS SPOKEN (2026-08-22). Not a new
     rule — the same rule, on corrected input. `[safety-buffer, hedge]` is a
     CHOICE between two ways to finish a loop lane, and the founder's ruling
     governs exactly that choice. Where the market has ruled the leverage
     module dominated, one of the two ways is unreachable and the hedge stops
     being one option among several: it is the only position that finishes the
     lane, like the market, and like the hedge on `dnlp`. Suppressing it there
     would leave the rack drawing a required, unfilled position nowhere at all
     — which is the defect the `dnlp` narrowing above was written to fix. */
  const hedgeIsUnavoidable = FAMILY_REQUIRED_GROUPS[bound]
    .map((g) => g.filter((k) => !dominated.has(k)))
    .some((g) => g.length === 1 && g[0] === "hedge");

  for (const key of chain) {
    if (key === "liquidity-source") continue; // bay 01, already placed above
    if (placed.has(key)) {
      out.push({ kind: "plate", key });
      continue;
    }
    if (!hasMarket) continue;
    /* THE BAY GOES WITH THE MODULE (THE GHOST BAY RULING, 2026-08-22).
       ---------------------------------------------------------------------
       A bay is a control with one setting: INSTALL. Where every setting of the
       thing it installs is dominated on all three declared axes at once, that
       one setting is dominated too — a control that installs a non-instrument
       is not an instrument, and L1 reaches the bay by composition.

       NOTHING RENDERS. Not a ghost, not a `todo`, not an inert socket. The
       spec's named worst mistake is closing a hole with a placeholder that
       re-announces it, and an empty labelled socket is the screenshot's own
       defect compressed into one cell with its costs hidden behind it. The row
       closes up and renumbers; `Lane.tsx` takes the ordinal from the rendered
       position, so no number is skipped and the absence is not announced
       arithmetically either.

       AND NOTHING ELSE NAMES IT. `unmet` below is drawn from `required`, which
       `addableModules` has already re-read over the same set — so a downstream
       `todo` cannot come out reading `after dynamic leverage`, which is the
       one-bay-to-the-right version of the same mistake.

       ⚠ THIS CLAUSE SITS AFTER THE `placed` BRANCH ON PURPOSE. The rack may
       refuse to OFFER a module; it may never fail to DRAW one the lane is
       holding. A lane that installed this module from the dock shelf keeps its
       plate, and the 128-subset invariant (one plate per node, no plate
       without a node) is untouched by this ruling.

       WHAT REPLACES IT is not on the rack at all: the dock's reclaim readout
       states what the model chose, what it declined and what declining it
       bought, and the shelf keeps the override, priced. The readout is the
       agency; the socket was the appearance of it. */
    if (dominated.has(key)) continue;
    /* THE HEDGE NEVER SELF-PROPOSES (founder ruling 2026-08-20) — WHERE IT IS
       A PROPOSAL. It is addable, and it is added from the dock, never by a
       ghost; offering it dimmed would be a proposal in a quieter voice, which
       is still one.

       NARROWED 2026-08-22 in the wave audit, to the family the ruling was
       actually made on. P0-1 put `hedge` in a SINGLETON required group on
       `dnlp`, where it is not a proposal but a position the lane must hold
       before it can publish, exactly like the market. Suppressing it there had
       the rack refusing to draw a required, unfilled position while the rail
       named `Hedge` as a step and the launch key stayed dark — the rack and
       the rail disagreeing about one lane, which is what P0-5 exists to
       prevent. Measured live on `/build?new=1`: `{liquidity-source,
       auto-center}` on the LP row drew no hedge bay at all, and the only
       reason the product could give was a sentence about a module that does
       not fit.

       The test is whether the hedge is UNAVOIDABLE here, not merely required.
       On `loop` it shares its group with `safety-buffer`, so it stays silent
       and the founder's ruling holds unchanged. Derived from
       `FAMILY_REQUIRED_GROUPS`, so a fourth family cannot leave it stale. */
    if (key === "hedge" && !hedgeIsUnavoidable) continue;
    // A bay is LIVE only when the validator would take it AND nothing this
    // lane still requires sits ahead of it.
    const live = addable.has(key) && (unmet.includes(key) || unmet.length === 0);
    out.push(live ? { kind: "ghost", key } : { kind: "todo", key, after: unmet[0] ?? null });
  }

  // A module outside the committed chain is drawn last, never dropped.
  for (const key of [...placed].filter((k) => !chain.includes(k)).sort((a, b) => rank(a) - rank(b))) {
    out.push({ kind: "plate", key });
  }
  return out;
}
