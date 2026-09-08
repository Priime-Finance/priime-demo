"use client";

/**
 * The verification board: the vault and its operators as one living board,
 * seated full width in the vault page's Verification section
 * (docs/plans/LATEST_UI_PORT_SPEC.md E.8). Drawn in the Priime Build hardware
 * language and laid out as the original system console was: the vault at the
 * center, operator 1 above it, operators 2 and 3 below, the attestation sink
 * on Base at the top right. Dashed wires are the position being read out;
 * solid blue wires are signed results converging on the quorum; a rejected
 * submission drops out as a dashed red line.
 *
 * Two levels share the board. The meta layer is the verification topology;
 * clicking the vault plate (or its lit key) zooms one level down into the
 * loop's internal canvas, the composition this vault was published from,
 * read only, with a handoff key to the canvas for actual editing.
 *
 * Playback: `capture` picks the recording, `run` starts a run at
 * `startAtMs`, `tMs` is the playback clock and `null` means the finished
 * strike (the server render, the reduced-motion render, and the resting
 * state). The first run starts on first intersection (threshold .3, once):
 * the strike IS the entrance. A press starts its run where the press lands
 * (`pressStartMs`, verification-model.ts), so the corrupt press lands the
 * rejection at +160 ms and the restore press the green at +160 ms, each
 * derived from the timeline at call time. Nothing here mutates a journal;
 * the corrupted run is a second capture, not an edit of the first.
 */

import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { useBuildHref } from "@/lib/host";
import { buildTimeline, deriveReplayState } from "@/lib/replay";
import {
  buildPipelineView,
  captureJournal,
  type Capture,
  type NodeView,
  type PipelineView,
} from "@/lib/vaults/pipeline";
import type { VaultRecord } from "@/lib/vaults/store";

import { useInView } from "./useInView";
import { innerLaneModel, pressStartMs, saboteurOperatorId, type InnerLanePlate } from "./verification-model";

const AWAITING = "awaiting";

/** Fixed board coordinate space; the stage scales to the container. */
const BOARD_W = 1400;
const BOARD_H = 760;

