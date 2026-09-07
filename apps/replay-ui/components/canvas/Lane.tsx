"use client";

/* eslint-disable @typescript-eslint/no-empty-function --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * Lane (UX_SPEC §1/§4, mockup register 2026-08-20) — one rack lane: flex row
 * of hardware plates wired left→right into the vault terminus, with the
 * guided-arc ghost slots. The state machine is structural: stage 0 renders
 * exactly one glowing slot and a dim vault; once a market lands the spine
 * self-proposes leverage + compound (the hedge is opt-in from the dock);
 * the Install defaults key snaps everything in.
 *
 * 2026-08-20 founder pass: the lane-level RISK dial is gone (risk lives in
 * the module plates), quote-failure warnings never render (the canvas
 * presents clean modeled data), and chrome labels speak sentence case.
 *
 * ══ RECETTE ITEM 15 (2026-08-22) — THE GHOST ROW IS A DERIVATION NOW ═══════
 *
 * The rack used to decide for itself what could sit in an empty bay:
 * `FAMILY_CHAINS[family].slice(1)` minus a hard-coded `key !== "hedge"`. That
 * is a second opinion about addability, and `graph-ops.addableModules()` is
 * the first — the one the compose panel, the mobile sheet and the validator
 * all speak through. The rack now reads it too, so a module the validator
 * would refuse can no longer be offered as a glowing dashed rectangle.
 *
 * On top of the delegated answer sit exactly two rack-local rules, both
 * stated rather than inferred:
 *
 *   • THE HEDGE NEVER SELF-PROPOSES (founder ruling 2026-08-20). It is
 *     addable, and it is added from the dock's lane panel, never by a ghost.
 *
 *   • A NON-ANCHOR SLOT IS GATED ON WHAT THE LANE STILL REQUIRES. Until that
 *     set is complete, everything downstream of it renders `todo`.
 *     `RackCanvas.onAddModule` installs the one module it is given and does
 *     not walk `implies`, so an ungated `Auto-compound` ghost built the lane
 *     {source, auto-compound} in one click — a graph `validateGraph` refuses
 *     and the canvas kept pricing. (The private `FAMILY_REQUIRED` copy that
 *     answered that question was deleted in P0-3, below; the rule stands, its
 *     source changed.)
 *
 * ══ SURFACE ROW 9 — THE HEADER STATES A MAGNITUDE, NOT A CATEGORY ══════════
 *
 * `leverage is yield-negative in this market today` told the user the sign of
 * a derivative and nothing about its size, and it did it with the word
 * `today`, which `tips.ts` bans from every tip string it asserts over. The
 * line now prices the dial's own step: `each 0.25x costs 0.35pp here`.
 *
 * ══ SURFACE ROW 10 — THE HEADER STATES THE CUSHION, NOT AN ADJECTIVE ═══════
 *
 * Founder ruling 2026-08-22. The lane's risk was carried by a segmented
 * control reading Safer / Balanced / Max, and "Balanced" named a 1.75x
 * position on one market and a 2.75x position on another. The header now
 * prints the ADVERSE PAIR MOVE the lane survives — exact, derived from the
 * venue's own liquidation threshold at the leverage the model landed on, and
 * comparable lane to lane. It reads `liquidation.ts`, the one owner, which is
 * the same function the dock control, the plate, the vault page and the
 * automations instrument all read.
 *
 * ══ AND THE NOTCH LINE IS UNGATED ══════════════════════════════════════════
 *
 * It was gated on `leverageYieldNegative`, so on the two live rows where
 * leverage actually PAYS it printed nothing: the user learned "leverage
 * costs" on thirteen rows and learned nothing on the two where the opposite
 * is true. It prints in both directions now, above the same `EVEN_FLOOR`, and
 * only the cost direction wears the amber narration class.
 *
 * ══ P0-3 (2026-08-22) — A NODE IN THE GRAPH ALWAYS HAS A PLATE ═════════════
 *
 * D1, the worst defect in THE UNCOMMITTED CANVAS, lived in six lines here:
 * the row early-returned on `!src` and drew ONE ghost. Press `Add covered
 * call` on a blank lane and the node entered the graph, the dock listed it
 * under Installed, and the rack drew nothing at all. The dock was made
 * family-agnostic in the last wave; the rack was not, so the rack was still
 * a market-first surface wearing a module-first product.
 *
 * The row is now built from the PLACED modules first, in committed-chain
 * order, and the ghosts second. `rackItems` is exported and pure precisely so
 * the invariant can be swept rather than asserted: for all 128 module subsets,
 * `plates.length === nodes.length`.
 *
 * Three rules the derivation carries, each stated rather than inferred:
 *
 *   • THE COMMITTED CHAIN, NEVER THE DEFAULT ONE. `committedFamily(loop)` is
 *     null while more than one family survives, and a blank lane is exactly
 *     that state. While unbound the rack draws bay 01 (the market), ONE
 *     `strategy` bay standing in for whichever anchor the lane eventually
 *     seats — index 1 in all three `FAMILY_CHAINS`, so it is the anchor's own
 *     seat, not a placeholder parked somewhere convenient — and then whatever
 *     is already placed. It names no family, because the lane has not chosen
 *     one. This is the same three-step reading `laneSteps()` gives the rail.
 *
 *   • THE PRIVATE `FAMILY_REQUIRED` COPY IS GONE (§2 M4). "What still blocks
 *     this lane" now comes from `addableModules().addable[].required`, the one
 *     derivation the dock, the mobile sheet and the validator already speak
 *     through. The old copy read `FAMILY_REQUIRED[laneFamily(nodes)]`, which
 *     on a lane holding nothing asserted the loop's required set — the
 *     unearned default this wave exists to delete.
 *
 *   • AN ORPHAN STILL GETS ITS PLATE. `{safety-buffer, covered-call}` belongs
 *     to no family; `committedFamily` resolves it to the lane the validator is
 *     already reporting `family-mismatch` against, and the module outside that
 *     chain is drawn LAST rather than dropped. A plate the user cannot see is
 *     not a refusal, it is a disappearance.
 */

