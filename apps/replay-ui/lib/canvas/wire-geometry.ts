/**
 * WIRE GEOMETRY — the one owner of "a jack's on-screen rect becomes a point in
 * a wire SVG's own coordinate space".
 *
 * WHY THIS FILE EXISTS (founder report, 2026-08-27: "prb on link from router
 * to lane when switching from one lane to another").
 * -------------------------------------------------------------------------
 * Three wire layers each rebuilt the same conversion inline, and none of the
 * three could be tested without a browser:
 *
 *   - `RouterWires`   (FundingCanvas) — capital router → each lane's perp jack
 *   - `OrchWires`     (RackCanvas)    — orchestrator   → each loop's source jack
 *   - `LaneWires`                     — plate → plate inside one lane
 *
 * All three measured jacks with `getBoundingClientRect()` (VIEWPORT space) and
 * then hand-rolled the map back into the SVG's own user space out of the
 * container's rect and `offsetWidth`:
 *
 *     const k = rr.width / root.offsetWidth;          // the viewport scale
 *     const x = (jackRect.left + jackRect.width / 2 - rr.left) / k;
 *
 * That reconstruction is CORRECT but approximate, and it is approximate in a
 * way that gets worse as the rack gets wider: `offsetWidth` is an INTEGER, so
 * `k` carries the rounding error of a whole pixel spread over the rack. On the
 * loop rack at 1440 that is k=0.57411 against a true 0.57407 — about a tenth
 * of a local pixel at the far edge. The browser will hand us the exact matrix
 * if we ask, so we ask: `svg.getScreenCTM()` inverted is the same map with no
 * reconstruction and no rounding, and it keeps working through any transform
 * the board grows later. The `k` form stays as the fallback for the one case
 * where the CTM is unavailable (a detached or `display:none` SVG, or a test
 * environment with no SVG layout).
 *
 * ⚠ WHAT IS *NOT* A PROBLEM HERE, measured, so nobody re-introduces it:
 * per-lane `zoom` (`.rk-rack--multi .rk-lane .hm-hw{zoom:.62}` /
 * `.rk-lane--focused .hm-hw{zoom:.86}`, build.css) does NOT need a per-lane
 * scale correction. `getBoundingClientRect()` already reports the jack's real
 * viewport box with every ancestor zoom baked in, so a lane's zoom changes
 * WHERE the jack is, never HOW rack-local space maps to the viewport. That map
 * is one affine for the whole rack. Dividing a second time by a per-lane zoom
 * would double-correct and push the endpoint off by (1 - zoom) of its offset.
 * `wire-geometry.test.ts` pins exactly this: two lanes at two different zooms,
 * both endpoints on their jack centres, from ONE matrix.
 *
 * The real bug was the TRIGGER, not the maths: the router layers never
 * re-measured when lane focus changed, and a focus change is precisely what
 * moves every jack by 38.7%. See the `measureKey` props at the call sites.
 */

/** The parts of a `DOMRect` this module needs. */
export interface WireRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WirePoint {
  x: number;
  y: number;
}

