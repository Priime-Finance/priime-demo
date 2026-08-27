"use client";

/**
 * The verification canvas: the vault and its operators as one living board,
 * the hero of /vault. Drawn in the Priime Build hardware language and laid
 * out as the original system console was: the vault at the center, operator
 * 1 above it, operators 2 and 3 below, the attestation sink on Base at the
 * top right. Dashed sand wires are the position being read out; solid blue
 * wires are signed results converging on the quorum; a rejected submission
 * drops out as a dashed red line.
 *
 * Two levels share the board. The meta layer is the verification topology;
 * clicking the vault plate (or its lit key) zooms one level down into the
 * loop's internal canvas, the composition this vault was published from,
 * read only, with a handoff key to /build for actual editing.
 *
 * Playback is the same machine as the flat panel this replaces: `capture`
 * picks the recording, `runId` starts a run, `tMs` is the playback clock and
 * `null` means the finished strike (the server render, the reduced-motion
 * render, and the resting state). Nothing here mutates a journal; the
 * corrupted run is a second capture, not an edit of the first.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { buildTimeline, deriveReplayState } from "@/lib/replay";
import {
  buildPipelineView,
  captureJournal,
  type Capture,
  type NodeView,
  type PipelineView,
} from "@/lib/vaults/pipeline";
import { fmtPct, type VaultRecord } from "@/lib/vaults/store";

const AWAITING = "awaiting";

/** Fixed board coordinate space; the stage scales to the container. */
const BOARD_W = 1400;
const BOARD_H = 760;

/**
 * Plate geometry. Every plate is 244 wide (.vc-hw); the heights differ because
 * each plate carries a different screen, and they are what the plates actually
 * render at — measured in the browser 2026-08-27: operator 225.7, vault 292.2,
 * attestation sink 245.7. A jack is 13px across and protrudes 17px, so its
 * centre sits 10.5px outside the plate edge, on that edge's midline. Wire ends
 * are derived from these rather than written out, so the plugs stay welded to
 * their jacks when a plate's contents change height.
 */
const PLATE_W = 244;
const JACK_OFF = 10.5;
const H_OPERATOR = 225.7;
const H_VAULT = 292.2;
const H_SINK = 245.7;

type XY = [number, number];
const round2 = (v: number): number => Math.round(v * 100) / 100;
const jackT = (left: number, top: number): XY => [round2(left + PLATE_W / 2), round2(top - JACK_OFF)];
const jackB = (left: number, top: number, h: number): XY => [
  round2(left + PLATE_W / 2),
  round2(top + h + JACK_OFF),
];
const jackL = (left: number, top: number, h: number): XY => [round2(left - JACK_OFF), round2(top + h / 2)];
const jackR = (left: number, top: number, h: number): XY => [
  round2(left + PLATE_W + JACK_OFF),
  round2(top + h / 2),
];

/** Plate origins. The operators keep journal order: above, lower left, lower right. */
const OP1 = { left: 578, top: 12 };
const OP2 = { left: 140, top: 480 };
const OP3 = { left: 950, top: 480 };
const VAULT_POS = { left: 578, top: 340 };
const SINK_POS = { left: 1120, top: 90 };

const NODE_POS: readonly { left: number; top: number; jacks: readonly string[] }[] = [
  { ...OP1, jacks: ["b", "r"] },
  { ...OP2, jacks: ["t", "r"] },
  { ...OP3, jacks: ["t", "l"] },
];

const J_VAULT_T = jackT(VAULT_POS.left, VAULT_POS.top);
const J_VAULT_L = jackL(VAULT_POS.left, VAULT_POS.top, H_VAULT);
const J_VAULT_R = jackR(VAULT_POS.left, VAULT_POS.top, H_VAULT);
const J_OP1_B = jackB(OP1.left, OP1.top, H_OPERATOR);
const J_OP1_R = jackR(OP1.left, OP1.top, H_OPERATOR);
const J_OP2_T = jackT(OP2.left, OP2.top);
const J_OP2_R = jackR(OP2.left, OP2.top, H_OPERATOR);
const J_OP3_T = jackT(OP3.left, OP3.top);
const J_OP3_L = jackL(OP3.left, OP3.top, H_OPERATOR);
const J_SINK_L = jackL(SINK_POS.left, SINK_POS.top, H_SINK);
const J_SINK_B = jackB(SINK_POS.left, SINK_POS.top, H_SINK);

