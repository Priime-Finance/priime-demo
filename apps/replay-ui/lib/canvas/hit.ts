/**
 * WHERE A CLICK LANDED ON THE CANVAS — the one owner of that question.
 *
 * ══ WHY THIS FILE EXISTS (founder report, 2026-08-27) ══════════════════════
 *
 * "on canvas, how to select lane 2 or 1 or 3, it seems complicated. […] For
 *  now I can only see lane 1 and not others by clicking."
 *
 * Measured on the live canvas at 1440x900, three complete lanes, 2px-grid
 * `elementFromPoint` over every lane: 7.73% of a lane's area selected it (a
 * 16px header band on a 171px lane), 58.7% focused a module, and 32.0% —
 * every pixel of the background AROUND the modules, which is exactly the
 * surface the founder was clicking — CLEARED the selection and sent the dock
 * back to Lane 1. The lane was not unreachable; the reachable strip did not
 * look like a control, and the large obvious surface beside it was
 * anti-functional.
 *
 * The root cause was a missing target guard on `.rk-board`'s `onClick`. Its
 * two siblings on the same element checked what was under the cursor
 * (`onPointerDown` via `isCanvasBackground`, `onDoubleClick` likewise);
 * `onClick` checked only whether a pan had happened, so every click that
 * survived to the board — and `<section class="rk-lane">` and
 * `<div class="rk-row">` have never carried a handler of their own — ran
 * `setFocus(null)`. Everything that worked, worked by calling
 * `stopPropagation`.
 *
 * `FundingCanvas` had already found half of this and fixed it in place
 * (see its board `onClick`); the fix was never carried across, and its list
 * was missing `.rk-lane` / `.rk-row` too. Both canvases now ask this file.
 *
 * ══ TWO PREDICATES, AND THE ASYMMETRY IS DELIBERATE ════════════════════════
 *
 * A click that CLEARS the user's selection is worse than a click that misses,
 * so clearing must name a positive target (`isBoardVoid`) while selecting may
 * rely on bubbling (`isLaneBackground`).
 *
 * Neither is `isCanvasBackground`, which lives in `RackCanvas` and answers a
 * third question — "may this gesture pan the board" — and must keep returning
 * true inside a lane, or panning dies on a phone where the lanes fill the
 * board.
 */

/**
 * Controls inside a lane that own their own click.
 *
 * `.rk-vault` is named explicitly although it currently also carries
 * `.rk-plate`, so the guard survives that class being dropped.
 *
 * `[role="button"]` catches the ghost bay's nested `Install defaults` key,
 * which is a `<span role="button">` rather than a `<button>`.
 */
const LANE_CONTROLS =
  '.rk-plate,.rk-vault,.rk-slot,.rk-addlane,button,input,select,textarea,[role="button"]';

/**
 * A click inside a lane that belongs to the LANE, not to a control in it:
 * the band above and below the plates, the gaps between them, the header's
 * empty space and its readouts.
 *
 * THE MECHANISM, STATED. Plates already `stopPropagation` in `HwPlate`, so a
 * plate click never reaches the lane at all. This guard is the SECOND line of
 * defence, so a future child that forgets to stop its own click degrades to
 * "nothing happens" rather than to "your selection is destroyed".
 */
export function isLaneBackground(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !el?.closest?.(LANE_CONTROLS);
}

/**
 * A click on the board itself, OUTSIDE every lane. Only this may clear the
 * selection.
 *
 * Every plate, slot, wire node and vault lives inside a `.rk-lane`, so naming
 * the lane covers the whole rack in both canvases; `.rk-orchcol` covers the
 * orchestrator / capital-router column beside it.
 */
export function isBoardVoid(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !el?.closest?.(
    '.rk-lane,.rk-orchcol,.rk-addlane,.rk-nav,.rk-tips,.rk-dart,' + LANE_CONTROLS,
  );
}

/** Exported for the tests that pin the census — never for a second copy. */
export const LANE_CONTROL_SELECTOR = LANE_CONTROLS;
