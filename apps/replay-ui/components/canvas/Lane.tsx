"use client";

/**
 * Lane (UX_SPEC §1/§4, mockup register 2026-08-20) — one rack lane: flex row
 * of hardware plates wired left→right into the vault terminus, with the
 * guided-arc ghost slots. The state machine is structural: stage 0 renders
 * exactly one glowing slot and a dim vault; once a market lands the spine
 * self-proposes leverage + compound (the hedge is opt-in from the dock);
 * the Install defaults key snaps everything in.
 *
 * 2026-08-20 founder pass: the lane-level RISK dial is gone (risk lives in
 * the module plates), quote-failure warnings never render (the canvas
 * presents clean modeled data), and chrome labels speak sentence case.
 */

import { useMemo, useRef } from "react";
import type { LoopGraph, ModuleKey, ParamValue } from "@/lib/canvas/types";
import { LANE_CHAIN, nodeFor } from "@/lib/canvas/graph-ops";
import HwPlate from "./HwPlate";
import GhostSlot from "./GhostSlot";
import VaultPlate from "./VaultPlate";
import LaneWires from "./LaneWires";
import type { RepriceData } from "./types";
import type { ScreenState } from "./PlateScreen";

const INDEX: Record<ModuleKey, string> = {
  "liquidity-source": "01",
  "safety-buffer": "02",
  hedge: "03",
  "auto-compound": "04",
};

const SLOT_LABEL: Record<ModuleKey, string> = {
  "liquidity-source": "Pick a market",
  "safety-buffer": "Dynamic leverage",
  hedge: "Dynamic hedge",
  "auto-compound": "Auto-compound",
};

/** Modules a lane surface can eject (the source and the leverage spine
 *  anchor stay put; everything optional goes). */
const EJECTABLE: ReadonlySet<ModuleKey> = new Set(["hedge", "auto-compound"]);

interface LaneProps {
  loop: LoopGraph;
  multi: boolean;
  focusedKey: ModuleKey | null; // focused module inside this lane
  laneFocused: boolean; // this lane holds the focus (zoom .86 in multi)
  /** The effective quote (live rail or catalog-modeled); never a failure. */
  reprice: RepriceData | null;
  repricing: boolean;
  /** The lane's modeled net APY, computed upstream (server or catalog). */
  netApy: number | null;
  laneReviewable: boolean;
  /** Borrow above yield at the margin: the header narrates it, one line. */
  leverageYieldNegative: boolean;
  allocationBps: number | null; // null when orchestrator off
  snapKeys: ReadonlySet<string>; // `${loopId}/${key}` recently placed
  pulseKey: number;
  canRemove: boolean;
  onFocusModule: (key: ModuleKey) => void;
  /** Lane header background click → dock Lane mode (IT4 §2.2). */
  onFocusLane: () => void;
  onOpenCatalog: () => void;
  onInstallDefaults: () => void;
  onAddModule: (key: ModuleKey) => void;
  onParam: (key: ModuleKey, field: string, value: ParamValue) => void;
  onEject: (key: ModuleKey) => void;
  onRename: (label: string) => void;
  onRemoveLoop: () => void;
  /** ADVANCED control touched on a plate (kept for dial-state inference). */
  onAdvancedTouch: () => void;
}