/** One cubic: two control points and the point it lands on. */
type Seg = readonly [XY, XY, XY];
interface Wire {
  d: string;
  from: [number, number];
  to: [number, number];
}
const pt = (p: XY): string => `${String(p[0])} ${String(p[1])}`;
/** A wire from a jack, through one or more cubics, onto the jack it plugs into. */
function wire(from: XY, first: Seg, ...rest: readonly Seg[]): Wire {
  const last = rest.at(-1) ?? first;
  const d = [first, ...rest].reduce(
    (acc, [c1, c2, end]) => `${acc} C ${pt(c1)}, ${pt(c2)}, ${pt(end)}`,
    `M ${pt(from)}`,
  );
  return { d, from: [from[0], from[1]], to: [last[2][0], last[2][1]] };
}

/** Position reads, vault jack to node jack, by journal order. */
const READ_WIRES: readonly Wire[] = [
  wire(J_VAULT_T, [[J_VAULT_T[0], 303], [J_OP1_B[0], 276], J_OP1_B]),
  wire(J_VAULT_L, [[481, J_VAULT_L[1]], [481, J_OP2_R[1]], J_OP2_R]),
  wire(J_VAULT_R, [[886, J_VAULT_R[1]], [886, J_OP3_L[1]], J_OP3_L]),
];

/** Signed results, node jack to the Base sink, by journal order. */
const SUB_WIRES: readonly Wire[] = [
  wire(J_OP1_R, [[950, J_OP1_R[1]], [1000, J_SINK_L[1]], J_SINK_L]),
  // Out of the top jack straight up, one quarter turn, then level along the
  // corridor between operator 1 and the vault before easing into the sink.
  wire(
    J_OP2_T,
    [[J_OP2_T[0], 335.5], [390, 289], [580, 289]],
    [[1010, 289], [1040, J_SINK_L[1]], J_SINK_L],
  ),
  wire(J_OP3_T, [[J_OP3_T[0], 384.5], [J_SINK_B[0], 431.2], J_SINK_B]),
];

/** Inner lane plate x positions; the lane is vertically centered on the board. */
const LANE_X = [160, 444, 728, 1012] as const;
const LANE_TOP = 270;
/** Lane jack centre line: LANE_TOP - 17 (jack offset) + 6.5 (jack radius) + 3.5. */
const LANE_JACK_Y = LANE_TOP - 7;

interface VerificationCanvasProps {
  capture: Capture;
  onCapture: (capture: Capture) => void;
  vault: VaultRecord;
  /** Attested NAV per share, for the vault plate readout. */
  navPerShare: number | null;
}

