"use client";

/**
 * SystemCanvas — the living system, drawn once in SVG.
 *
 * The vault in the middle, three operator modules around it, the Base
 * attestation node off to one side, and every wire that connects them: vault
 * state fanning out to the operators when a strike fires, signed submissions
 * converging on the chain, and the faint mDNS mesh between the nodes.
 *
 * Presentation only, like everything in `components/`: geometry arrives as a
 * `CanvasLayout`, values arrive preformatted, and travelling pulses arrive as
 * `{ edgeId, progress }`. The component owns no clock and no simulator.
 *
 * Interaction is deliberately small: click any node to inspect it, flip a
 * node's `corrupt` switch to make it lie from the next strike onward.
 */
import {
  type CanvasEdge,
  type CanvasLayout,
  type CanvasNode,
  pointAtProgress,
  polylinePath,
} from "@/lib/canvas";
import { VaultDoor, type VaultTone } from "@/components/VaultDoor";

/* ----------------------------------------------------------------- models */

/**
 * Lifecycle step a node lamp can show. `stalled` is the honest node in a
 * strike that never reached quorum: amber, not red. Nothing was outvoted.
 */
export type NodeLamp =
  | "idle"
  | "computing"
  | "submitted"
  | "accepted"
  | "rejected"
  | "stalled";

/** One operator module on the canvas. */
export interface CanvasOperatorView {
  /** Operator signing address; matches the layout node id. */
  id: string;
  /** Registry label, e.g. `"node-1"`. */
  label: string;
  /** Slash index, e.g. `"// 01"`. */
  index: string;
  /** Truncated signing address. */
  address: string;
  /** Lamp register. */
  lamp: NodeLamp;
  /** Status word on the mini LCD. */
  statusWord: string;
  /** Truncated `result_hash`, or a placeholder. */
  hash: string;
  /** NAV as a signed percentage, or a placeholder. */
  navPct: string;
  /** Weight line, e.g. `"WEIGHT 1"`. */
  weight: string;
  /** True while this node is flipped to lie. */
  corrupt: boolean;
  /** libp2p peer id, for the native tooltip on the mesh. */
  peerId: string;
}

/** The Base attestation node. */
export interface CanvasChainView {
  /** Chain line, e.g. `"Base · 8453"`. */
  title: string;
  /** Slash index. */
  index: string;
  /** One-line framing. */
  kicker: string;
  /** Truncated registry contract address. */
  registry: string;
  /** Quorum state, e.g. `"2-of-3"`. */
  quorum: string;
  /** Quorum status word. */
  quorumWord: string;
  /** Lamp register: ok when settled, warn when stalled. */
  lamp: "idle" | "computing" | "accepted" | "rejected" | "stalled";
  /** Truncated attestation tx hash, or a placeholder. */
  txLabel: string;
  /** Settled NAV line. */
  navLine: string;
}

/** The vault at the centre. */
export interface CanvasVaultView {
  /** Lamp register. */
  tone: VaultTone;
  /** True while the strike is reading the position. */
  reading: boolean;
  /** Engraved line 1, e.g. `"NAV +0.42%"`. */
  caption: string;
  /** Engraved line 2, e.g. `"HF 1.17"`. */
  subCaption: string;
}

/** A packet travelling an edge. */
export interface CanvasPulse {
  /** `CanvasEdge.id` it travels. */
  edgeId: string;
  /**
   * Progress along the edge in `[0, 1]`, or `null` for "this wire is hot but
   * nothing is animating" (reduced motion).
   */
  progress: number | null;
  /** Colour register. */
  tone: "read" | "ok" | "bad";
}

export interface SystemCanvasProps {
  /** Placed geometry. */
  layout: CanvasLayout;
  /** The vault. */
  vault: CanvasVaultView;
  /** Operators, keyed to layout node ids. */
  operators: readonly CanvasOperatorView[];
  /** The chain node. */
  chain: CanvasChainView;
  /** Pulses in flight this frame. */
  pulses: readonly CanvasPulse[];
  /** Currently inspected node id, or null. */
  selected: string | null;
  /** Inspect a node. */
  onSelect: (nodeId: string) => void;
  /** Flip an operator's corrupt switch. */
  onToggleCorrupt: (operatorId: string) => void;
  /** Suppress travelling dots, spin and shake. */
  reducedMotion: boolean;
}

