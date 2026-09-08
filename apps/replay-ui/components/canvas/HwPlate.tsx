"use client";

/**
 * HwPlate — the EXACT landing hardware-module DOM (DESIGN_HWMOD_SPEC §2):
 * chrome plate (.hm-body + backplate ::before + ground ::after), nameplate,
 * three jacks, the 142px OLED, and the action-key row. Only content slots
 * (names, screens, keys) are product-specific. No data-kind: state renders
 * from React, exactly like the landing's own hm-static precedent.
 *
 * Click = expand in place (UX §2.2): width 244→340, hm-acts swaps display
 * keys for the module's 1–2 real controls. `?` in the tag discloses
 * def.description; no prose renders on-surface otherwise.
 */

import type { ModuleKey, ParamValue } from "@/lib/canvas/types";
import { EXIT_ROUTE_OPTIONS, getDef, type ParamContext } from "@/lib/canvas/modules";
import { OVERLAY_KEYS } from "@/lib/canvas/graph-ops";
import { POSTURE_STOPS, watchViewOf, type PostureStop } from "@/lib/canvas/exogenous";
import PlateScreen, { type ScreenState } from "./PlateScreen";
import type { LaneComposition } from "@/lib/canvas/mock-quote";
import PlateControls from "./PlateControls";
import type { RepriceData } from "./types";

export interface HwPlateProps {
  nodeId: string;
  moduleKey: ModuleKey;
  index: string; // hm-tag .n, e.g. "01"
  params: Record<string, ParamValue>;
  reprice: RepriceData | null;
  screenState: ScreenState;
  /** FRAME M — the lane's UNREPRICED scan row, threaded to the screen. */
  scan?: { apr: number | null; lev: number | null } | null;
  /** Whether the LANE runs the short leg, threaded to the screen. */
  hasHedge?: boolean;
  /** The lane's composition (`pricingParamsFor(loop)`), threaded to the screen
   *  so every hedge quantity on the plate reads the lane's own dials. */
  comp?: LaneComposition | null;
  /** The lane's market, for the CONTROLS' bounds (D3, 2026-08-24):
   *  `paramContextFor(...)`, the same object the reducer clamps this plate's
   *  own dispatches with. Without it a dial publishes the STRUCTURAL envelope
   *  and offers range its clamp refuses. */
  paramCtx?: ParamContext;
  focused: boolean;
  snap?: boolean; // materialize animation on placement
  /** Deferred unmount while the eject beat plays (§5.2). */
  ejecting?: boolean;
  onFocus: () => void;
  onParam: (field: string, value: ParamValue) => void;
  onEject?: () => void; // optional modules only
  onOpenCatalog?: () => void; // liquidity-source only
  /** I9 — the ONE open help card on the whole canvas, owned by RackCanvas
   *  so the Esc ladder and a background click can both close it. */
  helpOpen?: boolean;
  onToggleHelp?: () => void;
}

/** Default (unfocused) action keys per module — one lit at most, reflecting
 *  real state; `hold`-style dim treatment is reserved via data-key. */
