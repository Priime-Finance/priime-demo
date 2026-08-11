"use client";

/**
 * Which canvas register to draw.
 *
 * The 390px register is a different graph, not the same one shrunk: a
 * 1120-unit viewBox rendered in 350 CSS pixels puts 13px type on screen at
 * 4px. So the breakpoint picks a layout rather than scaling one, and it lives
 * in a hook because it owns a `matchMedia` subscription.
 *
 * Starts `"wide"` on the server and on the first client render, then
 * reconciles in an effect — matching what the media query actually says during
 * render would be a hydration mismatch.
 */
import { useEffect, useState } from "react";

import type { CanvasMode } from "@/lib/canvas";

/** Below this width the canvas switches to the column register. */
export const TALL_BREAKPOINT = "(max-width: 760px)";

/**
 * Subscribe to the canvas breakpoint.
 *
 * @returns the register to draw.
 */
export function useCanvasMode(): CanvasMode {
  const [mode, setMode] = useState<CanvasMode>("wide");

  useEffect(() => {
    const query = window.matchMedia(TALL_BREAKPOINT);
    const apply = (matches: boolean): void => setMode(matches ? "tall" : "wide");
    apply(query.matches);
    const onChange = (event: MediaQueryListEvent): void => apply(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return mode;
}