/* ---------------------------------------------------------------- metrics */

/** Every coordinate one operator plate needs, in canvas user units. */
interface PlateMetrics {
  lamp: { x: number; y: number; r: number };
  name: { x: number; y: number; size: number };
  index: { x: number; y: number; size: number };
  addr: { x: number; y: number; size: number };
  lcd: { x: number; y: number; w: number; h: number; pad: number; r: number };
  lcdLabel: number;
  lcdValue: number;
  lcdNav: number;
  toggle: { x: number; y: number; w: number; h: number; labelX: number; size: number };
  foot: { y: number; size: number };
}

/** Every coordinate the chain plate needs. */
interface ChainMetrics {
  lamp: { x: number; y: number; r: number };
  title: { x: number; y: number; size: number };
  index: { x: number; y: number; size: number };
  kicker: { x: number; y: number; size: number };
  row: { x: number; y: number; labelSize: number; valueSize: number };
  lcd: { x: number; y: number; w: number; h: number; pad: number; r: number };
  micro: number;
  metric: number;
  tx: number;
  foot: { y: number; size: number };
}

const PLATE_WIDE: PlateMetrics = {
  lamp: { x: -108, y: -43, r: 6 },
  name: { x: -96, y: -37, size: 17 },
  index: { x: 118, y: -37, size: 11 },
  addr: { x: -96, y: -19, size: 11.5 },
  lcd: { x: -118, y: -8, w: 236, h: 44, pad: 9, r: 6 },
  lcdLabel: 9,
  lcdValue: 13,
  lcdNav: 12,
  toggle: { x: -118, y: 44, w: 34, h: 16, labelX: -78, size: 9 },
  foot: { y: 56, size: 10 },
};

const PLATE_TALL: PlateMetrics = {
  lamp: { x: -138, y: -54, r: 8 },
  name: { x: -122, y: -46, size: 23 },
  index: { x: 148, y: -46, size: 14 },
  addr: { x: -122, y: -24, size: 14 },
  lcd: { x: -150, y: -12, w: 300, h: 56, pad: 12, r: 8 },
  lcdLabel: 12,
  lcdValue: 17,
  lcdNav: 15,
  toggle: { x: -150, y: 56, w: 44, h: 20, labelX: -98, size: 12 },
  foot: { y: 71, size: 12 },
};

const CHAIN_WIDE: ChainMetrics = {
  lamp: { x: -128, y: -90, r: 7 },
  title: { x: -114, y: -84, size: 17 },
  index: { x: 136, y: -84, size: 11 },
  kicker: { x: -114, y: -64, size: 10 },
  row: { x: 136, y: -38, labelSize: 9, valueSize: 11 },
  lcd: { x: -136, y: -24, w: 272, h: 104, pad: 12, r: 8 },
  micro: 9,
  metric: 26,
  tx: 12,
  foot: { y: 104, size: 10 },
};

const CHAIN_TALL: ChainMetrics = {
  lamp: { x: -168, y: -88, r: 8 },
  title: { x: -150, y: -80, size: 22 },
  index: { x: 172, y: -80, size: 14 },
  kicker: { x: -150, y: -58, size: 12 },
  row: { x: 172, y: -32, labelSize: 11, valueSize: 14 },
  lcd: { x: -172, y: -18, w: 344, h: 112, pad: 14, r: 8 },
  micro: 11,
  metric: 30,
  tx: 15,
  foot: { y: 104, size: 12 },
};

/** Lamp colour per register. */
const LAMP_COLOR: Readonly<Record<string, string>> = {
  idle: "var(--text-faint)",
  computing: "var(--o-500)",
  submitted: "var(--o-400)",
  accepted: "var(--status-ok)",
  rejected: "var(--status-bad)",
  stalled: "var(--status-warn)",
};