/** A 2-D affine matrix in `DOMMatrix` component order. */
export interface WireMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_MATRIX: WireMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Centre of a rect, in whatever space the rect is expressed in. */
export function rectCentre(r: WireRect): WirePoint {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function applyMatrix(m: WireMatrix, p: WirePoint): WirePoint {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Inverse of an affine matrix, or null when it is singular (zero scale). */
export function invertMatrix(m: WireMatrix): WireMatrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (!det || !Number.isFinite(det)) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/**
 * The FALLBACK map, local → screen, rebuilt from a container's own rect and a
 * uniform scale. This is what every wire layer used to compute by hand; it is
 * only reached when the SVG cannot give us a CTM.
 */
export function originScaleMatrix(originX: number, originY: number, k: number): WireMatrix {
  const s = k > 0 && Number.isFinite(k) ? k : 1;
  return { a: s, b: 0, c: 0, d: s, e: originX, f: originY };
}

/**
 * screen (viewport) → the SVG's own user space.
 *
 * `screenToLocal` takes the INVERSE matrix so a caller inverts once per
 * measure pass rather than once per jack.
 */
export function screenToLocal(inverse: WireMatrix, p: WirePoint): WirePoint {
  return applyMatrix(inverse, p);
}

/** A jack's centre, measured in the viewport, expressed in the SVG's space. */
export function jackCentreLocal(rect: WireRect, inverse: WireMatrix): WirePoint {
  return screenToLocal(inverse, rectCentre(rect));
}

/**
 * Resolve the screen→local matrix for one measure pass. Prefers the SVG's own
 * CTM; falls back to the container-rect reconstruction. Never returns null:
 * a singular matrix degrades to identity rather than dropping the wires.
 */
export function resolveInverse(
  screenCtm: WireMatrix | null | undefined,
  fallback: { originX: number; originY: number; k: number },
): WireMatrix {
  const fromCtm = screenCtm ? invertMatrix(screenCtm) : null;
  if (fromCtm) return fromCtm;
  const rebuilt = invertMatrix(originScaleMatrix(fallback.originX, fallback.originY, fallback.k));
  return rebuilt ?? IDENTITY_MATRIX;
}

/** One bus destination: a lane's entry jack, plus the label the drop carries. */
export interface BusTarget {
  id: string;
  rect: WireRect;
  label: string;
}

/** One drawn cable. `start`/`end` are the exact path endpoints, for tests. */
export interface BusWire {
  id: string;
  d: string;
  label: string;
  /** Label anchor, in the SVG's space. */
  x: number;
  y: number;
  start: WirePoint;
  end: WirePoint;
}

/** Two decimals: sub-pixel at every board scale, and keeps `d` strings short. */
function n(v: number): string {
  return v.toFixed(2);
}

/**
 * FUNDING RACK — capital router to each lane's perp-market jack.
 * A symmetric horizontal cubic: both control points sit on the midpoint x, so
 * the cable leaves the router sideways and arrives at the jack sideways.
 */
export function routerBusWires(
  bus: WireRect,
  targets: readonly BusTarget[],
  inverse: WireMatrix,
): BusWire[] {
  const start = jackCentreLocal(bus, inverse);
  return targets.map((t) => {
    const end = jackCentreLocal(t.rect, inverse);
    const mx = (start.x + end.x) / 2;
    return {
      id: t.id,
      label: t.label,
      d: `M ${n(start.x)} ${n(start.y)} C ${n(mx)} ${n(start.y)}, ${n(mx)} ${n(end.y)}, ${n(end.x)} ${n(end.y)}`,
      x: mx,
      y: (start.y + end.y) / 2,
      start,
      end,
    };
  });
}

/**
 * LOOP RACK — orchestrator to each loop's liquidity-source jack.
 * A sagging cubic: both control points drop by `sag` so the cable hangs, the
 * way the landing's bus cables do.
 */
export function orchestratorBusWires(
  orch: WireRect,
  targets: readonly BusTarget[],
  inverse: WireMatrix,
): BusWire[] {
  const start = jackCentreLocal(orch, inverse);
  return targets.map((t) => {
    const end = jackCentreLocal(t.rect, inverse);
    const sag = 34 + Math.abs(end.y - start.y) * 0.12;
    return {
      id: t.id,
      label: t.label,
      d: `M ${n(start.x)} ${n(start.y)} C ${n(start.x)} ${n(start.y + sag)}, ${n(end.x)} ${n(end.y + sag)}, ${n(end.x)} ${n(end.y)}`,
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2 + sag * 0.72,
      start,
      end,
    };
  });
}

/**
 * Parse the final coordinate pair out of a cubic `d` string. Exists so a test
 * can assert on WHAT WAS DRAWN rather than on the numbers the builder happened
 * to return alongside it — the endpoint and the path have to agree.
 */
export function pathEndpoint(d: string): WirePoint | null {
  const parts = d.trim().split(/[\s,]+/);
  const y = Number(parts[parts.length - 1]);
  const x = Number(parts[parts.length - 2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}