function DisplayKeys({
  moduleKey,
  params,
  onOpenCatalog,
  answeredAt,
}: Pick<HwPlateProps, "moduleKey" | "params" | "onOpenCatalog"> & {
  /** How many parties each stop answers on THIS lane. One owner, threaded
   *  rather than re-derived, so the resting face and the focused control
   *  cannot print two counts for one lane. */
  answeredAt: (stop: PostureStop) => string;
}) {
  if (moduleKey === "liquidity-source") {
    const picked = String(params.candidateId ?? "") !== "";
    return (
      <div className="hm-keys">
        <div
          role="button"
          tabIndex={0}
          className={`hm-key${picked ? "" : " lit"}`}
          data-key="pick"
          onClick={(e) => {
            e.stopPropagation();
            onOpenCatalog?.();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            // I10: without preventDefault, Space both activates the chip AND
            // scrolls the list it lives in out from under the finger.
            e.preventDefault();
            e.stopPropagation();
            onOpenCatalog?.();
          }}
        >
          <span className="hm-led" />
          {picked ? "Swap market" : "Pick market"}
        </div>
        <div className="hm-key" data-key="hold">
          <span className="hm-led" />
          Scan
        </div>
      </div>
    );
  }
  if (moduleKey === "safety-buffer") {
    // UX_ITERATION_3 §3: no preset keys on the surface — the buffer is
    // automatic; risk parameters live behind the plate's Advanced dials.
    return (
      <div className="hm-keys">
        <div className="hm-key lit" data-key="auto">
          <span className="hm-led" />
          Auto-lever
        </div>
        <div className="hm-key lit" data-key="hold">
          <span className="hm-led" />
          Auto-delever
        </div>
      </div>
    );
  }
  if (moduleKey === "hedge") {
    return (
      <div className="hm-keys">
        <div className="hm-key lit" data-key="auto">
          <span className="hm-led" />
          Auto
        </div>
        <div className="hm-key" data-key="hold">
          <span className="hm-led" />
          Hold
        </div>
      </div>
    );
  }
  if (moduleKey === "auto-center") {
    return (
      <div className="hm-keys">
        <div className="hm-key lit" data-key="recenter">
          <span className="hm-led" />
          Recenter
        </div>
        <div className="hm-key" data-key="hold">
          <span className="hm-led" />
          Hold
        </div>
      </div>
    );
  }
  if (moduleKey === "covered-call" || moduleKey === "protective-put") {
    return (
      <div className="hm-keys">
        <div className="hm-key lit" data-key="roll">
          <span className="hm-led" />
          Roll
        </div>
        <div className="hm-key" data-key="hold">
          <span className="hm-led" />
          Hold
        </div>
      </div>
    );
  }
  if (moduleKey === "exogenous-risk") {
    /* THE SAME THREE CELLS THE FOCUSED CONTROL RENDERS, unfocused — the
       `auto-compound` precedent, where the resting keys ARE the cadence
       values with one lit. The stop is state, so it belongs on the resting
       face; pressing the plate is what makes it a control.

       The landing's `De-risk` key does NOT come across. An action verb
       claiming a running actuator has no place on a surface whose own arming
       state reads `Automations compile in shadow · not armed`. */
    const stop = String(params.posture ?? "measured");
    return (
      <div className="hm-keys">
        {POSTURE_STOPS.map((v) => (
          <div key={v} className={`hm-key${stop === v ? " lit" : ""}`} data-key={v}>
            <span className="hm-led" />
            {answeredAt(v)}
          </div>
        ))}
      </div>
    );
  }
  if (moduleKey === "redemption-route") {
    /* THE ROUTE, RESTING. Without this branch the plate fell through to the
       cadence keys below and rested showing AUTO-COMPOUND's `6h | 24h | 72h`
       with 24h lit, on a module that carries no `cadence` at all. A plate
       wearing another module's control is worse than a blank one, because it
       is legible and wrong.

       The `exogenous-risk` precedent: the resting keys ARE the control's
       stops with one lit, because the route is state and pressing the plate
       is what makes it a control. The envelope renders rather than the
       issuer's own subset, for the same reason the posture strip renders
       three: the resting face holds no descriptor. */
    const route = String(params.exitPath ?? "issuer-wire");
    return (
      <div className="hm-keys">
        {EXIT_ROUTE_OPTIONS.map((o) => (
          <div key={o.value} className={`hm-key${route === o.value ? " lit" : ""}`} data-key={o.value}>
            <span className="hm-led" />
            {o.shortLabel ?? o.label}
          </div>
        ))}
      </div>
    );
  }
  const cadence = String(params.cadence ?? "24h");
  return (
    <div className="hm-keys">
      {(["6h", "24h", "72h"] as const).map((v) => (
        <div key={v} className={`hm-key${cadence === v ? " lit" : ""}`} data-key={v}>
          <span className="hm-led" />
          {v}
        </div>
      ))}
    </div>
  );
}

