"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * Count a number up to its target (easeOutCubic, requestAnimationFrame).
 * Subsequent target changes animate from the previously shown value, so a
 * deposit ticks the TVL rather than recounting from zero. Respects
 * prefers-reduced-motion by landing on the target immediately.
 *
 * Lives in its own file so AutomationsSection can use it without importing
 * VaultDetail (which imports AutomationsSection — an import cycle).
 */

import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, ms = 700, seeded = false): number {
  /* SEEDED START (C1, 2026-08-24) — the SSR hero.
     Unseeded, the hook's first render is 0 on the server AND on the client,
     so `curl /vaults/khype-boost-loop` served `Modeled APY 0.0%`: the single
     most consequential number on the record, wrong in the HTML, corrected
     only once JavaScript ran. Every crawler, every preview card and every
     reader on a slow first paint read a zero the record does not state.
     `seeded` makes the first render the FROZEN value itself — identical on
     both sides of hydration, so there is no mismatch — and the tween then
     starts from that same value, i.e. it does not run on mount. A later
     target change still animates from what was shown, which is what the
     stat band needs when a deposit ticks it.
     Callers pass `seeded` only for a value that is frozen on the record and
     therefore identical on server and client. A clock- or storage-derived
     target must stay unseeded: seeding one would turn a masked difference
     into a hydration mismatch. */
  const [value, setValue] = useState(seeded ? target : 0);
  const fromRef = useRef(seeded ? target : 0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      /* k CLAMPS AT 0 (cleanup 2026-08-24). A rAF timestamp is the FRAME's
         start time and can precede the `performance.now()` captured when the
         effect ran — on a busy load frame by tens of ms — so an unclamped k
         goes negative, `1 − (1 − k)³` dips below 0 and the hero printed
         invented negatives for a beat ("Modeled APY −1.7%", "TVL $-2467",
         "Share value −0.2109") on values that cannot be negative. Clamped,
         the eased value stays inside [from, target] for the whole tween; the
         easing curve itself is untouched. */
      const k = Math.min(1, Math.max(0, (t - t0) / ms));
      const eased = 1 - Math.pow(1 - k, 3);
      const v = from + (target - from) * eased;
      fromRef.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}