import { useMemo, useRef } from "react";
import type { LoopGraph, ModuleKey, ParamValue } from "@/lib/canvas/types";
import { addableModules, committedFamily, nodeFor, OVERLAY_KEYS } from "@/lib/canvas/graph-ops";
import {
  rackItems,
  SLOT_LABEL,
  STRATEGY_SLOT_LABEL,
  WAITS_ON,
} from "@/lib/canvas/rack-row";
import { defaultInstallChain, dominatedModules } from "@/lib/canvas/leverage-module";
import { composeOptionsFor, requiredInstalled } from "@/lib/canvas/compose-options";
import type { ProjectedCandidate } from "@/lib/canvas/opportunities";
import { adverseMoveShort, liquidationDistance } from "@/lib/canvas/liquidation";
import { notchMove } from "@/lib/canvas/leverage-stops";
import { pricingParamsFor } from "@/lib/canvas/pricing-params";
import type { ParamContext } from "@/lib/canvas/modules";
import { pct } from "@/lib/canvas/format";
import { collarForfeit, collarForfeitLine, collarForfeitPlateLines } from "@/lib/canvas/templates";
import { isLaneBackground } from "@/lib/canvas/hit";
import HwPlate from "./HwPlate";
import LaneName from "./LaneName";
import GhostSlot, { shelfCountLabel } from "./GhostSlot";
import VaultPlate from "./VaultPlate";
import LaneWires from "./LaneWires";
import type { RepriceData } from "./types";
import type { ScreenState } from "./PlateScreen";

