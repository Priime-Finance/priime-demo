/**
 * Pure zoom-to-fit math (IT4C_RESPONSIVE_SPEC §1). No React, no DOM.
 *
 * Big screens get MORE PRODUCT: the fit targets filling ~86% of the
 * AVAILABLE canvas width (the board column the workstation grid actually
 * gives the canvas, i.e. viewport minus open panels), never less than 48px
 * side margins, with a fit cap that SCALES with the physical viewport so
 * plates genuinely grow on big screens. Vertically the content block is
 * centered in the visible canvas whenever it is shorter than it.
 *
 * RackCanvas feeds this from real measurements (board clientWidth/Height,
 * content-hugging rack offsetWidth/Height, window.innerWidth) and animates
 * to the returned view. The math lives here so it can be unit-tested.
 */

/** Fill target: the content block aims for ~86% of the available width. */
export const FIT_FILL = 0.86;
/** Minimum side margin (px) between the content block and the board edge. */
export const FIT_MARGIN_X = 48;
/** Phone-width margin floor (recette P1-9): 48px of dead gutter on a 390px
 *  viewport pushed lane controls past the right edge. */
export const FIT_MARGIN_X_MOBILE = 12;
/** Vertical breathing room (px) used for the height fit at each edge. */
export const FIT_PAD_Y = 24;
/** Minimum top offset (px) when the content is taller than the board. */
export const FIT_MIN_Y = 12;
/** The fit never shrinks below the manual zoom floor. */
export const FIT_MIN_SCALE = 0.4;
/**
 * THE LEGIBILITY FLOOR (recette I5).
 *
 * The smallest type the hardware plate puts on its own surface is 8.5px (the
 * nameplate/tag/key register, `.rk-lanebdg` and `.rk-addlane` in build.css).
 * At 1440px with BOTH panels open — the exact state the user has to be in to
 * pick a market and tune it — the 86% width fill lands at ~0.53, so that
 * 8.5px chrome rendered at 4.5px and the signature readout was unreadable in
 * the product's DEFAULT state.
 *
 * So the floor is not a taste number, it is an arithmetic one: the scale at
 * which the plate's smallest type is still 7px. Below it the fit stops
 * shrinking and the block simply overflows the board — panning is a gesture
 * the user can undo, an illegible plate is not.
 */
export const PLATE_MIN_TYPE_PX = 8.5;
export const FIT_MIN_TYPE_PX = 7;
export const FIT_MIN_SCALE_SINGLE_LANE = FIT_MIN_TYPE_PX / PLATE_MIN_TYPE_PX;
/** Phone-width scale floor (recette P1-9): a 0.4 floor could not fit a
 *  multi-plate lane inside 390px, so FIT "panned without rescaling" and the
 *  lane remove control rendered off-viewport. Reachability beats plate size. */
export const FIT_MIN_SCALE_MOBILE = 0.25;
/** Viewport width at or under which the mobile fit floors apply. */
export const FIT_MOBILE_MAX_W = 480;

/**
 * Viewport-scaled fit cap (spec §1): <=1440 the plates never exceed 1.0;
 * 1441-1799 they may grow to 1.15; >=1800 to 1.35. The cap keys off the
 * WINDOW width (the screen the user bought), not the board width (which
 * shrinks when panels open) — opening a panel must never change the cap.
 */
export function fitCapForViewport(viewportWidth: number): number {
  if (viewportWidth >= 1800) return 1.35;
  if (viewportWidth > 1440) return 1.15;
  return 1.0;
}

/**
 * The other end of the same clamp: how small the fit is allowed to go.
 *
 * `laneCount` is OPTIONAL and its absence means "the caller does not know",
 * which resolves to the historical 0.4 floor rather than to a promise the
 * caller never made. RackCanvas always passes it.
 *
 *   • phone widths  → FIT_MIN_SCALE_MOBILE. Reachability beats plate size on
 *     a 390px board (P1-9); the whole lane has to land inside the viewport.
 *   • one lane      → FIT_MIN_SCALE_SINGLE_LANE. A single lane is a short
 *     wide block; the width fit is what binds, and the block overflowing to
 *     the right is a pan, not a loss.
 *   • two or more   → FIT_MIN_SCALE. A tall rack is bound by HEIGHT, and
 *     vertical overflow on a canvas whose only vertical affordance is a drag
 *     hides lanes rather than the end of one.
 *
 * Never above the viewport cap: a floor that outranks the cap is not a
 * clamp, it is a contradiction.
 */
