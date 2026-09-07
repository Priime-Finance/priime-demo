"use client";

/**
 * Ghost slot (UX_SPEC §1) — the landing .pg-slot treatment: 1.5px dashed
 * #C9B49A, radius 16, 8.5px mono tracking .18em. `want` pulses orange: the
 * canvas itself proposes the next action, no instructional copy anywhere.
 *
 * ══ RECETTE ITEM 15 (2026-08-22) — TWO REACHABLE BROKEN STATES ═════════════
 *
 * 1. THE UNGATED DOWNSTREAM GHOST. Every non-anchor slot rendered as a live
 *    control the moment a market landed, and `RackCanvas.onAddModule` adds
 *    exactly the module it is handed — it does not walk the implied chain. So
 *    one click on `Auto-compound` before `Dynamic leverage` existed produced
 *    the lane {source, auto-compound}, which `validateGraph` refuses. A
 *    control that builds an invalid graph is not a control. Such a slot now
 *    renders `todo`: same geometry, same dashed frame, drained of the pickable
 *    register and inert, naming the module it waits on. It is a state, not a
 *    warning — no amber, no icon.
 *
 * 2. THE BODY THAT DID THREE THINGS. The `Dynamic leverage` slot's own body
 *    was wired to `installDefaults`, so pressing the plate-shaped thing
 *    labelled with ONE module's name installed THREE. The body now adds the
 *    one module it is named after and the three-module scope lives where it
 *    was always visible: on the nested key, which says `Install defaults (3)`
 *    and counts what it will actually install.
 *
 * ══ P0-3 (2026-08-22) — THE BAY NAMES THE MODULE, THE KEY NAMES THE ERRAND ══
 *
 * `installKey` / `onInstall` were the Install-defaults path spelled as if it
 * were the only reason a bay could carry a key. It is not: bay 01 reads
 * `Liquidity source` with the key `Browse markets`, and the uncommitted lane's
 * bay 02 reads `Modules` with the key `Choose a module`. So the pair
 * generalises to `keyLabel` / `onKey`, and the key acquires the state it was
 * always implying:
 *
 *   • `onKey` PRESENT  → the key does something the body does not (installing
 *     three modules where the body installs one). It is interactive, and it
 *     earns its own tab stop.
 *   • `onKey` ABSENT   → the key NAMES what pressing the bay does. It is
 *     decorative and `aria-hidden`, because a second tab stop that repeats the
 *     first is a second announcement of one action — and because a `role`
 *     button nested inside a real one is a control a screen reader cannot
 *     describe.
 *
 * `sub` is the bay's one quiet fact (`1 source, 6 modules, 4 strategies`). It
 * is a COUNT, never a mood, and never a number about money: nothing on this
 * rack is priced before a market.
 *
 * ══ W2-C3 (2026-08-24) — THE COUNT AND THE ROWS DISAGREED ══════════════════
 *
 * The bay said `6 to choose from` and the dock head said `6 modules,
 * 4 strategies`, both reading `addable.length`. But the blank-lane shelf
 * LISTS SEVEN rows: six addable keys plus the blocked one, and the first of
 * those seven is the liquidity source, which is not a module at all
 * (`MODULE_DEFS["liquidity-source"].optional === false` — the one key on the
 * registry with no install decision). So a reader counted seven things under
 * a head that said six.
 *
 * `shelfCountLabel` below is the ONE owner of that sentence. It counts the
 * rows the surface actually lists and splits them on the registry's own
 * `optional` flag, so the source is named as a source and the number can
 * never drift from the list again: `sources + modules === rows.length`.
 * Both surfaces call it — the dock head (`ComposePanel`) and this bay's
 * `sub` (`Lane`) — so they cannot disagree by construction.
 */

import type { ComposeOptions } from "@/lib/canvas/compose-options";
import { SHELF_COUNT_SCOPED } from "@/lib/canvas/shelf-count";

/**
 * THE BLANK-LANE COUNT, stated once, for the dock head and the ghost bay.
 *
 * SCOPED (docs/plans/LATEST_UI_PORT_SPEC.md A.3 #7): `1 source, 2 modules,
 * 1 strategy · 10 coming soon`. The live count read the rows the shelf lists,
 * and on this build the shelf still lists every row but seats only the live
 * ones, so the count is the one owner's (`lib/demo-scope.ts` through
 * `lib/canvas/shelf-count.ts`) and never this surface's own tally. Both
 * callers keep their signature: the dock head and this bay's `sub` print one
 * string by construction.
 */
export function shelfCountLabel(_opts: ComposeOptions): string {
  return SHELF_COUNT_SCOPED;
}

export default function GhostSlot({
  label,
  want,
  todo,
  todoAfter,
  sub,
  onClick,
  keyLabel,
  onKey,
}: {
  label: string;
  want?: boolean;
  /** An unmet downstream link: dimmed, inert, and not a promise. */
  todo?: boolean;
  /** What this slot is waiting on, as a noun, for the one-line reason. */
  todoAfter?: string | null;
  /** One quiet fact about the bay, under the label. */
  sub?: string | null;
  onClick: () => void;
  /** Label of the one key inside the slot. */
  keyLabel?: string;
  /** Present only when the key does something the body does not. */
  onKey?: () => void;
}) {
  if (todo) {
    /* `pointerEvents: none` rather than `disabled` alone: `.rk-slot:hover`
       repaints the border blue, and a blue border on a control that does
       nothing is the same lie in a quieter font. Inline because the todo state
       has no class in build.css and build.css is not this wave's to edit —
       HANDOFF: `.rk-slot.todo { opacity:.42; pointer-events:none }` belongs
       beside `.rk-slot.want`, and this style block goes when it lands. */
    return (
      <div
        className="rk-slot"
        data-wire-node
        data-state="todo"
        aria-disabled="true"
        style={{ opacity: 0.42, pointerEvents: "none", cursor: "default" }}
      >
        <span>{label}</span>
        {todoAfter ? <span style={{ opacity: 0.75 }}>after {todoAfter}</span> : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`rk-slot${want ? " want" : ""}`}
      data-wire-node
      data-state={want ? "want" : "open"}
      onClick={onClick}
    >
      <span>{label}</span>
      {sub ? <span style={{ opacity: 0.75 }}>{sub}</span> : null}
      {keyLabel ? (
        onKey ? (
          <span
            role="button"
            tabIndex={0}
            className="hm-key lit"
            data-key="install"
            onClick={(e) => {
              e.stopPropagation();
              onKey();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onKey();
              }
            }}
          >
            <span className="hm-led" />
            {keyLabel}
          </span>
        ) : (
          /* The key NAMES the body's own action. The whole bay is the button,
             so this must not be one — and must not be read out twice.

             LIT ONLY ON THE `want` BAY (O6). One lit key on screen, ever: the
             blank lane already pulses bay 01, and a second lit key beside it
             is two blue beats for one idea on the calmest screen in the
             product. An unlit key still NAMES the errand, which is its job. */
          <span className={`hm-key${want ? " lit" : ""}`} aria-hidden="true">
            <span className="hm-led" />
            {keyLabel}
          </span>
        )
      ) : null}
    </button>
  );
}