/** Pulse and hot-wire colour per register. */
const PULSE_COLOR: Readonly<Record<CanvasPulse["tone"], string>> = {
  read: "var(--o-500)",
  ok: "var(--status-ok)",
  bad: "var(--status-bad)",
};

/* -------------------------------------------------------------- component */

/** The whole topology. */
export function SystemCanvas({
  layout,
  vault,
  operators,
  chain,
  pulses,
  selected,
  onSelect,
  onToggleCorrupt,
  reducedMotion,
}: SystemCanvasProps): React.JSX.Element {
  const plate = layout.mode === "wide" ? PLATE_WIDE : PLATE_TALL;
  const chainMetrics = layout.mode === "wide" ? CHAIN_WIDE : CHAIN_TALL;

  const pulseByEdge = new Map(pulses.map((pulse) => [pulse.edgeId, pulse]));
  const viewById = new Map(operators.map((view) => [view.id.toLowerCase(), view]));

  const peerLabel = (edge: CanvasEdge): string => {
    const from = viewById.get(edge.from.toLowerCase());
    const to = viewById.get(edge.to.toLowerCase());
    if (from === undefined || to === undefined) return "p2p mesh · mDNS";
    return `p2p mesh · mDNS\n${from.label} ${from.peerId}\n${to.label} ${to.peerId}`;
  };

  return (
    <svg
      className="canvas"
      viewBox={`0 0 ${layout.viewWidth} ${layout.viewHeight}`}
      role="img"
      aria-label="Vault, three operator nodes and the Base attestation node, with the NAV strike flowing between them"
      data-testid="system-canvas"
      data-mode={layout.mode}
    >
      {/*
        Paints. SVG `fill` cannot take a CSS gradient token, so the door's
        gradients are declared here and their stops are coloured from CSS
        (`stop-color` on an attribute would not resolve `var()`).
      */}
      <defs>
        <radialGradient id="vaultFace" cx="50%" cy="34%" r="74%">
          <stop className="vaultstop vaultstop--face-a" offset="0%" />
          <stop className="vaultstop vaultstop--face-b" offset="100%" />
        </radialGradient>
        <linearGradient id="vaultBezel" x1="0" y1="0" x2="0" y2="1">
          <stop className="vaultstop vaultstop--rim-a" offset="0%" />
          <stop className="vaultstop vaultstop--rim-b" offset="100%" />
        </linearGradient>
        <radialGradient id="vaultHub" cx="50%" cy="32%" r="70%">
          <stop className="vaultstop vaultstop--hub-a" offset="0%" />
          <stop className="vaultstop vaultstop--hub-b" offset="100%" />
        </radialGradient>
        <pattern id="canvasGrid" width="64" height="64" patternUnits="userSpaceOnUse">
          <path className="canvasgrid" d="M 64 0 L 0 0 0 64" />
        </pattern>
      </defs>

      {/* The board the whole system is bolted to: the kit's blueprint grid. */}
      <rect className="canvas__board" x={0} y={0} width={layout.viewWidth} height={layout.viewHeight} rx={12} />
      <rect
        className="canvas__gridfill"
        x={0}
        y={0}
        width={layout.viewWidth}
        height={layout.viewHeight}
        rx={12}
        fill="url(#canvasGrid)"
      />

      {/* Wires first, so every plate sits on top of its own connections. */}
      <g className="canvas__wires">
        {layout.edges.map((edge) => {
          const pulse = pulseByEdge.get(edge.id);
          const path = polylinePath(edge.points);
          return (
            <g key={edge.id} data-edge={edge.id} data-kind={edge.kind}>
              <path className={`wire wire--${edge.kind}`} d={path}>
                {edge.kind === "mesh" ? <title>{peerLabel(edge)}</title> : null}
              </path>
              {pulse === undefined ? null : (
                <path
                  className="wire wire--hot"
                  d={path}
                  style={{ stroke: PULSE_COLOR[pulse.tone] }}
                />
              )}
            </g>
          );
        })}
      </g>

      {/* Travelling packets. */}
      <g className="canvas__pulses">
        {pulses.map((pulse) => {
          const edge = layout.edges.find((candidate) => candidate.id === pulse.edgeId);
          if (edge === undefined || pulse.progress === null) return null;
          const point = pointAtProgress(edge.points, pulse.progress);
          return (
            <circle
              key={pulse.edgeId}
              className="pulse"
              cx={point.x}
              cy={point.y}
              r={5}
              style={{ fill: PULSE_COLOR[pulse.tone] }}
              data-testid={`pulse-${pulse.edgeId}`}
            />
          );
        })}
      </g>

      {/* The vault. */}
      <NodeGroup
        node={layout.vault}
        label={`Vault, ${vault.caption}`}
        selected={selected === layout.vault.id}
        onSelect={onSelect}
        testId="canvas-vault"
      >
        <VaultDoor
          radius={layout.vault.width / 2}
          tone={vault.tone}
          reading={vault.reading}
          reducedMotion={reducedMotion}
          caption={vault.caption}
          subCaption={vault.subCaption}
        />
      </NodeGroup>

      {/* The operator set. */}
      {layout.operators.map((node) => {
        const view = viewById.get(node.id.toLowerCase());
        if (view === undefined) return null;
        return (
          <NodeGroup
            key={node.id}
            node={node}
            label={`Operator ${view.label}`}
            selected={selected === node.id}
            onSelect={onSelect}
            testId={`canvas-${view.label}`}
            sick={view.corrupt}
            reducedMotion={reducedMotion}
          >
            <OperatorPlate
              node={node}
              view={view}
              metrics={plate}
              reducedMotion={reducedMotion}
              onToggleCorrupt={onToggleCorrupt}
            />
          </NodeGroup>
        );
      })}

      {/* The chain. */}
      <NodeGroup
        node={layout.chain}
        label="Base attestation node"
        selected={selected === layout.chain.id}
        onSelect={onSelect}
        testId="canvas-chain"
      >
        <ChainPlate
          node={layout.chain}
          view={chain}
          metrics={chainMetrics}
          reducedMotion={reducedMotion}
        />
      </NodeGroup>
    </svg>
  );
}