/* THE PLATE ORDINAL IS POSITIONAL (THE GHOST BAY RULING, 2026-08-22).
   -------------------------------------------------------------------------
   A per-key `INDEX` map stood here. It was never identity — it was chain
   position + 1 in `FAMILY_CHAINS`, which is why it COLLIDED across families
   (`auto-center` and `covered-call` both read `02`; `hedge` and
   `protective-put` both read `03`). A positional ordinal taken from a chain
   the lane does not hold is simply the wrong number, and it is spoken aloud
   too: `HwPlate` puts it in `aria-label="Dynamic hedge module 03"`.

   It also announced absences arithmetically. With a bay suppressed the row
   read `01 · 03`, so deleting the socket would still have left the hole
   counted out loud — the placeholder mistake in numerals.

   The ordinal is now the 1-based position in `rackItems` output: stable as
   bays fill, correct on every family, and an orphan plate finally gets a true
   number instead of its foreign chain's. */

/** Modules a lane surface can eject (the source stays put; everything
 *  optional goes). `safety-buffer` joined 2026-08-23: `isRequiredInstalled`
 *  in the dock keeps it locked while it is the only member holding the loop
 *  group, and the plate's own eject key follows `MODULE_DEFS.optional`. */
const EJECTABLE: ReadonlySet<ModuleKey> = new Set([
  "safety-buffer",
  "hedge",
  "auto-compound",
  /* The overlay (2026-08-26): optional, on no required group of any family,
     so `requiredInstalled` never locks it and both surfaces offer the cross. */
  "exogenous-risk",
  "auto-center",
  "covered-call",
  "protective-put",
]);

/* WHAT `Install defaults` INSTALLS IS NOT A SECOND LIST HERE ANY MORE.
   -------------------------------------------------------------------------
   A private `INSTALL_CHAIN` literal stood here and the key counted
   `addable ∩ INSTALL_CHAIN`, while `RackCanvas.installDefaults` runs
   `defaultInstallChain(row)`. The two disagreed on the live catalog, measured
   over every fixture loop row at fresh pick: the key printed
   `Install defaults (2)` and the press seated THREE plates on all 7 rows where
   the leverage module installs, and printed `(1)` where the press seats
   NOTHING on the two syrupUSDC rows. A key that miscounts its own action is
   the same defect as a bay that hides its cost.

   The count now comes from `defaultInstallChain` — the single owner
   `installDefaults` itself calls, on the same row it resolves it from — minus
   whatever the lane already holds. */

/* The magnitude form of `pp` moved to `format.ppMag` (2026-08-22): it was a
   private copy here, which is the shape single-owner.test.ts refuses. TWO
   DECIMALS, like `format.carry()` and for its reason: the live per-notch costs
   cluster between 0.13pp and 0.40pp, and one decimal rounds four distinct
   markets onto the same three characters — and rounds the ruled `0.35pp` UP
   to `0.4pp`, overstating a cost by 14%. */

