/**
 * Canvas geometry for the living-system diagram.
 *
 * Pure maths, no React and no DOM: node placements, edge routes as polylines,
 * and a point-at-progress walker so a pulse can travel any edge without
 * `getPointAtLength` (which needs a mounted `<path>` and therefore breaks
 * server rendering and deterministic screenshots).
 *
 * Two layouts, one shape. `wide` is the desktop dial: the vault dead centre
 * with the operator set fanned around it and the chain node off to the right.
 * `tall` is the 390px register: the same graph rotated into a column with
 * orthogonal channel routing, because a 1120-unit viewBox squeezed into 350
 * CSS pixels renders 13px type at 4px.
 */

/** A point in canvas user units. */
export interface Pt {
  /** x in user units. */
  x: number;
  /** y in user units. */
  y: number;
}

/** Which register the canvas is drawn in. */
export type CanvasMode = "wide" | "tall";

/** What a node represents in the topology. */
export type CanvasNodeKind = "vault" | "operator" | "chain";

/** One placed node. Vault nodes are circles; the rest are rounded plates. */
export interface CanvasNode {
  /** Stable id: `"vault"`, `"chain"`, or the operator signing address. */
  id: string;
  /** What it is. */
  kind: CanvasNodeKind;
  /** Centre in user units. */
  center: Pt;
  /** Plate width (vault: diameter). */
  width: number;
  /** Plate height (vault: diameter). */
  height: number;
}

/** What an edge carries. */
export type CanvasEdgeKind =
  /** Vault state -> operator: each node reads the position at `inputs_block`. */
  | "read"
  /** Operator -> chain: a signed submission travelling to the aggregator. */
  | "submit"
  /** Operator <-> operator: the mDNS p2p mesh. Carries gossip, not results. */
  | "mesh";

/** One routed edge. */
export interface CanvasEdge {
  /** Stable id, e.g. `"read:0x1111…"`. */
  id: string;
  /** What it carries. */
  kind: CanvasEdgeKind;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** Route in user units, source first. At least two points. */
  points: readonly Pt[];
}

/** A fully placed canvas. */
export interface CanvasLayout {
  /** Which register this is. */
  mode: CanvasMode;
  /** viewBox width in user units. */
  viewWidth: number;
  /** viewBox height in user units. */
  viewHeight: number;
  /** The centrepiece. */
  vault: CanvasNode;
  /** Operators, in registry order. */
  operators: readonly CanvasNode[];
  /** The Base attestation node. */
  chain: CanvasNode;
  /** Every routed edge. */
  edges: readonly CanvasEdge[];
}

/* ------------------------------------------------------------- primitives */

/** Distance between two points. */
function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Total length of a polyline.
 *
 * @param points route, source first.
 * @returns length in user units; `0` for fewer than two points.
 */
export function polylineLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1]!, points[i]!);
  }
  return total;
}

/**
 * The point a fraction `p` of the way along a polyline.
 *
 * @param points route, source first. Must be non-empty.
 * @param p progress; clamped to `[0, 1]`, and non-finite input reads as 0.
 * @returns the point in user units.
 */
export function pointAtProgress(points: readonly Pt[], p: number): Pt {
  const first = points[0];
  if (first === undefined) return { x: 0, y: 0 };
  const last = points[points.length - 1]!;

  const clamped = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  const target = polylineLength(points) * clamped;
  if (target <= 0) return first;

  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const segment = distance(a, b);
    if (segment === 0) continue;
    if (travelled + segment >= target) {
      const t = (target - travelled) / segment;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    travelled += segment;
  }
  return last;
}

/**
 * An SVG path `d` for a polyline.
 *
 * @param points route, source first.
 * @returns the `d` attribute, or `""` when there is nothing to draw.
 */
export function polylinePath(points: readonly Pt[]): string {
  if (points.length === 0) return "";
  const [head, ...rest] = points;
  return [
    `M ${round(head!.x)} ${round(head!.y)}`,
    ...rest.map((point) => `L ${round(point.x)} ${round(point.y)}`),
  ].join(" ");
}

/** Two decimals is plenty for an SVG coordinate, and keeps the DOM readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ------------------------------------------------------------ attachments */

/**
 * Where an edge should meet a node: the point on the node's outline, plus a
 * small standoff so the stroke does not touch the plate.
 *
 * @param node the node to leave (or enter).
 * @param toward the direction the edge heads in.
 * @param pad extra clearance in user units.
 * @returns the attachment point.
 */
