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
const FIT_FILL = 0.86;
/** Minimum side margin (px) between the content block and the board edge. */
const FIT_MARGIN_X = 48;
/** Phone-width margin floor (recette P1-9): 48px of dead gutter on a 390px
 *  viewport pushed lane controls past the right edge. */
const FIT_MARGIN_X_MOBILE = 12;
/** Vertical breathing room (px) used for the height fit at each edge. */
const FIT_PAD_Y = 24;
/** Minimum top offset (px) when the content is taller than the board. */
const FIT_MIN_Y = 12;
/** The fit never shrinks below the manual zoom floor. */
const FIT_MIN_SCALE = 0.4;
/** Phone-width scale floor (recette P1-9): a 0.4 floor could not fit a
 *  multi-plate lane inside 390px, so FIT "panned without rescaling" and the
 *  lane remove control rendered off-viewport. Reachability beats plate size. */
const FIT_MIN_SCALE_MOBILE = 0.25;
/** Viewport width at or under which the mobile fit floors apply. */
const FIT_MOBILE_MAX_W = 480;

/**
 * Viewport-scaled fit cap (spec §1): <=1440 the plates never exceed 1.0;
 * 1441-1799 they may grow to 1.15; >=1800 to 1.35. The cap keys off the
 * WINDOW width (the screen the user bought), not the board width (which
 * shrinks when panels open) — opening a panel must never change the cap.
 */
function fitCapForViewport(viewportWidth: number): number {
  if (viewportWidth >= 1800) return 1.35;
  if (viewportWidth > 1440) return 1.15;
  return 1.0;
}

interface FitInput {
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
}

interface FitView {
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
  const minScale = mobile ? FIT_MIN_SCALE_MOBILE : FIT_MIN_SCALE;
  // 86% fill, but never closer to the edges than the margin floor
  const widthBudget = Math.min(i.availableWidth * FIT_FILL, i.availableWidth - marginX * 2);
  const heightBudget = i.availableHeight - FIT_PAD_Y * 2;
  const raw = Math.min(widthBudget / i.contentWidth, heightBudget / i.contentHeight, cap);
  const s = Math.max(minScale, raw);
  // horizontal centering with the margin floor; vertical centering whenever
  // the scaled block is shorter than the visible canvas. On phones the
  // margin floor must never push the block past the right edge (P1-9):
  // when the block fits, clamp the offset so the right edge stays inside;
  // when even the floor scale overflows, anchor left at the small margin.
  const centered = (i.availableWidth - i.contentWidth * s) / 2;
  let x: number;
  if (mobile) {
    if (i.contentWidth * s <= i.availableWidth - marginX * 2) {
      x = Math.max(marginX, centered);
    } else {
      x = Math.max(0, Math.min(marginX, i.availableWidth - i.contentWidth * s));
    }
  } else {
    x = Math.max(marginX, centered);
  }
  const y = Math.max(FIT_MIN_Y, (i.availableHeight - i.contentHeight * s) / 2);
  return { x, y, s };
}
