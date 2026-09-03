/**
 * Bespoke SVG share-value line. No chart library: the kit's craft law is
 * hairlines over glows, and a 40-line path builder gives exactly the hairline
 * plus tint the cards and the performance section want.
 *
 * The line is blue punctuation on cream, never green: a share value is a data
 * number, and green in this system means live status only.
 */

interface SparklineProps {
  /** Oldest to newest. Fewer than two points renders nothing. */
  values: readonly number[];
  /** Draw the soft blue tint under the line. */
  fill?: boolean;
  /** Mark the newest point with a dot. */
  endDot?: boolean;
  /**
   * Mark every captured data point with a small dot, so a flat line
   * (e.g. two attested strikes at the same NAV) reads as two data points
   * rather than a rendering bug. Uses the same round-dot technique as
   * `endDot`. Where both would draw at the last point, `endDot` wins.
   */
  markPoints?: boolean;
  /** Stroke width in viewBox units. */
  stroke?: number;
  /** Accessible description; the graphic is hidden when omitted. */
  label?: string;
  /**
   * viewBox height for a fixed 300-unit width. Set it near the rendered
   * aspect ratio: the graphic stretches to fill its box, so a viewBox shaped
   * like the box keeps the end dot round.
   */
  viewHeight?: number;
}

const W = 300;

/** Map a series onto the viewBox, with 6% headroom top and bottom. */
function points(values: readonly number[], H: number): { x: number; y: number }[] {
  const n = values.length;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  const pad = H * 0.06;
  return values.map((v, i) => ({
    x: n === 1 ? 0 : (i / (n - 1)) * W,
    // A flat series (two attested strikes that settled at the same NAV, for
    // instance) draws down the middle rather than collapsing onto an edge.
    y: span === 0 ? H / 2 : H - pad - ((v - min) / span) * (H - pad * 2),
  }));
}

export function Sparkline({
  values,
  fill = true,
  endDot = true,
  markPoints = false,
  stroke = 1.6,
  label,
  viewHeight: H = 100,
}: SparklineProps) {
  if (values.length < 2) return null;
  const pts = points(values, H);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const last = pts[pts.length - 1];
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const id = `spk-${String(values.length)}-${values[0]!.toFixed(4).replace(".", "")}`;
  return (
    <svg
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      preserveAspectRatio="none"
      // dots sit on the viewBox edge at the first and last strike
      style={{ overflow: "visible" }}
      role={label === undefined ? "presentation" : "img"}
      aria-hidden={label === undefined}
      aria-label={label}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2B5CFF" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#2B5CFF" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke="#2B5CFF"
        strokeWidth={stroke}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {markPoints &&
        pts.map((p, i) => {
          const isLast = i === pts.length - 1;
          if (isLast && endDot) return null; // endDot already marks this point
          return <circle key={i} cx={p.x} cy={p.y} r={2.2} fill="#2B5CFF" />;
        })}
      {endDot && last && <circle cx={last.x} cy={last.y} r={2.6} fill="#1B2FEE" />}
    </svg>
  );
}