export default function Lane(props: LaneProps) {
  const { loop, reprice, repricing, netApy } = props;
  const rowRef = useRef<HTMLDivElement | null>(null);

  const src = nodeFor(loop, "liquidity-source");
  const hasMarket = String(src?.data.params.candidateId ?? "") !== "";
  const ok = reprice?.ok === true ? reprice : null;

  const screenState: ScreenState = repricing ? "quoting" : ok ? "ok" : "idle";

  // The ordered rack: placed plates + ghost proposals at the spine's chain
  // positions. The hedge NEVER self-proposes (founder ruling 2026-08-20): a
  // placed hedge renders, an absent one is added from the dock's lane panel.
  const items = useMemo(() => {
    const out: { kind: "plate" | "ghost"; key: ModuleKey }[] = [];
    if (!src) {
      out.push({ kind: "ghost", key: "liquidity-source" });
      return out;
    }
    out.push({ kind: "plate", key: "liquidity-source" });
    for (const key of LANE_CHAIN.slice(1)) {
      const placed = nodeFor(loop, key);
      if (placed) {
        out.push({ kind: "plate", key });
      } else if (hasMarket && key !== "hedge") {
        out.push({ kind: "ghost", key });
      }
    }
    return out;
  }, [loop, src, hasMarket]);

  const screensLive = !!nodeFor(loop, "safety-buffer");

  // Wire heat: plate→plate hot once the downstream plate is placed AND the
  // current quote is ok; the final segment into the vault goes hot only
  // when the lane is reviewable (the lane visibly "completes").
  const hotFlags = useMemo(() => {
    const flags: boolean[] = [];
    for (let i = 0; i < items.length - 1; i++) {
      flags.push(items[i]!.kind === "plate" && items[i + 1]!.kind === "plate" && !!ok);
    }
    flags.push(props.laneReviewable); // last item → vault
    return flags;
  }, [items, ok, props.laneReviewable]);

  const measureKey = `${items.map((i) => `${i.kind}:${i.key}`).join(",")}|${props.multi}|${props.laneFocused}|${props.focusedKey ?? ""}`;

  return (
    <section className={`rk-lane${props.laneFocused ? " rk-lane--focused" : ""}${props.focusedKey ? " rk-lane--hasfocus" : ""}`}>
      <header
        className="rk-lanehead"
        tabIndex={0}
        aria-label={`${loop.label} lane, select to edit`}
        onClick={(e) => {
          e.stopPropagation();
          props.onFocusLane();
        }}
        // Keyboard reach for the lane header. The guard keeps typing in the
        // lane-name input (and the Remove button) out of it, so no
        // role="button" wrapper over nested interactive content.
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            props.onFocusLane();
          }
        }}
      >
        <input
          className="rk-lanename"
          defaultValue={loop.label}
          key={loop.label}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== loop.label) props.onRename(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="rk-laneapy">
          {repricing ? (
            <i className="rk-lanenote">quoting…</i>
          ) : netApy !== null ? (
            <>
              net APY <b>{(netApy * 100).toFixed(1)}%</b> <i className="rk-lanenote">modeled</i>
            </>
          ) : null}
        </span>
        {props.leverageYieldNegative ? (
          <span className="rk-riskline">leverage is yield-negative in this market today</span>
        ) : null}
        {props.allocationBps !== null ? (
          <span className="rk-laneshare">{(props.allocationBps / 100).toFixed(0)}% allocation</span>
        ) : null}
        {props.canRemove ? (
          <button className="rk-lanekill" onClick={props.onRemoveLoop}>
            Remove
          </button>
        ) : null}
      </header>

      <div className="rk-row" ref={rowRef}>
        <LaneWires containerRef={rowRef} hotFlags={hotFlags} measureKey={measureKey} pulseKey={props.pulseKey} />
        {items.map((item) => {
          if (item.kind === "ghost") {
            if (item.key === "liquidity-source") {
              return (
                <GhostSlot
                  key="ghost-src"
                  label={SLOT_LABEL[item.key]}
                  want
                  onClick={props.onOpenCatalog}
                />
              );
            }
            if (item.key === "safety-buffer") {
              return (
                <GhostSlot
                  key="ghost-sb"
                  label={SLOT_LABEL[item.key]}
                  onClick={props.onInstallDefaults}
                  installKey="Install defaults"
                  onInstall={props.onInstallDefaults}
                />
              );
            }
            return (
              <GhostSlot
                key={`ghost-${item.key}`}
                label={SLOT_LABEL[item.key]}
                onClick={() => props.onAddModule(item.key)}
              />
            );
          }
          const node = nodeFor(loop, item.key)!;
          return (
            <HwPlate
              key={node.id}
              nodeId={node.id}
              moduleKey={item.key}
              index={INDEX[item.key]}
              params={node.data.params}
              reprice={reprice}
              screenState={item.key === "liquidity-source" || screensLive ? screenState : "idle"}
              focused={props.focusedKey === item.key}
              snap={props.snapKeys.has(node.id)}
              onFocus={() => props.onFocusModule(item.key)}
              onParam={(field, value) => props.onParam(item.key, field, value)}
              onEject={EJECTABLE.has(item.key) ? () => props.onEject(item.key) : undefined}
              onOpenCatalog={item.key === "liquidity-source" ? props.onOpenCatalog : undefined}
              onAdvancedTouch={item.key === "safety-buffer" || item.key === "hedge" ? props.onAdvancedTouch : undefined}
            />
          );
        })}
        <VaultPlate
          laneLabel={loop.label}
          netApy={props.laneReviewable || ok ? netApy : null}
          blockNumber={ok?.blockNumber ?? null}
          live={props.laneReviewable}
          dim={!src}
          quoting={repricing}
        />
      </div>
    </section>
  );
}