export function fitFloorForViewport(viewportWidth: number, laneCount?: number): number {
  if (viewportWidth <= FIT_MOBILE_MAX_W) return FIT_MIN_SCALE_MOBILE;
  const floor = laneCount === 1 ? FIT_MIN_SCALE_SINGLE_LANE : FIT_MIN_SCALE;
  return Math.min(floor, fitCapForViewport(viewportWidth));
}

export interface FitInput {
  /** Canvas width actually available: viewport minus open panel columns. */
  availableWidth: number;
  /** Visible canvas height. */
  availableHeight: number;
  /** Unscaled content width, measured from real lane bounds. */
  contentWidth: number;
  /** Unscaled content height. */
  contentHeight: number;
  /** Full window width — drives the fit cap only. */
  viewportWidth: number;
  /**
   * Right-edge gutter reserved for the canvas tip stack (TIP_SPEC D3).
   * UNCONDITIONAL by design: conditional reservation would re-run fitView on
   * every tip entrance and exit and slide the whole rack under the user,
   * which is far worse than a fixed gutter. Without it, a 296px card at
   * right:18px overlaps the top-right plate on almost every multi-plate lane
   * (the 86% fill leaves only ~100px of clearance on a 1440 board).
   */
  reservedRight?: number;
  /** Top-edge gutter (the mobile regime lays the stack across the top). */
  reservedTop?: number;
  /**
   * How many lanes the rack holds. Drives the SCALE FLOOR only (never the
   * fill, the cap or the centering). Absent = "unknown", which keeps the
   * historical 0.4 floor — see `fitFloorForViewport`.
   */
  laneCount?: number;
}

export interface FitView {
  x: number;
  y: number;
  s: number;
}

/**
 * Compute the zoom-to-fit view: scale to ~86% of the available width
 * (respecting the 48px margin floor, the height, and the viewport cap),
 * then center the block. Returns null when nothing is measurable yet.
 */
export function computeFit(i: FitInput): FitView | null {
  if (i.availableWidth <= 0 || i.availableHeight <= 0 || i.contentWidth <= 0 || i.contentHeight <= 0) {
    return null;
  }
  const cap = fitCapForViewport(i.viewportWidth);
  const mobile = i.viewportWidth <= FIT_MOBILE_MAX_W;
  const marginX = mobile ? FIT_MARGIN_X_MOBILE : FIT_MARGIN_X;
  const minScale = fitFloorForViewport(i.viewportWidth, i.laneCount);
  // The tip gutter comes off the top: everything below (fill, centering,
  // the mobile clamp) measures the space the rack may actually occupy.
  const reservedRight = Math.max(0, Math.min(i.reservedRight ?? 0, i.availableWidth - 120));
  const reservedTop = Math.max(0, Math.min(i.reservedTop ?? 0, i.availableHeight - 120));
  const availableWidth = i.availableWidth - reservedRight;
  const availableHeight = i.availableHeight - reservedTop;
  // 86% fill, but never closer to the edges than the margin floor
  const widthBudget = Math.min(availableWidth * FIT_FILL, availableWidth - marginX * 2);
  const heightBudget = availableHeight - FIT_PAD_Y * 2;
  const raw = Math.min(widthBudget / i.contentWidth, heightBudget / i.contentHeight, cap);
  const s = Math.max(minScale, raw);
  // horizontal centering with the margin floor; vertical centering whenever
  // the scaled block is shorter than the visible canvas. On phones the
  // margin floor must never push the block past the right edge (P1-9):
  // when the block fits, clamp the offset so the right edge stays inside;
  // when even the floor scale overflows, anchor left at the small margin.
  const centered = (availableWidth - i.contentWidth * s) / 2;
  let x: number;
  if (mobile) {
    if (i.contentWidth * s <= availableWidth - marginX * 2) {
      x = Math.max(marginX, centered);
    } else {
      x = Math.max(0, Math.min(marginX, availableWidth - i.contentWidth * s));
    }
  } else {
    x = Math.max(marginX, centered);
  }
  const y = reservedTop + Math.max(FIT_MIN_Y, (availableHeight - i.contentHeight * s) / 2);
  return { x, y, s };
}