export function attachPoint(node: CanvasNode, toward: Pt, pad = 8): Pt {
  const dx = toward.x - node.center.x;
  const dy = toward.y - node.center.y;
  if (dx === 0 && dy === 0) return node.center;

  if (node.kind === "vault") {
    const radius = node.width / 2 + pad;
    const length = Math.hypot(dx, dy);
    return {
      x: node.center.x + (dx / length) * radius,
      y: node.center.y + (dy / length) * radius,
    };
  }

  // Ray/rectangle intersection: scale the direction until it hits whichever
  // half-extent it reaches first.
  const halfWidth = node.width / 2 + pad;
  const halfHeight = node.height / 2 + pad;
  const scaleX = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: node.center.x + dx * scale, y: node.center.y + dy * scale };
}

/** Sample a quadratic Bezier into a polyline, so pulses can walk it. */
function quadratic(from: Pt, control: Pt, to: Pt, steps = 18): Pt[] {
  return Array.from({ length: steps + 1 }, (_unused, index) => {
    const t = index / steps;
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    };
  });
}

/* ---------------------------------------------------------------- layouts */

/** Raw placement for one register, before edges are routed. */
interface Placement {
  viewWidth: number;
  viewHeight: number;
  vault: Pt;
  vaultRadius: number;
  operators: readonly Pt[];
  operatorSize: { width: number; height: number };
  chain: Pt;
  chainSize: { width: number; height: number };
}

/**
 * Desktop register. Vault at the optical centre, the three operators fanned
 * around it (one above, two below), and the Base node parked to the right
 * where every submission converges.
 */
const WIDE: Placement = {
  viewWidth: 1120,
  viewHeight: 620,
  vault: { x: 405, y: 310 },
  vaultRadius: 100,
  operators: [
    { x: 405, y: 86 },
    { x: 152, y: 486 },
    { x: 662, y: 486 },
  ],
  operatorSize: { width: 264, height: 132 },
  chain: { x: 952, y: 300 },
  chainSize: { width: 300, height: 230 },
};

/** 390px register. The same graph as a column, wired with side channels. */
const TALL: Placement = {
  viewWidth: 560,
  viewHeight: 1120,
  vault: { x: 280, y: 140 },
  vaultRadius: 82,
  operators: [
    { x: 280, y: 380 },
    { x: 280, y: 560 },
    { x: 280, y: 740 },
  ],
  // Taller plates than the wide register: the same content has to survive a
  // 560-unit viewBox squeezed into ~330 CSS pixels, so the type is scaled up
  // (see PLATE_TALL / CHAIN_TALL in components/SystemCanvas.tsx).
  operatorSize: { width: 320, height: 160 },
  chain: { x: 280, y: 960 },
  chainSize: { width: 380, height: 230 },
};

/** The placement table, so a mode is always a lookup and never a branch. */
const PLACEMENTS: Readonly<Record<CanvasMode, Placement>> = { wide: WIDE, tall: TALL };

/* ------------------------------------------------------------------ build */

/**
 * Place and wire the whole topology.
 *
 * @param mode which register to draw.
 * @param operatorIds operator signing addresses in registry order. Extra ids
 *   past the third are ignored: the demo topology is a 3-node mesh by design.
 * @returns the placed layout.
 */
export function buildCanvasLayout(
  mode: CanvasMode,
  operatorIds: readonly string[],
): CanvasLayout {
  const place = PLACEMENTS[mode];

  const vault: CanvasNode = {
    id: "vault",
    kind: "vault",
    center: place.vault,
    width: place.vaultRadius * 2,
    height: place.vaultRadius * 2,
  };

  const chain: CanvasNode = {
    id: "chain",
    kind: "chain",
    center: place.chain,
    width: place.chainSize.width,
    height: place.chainSize.height,
  };

  const operators: CanvasNode[] = place.operators.map((center, index) => ({
    id: operatorIds[index] ?? `node-${index + 1}`,
    kind: "operator",
    center,
    width: place.operatorSize.width,
    height: place.operatorSize.height,
  }));

  const edges =
    mode === "wide" ? wideEdges(vault, operators, chain) : tallEdges(vault, operators, chain);

  return {
    mode,
    viewWidth: place.viewWidth,
    viewHeight: place.viewHeight,
    vault,
    operators,
    chain,
    edges,
  };
}

