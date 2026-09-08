"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * Deterministic share-value sparkline (SVG, no deps). Blue system.
 * Instrument register: hairline grid rulings, mono min/max labels, terminal
 * value by the dot. The line draws in on mount (vx-spark-line / vx-spark-fill
 * / vx-spark-dot, vaults.css) with an explicit reduced-motion fallback.
 * The SVG measures its own width so text never stretches (the viewBox
 * matches the rendered box 1:1).
 */

import { useEffect, useId, useRef, useState } from "react";

/**
 * Two optional props for the attested flat series on the hero page
 * (docs/plans/LATEST_UI_PORT_SPEC.md WP4.8): `fill={false}` draws no area
 * tint (a filled curve under two flat attested points would imply growth the
 * journal does not report) and `markPoints` marks every data point so a flat
 * line reads as N captured strikes rather than a rendering bug. The defaults
 * keep every live call site byte-identical in behaviour.
 */
export default function Sparkline({
  series,
  height = 120,
  fill = true,
  markPoints = false,
  format,
}: {
  series: number[];
  height?: number;
  fill?: boolean;
  markPoints?: boolean;
  /** How the three printed values (max, min, terminal) read. The share-value
   *  charts keep the four-decimal default; an instrument strip in dollars or
   *  in pp passes its own owner's formatter rather than printing
   *  `18643434.0000`. */
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => v.toFixed(4));
  const svgRef = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(320);
  const [seen, setSeen] = useState(false);
  const gradId = useId();

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      if (cw > 0) setW(Math.max(200, cw));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Gate playback, not the animation: the authored draw stagger holds at
  // its hidden first frames (animation-play-state paused, vaults.css) until
  // the chart first scrolls into view, then plays intact. Once-only; the
  // timeframe-switch remount replays because the svg is already in view.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const h = height;
  const pad = 6;
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  // Pad the value domain so flat / near-flat series center vertically: a
  // fresh vault shows a centered line with visible area fill instead of a
  // line glued to the bottom edge.
  const spanRaw = max - min;
  const padV = Math.max(spanRaw * 0.15, 0.002);
  const lo = min - padV;
  const hi = max + padV;
  const span = hi - lo || 1e-9;
  const x = (i: number) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - lo) / span) * (h - pad * 2);
  const d = series.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L ${x(series.length - 1).toFixed(1)} ${h - pad} L ${x(0).toFixed(1)} ${h - pad} Z`;
  const last = series[series.length - 1];
  const dotX = x(series.length - 1);
  const dotY = y(last);
  // Three hairline rulings at 25 / 50 / 75% of the plot height; the top and
  // bottom rulings carry the max / min value labels.
  const rulings = [0.25, 0.5, 0.75].map((f) => pad + f * (h - pad * 2));
  const mono = "var(--font-mono, ui-monospace, monospace)";
  return (
    <svg
      ref={svgRef}
      className={`vx-spark${seen ? " vx-spark--in" : ""}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2B5CFF" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#2B5CFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {rulings.map((ry) => (
        <line
          key={ry}
          x1={pad}
          x2={w - pad}
          y1={ry}
          y2={ry}
          stroke="#e7e4dd"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* A flat series has one value, and the terminal label already prints
          it: the range labels earn ink only when they say something else. */}
      {spanRaw > 0 ? (
        <>
          <text x={w - pad - 2} y={rulings[0] - 4} textAnchor="end" fontSize="9" fontFamily={mono} fill="#6f6b63">
            {fmt(max)}
          </text>
          <text x={w - pad - 2} y={rulings[2] + 11} textAnchor="end" fontSize="9" fontFamily={mono} fill="#6f6b63">
            {fmt(min)}
          </text>
        </>
      ) : null}
      {fill ? <path className="vx-spark-fill" d={area} fill={`url(#${gradId})`} /> : null}
      <path
        className="vx-spark-line"
        pathLength={1}
        d={d}
        fill="none"
        stroke="#2B5CFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {markPoints
        ? series.slice(0, -1).map((v, i) => (
            <circle key={i} className="vx-spark-dot" cx={x(i)} cy={y(v)} r="3" fill="#2B5CFF" />
          ))
        : null}
      <circle className="vx-spark-dot" cx={dotX} cy={dotY} r="3" fill="#2B5CFF" />
      <text
        x={dotX - 7}
        y={dotY - 7}
        textAnchor="end"
        fontSize="10"
        fontFamily={mono}
        fontWeight="600"
        fill="#2B5CFF"
        stroke="#fff"
        strokeWidth="2"
        paintOrder="stroke"
      >
        {fmt(last)}
      </text>
    </svg>
  );
}