/* ------------------------------------------------------------- node shell */

interface NodeGroupProps {
  node: CanvasNode;
  label: string;
  selected: boolean;
  onSelect: (nodeId: string) => void;
  testId: string;
  sick?: boolean;
  reducedMotion?: boolean;
  children: React.ReactNode;
}

/** A positioned, clickable, focusable node wrapper. */
function NodeGroup({
  node,
  label,
  selected,
  onSelect,
  testId,
  sick = false,
  reducedMotion = false,
  children,
}: NodeGroupProps): React.JSX.Element {
  const classes = [
    "canvasnode",
    `canvasnode--${node.kind}`,
    selected ? "canvasnode--selected" : null,
    sick ? "canvasnode--sick" : null,
    sick && !reducedMotion ? "canvasnode--buzzing" : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");

  return (
    <g
      className={classes}
      transform={`translate(${node.center.x} ${node.center.y})`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
      data-testid={testId}
      data-selected={String(selected)}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      {/* Inner wrapper: the buzz animation lives here so a CSS transform can
          never overwrite the node's own translate. */}
      <g className="canvasnode__body">{children}</g>
    </g>
  );
}

/* --------------------------------------------------------- operator plate */

interface OperatorPlateProps {
  node: CanvasNode;
  view: CanvasOperatorView;
  metrics: PlateMetrics;
  reducedMotion: boolean;
  onToggleCorrupt: (operatorId: string) => void;
}

/** One operator module: lamp, identity, mini LCD, corrupt switch. */
function OperatorPlate({
  node,
  view,
  metrics,
  reducedMotion,
  onToggleCorrupt,
}: OperatorPlateProps): React.JSX.Element {
  const { lcd } = metrics;
  const lampColor = view.corrupt ? "var(--status-bad)" : LAMP_COLOR[view.lamp];
  const lcdTone =
    view.corrupt || view.lamp === "rejected"
      ? "bad"
      : view.lamp === "stalled"
        ? "warn"
        : view.lamp;

  return (
    <>
      <rect
        className="plate"
        x={-node.width / 2}
        y={-node.height / 2}
        width={node.width}
        height={node.height}
        rx={14}
      />

      <circle
        className={
          reducedMotion ? "lamp" : view.corrupt ? "lamp lamp--alarm" : "lamp lamp--breathing"
        }
        cx={metrics.lamp.x}
        cy={metrics.lamp.y}
        r={metrics.lamp.r}
        style={{ fill: lampColor }}
        data-testid={`lamp-${view.label}`}
        data-lamp={view.corrupt ? "corrupt" : view.lamp}
      />

      <text className="plate__name" x={metrics.name.x} y={metrics.name.y} fontSize={metrics.name.size}>
        {view.label}
      </text>
      <text
        className="plate__index"
        x={metrics.index.x}
        y={metrics.index.y}
        fontSize={metrics.index.size}
        textAnchor="end"
      >
        {view.index}
      </text>
      <text className="plate__addr" x={metrics.addr.x} y={metrics.addr.y} fontSize={metrics.addr.size}>
        {view.address}
      </text>

      {/* Mini LCD: the one thing this node claims about the world. */}
      <rect className="lcd" x={lcd.x} y={lcd.y} width={lcd.w} height={lcd.h} rx={lcd.r} />
      <text
        className="lcd__label"
        x={lcd.x + lcd.pad}
        y={lcd.y + lcd.h * 0.34}
        fontSize={metrics.lcdLabel}
      >
        RESULT HASH
      </text>
      <text
        className="lcd__label"
        x={lcd.x + lcd.w - lcd.pad}
        y={lcd.y + lcd.h * 0.34}
        fontSize={metrics.lcdLabel}
        textAnchor="end"
        data-tone={lcdTone}
      >
        {view.statusWord}
      </text>
      <text
        className="lcd__value"
        x={lcd.x + lcd.pad}
        y={lcd.y + lcd.h * 0.78}
        fontSize={metrics.lcdValue}
        data-tone={lcdTone}
        data-testid={`hash-${view.label}`}
      >
        {view.hash}
      </text>
      <text
        className="lcd__value"
        x={lcd.x + lcd.w - lcd.pad}
        y={lcd.y + lcd.h * 0.78}
        fontSize={metrics.lcdNav}
        textAnchor="end"
        data-tone={lcdTone}
      >
        {view.navPct}
      </text>

      <CorruptSwitch
        metrics={metrics}
        checked={view.corrupt}
        label={view.label}
        onToggle={() => onToggleCorrupt(view.id)}
      />

      <text
        className="plate__foot"
        x={node.width / 2 - 14}
        y={metrics.foot.y}
        fontSize={metrics.foot.size}
        textAnchor="end"
      >
        {view.weight}
      </text>
    </>
  );
}

/* -------------------------------------------------------- corrupt switch */

interface CorruptSwitchProps {
  metrics: PlateMetrics;
  checked: boolean;
  label: string;
  onToggle: () => void;
}

/**
 * The switch the whole canvas exists for: flip it and this node starts lying
 * from the next strike. A rocker in a recessed cradle, the kit's `Toggle`.
 */
function CorruptSwitch({
  metrics,
  checked,
  label,
  onToggle,
}: CorruptSwitchProps): React.JSX.Element {
  const { toggle } = metrics;
  const thumb = toggle.h - 6;
  const thumbX = checked ? toggle.x + toggle.w - thumb - 3 : toggle.x + 3;

  return (
    <g
      className={checked ? "corrupt corrupt--on" : "corrupt"}
      role="switch"
      tabIndex={0}
      aria-checked={checked}
      aria-label={`Corrupt ${label}`}
      data-testid={`corrupt-${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }
      }}
    >
      <rect
        className="corrupt__track"
        x={toggle.x}
        y={toggle.y}
        width={toggle.w}
        height={toggle.h}
        rx={toggle.h / 2}
      />
      <circle
        className="corrupt__thumb"
        cx={thumbX + thumb / 2}
        cy={toggle.y + toggle.h / 2}
        r={thumb / 2}
      />
      <text
        className="corrupt__label"
        x={toggle.labelX}
        y={toggle.y + toggle.h * 0.72}
        fontSize={toggle.size}
      >
        CORRUPT
      </text>
    </g>
  );
}

/* ------------------------------------------------------------ chain plate */

interface ChainPlateProps {
  node: CanvasNode;
  view: CanvasChainView;
  metrics: ChainMetrics;
  reducedMotion: boolean;
}

/** The Base node: registry, quorum state, and the (simulated) attestation. */
function ChainPlate({
  node,
  view,
  metrics,
  reducedMotion,
}: ChainPlateProps): React.JSX.Element {
  const { lcd } = metrics;
  const tone =
    view.lamp === "rejected" ? "bad" : view.lamp === "stalled" ? "warn" : view.lamp;

  return (
    <>
      <rect
        className="plate"
        x={-node.width / 2}
        y={-node.height / 2}
        width={node.width}
        height={node.height}
        rx={14}
      />

      <circle
        className={reducedMotion ? "lamp" : "lamp lamp--breathing"}
        cx={metrics.lamp.x}
        cy={metrics.lamp.y}
        r={metrics.lamp.r}
        style={{ fill: LAMP_COLOR[view.lamp] }}
        data-lamp={view.lamp}
        data-testid="lamp-chain"
      />
      <text className="plate__name" x={metrics.title.x} y={metrics.title.y} fontSize={metrics.title.size}>
        {view.title}
      </text>
      <text
        className="plate__index"
        x={metrics.index.x}
        y={metrics.index.y}
        fontSize={metrics.index.size}
        textAnchor="end"
      >
        {view.index}
      </text>
      <text
        className="plate__kicker"
        x={metrics.kicker.x}
        y={metrics.kicker.y}
        fontSize={metrics.kicker.size}
      >
        {view.kicker}
      </text>

      <text
        className="plate__foot"
        x={-node.width / 2 + 14}
        y={metrics.row.y}
        fontSize={metrics.row.labelSize}
      >
        REGISTRY
      </text>
      <text
        className="plate__addr"
        x={metrics.row.x}
        y={metrics.row.y}
        fontSize={metrics.row.valueSize}
        textAnchor="end"
      >
        {view.registry}
      </text>

      <rect className="lcd" x={lcd.x} y={lcd.y} width={lcd.w} height={lcd.h} rx={lcd.r} />
      <text className="lcd__label" x={lcd.x + lcd.pad} y={lcd.y + 16} fontSize={metrics.micro}>
        QUORUM
      </text>
      <text
        className="lcd__label"
        x={lcd.x + lcd.w - lcd.pad}
        y={lcd.y + 16}
        fontSize={metrics.micro}
        textAnchor="end"
        data-tone={tone}
      >
        {view.quorumWord}
      </text>
      <text
        className="lcd__metric"
        x={lcd.x + lcd.pad}
        y={lcd.y + 16 + metrics.metric * 1.15}
        fontSize={metrics.metric}
        data-tone={tone}
        data-testid="chain-quorum"
      >
        {view.quorum}
      </text>
      <text
        className="lcd__label"
        x={lcd.x + lcd.w - lcd.pad}
        y={lcd.y + 16 + metrics.metric * 1.15}
        fontSize={metrics.micro}
        textAnchor="end"
      >
        {view.navLine}
      </text>

      <text
        className="lcd__label"
        x={lcd.x + lcd.pad}
        y={lcd.y + lcd.h - 30}
        fontSize={metrics.micro}
      >
        ATTESTATION TX
      </text>
      <text
        className="lcd__value"
        x={lcd.x + lcd.pad}
        y={lcd.y + lcd.h - 12}
        fontSize={metrics.tx}
        data-tone={tone}
        data-testid="chain-tx"
      >
        {view.txLabel}
      </text>
      <text
        className="lcd__sim"
        x={lcd.x + lcd.w - lcd.pad}
        y={lcd.y + lcd.h - 12}
        fontSize={metrics.micro}
        textAnchor="end"
      >
        SIM
      </text>

      <text
        className="plate__foot"
        x={-node.width / 2 + 14}
        y={metrics.foot.y}
        fontSize={metrics.foot.size}
      >
        SIMULATED · NOT DEEP-LINKED
      </text>
    </>
  );
}