/** Wide register wiring: radial reads, bowed submissions, a mesh triangle. */
function wideEdges(
  vault: CanvasNode,
  operators: readonly CanvasNode[],
  chain: CanvasNode,
): readonly CanvasEdge[] {
  const [top, left, right] = operators;
  const edges: CanvasEdge[] = [];

  // Vault -> operator: straight radials. Every node reads the same position.
  for (const operator of operators) {
    edges.push({
      id: `read:${operator.id}`,
      kind: "read",
      from: vault.id,
      to: operator.id,
      points: [
        attachPoint(vault, operator.center),
        attachPoint(operator, vault.center),
      ],
    });
  }

  // Operator -> chain: bowed away from the vault so nothing clips the door.
  const submitControls: readonly Pt[] = [
    { x: 770, y: 120 },
    { x: 520, y: 415 },
    { x: 840, y: 450 },
  ];
  operators.forEach((operator, index) => {
    const control = submitControls[index] ?? {
      x: (operator.center.x + chain.center.x) / 2,
      y: (operator.center.y + chain.center.y) / 2,
    };
    edges.push({
      id: `submit:${operator.id}`,
      kind: "submit",
      from: operator.id,
      to: chain.id,
      points: quadratic(
        attachPoint(operator, control),
        control,
        attachPoint(chain, control),
      ),
    });
  });

  // p2p mesh: every pair, drawn faint. Gossip, not results.
  if (top !== undefined && left !== undefined && right !== undefined) {
    edges.push(
      meshEdge(top, left),
      meshEdge(top, right),
      meshEdge(left, right),
    );
  }

  return edges;
}

/** Tall register wiring: orthogonal channels either side of the column. */
function tallEdges(
  vault: CanvasNode,
  operators: readonly CanvasNode[],
  chain: CanvasNode,
): readonly CanvasEdge[] {
  const [first, second, third] = operators;
  if (first === undefined || second === undefined || third === undefined) return [];

  const edges: CanvasEdge[] = [
    // Vault reads: straight down to the first node, channels to the other two.
    {
      id: `read:${first.id}`,
      kind: "read",
      from: vault.id,
      to: first.id,
      points: [attachPoint(vault, first.center), attachPoint(first, vault.center)],
    },
    {
      id: `read:${second.id}`,
      kind: "read",
      from: vault.id,
      to: second.id,
      points: [
        { x: vault.center.x - vault.width / 2 - 8, y: vault.center.y },
        { x: 70, y: vault.center.y },
        { x: 70, y: second.center.y },
        { x: second.center.x - second.width / 2 - 8, y: second.center.y },
      ],
    },
    {
      id: `read:${third.id}`,
      kind: "read",
      from: vault.id,
      to: third.id,
      points: [
        { x: vault.center.x + vault.width / 2 + 8, y: vault.center.y },
        { x: 490, y: vault.center.y },
        { x: 490, y: third.center.y },
        { x: third.center.x + third.width / 2 + 8, y: third.center.y },
      ],
    },

    // Submissions converge on the chain plate from three channels.
    {
      id: `submit:${first.id}`,
      kind: "submit",
      from: first.id,
      to: chain.id,
      points: [
        { x: first.center.x + first.width / 2 + 8, y: first.center.y },
        { x: 512, y: first.center.y },
        { x: 512, y: 920 },
        { x: chain.center.x + chain.width / 2 + 8, y: 920 },
      ],
    },
    {
      id: `submit:${second.id}`,
      kind: "submit",
      from: second.id,
      to: chain.id,
      points: [
        { x: second.center.x - second.width / 2 - 8, y: second.center.y },
        { x: 40, y: second.center.y },
        { x: 40, y: 920 },
        { x: chain.center.x - chain.width / 2 - 8, y: 920 },
      ],
    },
    {
      id: `submit:${third.id}`,
      kind: "submit",
      from: third.id,
      to: chain.id,
      points: [
        attachPoint(third, chain.center),
        attachPoint(chain, third.center),
      ],
    },

    // Mesh: neighbours vertically, the far pair down a dedicated channel.
    meshEdge(first, second),
    meshEdge(second, third),
    {
      id: `mesh:${first.id}~${third.id}`,
      kind: "mesh",
      from: first.id,
      to: third.id,
      points: [
        { x: first.center.x + first.width / 2 + 8, y: first.center.y },
        { x: 458, y: first.center.y },
        { x: 458, y: third.center.y },
        { x: third.center.x + third.width / 2 + 8, y: third.center.y },
      ],
    },
  ];

  return edges;
}

/** A straight mesh link between two operator plates. */
function meshEdge(a: CanvasNode, b: CanvasNode): CanvasEdge {
  return {
    id: `mesh:${a.id}~${b.id}`,
    kind: "mesh",
    from: a.id,
    to: b.id,
    points: [attachPoint(a, b.center, 6), attachPoint(b, a.center, 6)],
  };
}