export interface LaneProps {
  loop: LoopGraph;
  multi: boolean;
  focusedKey: ModuleKey | null; // focused module inside this lane
  laneFocused: boolean; // this lane holds the focus (zoom .86 in multi)
  /** The effective quote (live rail or catalog-modeled); never a failure. */
  reprice: RepriceData | null;
  repricing: boolean;
  /** The lane's modeled net APY, computed upstream (server or catalog). */
  netApy: number | null;
  /** FRAME M — the lane's UNREPRICED scan row (market APR at market L0),
   *  threaded down to the liquidity-source and leverage plates. */
  scan: { apr: number | null; lev: number | null } | null;
  /**
   * THE UNREPRICED CATALOG ROW behind this lane, or null (THE GHOST BAY
   * RULING, 2026-08-22). The same answer `RackCanvas.scanRowFor` gives and the
   * same one `installDefaults` resolves its chain from, so the rack's shape,
   * the key's count and the press cannot disagree.
   *
   * ⚠ THE RAW ROW, NEVER `reprice.candidate`. Two independent reasons, and the
   * second is the load-bearing one:
   *
   *   1 · the repriced candidate has already been through `repriceAtLeverage`,
   *       which caps at the row's own `economics.loopLeverage` — the same trap
   *       `scanRowFor` and the leverage stops document.
   *   2 · `escrowShare` returns null whenever the repriced lane's
   *       `|netCarryOnEquityApy| < 1e-12`, which flips the verdict to `unknown`
   *       and puts the module back. A rack whose SHAPE depends on the quote
   *       state would re-grow a bay mid-reprice. The raw row is defined while a
   *       quote is in flight, and `ok` is null exactly then.
   *
   * Measured across the committed fixture catalog before this was wired: the
   * verdict on the raw row, the default-lane repriced row and the levered-lane
   * repriced row agree on 23 of 23 loop rows. The threading choice is made on
   * definedness, not on a disagreement.
   *
   * AMENDED 2026-08-23 — `RackCanvas` now hands over `verdictRow(marketRow,
   * ok.candidate)`: the raw row wherever the venue served one (everything
   * above holds byte for byte), and the lane's own priced candidate ONLY where
   * the catalog row is null. Both reads this prop feeds — `dominatedModules`
   * and `defaultInstallChain` — turn on `sign(cy − bo)`, which is
   * reprice-invariant, so reason 1 does not apply to them; reason 2 is why the
   * raw row still wins whenever it exists. Without the fallback an empty venue
   * answer re-grew the ghost bay on a market the ruling had closed.
   */
  scanRow: ProjectedCandidate | null;
  /** The lane's market as `paramContextFor(...)` reads it, forwarded verbatim
   *  to every plate's controls (D3, 2026-08-24). It is the SAME object
   *  `RackCanvas` attaches to this lane's `param` dispatches, which is what
   *  makes a dial's published `max` the bound its own clamp enforces. */
  paramCtx?: ParamContext;
  laneReviewable: boolean;
  /** The eyes-open venue verdict (funding launch rail, 2026-08-24): set on a
   *  lane pinned to a measured market with no launch rail, so the fact the
   *  builder pinned through stays visible on the lane itself. Null elsewhere. */
  railVerdict?: string | null;
  /** This lane's market stopped accepting deposits and is what disarms
   *  Review (CAPACITY_SPEC §2.6 / M7): a FINITE ring, never infinite. */
  noCapacity?: boolean;
  allocationBps: number | null; // null when orchestrator off
  snapKeys: ReadonlySet<string>; // `${loopId}/${key}` recently placed
  /** `${loopId}/${key}` mid-eject: the plate powers down and collapses
   *  BEFORE the real dispatch (§5.2). Without a deferred unmount there is
   *  nothing to animate — the node simply vanishes mid-frame. */
  ejectingKeys?: ReadonlySet<string>;
  pulseKey: number;
  canRemove: boolean;
  onFocusModule: (key: ModuleKey) => void;
  /** Select this lane → dock Lane/Compose mode scoped to it (IT4 §2.2).
   *  Reached from the lane's whole background, its name button and its ghost
   *  bay; the pan guard lives at the RackCanvas end, so a drag that ends over
   *  a lane never fires this. */
  onFocusLane: () => void;
  onOpenCatalog: () => void;
  onInstallDefaults: () => void;
  onAddModule: (key: ModuleKey) => void;
  onParam: (key: ModuleKey, field: string, value: ParamValue) => void;
  onEject: (key: ModuleKey) => void;
  onRename: (label: string) => void;
  onRemoveLoop: () => void;
  /** I9 — the ONE open help card on the canvas, owned by RackCanvas. */
  helpNodeId?: string | null;
  onToggleHelp?: (nodeId: string) => void;
}