export function VerificationCanvas({ capture, onCapture, vault, navPerShare }: VerificationCanvasProps) {
  const journal = useMemo(() => captureJournal(capture), [capture]);
  const timeline = useMemo(() => buildTimeline(journal), [journal]);

  const [runId, setRunId] = useState(0);
  const [tMs, setTMs] = useState<number | null>(null);
  const [level, setLevel] = useState<"meta" | "inner">("meta");

  // Autoplay once, after hydration; server and first client render agree.
  useEffect(() => {
    setRunId(1);
  }, []);

  useEffect(() => {
    if (runId === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTMs(null);
      return;
    }
    setTMs(0);
    const timers = timeline.events.map((event) =>
      setTimeout(() => {
        setTMs(event.atMs);
      }, event.atMs),
    );
    timers.push(
      setTimeout(() => {
        setTMs(null);
      }, timeline.durationMs),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [runId, timeline]);

  // Which operator the sabotage capture records as the liar. Derived from the
  // capture itself rather than hardcoded: only that node's switch is live,
  // because only that journal exists to replay.
  const saboteurId = useMemo(() => {
    const sabotage = captureJournal("corrupted");
    const sabotageTimeline = buildTimeline(sabotage);
    const settled = deriveReplayState(sabotage, sabotageTimeline.durationMs, sabotageTimeline);
    return settled.operators.find((o) => o.matchesWinningHash === false)?.id ?? null;
  }, []);

  // Scale the fixed board to the container. Measured before paint and on
  // every container resize, so the board always fits; there is no manual FIT.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      setScale(el.clientWidth > 0 ? el.clientWidth / BOARD_W : 1);
    };
    measure();
    // ResizeObserver alone is not enough: its callbacks are frame-aligned and
    // never fire while the page is hidden, so a background tab that changes
    // size would keep a stale scale. The resize event has no such gate.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const state = deriveReplayState(journal, tMs ?? timeline.durationMs, timeline);
  const view: PipelineView = buildPipelineView(journal, state);
  const playing = tMs !== null;
  const corrupted = capture === "corrupted";

  const toggleCapture = () => {
    onCapture(corrupted ? "honest" : "corrupted");
    setRunId((id) => id + 1);
  };

  return (
    <>
      <div className="vc-wrap" ref={wrapRef} style={{ height: BOARD_H * scale }}>
        <div
          className="vc-stage"
          data-level={level}
          style={{ transform: `scale(${String(scale)})` }}
        >
          <div className="vc-board">
            {playing && level === "meta" && (
              <div className="vc-prog" aria-hidden="true">
                <span style={{ width: `${String(view.progressPct)}%` }} />
              </div>
            )}

            {/* ── meta layer: the verification topology ── */}
            <div className="vc-layer vc-layer--meta" aria-hidden={level !== "meta"}>
              <div className="vc-kicker">
                <div className="vc-lane">
                  <span>
                    {vault.name} · NAV strike {view.triggerBlock}
                  </span>
                  <span className="vc-phase">{view.phaseLabel}</span>
                </div>
              </div>

              <svg className="vc-wires" viewBox={`0 0 ${String(BOARD_W)} ${String(BOARD_H)}`}>
                {READ_WIRES.map((wire, index) => {
                  const node = view.nodes[index];
                  const pulse = playing && view.triggered && node?.reported === false;
                  return (
                    <path
                      key={`read-${String(index)}`}
                      className={`vc-wire vc-wire--read${pulse ? " vc-pulse" : ""}`}
                      d={wire.d}
                    />
                  );
                })}
                {SUB_WIRES.map((wire, index) => {
                  const node = view.nodes[index];
                  const cls =
                    node?.reported !== true
                      ? "vc-wire vc-wire--ghost"
                      : node.step === "rejected"
                        ? "vc-wire vc-wire--rejected"
                        : `vc-wire vc-wire--hot${playing ? " vc-draw" : ""}`;
                  return (
                    <path
                      key={`sub-${String(index)}-${String(runId)}-${node?.step ?? "idle"}`}
                      className={cls}
                      d={wire.d}
                      pathLength={1}
                    />
                  );
                })}
                {[...READ_WIRES, ...SUB_WIRES].flatMap((wire, index) => [
                  <circle
                    key={`plug-a-${String(index)}`}
                    className="vc-plug"
                    r={4}
                    cx={wire.from[0]}
                    cy={wire.from[1]}
                  />,
                  <circle
                    key={`plug-b-${String(index)}`}
                    className="vc-plug"
                    r={4}
                    cx={wire.to[0]}
                    cy={wire.to[1]}
                  />,
                ])}
                <text className="vc-wiretag" x={418} y={430}>
                  one position, read 3x
                </text>
                <text className="vc-wiretag" x={860} y={204}>
                  3 hashes, 1 number
                </text>
                {corrupted && (
                  <text className="vc-wiretag vc-wiretag--bad" x={900} y={441}>
                    hash mismatch, rejected
                  </text>
                )}
              </svg>

              {view.nodes.map((node, index) => (
                <OperatorPlate
                  key={node.id}
                  node={node}
                  index={index}
                  saboteur={saboteurId !== null && node.id.toLowerCase() === saboteurId.toLowerCase()}
                  corrupted={corrupted}
                  onToggle={toggleCapture}
                />
              ))}

              {/* the vault, center: click target for the inner level */}
              <div
                className="vc-hw vc-hw--click"
                style={{ left: VAULT_POS.left, top: VAULT_POS.top }}
                onClick={() => {
                  setLevel("inner");
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setLevel("inner");
                }}
                aria-label={`${vault.name}: open the loop`}
              >
                <div className="vc-body">
                  <div className="vc-tag">
                    <span className="vc-nm">{vault.name}</span>
                    <span className="vc-n">VAULT</span>
                  </div>
                  <div className="vc-scr" style={{ height: 158 }}>
                    <div className="vc-st">
                      <span>Base · inputs block {view.attestation.inputsBlock}</span>
                      <span className={`vc-bdg${view.attestation.landed ? " vc-bdg--ok" : ""}`}>
                        {view.attestation.landed ? "● Attested" : "strike in flight"}
                      </span>
                    </div>
                    <div>
                      <div className={`vc-big${view.attestation.landed ? "" : " vc-big--wait"}`}>
                        {view.attestation.navText ?? AWAITING}
                      </div>
                      <div className="vc-srow" style={{ marginTop: 4 }}>
                        <span>NAV, attested</span>
                        <b>share {navPerShare === null ? "1.000000" : navPerShare.toFixed(6)}</b>
                      </div>
                    </div>
                    <div className="vc-foot">
                      NAV attested by Priime Operator · <em>quorum {view.quorum.thresholdLabel}</em>
                    </div>
                  </div>
                  <div className="vc-acts">
                    <div className="vc-al">Actions</div>
                    <button type="button" className="vc-openkey" tabIndex={-1}>
                      <span className="vc-led" />
                      Open the loop
                    </button>
                  </div>
                  <span className="vc-jack vc-jack--t" />
                  <span className="vc-jack vc-jack--l" />
                  <span className="vc-jack vc-jack--r" />
                </div>
              </div>

              <BasePlate view={view} />

              <div className="vc-chrome">
                <button
                  type="button"
                  className="vc-key"
                  onClick={() => {
                    setRunId((id) => id + 1);
                  }}
                >
                  <span className="vc-led" />
                  Replay the strike
                </button>
                <button
                  type="button"
                  className={`vc-key${corrupted ? " vc-key--ok" : " vc-key--danger"}`}
                  onClick={toggleCapture}
                >
                  <span className="vc-led" />
                  {corrupted ? "Restore honest run" : "Corrupt an operator"}
                </button>
              </div>
            </div>

            {/* ── inner layer: the loop inside ── */}
            <div className="vc-layer vc-layer--inner" aria-hidden={level !== "inner"}>
              <div className="vc-crumb">
                <div className="vc-lane">
                  <em>PRIIME OPERATOR</em> ▸ {vault.name.toUpperCase()}
                </div>
                <div className="vc-cap">
                  The same canvas, one level down: the composition this vault was published from.
                </div>
              </div>
              <div className="vc-chrome vc-chrome--top">
                <button
                  type="button"
                  className="vc-key"
                  onClick={() => {
                    setLevel("meta");
                  }}
                >
                  <span className="vc-led" />
                  ◂ Back to operators
                </button>
                <a className="vc-key vc-key--ok" href="/build">
                  <span className="vc-led" />
                  Edit in Priime Build
                </a>
              </div>
              <InnerLane vault={vault} thresholdLabel={view.quorum.thresholdLabel} />
            </div>
          </div>
        </div>
      </div>

      <div className="vc-legend">
        <span>
          <i />
          position read
        </span>
        <span className="vc-lg--hot">
          <i />
          signed result
        </span>
        <span className="vc-lg--rej">
          <i />
          rejected
        </span>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────── one operator plate ── */

function OperatorPlate({
  node,
  index,
  saboteur,
  corrupted,
  onToggle,
}: {
  node: NodeView;
  index: number;
  saboteur: boolean;
  corrupted: boolean;
  onToggle: () => void;
}) {
  const pos = NODE_POS[index];
  if (pos === undefined) return null;
  const sick = node.step === "rejected";
  const computing = !node.reported;
  return (
    <div className={`vc-hw${sick ? " vc-hw--sick" : ""}`} style={{ left: pos.left, top: pos.top }}>
      <div className="vc-body">
        <div className="vc-tag">
          <span className="vc-nm">{node.label}</span>
          <span className="vc-n vc-n--danger">{`// 0${String(index + 1)}`}</span>
        </div>
        <div className="vc-addr">signer {node.shortId}</div>
        <div className="vc-scr" style={{ height: 118 }}>
          <div className="vc-st">
            <span>Result hash</span>
            <span
              className={`vc-bdg${node.step === "accepted" ? " vc-bdg--ok" : ""}${sick ? " vc-bdg--bad" : ""}`}
            >
              {node.step === "accepted" || sick ? "● " : ""}
              {node.stepLabel}
            </span>
          </div>
          <div
            className={`vc-hash${sick ? " vc-hash--bad" : ""}${computing ? " vc-hash--wait" : ""}`}
            title={node.hash ?? undefined}
          >
            {node.hashShort ?? AWAITING}
          </div>
          <div className="vc-srow">
            <span>Reported NAV</span>
            <b className={sick ? "vc-v--bad" : computing ? "vc-v--wait" : ""}>
              {node.navText ?? AWAITING}
            </b>
          </div>
        </div>
        <div className="vc-ctl">
          <button
            type="button"
            className={`vc-sw${saboteur && corrupted ? " vc-sw--on" : ""}`}
            disabled={!saboteur}
            onClick={saboteur ? onToggle : undefined}
            title={
              saboteur
                ? corrupted
                  ? "Restore the honest capture"
                  : "Play the captured sabotage run"
                : "The capture records operator 3 as the saboteur; only its journal exists to replay"
            }
          >
            <span className="vc-track">
              <span className="vc-knob" />
            </span>
            corrupt
          </button>
          <span className="vc-wt">weight 1</span>
        </div>
        {pos.jacks.map((j) => (
          <span key={j} className={`vc-jack vc-jack--${j}`} />
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────── the Base attestation sink ── */

function BasePlate({ view }: { view: PipelineView }) {
  const q = view.quorum;
  const a = view.attestation;
  return (
    <div className="vc-hw" style={{ left: SINK_POS.left, top: SINK_POS.top }}>
      <div className="vc-body">
        <div className="vc-tag">
          <span className="vc-nm">Priime Operator</span>
          <span className="vc-n">BASE · 8453</span>
        </div>
        <div className="vc-addr">attestation sink · threshold {q.thresholdLabel}</div>
        <div className="vc-scr" style={{ height: 168 }}>
          <div className="vc-st">
            <span>Quorum</span>
            <span className={`vc-bdg${q.reached ? " vc-bdg--ok" : ""}`}>
              {q.reached ? "● Reached" : "forming"}
            </span>
          </div>
          <div>
            <div className={`vc-big${q.reached ? " vc-big--ok" : " vc-big--wait"}`}>
              {q.weightLabel}
            </div>
            <div
              className={`vc-hash${q.winningHashShort === null ? " vc-hash--wait" : ""}`}
              style={{ marginTop: 4 }}
            >
              {q.winningHashShort === null ? AWAITING : `wins ${q.winningHashShort}`}
            </div>
          </div>
          <div className="vc-srow">
            <span>Attested NAV</span>
            <b className={a.landed ? "" : "vc-v--wait"}>{a.navText ?? AWAITING}</b>
          </div>
          <div className="vc-foot">
            {q.outside !== null && (
              <>
                <span className="vc-out">outside the quorum: {q.outside.navText}</span>
                {" · "}
              </>
            )}
            {a.landed ? `settled ${a.settledBy ?? ""} at ${a.attestedAt} UTC` : "awaiting settlement"}
            {" · no explorer link, replayed data"}
          </div>
        </div>
        <span className="vc-jack vc-jack--l" />
        <span className="vc-jack vc-jack--b" />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── the inner composition lane ── */

function InnerLane({ vault, thresholdLabel }: { vault: VaultRecord; thresholdLabel: string }) {
  const param = (label: string, fallback: string): string =>
    vault.params.find((p) => p.label === label)?.value ?? fallback;
  const moduleName = (index: number, fallback: string): string =>
    vault.moduleLines[index]?.name ?? fallback;

  const arcs = LANE_X.slice(0, -1).map((x, index) => {
    const next = LANE_X[index + 1];
    if (next === undefined) return null;
    const from = x + 191.5;
    const to = next + 52.5;
    const y = LANE_JACK_Y;
    const c = LANE_JACK_Y - 26;
    return {
      d: `M ${String(from)} ${String(y)} C ${String(from)} ${String(c)}, ${String(to)} ${String(c)}, ${String(to)} ${String(y)}`,
      from,
      to,
    };
  });

  return (
    <>
      <svg className="vc-wires" viewBox={`0 0 ${String(BOARD_W)} ${String(BOARD_H)}`}>
        {arcs.map(
          (arc, index) =>
            arc !== null && (
              <g key={`arc-${String(index)}`}>
                <path className="vc-wire vc-wire--hot" d={arc.d} />
                <circle className="vc-plug" r={4} cx={arc.from} cy={LANE_JACK_Y} />
                <circle className="vc-plug" r={4} cx={arc.to} cy={LANE_JACK_Y} />
              </g>
            ),
        )}
      </svg>

      <LanePlate
        x={LANE_X[0]}
        name={moduleName(0, "Liquidity source")}
        n="S1"
        st="Market · Morpho Blue"
        bdg="unhedged"
        big={vault.market}
        rowL="Venue"
        rowV={vault.venue}
        jacks={["tout"]}
      />
      <LanePlate
        x={LANE_X[1]}
        name={moduleName(1, "Dynamic leverage")}
        n="S2"
        st="Protection envelope"
        bdg="● Armed"
        bdgOk
        big={param("Target leverage", "5.0x")}
        rowL="HF floor"
        rowV={param("Health factor floor", "1.08x")}
        jacks={["tin", "tout"]}
      />
      <LanePlate
        x={LANE_X[2]}
        name={moduleName(2, "Auto-compound")}
        n="S3"
        st="Compounding"
        bdg="● Armed"
        bdgOk
        big={param("Compound cadence", "24h")}
        rowL="Min net spread"
        rowV={param("Min net spread", "0.25%")}
        jacks={["tin", "tout"]}
      />
      <LanePlate
        x={LANE_X[3]}
        name="Vault"
        n="S4"
        st="Net APY"
        bdg="modeled"
        big={fmtPct(vault.modeledApy)}
        foot={
          <>
            NAV attested by Priime Operator · <em>quorum {thresholdLabel}</em>
          </>
        }
        jacks={["tin"]}
      />
    </>
  );
}

function LanePlate({
  x,
  name,
  n,
  st,
  bdg,
  bdgOk = false,
  big,
  rowL,
  rowV,
  foot,
  jacks,
}: {
  x: number;
  name: string;
  n: string;
  st: string;
  bdg: string;
  bdgOk?: boolean;
  big: string;
  rowL?: string;
  rowV?: string;
  foot?: React.ReactNode;
  jacks: readonly string[];
}) {
  return (
    <div className="vc-hw" style={{ left: x, top: LANE_TOP }}>
      <div className="vc-body">
        <div className="vc-tag">
          <span className="vc-nm">{name}</span>
          <span className="vc-n">{n}</span>
        </div>
        <div className="vc-scr" style={{ height: 118 }}>
          <div className="vc-st">
            <span>{st}</span>
            <span className={`vc-bdg${bdgOk ? " vc-bdg--ok" : ""}`}>{bdg}</span>
          </div>
          <div className="vc-big">{big}</div>
          {rowL !== undefined && rowV !== undefined && (
            <div className="vc-srow">
              <span>{rowL}</span>
              <b>{rowV}</b>
            </div>
          )}
          {foot !== undefined && <div className="vc-foot">{foot}</div>}
        </div>
        {jacks.map((j) => (
          <span key={j} className={`vc-jack vc-jack--${j}`} />
        ))}
      </div>
    </div>
  );
}
