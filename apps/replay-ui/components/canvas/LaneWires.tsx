"use client";

/**
 * LaneWires (UX_SPEC §2.4) — one SVG per lane behind the plates. Segments
 * run between consecutive jacks (tout → tin), measured from plate DOM rects
 * (the .hm-jack spans), recomputed on ResizeObserver. Ghost = dashed
 * #C9C2B0 (pgdash), hot = #2B5CFF with glow; plug dots land on jack centers
 * (black, per the landing cable chrome). A reprice arrival pulses the hot
 * wires once (stroke 1.6→2.4→1.6, 400ms).
 */

import { useEffect, useRef, useState } from "react";
import { resolveInverse, screenToLocal } from "@/lib/canvas/wire-geometry";

interface Segment {
  d: string;
  hot: boolean;
  plugs: { x: number; y: number }[];
}

export default function LaneWires({
  containerRef,
  hotFlags,
  measureKey,
  pulseKey,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** hotFlags[i] = segment between wire-node i and i+1 is hot. */
  hotFlags: boolean[];
  /** Any change re-measures (placement, focus, zoom, lane count). */
  measureKey: string;
  /** Increment to run the one-shot pulse on hot wires. */
  pulseKey: number;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [pulsing, setPulsing] = useState(false);
  // Newly hot segments draw in (rank 18): indexes held in a set for the
  // animation window so measure-driven re-renders never cut the draw short.
  const [drawing, setDrawing] = useState<ReadonlySet<number>>(new Set());
  const prevHot = useRef<boolean[]>([]);
  const rafRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const fresh: number[] = [];
    hotFlags.forEach((h, i) => {
      if (h && !prevHot.current[i]) fresh.push(i);
    });
    prevHot.current = hotFlags.slice();
    if (!fresh.length) return;
    setDrawing((s) => new Set([...s, ...fresh]));
    const t = setTimeout(() => {
      setDrawing((s) => {
        const next = new Set(s);
        fresh.forEach((i) => next.delete(i));
        return next;
      });
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(hotFlags)]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const root = containerRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      // Canvas pan/zoom (UX_ITERATION_3 §2) scales the viewport with a CSS
      // transform: client rects come back scaled while the SVG lives INSIDE
      // the transform, so every measured point has to come back out of
      // viewport space before it can be a path coordinate.
      //
      // `lib/canvas/wire-geometry` owns that conversion for all three wire
      // layers now (this one, RouterWires, OrchWires). It asks the SVG for its
      // own screen matrix and inverts it, which is the same map this used to
      // rebuild from `rootRect` and an INTEGER `offsetWidth` — minus that
      // integer's rounding error, which on a wide rack is a tenth of a local
      // pixel. The rebuilt form is still the fallback below.
      const inverse = resolveInverse(svgRef.current?.getScreenCTM() ?? null, {
        originX: rootRect.left,
        originY: rootRect.top,
        k: root.offsetWidth > 0 && rootRect.width > 0 ? rootRect.width / root.offsetWidth : 1,
      });
      const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-wire-node]"));
      const segs: Segment[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        const outJack = a.querySelector<HTMLElement>('[data-jack$=":out"]');
        const inJack = b.querySelector<HTMLElement>('[data-jack$=":in"]');
        const ar = (outJack ?? a).getBoundingClientRect();
        const br = (inJack ?? b).getBoundingClientRect();
        // A jack plugs at its centre; a bare wire-node plugs at the edge the
        // cable leaves from or arrives at, vertically centred.
        const from = screenToLocal(inverse, {
          x: outJack ? ar.left + ar.width / 2 : ar.right,
          y: ar.top + ar.height / 2,
        });
        const to = screenToLocal(inverse, {
          x: inJack ? br.left + br.width / 2 : br.left,
          y: br.top + br.height / 2,
        });
        const x1 = from.x;
        const y1 = from.y;
        const x2 = to.x;
        const y2 = to.y;
        // IT4C: shallow, tight arcs that stay OUT of the lane-header band.
        // The SVG's top edge (local y=0) is the header's bottom edge; a
        // symmetric cubic with both control points at j-lift peaks at
        // j - 0.75*lift, so capping lift at (j-9)/0.75 keeps every apex
        // more than 8px below the header. Long spans flatten (0.28*dx,
        // max 40) instead of ballooning.
        const j = Math.min(y1, y2);
        const lift = Math.max(2, Math.min(40, (x2 - x1) * 0.28, Math.max(0, j - 9) / 0.75));
        segs.push({
          d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${(y1 - lift).toFixed(1)}, ${x2.toFixed(1)} ${(y2 - lift).toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
          hot: hotFlags[i] ?? false,
          plugs: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ],
        });
      }
      setSegments(segs);
    };

    // measure after layout settles (zoom transitions run 280ms)
    rafRef.current = requestAnimationFrame(measure);
    const t = setTimeout(measure, 320);
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, measureKey, JSON.stringify(hotFlags)]);

  useEffect(() => {
    if (pulseKey === 0) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 420);
    return () => clearTimeout(t);
  }, [pulseKey]);

  return (
    <svg ref={svgRef} className="rk-wires" aria-hidden>
      {segments.map((s, i) => (
        <g key={i}>
          <path
            d={s.d}
            // pathLength normalizes the draw animation; ghost paths keep
            // their native length so the 3/6 dash pattern stays intact.
            pathLength={s.hot ? 1 : undefined}
            className={
              s.hot ? `hot${drawing.has(i) ? " draw" : ""}${pulsing ? " pulse" : ""}` : "ghost"
            }
          />
          {s.hot
            ? s.plugs.map((p, j) => (
                <circle
                  key={j}
                  className={`plug${drawing.has(i) ? " in" : ""}`}
                  cx={p.x}
                  cy={p.y}
                  r={3.2}
                />
              ))
            : null}
        </g>
      ))}
    </svg>
  );
}