export default function Lane(props: LaneProps) {
  const { loop, reprice, repricing, netApy } = props;
  const rowRef = useRef<HTMLDivElement | null>(null);

  const src = nodeFor(loop, "liquidity-source");
  const ok = reprice?.ok === true ? reprice : null;
  /** The family this lane has EARNED, or null while it is still open. The one
   *  accessor a surface may use to reach a family word (§1 corollary). */
  const committed = useMemo(() => committedFamily(loop), [loop]);

  /** QNT-3 — the collar's companion fact, at THIS lane's own dials: the
   *  premium the header prints is the price of the upside sold above the
   *  strike, and the ledger rules the two print together or not at all.
   *  Null off the collar family, on a partial rack, and on an off-grid dial
   *  (`collarForfeit` refuses exactly where `collarModel` does). */
  const forfeit = useMemo(() => {
    if (committed !== "collar") return null;
    const call = nodeFor(loop, "covered-call")?.data.params;
    const put = nodeFor(loop, "protective-put")?.data.params;
    if (!call || !put) return null;
    return collarForfeit({
      strikePct: String(call.strikePct ?? ""),
      floorPct: String(put.floorPct ?? ""),
      rollDays: String(call.rollDays ?? ""),
    });
  }, [committed, loop]);

  const screenState: ScreenState = repricing ? "quoting" : ok ? "ok" : "idle";

  /**
   * WHAT THIS MARKET RULED OUT (THE GHOST BAY RULING, 2026-08-22), from the
   * one owner of THE MODULE RULING. On a market whose leverage slope is not
   * positive beyond the ratified floor this is `["safety-buffer"]`, and on
   * every other market — including a market that does not price yet — it is
   * empty, which is the shipped rack byte for byte.
   */
  const dominated = useMemo(() => dominatedModules(props.scanRow), [props.scanRow]);

  /** THE ONE addability derivation, delegated whole (item 15) — now with the
   *  market's own verdict as an input, which is where the ruling said it
   *  belongs: in the addability derivation, not in the rack's chain walk. */
  const addability = useMemo(() => addableModules(loop, { dominated }), [loop, dominated]);

  /** The ordered rack: every placed plate, then the bays the lane is still
   *  open at. Pure, exported, and swept over all 128 subsets (P0-3). */
  const items = useMemo(() => rackItems(loop, addability), [loop, addability]);

  /** What `Install defaults` will actually install: `installDefaults`' OWN
   *  chain, on `installDefaults`' own row, minus what the lane already holds.
   *  Not an intersection with a private list — see the note above. */
  const installCount = useMemo(
    () => defaultInstallChain(props.scanRow).filter((k) => !nodeFor(loop, k)).length,
    [props.scanRow, loop],
  );

  /**
   * SURFACE ROW 9 — what one notch of the dial costs on this market.
   *
   * ONE OWNER: `notchMove` (leverage-stops.ts), the same call the compose
   * panel makes. This held a private copy of the three lines, and the copy
   * had already drifted: it read the hedged escrow on a hedgeless lane. The
   * owner takes `hasHedge` and prices f_b = 1 where the lane holds no short.
   * The lane's candidate is priced at the lane's own composition, so its
   * implied escrow IS the lane's dials; no composition needs re-threading
   * here.
   */
  const laneHasHedge = !!nodeFor(loop, "hedge");
  /** The lane's composition — the same object `RackCanvas` priced the quote
   *  with — threaded to every plate so the hedge screen reads the dials it was
   *  priced at, never a constant and never a second derivation. */
  const comp = useMemo(() => pricingParamsFor(loop), [loop]);
  const notch = useMemo(() => notchMove(ok?.candidate, laneHasHedge, comp), [ok, laneHasHedge, comp]);

  /**
   * THE GHOST BAY'S COUNT, FROM THE SAME OWNER THE DOCK HEAD READS
   * (S2 Wave 2 seam, 2026-08-24).
   *
   * The bay printed the addable-key count as a bare number of things a
   * reader could pick — SIX on a blank lane — while the dock head three
   * inches away had already moved to `1 source, 6 modules, 4 strategies` over
   * the SEVEN rows the shelf actually lists. One shelf, two surfaces, two
   * numbers. W2-C3 opened that defect and could not close it: `Lane.tsx` was
   * outside its OWNS list.
   *
   * The bay now builds the SAME `ComposeOptions` the shelf is rendered from —
   * `composeOptionsFor` on this lane's own loop, candidate, scan row and
   * dials, which is byte for byte the call `ComposePanel` makes for its card
   * — and hands it to `shelfCountLabel`, the one owner of the sentence. Not a
   * second derivation: the one derivation, so the two surfaces cannot
   * disagree by construction.
   *
   * It is unconditional, where the old count guarded itself on `> 0`. The
   * label is a description of the SHELF, which always holds seven rows, not
   * of what is left to add — so there is no state in which the bay is on
   * screen and the sentence is false.
   */
  const shelfOpts = useMemo(
    () =>
      composeOptionsFor(loop, ok?.candidate ?? null, {
        scanRow: props.scanRow,
        comp,
        preset: comp.riskPreset,
      }),
    [loop, ok, props.scanRow, comp],
  );
  const choiceLabel = shelfCountLabel(shelfOpts);

  /**
   * THE CUSHION. The adverse move in the collateral-vs-debt pair that
   * liquidates this lane, at the leverage the MODEL landed on. One owner
   * (`liquidation.ts`), read here exactly as the dock control and the vault
   * page read it, so the three can never disagree. Null until a market is
   * pinned — the header prints nothing rather than a placeholder.
   */
  const cushion = useMemo(
    () =>
      adverseMoveShort(
        liquidationDistance(ok?.candidate?.lt, ok?.candidate?.economics?.loopLeverage),
      ),
    [ok],
  );

  const hasSafety = !!nodeFor(loop, "safety-buffer");
  // Non-loop families price through the mock-quote path with no leverage
  // module — their screens read the quote as soon as it lands. Read off the
  // COMMITTED family: an unbound lane has no quote to read anyway, and asking
  // `laneFamily()` here was one more surface asserting loop by default.
  const screensLive = hasSafety || (committed !== null && committed !== "loop");

  // Wire heat: plate→plate hot once the downstream plate is placed AND the
  // current quote is ok; the final segment into the vault goes hot only
  // when the lane is reviewable (the lane visibly "completes").
  /* ⚠ THE FLAGS ARE INDEXED OVER WIRE NODES, NOT OVER ITEMS (2026-08-26).
     `LaneWires` measures `root.querySelectorAll("[data-wire-node]")` and pairs
     CONSECUTIVE nodes, and an OVERLAY plate carries no such attribute — the
     capital wire runs behind it. Indexed over `items` the two lists desync by
     one the moment an overlay is placed, and every wire after it lights the
     wrong segment. The rack and the wires must count the same things. */
  const wireItems = useMemo(
    () => items.filter((i) => i.kind !== "plate" || !OVERLAY_KEYS.has(i.key)),
    [items],
  );
  const hotFlags = useMemo(() => {
    const flags: boolean[] = [];
    for (let i = 0; i < wireItems.length - 1; i++) {
      flags.push(wireItems[i].kind === "plate" && wireItems[i + 1].kind === "plate" && !!ok);
    }
    flags.push(props.laneReviewable); // last wire node → vault
    return flags;
  }, [wireItems, ok, props.laneReviewable]);

  const measureKey = `${items.map((i) => (i.kind === "strategy" ? "strategy" : `${i.kind}:${i.key}`)).join(",")}|${props.multi}|${props.laneFocused}|${props.focusedKey ?? ""}`;

  return (
    // data-loop-id: the tip layer's hover ring and dart resolve their target
    // against the board, and fall back to this lane's ghost .rk-slot when the
    // plate a tip is about does not exist yet (TIP_SPEC E2/E5b).
    <section
      data-loop-id={loop.id}
      className={`rk-lane${props.laneFocused ? " rk-lane--focused" : ""}${props.focusedKey ? " rk-lane--hasfocus" : ""}${props.noCapacity ? " rk-lane--nocap" : ""}`}
      /* THE WHOLE LANE SELECTS THE LANE (founder report, 2026-08-27).
         ---------------------------------------------------------------
         The band above and below the plates, the gaps between them and the
         header's empty space were all dead surface that fell through to the
         board's unguarded `onClick` and CLEARED the selection — 32% of a
         lane's area, against the 7.7% that selected it. `isLaneBackground`
         is the one owner of "does this click belong to the lane"; plate,
         slot, key and field clicks answer false and keep their own
         behaviour. `onFocusLane` carries the board's pan guard, so a drag
         that ends over a lane never selects it.

         POINTER-ONLY, ON PURPOSE: no role, no tabIndex, no aria on this
         element. It enlarges a control that is already keyboard reachable
         (the name button below), so it adds ZERO focusable regions and
         cannot stack a role inside a role. */
      onClick={(e) => {
        if (!isLaneBackground(e.target)) return;
        props.onFocusLane();
      }}
    >
      {/* I2 — the lane header is the door to the dock's Lane panel (risk,
          allocation, orchestrator rules).

          A PLAIN <header> SINCE 2026-08-27. It was `role="button" tabIndex=0`
          wrapping an input and a button, which is invalid ARIA, and its one
          legible hit target was the rename field — so the click that looked
          most like "select this lane" edited its name instead. The name is a
          real button now (LaneName) and the header's own empty space is lane
          background like every other part of the lane. */}
      <header className="rk-lanehead">
        <LaneName
          id={loop.id}
          label={loop.label}
          selected={props.laneFocused}
          onSelect={props.onFocusLane}
          onRename={props.onRename}
        />
        <span className="rk-laneapy">
          {repricing ? (
            <i className="rk-lanenote">quoting…</i>
          ) : netApy !== null ? (
            <>
              {/* `pct` is the single APY printer. The inline
                  `(netApy * 100).toFixed(1)` + a literal percent sign that this
                  replaces was a fourth private copy of it, and it emitted an
                  ASCII hyphen on a negative lane where every other surface on
                  the canvas emits U+2212. */}
              net APY <b>{pct(netApy)}</b> <i className="rk-lanenote">modeled</i>
            </>
          ) : null}
        </span>
        {/* QNT-3 — the ledger's collar ruling: the premium cash flow never
            prints without the upside it was paid for. Same quiet register as
            the cushion chip; a fact beside the number, never a warning. */}
        {!repricing && netApy !== null && forfeit ? (
          <span className="rk-laneshare">{collarForfeitLine(forfeit)}</span>
        ) : null}
        {cushion ? <span className="rk-laneshare">{cushion}</span> : null}
        {/* The eyes-open verdict is a FACT chip, not a warning: muted register,
            no amber. It is the same string the review sheet and the record
            carry, so the three surfaces state one verdict. */}
        {props.railVerdict ? <span className="rk-laneshare">{props.railVerdict}</span> : null}
        {notch ? (
          /* Amber is the narration register and it belongs to a cost. A notch
             that ADDS is not a warning and must not wear one. */
          <span className={notch.costs ? "rk-riskline" : "rk-laneshare"}>{notch.text}</span>
        ) : null}
        {props.allocationBps !== null ? (
          <span className="rk-laneshare">{pct(props.allocationBps / 10000, 0)} allocation</span>
        ) : null}
        {props.canRemove ? (
          <button
            className="rk-lanekill"
            aria-label={`Remove ${loop.label}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onRemoveLoop();
            }}
          >
            Remove
          </button>
        ) : null}
      </header>

      <div className="rk-row" ref={rowRef}>
        <LaneWires containerRef={rowRef} hotFlags={hotFlags} measureKey={measureKey} pulseKey={props.pulseKey} />
        {items.map((item, i) => {
          /* THE ORDINAL IS THE RENDERED POSITION, 1-based. See the note where
             the `INDEX` map used to be: the map was a foreign chain's number
             and it collided across families. */
          const ordinal = String(i + 1).padStart(2, "0");
          if (item.kind === "strategy") {
            /* BAY 02 ON AN UNCOMMITTED LANE. It names no family and no module,
               because the lane has chosen neither; it names the POSITION and
               says how many things fit in it. Pressing it focuses the lane,
               which lands the dock on the shelf where the choice actually
               lives — the bay is a door, not a control that installs. */
            return (
              <GhostSlot
                key="ghost-strategy"
                label={STRATEGY_SLOT_LABEL}
                keyLabel="Choose a module"
                sub={choiceLabel}
                onClick={props.onFocusLane}
              />
            );
          }
          if (item.kind === "todo") {
            /* An unmet downstream link. It names what it waits on rather than
               instructing: the anchor is one plate to its left and lit. */
            return (
              <GhostSlot
                key={`todo-${item.key}`}
                label={SLOT_LABEL[item.key]}
                todo
                todoAfter={item.after ? WAITS_ON[item.after] : null}
                onClick={() => {}}
              />
            );
          }
          if (item.kind === "ghost") {
            if (item.key === "liquidity-source") {
              return (
                <GhostSlot
                  key="ghost-src"
                  label={SLOT_LABEL[item.key]}
                  want
                  keyLabel="Browse markets"
                  onClick={props.onOpenCatalog}
                />
              );
            }
            if (item.key === "safety-buffer") {
              /* THE BODY ADDS ONE MODULE — the one it is named after. The
                 multi-module scope is on the nested key and the key SAYS its
                 count, which now comes from `defaultInstallChain` — the chain
                 `installDefaults` itself walks — so the number on the key is
                 the number of plates the press seats, not the number of
                 modules the lane could take. Below two the key would duplicate
                 the body, so it stands down; that is the correct silence on a
                 row whose chain is shorter than the promise.

                 REACHED ONLY WHERE THE MODULE INSTALLS (2026-08-22). Where the
                 market has ruled it dominated `rackItems` emits no bay at all,
                 so this branch and its nested key go with it, and the lane's
                 `Install defaults` is the dock's own lit key — which is gated
                 on `spineIncomplete && bound === "loop"`, true at fresh pick on
                 exactly those markets. */
              return (
                <GhostSlot
                  key="ghost-sb"
                  label={SLOT_LABEL[item.key]}
                  onClick={() => props.onAddModule("safety-buffer")}
                  keyLabel={
                    installCount >= 2 ? `Install defaults (${installCount})` : undefined
                  }
                  onKey={installCount >= 2 ? props.onInstallDefaults : undefined}
                />
              );
            }
            return (
              <GhostSlot
                key={`ghost-${item.key}`}
                label={SLOT_LABEL[item.key]}
                onClick={() => props.onAddModule(item.key)}
              />
            );
          }
          const node = nodeFor(loop, item.key)!;
          return (
            <HwPlate
              key={node.id}
              nodeId={node.id}
              moduleKey={item.key}
              index={ordinal}
              params={node.data.params}
              reprice={reprice}
              screenState={item.key === "liquidity-source" || screensLive ? screenState : "idle"}
              scan={props.scan}
              hasHedge={laneHasHedge}
              comp={comp}
              paramCtx={props.paramCtx}
              focused={props.focusedKey === item.key}
              snap={props.snapKeys.has(node.id)}
              ejecting={props.ejectingKeys?.has(node.id)}
              onFocus={() => props.onFocusModule(item.key)}
              onParam={(field, value) => props.onParam(item.key, field, value)}
              /* THE SAME LOCK THE DOCK'S CROSS READS (2026-08-23): a module
                 that is the only member holding a required group of a
                 surviving family has no eject key on the plate either. */
              onEject={
                EJECTABLE.has(item.key) && !requiredInstalled(loop, item.key)
                  ? () => props.onEject(item.key)
                  : undefined
              }
              onOpenCatalog={item.key === "liquidity-source" ? props.onOpenCatalog : undefined}
              helpOpen={props.helpNodeId === node.id}
              onToggleHelp={props.onToggleHelp ? () => props.onToggleHelp!(node.id) : undefined}
            />
          );
        })}
        <VaultPlate
          laneLabel={loop.label}
          netApy={props.laneReviewable || ok ? netApy : null}
          blockNumber={ok?.blockNumber ?? null}
          live={props.laneReviewable}
          dim={!src}
          quoting={repricing}
          note={forfeit ? collarForfeitPlateLines(forfeit) : null}
        />
      </div>
    </section>
  );
}