/**
 * Plate geometry. Every plate is 244 wide (.vc-hw); the heights differ because
 * each plate carries a different screen, and they are what the plates actually
 * render at, measured in the browser 2026-08-27: operator 225.7, vault 292.2,
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

/** One playback run: its id and where on the timeline it starts. */
interface Run {
  id: number;
  startAtMs: number;
}

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
  const buildHref = useBuildHref();

  const [run, setRun] = useState<Run>({ id: 0, startAtMs: 0 });
  const [tMs, setTMs] = useState<number | null>(null);
  const [level, setLevel] = useState<"meta" | "inner">("meta");
  /** The run whose rejected wire has finished drawing, so it rests dashed. */
  const [drawnRun, setDrawnRun] = useState(0);

  // Autoplay on first intersection (threshold .3, rootMargin -8%, once): the
  // strike is the entrance. Server and first client render agree (run 0, the
  // resting frame); the run starts when the board scrolls into view.
  const { ref: wrapRef, inView } = useInView<HTMLDivElement>();
  useEffect(() => {
    if (!inView) return;
    setRun((r) => (r.id === 0 ? { id: 1, startAtMs: 0 } : r));
  }, [inView]);

  useEffect(() => {
    if (run.id === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTMs(null);
      return;
    }
    // The clock seeds at the run's start: every event at or before it is
    // already on screen in the first frame, every later one fires at its own
    // offset from that start, so the timeline's spacing is kept.
    const start = run.startAtMs;
    setTMs(start);
    const timers = timeline.events
      .filter((event) => event.atMs > start)
      .map((event) =>
        setTimeout(() => {
          setTMs(event.atMs);
        }, event.atMs - start),
      );
    timers.push(
      setTimeout(
        () => {
          setTMs(null);
        },
        Math.max(0, timeline.durationMs - start),
      ),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [run, timeline]);

  // Which operator the sabotage capture records as the liar. Derived from the
  // capture itself rather than hardcoded: only that node's switch is live,
  // because only that journal exists to replay.
  const saboteurId = useMemo(() => saboteurOperatorId(), []);

  // Scale the fixed board to the container. Measured before paint and on
  // every container resize, so the board always fits; there is no manual FIT.
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
  }, [wrapRef]);

  const state = deriveReplayState(journal, tMs ?? timeline.durationMs, timeline);
  const view: PipelineView = buildPipelineView(journal, state);
  const playing = tMs !== null;
  const corrupted = capture === "corrupted";
  const rejectedOnScreen = view.nodes.some((n) => n.step === "rejected");

  /**
   * The corrupt / restore press. The capture flips and the run starts where
   * the press lands on the capture it opens (F.5): the first rejected
   * submission minus the press lead on the corrupt press, the honest
   * operator's accepted submission minus the press lead on restore.
   */
  const toggleCapture = () => {
    const next: Capture = corrupted ? "honest" : "corrupted";
    onCapture(next);
    setRun((r) => ({ id: r.id + 1, startAtMs: pressStartMs(next) }));
  };

  /** `Replay the strike`: the full run from 0. */
  const replay = () => {
    setRun((r) => ({ id: r.id + 1, startAtMs: 0 }));
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
            <div className="vc-layer vc-layer--meta" aria-hidden={level !== "meta"} inert={level !== "meta"}>
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
                  if (node?.reported !== true) {
                    return (
                      <path
                        key={`sub-${String(index)}-${String(run.id)}-idle`}
                        className="vc-wire vc-wire--ghost"
                        d={wire.d}
                      />
                    );
                  }
                  if (node.step === "rejected") {
                    // Draws in on the press (pathLength + the dash trick),
                    // then rests dashed once the draw has finished.
                    const draw = playing && drawnRun !== run.id;
                    return (
                      <path
                        key={`sub-${String(index)}-${String(run.id)}-rejected`}
                        className={`vc-wire vc-wire--rejected${draw ? " vc-draw" : ""}`}
                        d={wire.d}
                        pathLength={draw ? 1 : undefined}
                        onAnimationEnd={() => {
                          setDrawnRun(run.id);
                        }}
                      />
                    );
                  }
                  return (
                    <path
                      key={`sub-${String(index)}-${String(run.id)}-${node.step}`}
                      className={`vc-wire vc-wire--hot${playing ? " vc-draw" : ""}`}
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
                {corrupted && rejectedOnScreen && (
                  <text
                    key={`tag-bad-${String(run.id)}`}
                    className="vc-wiretag vc-wiretag--bad"
                    x={900}
                    y={441}
                  >
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
                  // Space would scroll the page and Enter would submit a form:
                  // a div playing a button has to swallow both itself.
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setLevel("inner");
                  }
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
                        <b className={navPerShare === null ? "vc-v--wait" : undefined}>
                          share {navPerShare === null ? AWAITING : navPerShare.toFixed(6)}
                        </b>
                      </div>
                    </div>
                    <div className="vc-foot">
                      NAV attested by Priime Operator · <em>quorum {view.quorum.thresholdLabel}</em>
                    </div>
                  </div>
                  <div className="vc-acts">
                    <div className="vc-al">Actions</div>
                    {/* A span, not a button: this plate is already the
                        role="button", and a nested control there is invalid. */}
                    <span className="vc-openkey">
                      <span className="vc-led" />
                      Open the loop
                    </span>
                  </div>
                  <span className="vc-jack vc-jack--t" />
                  <span className="vc-jack vc-jack--l" />
                  <span className="vc-jack vc-jack--r" />
                </div>
              </div>

              <BasePlate view={view} />

              <div className="vc-chrome">
                <button type="button" className="vc-key" onClick={replay}>
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
            <div className="vc-layer vc-layer--inner" aria-hidden={level !== "inner"} inert={level !== "inner"}>
              <div className="vc-crumb">
                <div className="vc-lane">
                  <em>Priime Operator</em> ▸ {vault.name}
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
                <a className="vc-key vc-key--ok" href={buildHref}>
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

/**
 * The composition this vault was published from, read off the live record
 * through the adapter (`innerLaneModel`): S1 the market, S2 the applied
 * leverage, S3 the compound cadence, S4 the modeled APY. A plate whose value
 * the record does not carry prints nothing in that slot; nothing here types
 * a fallback figure.
 */
function InnerLane({ vault, thresholdLabel }: { vault: VaultRecord; thresholdLabel: string }) {
  const model = useMemo(() => innerLaneModel(vault), [vault]);

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

  const jacksFor = (index: number): readonly string[] =>
    index === 0 ? ["tout"] : index === LANE_X.length - 1 ? ["tin"] : ["tin", "tout"];

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

      {model.plates.map((plate, index) => {
        const x = LANE_X[index];
        if (x === undefined) return null;
        const isVault = index === model.plates.length - 1;
        return (
          <LanePlate
            key={plate.n}
            x={x}
            plate={plate}
            bdg={isVault ? "modeled" : index === 0 ? "unhedged" : plate.armed ? "● Armed" : "not composed"}
            bdgOk={!isVault && index !== 0 && plate.armed}
            foot={
              isVault ? (
                <>
                  NAV attested by Priime Operator · <em>quorum {thresholdLabel}</em>
                </>
              ) : undefined
            }
            jacks={jacksFor(index)}
          />
        );
      })}
    </>
  );
}

function LanePlate({
  x,
  plate,
  bdg,
  bdgOk = false,
  foot,
  jacks,
}: {
  x: number;
  plate: InnerLanePlate;
  bdg: string;
  bdgOk?: boolean;
  foot?: React.ReactNode;
  jacks: readonly string[];
}) {
  return (
    <div className="vc-hw" style={{ left: x, top: LANE_TOP }}>
      <div className="vc-body">
        <div className="vc-tag">
          <span className="vc-nm">{plate.label}</span>
          <span className="vc-n">{plate.n}</span>
        </div>
        <div className="vc-scr" style={{ height: 118 }}>
          <div className="vc-st">
            <span>{plate.status}</span>
            <span className={`vc-bdg${bdgOk ? " vc-bdg--ok" : ""}`}>{bdg}</span>
          </div>
          <div className="vc-big">{plate.value ?? ""}</div>
          {plate.row !== null && (
            <div className="vc-srow">
              <span>{plate.row.label}</span>
              <b>{plate.row.value}</b>
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
