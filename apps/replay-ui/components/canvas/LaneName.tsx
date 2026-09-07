"use client";

/**
 * THE LANE NAME — one control, shared by both racks.
 *
 * ══ WHY CLICK-TO-EDIT IS RETIRED (founder report, 2026-08-27) ══════════════
 *
 * The lane header was `<header role="button">` wrapping an `<input>` and a
 * `<button>`. That is invalid ARIA that already shipped, and it produced the
 * confusion the founder reported one level down: the rename field was the
 * most legible thing inside the ONLY strip of a lane that selected it, and it
 * called `stopPropagation`, so clicking the words "Lane 2" put a caret in
 * "Lane 2" and left the dock showing Lane 1. Measured: clicking (339, 477),
 * dead centre of the text reading "Lane 2", gave `activeElement =
 * INPUT.rk-lanename` with the dock kicker still on `Compose · Lane 1`.
 *
 * So the name is a BUTTON that selects the lane, and renaming moved onto the
 * two gestures that mean "edit this label" everywhere else: double-click, and
 * F2. Both defects die together — the nested-role trap and the click that
 * edits when the user meant to select — and the rename field leaves the tab
 * order of every lane.
 *
 * ══ THREE RULINGS WORTH KEEPING ════════════════════════════════════════════
 *
 *  • `aria-current="true"`, NOT `aria-pressed` (which implies a toggle that
 *    can be un-pressed; a lane cannot be deselected by pressing it again) and
 *    NOT `aria-expanded` (which implies a disclosure this button does not
 *    own). The retired `aria-expanded={laneFocused}` on the header was a lying
 *    label anyway: it read "expanded" while the dock was showing a MODULE.
 *
 *  • ESCAPE INSIDE THE FIELD STOPS PROPAGATION. The old input deliberately did
 *    not, so Escape mid-rename fell through to the canvas Esc ladder and threw
 *    the user out of the lane. The rename field is now the ladder's innermost
 *    ring, which is the ladder's own doctrine (help card → module → lane →
 *    null: out one ring at a time).
 *
 *  • REVERT IS BY CONSTRUCTION. The field is uncontrolled with
 *    `defaultValue`, so unmounting it throws the typed value away. The blur
 *    that may or may not fire on unmount (browsers disagree) is swallowed by
 *    `revertRef` rather than committing a half-typed name.
 */

import { useEffect, useRef, useState } from "react";

export interface LaneNameProps {
  /** The lane's loop id — namespaces the screen-reader hint. */
  id: string;
  label: string;
  /** This lane is the one the dock is currently talking about. */
  selected: boolean;
  /** Select this lane (the dock's Lane/Compose panel scopes to it). */
  onSelect: () => void;
  onRename: (label: string) => void;
}

export default function LaneName(props: LaneNameProps) {
  const [editing, setEditing] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const revertRef = useRef(false);
  const returnFocusRef = useRef(false);
  const hintId = `${props.id}:namehint`;

  // Leaving the field puts focus back where the gesture started, so a keyboard
  // user is never dropped at the top of the document mid-lane.
  useEffect(() => {
    if (editing || !returnFocusRef.current) return;
    returnFocusRef.current = false;
    btnRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    revertRef.current = false;
    setEditing(true);
  };

  if (editing) {
    return (
      <input
        className="rk-lanename"
        autoFocus
        defaultValue={props.label}
        aria-label="Lane name"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (revertRef.current) {
            revertRef.current = false;
            setEditing(false);
            return;
          }
          const v = e.target.value.trim();
          if (v && v !== props.label) props.onRename(v);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
            return;
          }
          if (e.key === "Escape") {
            // THE INNERMOST RING: Escape leaves the FIELD, never the lane.
            e.stopPropagation();
            revertRef.current = true;
            returnFocusRef.current = true;
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="rk-lanepick"
        aria-current={props.selected ? "true" : undefined}
        aria-describedby={hintId}
        title="Double-click to rename"
        onClick={props.onSelect}
        onDoubleClick={startEditing}
        onKeyDown={(e) => {
          if (e.key !== "F2") return;
          e.preventDefault();
          startEditing();
        }}
      >
        {props.label}
      </button>
      <span id={hintId} className="rk-sr">
        Press F2 to rename this lane.
      </span>
    </>
  );
}
