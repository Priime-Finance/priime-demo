"use client";

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * TipDart (TIP_SPEC §E5b) — on accept, the tip does not fly. It SENDS A WIRE.
 *
 * One 1.25px #2B5CFF quadratic in an SVG sibling of `.rk-viewport`, with the
 * exact stroke and drop-shadow of `.rk-wires path.hot`, so the beat is the
 * canvas's own language and costs one SVG node.
 *
 * GEOMETRY: both rects come from `getBoundingClientRect()` and are therefore
 * POST-transform, so there is ZERO zoom math — the dart is drawn in board
 * pixels whatever the viewport scale.
 *
 * TARGET FALLBACK: when the selector resolves to nothing (the common
 * `add-module` case, where the plate does not exist yet) the caller passes the
 * lane's ghost `.rk-slot`, which does exist and is exactly where the module
 * will land. The dart hits the empty socket, then the module snaps into it.
 *
 * Exactly ONE dart in flight, ever — two blue arcs crossing the rack is a
 * slot machine. Never mounted under reduced motion (E7): `.rk-tgt--land`
 * carries the causation instead.
 */

import { useEffect, useMemo, useState } from "react";

export interface DartShot {
  /** Bumped per shot so the same geometry re-runs the animation. */
  key: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Shorter travel on mobile: the desktop timing reads sluggish. */
  compact: boolean;
}

export default function TipDart({ shot }: { shot: DartShot | null }) {
  const [alive, setAlive] = useState(false);
  useEffect(() => {
    if (!shot) return;
    setAlive(true);
    const t = setTimeout(() => setAlive(false), shot.compact ? 200 : 260);
    return () => clearTimeout(t);
  }, [shot]);

  const path = useMemo(() => {
    if (!shot) return null;
    const { from, to } = shot;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    // control point pushed perpendicular to the chord
    const off = shot.compact ? 20 : 40;
    const cx = (from.x + to.x) / 2 + (-dy / len) * off;
    const cy = (from.y + to.y) / 2 + (dx / len) * off;
    // quadratic arc length approximation is plenty for a dash budget
    const approx = Math.hypot(cx - from.x, cy - from.y) + Math.hypot(to.x - cx, to.y - cy);
    return { d: `M${from.x},${from.y} Q${cx},${cy} ${to.x},${to.y}`, len: approx };
  }, [shot]);

  if (!shot || !path || !alive) return null;
  return (
    <svg className="rk-dart" aria-hidden>
      <path
        key={shot.key}
        d={path.d}
        style={
          {
            strokeDasharray: `60 ${path.len}`,
            ["--dart-len" as string]: `${path.len}`,
            animationDuration: shot.compact ? "180ms" : "220ms",
          } as React.CSSProperties
        }
      />
    </svg>
  );
}