export default function HwPlate(props: HwPlateProps) {
  const { moduleKey, index, params, reprice, screenState, scan, hasHedge, comp, paramCtx, focused, snap, ejecting, onFocus, onParam, onEject, onOpenCatalog } = props;
  const def = getDef(moduleKey);
  const helpOpen = !!props.helpOpen;
  const helpId = `${props.nodeId}:help`;
  const overlay = OVERLAY_KEYS.has(moduleKey);
  /* ONE OWNER for the counts the resting keys print. `reprice.candidate` is
     the lane's own priced row and `hasHedge` is the lane's own composition, so
     this is the same view the focused control and the plate screen build. */
  const view = watchViewOf({
    candidate: reprice?.ok === true ? reprice.candidate : null,
    placed: hasHedge ? ["hedge", moduleKey] : [moduleKey],
    params: { [moduleKey]: params },
  });

  const stateClass = [
    "rk-plate",
    focused ? "rk-plate--focused on" : "",
    screenState === "quoting" ? "rk-plate--quoting" : "",
    snap ? "rk-plate--snap" : "",
    ejecting ? "rk-plate--ejecting" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    /* I2 — THE PLATE IS THE ONLY DOOR TO THE MODULE PANEL, and it was a bare
       div with an onClick. The dock's Module panel mounts from a plate click
       and from nothing else, so a keyboard user could pick a market and
       publish but could not change leverage, risk or cadence, or add or eject
       the hedge. `aria-expanded` is the honest word for what the click does:
       it opens this module's controls, here and in the dock.

       The Enter/Space handler fires only when the plate ITSELF is focused
       (`e.target === e.currentTarget`), so the `?` button and every key
       inside the plate keep their own activation. */
    <div
      className={stateClass}
      /* ══ AN OVERLAY IS NOT A WIRE NODE ═══════════════════════════════════
         `LaneWires` collects `[data-wire-node]` and pairs CONSECUTIVE nodes,
         so a plate without the attribute is skipped entirely and the capital
         wire runs from the last chain plate's `:out` straight to `vault:in`,
         passing BEHIND this one (`.rk-wires` is an SVG behind the plates).
         Every other plate on the rack has a wire in and a wire out. This one
         has neither, and the capital visibly goes past it — which is the
         truest available drawing of the sentence that decided the whole
         architecture: nothing passes through it.

         The precedent is already in the repo: `OrchestratorPlate` carries
         `hm-jack bus` alone, with no `data-wire-node`, no `tin` and no
         `tout`. Zero new geometry, zero new vocabulary. */
      {...(overlay ? {} : { "data-wire-node": true })}
      data-placed
      data-node-id={props.nodeId}
      role="button"
      tabIndex={0}
      aria-expanded={focused}
      aria-label={`${def.name} module ${index}`}
      onClick={(e) => {
        e.stopPropagation();
        onFocus();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault(); // Space scrolls the board out from under the plate
        e.stopPropagation();
        onFocus();
      }}
    >
      <div className="hm-hw">
        <div className="hm-body">
          <div className="hm-tag">
            <span className="nm">
              {def.name}
              <button
                type="button"
                className="hm-help"
                aria-label={`About ${def.name}`}
                aria-expanded={helpOpen}
                aria-controls={helpOpen ? helpId : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onToggleHelp?.();
                }}
                onKeyDown={(e) => {
                  // The button activates on Space by default; stopping the
                  // key here keeps it off the plate root behind it.
                  if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                }}
              >
                ?
              </button>
            </span>
            <span className="n">{index}</span>
          </div>
          {helpOpen ? (
            <div className="hm-helppop" id={helpId} role="note" onClick={(e) => e.stopPropagation()}>
              {def.description}
            </div>
          ) : null}
          {overlay ? null : (
            <>
              <span className="hm-jack tin" data-jack={`${props.nodeId}:in`} />
              <span className="hm-jack tout" data-jack={`${props.nodeId}:out`} />
            </>
          )}
          <span className="hm-jack bus" data-jack={`${props.nodeId}:bus`} />
          <div
            onClick={
              moduleKey === "liquidity-source"
                ? (e) => {
                    e.stopPropagation();
                    onOpenCatalog?.();
                  }
                : undefined
            }
          >
            <PlateScreen
              moduleKey={moduleKey}
              params={params}
              reprice={reprice}
              state={screenState}
              scan={scan}
              hasHedge={hasHedge}
              comp={comp}
            />
          </div>
          <div className="hm-acts">
            <div className="hm-al">{focused && moduleKey !== "liquidity-source" ? "Tune" : "Actions"}</div>
            {focused && moduleKey !== "liquidity-source" ? (
              <PlateControls moduleKey={moduleKey} params={params} ctx={paramCtx} reprice={reprice} hasHedge={hasHedge} onParam={onParam} onEject={onEject} />
            ) : (
              <DisplayKeys
                moduleKey={moduleKey}
                params={params}
                onOpenCatalog={onOpenCatalog}
                answeredAt={(stop) => String(view.stopCounts[stop] ?? 0)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
