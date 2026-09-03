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

import { useState } from "react";
import type { ModuleKey, ParamValue } from "@/lib/canvas/types";
import { getDef } from "@/lib/canvas/modules";
import PlateScreen, { type ScreenState } from "./PlateScreen";
import PlateControls from "./PlateControls";
import type { RepriceData } from "./types";

interface HwPlateProps {
  nodeId: string;
  moduleKey: ModuleKey;
  index: string; // hm-tag .n, e.g. "01"
  params: Record<string, ParamValue>;
  reprice: RepriceData | null;
  screenState: ScreenState;
  focused: boolean;
  snap?: boolean; // materialize animation on placement
  onFocus: () => void;
  onParam: (field: string, value: ParamValue) => void;
  onEject?: () => void; // optional modules only
  onOpenCatalog?: () => void; // liquidity-source only
  /** ADVANCED control touched — dial-state inference upstream. */
  onAdvancedTouch?: () => void;
}

/** Default (unfocused) action keys per module — one lit at most, reflecting
 *  real state; `hold`-style dim treatment is reserved via data-key. */
function DisplayKeys({ moduleKey, params, onOpenCatalog }: Pick<HwPlateProps, "moduleKey" | "params" | "onOpenCatalog">) {
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
            if (e.key === "Enter" || e.key === " ") onOpenCatalog?.();
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
  const { moduleKey, index, params, reprice, screenState, focused, snap, onFocus, onParam, onEject, onOpenCatalog, onAdvancedTouch } = props;
  const def = getDef(moduleKey);
  const [helpOpen, setHelpOpen] = useState(false);

  const stateClass = [
    "rk-plate",
    focused ? "rk-plate--focused on" : "",
    screenState === "quoting" ? "rk-plate--quoting" : "",
    snap ? "rk-plate--snap" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={stateClass}
      data-wire-node
      data-placed
      data-node-id={props.nodeId}
      tabIndex={0}
      aria-label={`${def.name} plate, select to edit`}
      onClick={(e) => {
        e.stopPropagation();
        onFocus();
      }}
      // Keyboard reach for the plate itself (the dock dials are only
      // reachable through focus). No role="button": the plate holds real
      // buttons, so nested interactive content would be the violation.
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // keys inside inner controls
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onFocus();
        }
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
                onClick={(e) => {
                  e.stopPropagation();
                  setHelpOpen((v) => !v);
                }}
              >
                ?
              </button>
            </span>
            <span className="n">{index}</span>
          </div>
          {helpOpen ? (
            <div className="hm-helppop" onClick={(e) => e.stopPropagation()}>
              {def.description}
            </div>
          ) : null}
          <span className="hm-jack tin" data-jack={`${props.nodeId}:in`} />
          <span className="hm-jack tout" data-jack={`${props.nodeId}:out`} />
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
            />
          </div>
          <div className="hm-acts">
            <div className="hm-al">{focused && moduleKey !== "liquidity-source" ? "Tune" : "Actions"}</div>
            {focused && moduleKey !== "liquidity-source" ? (
              <PlateControls moduleKey={moduleKey} params={params} onParam={onParam} onEject={onEject} onAdvancedTouch={onAdvancedTouch} />
            ) : (
              <DisplayKeys moduleKey={moduleKey} params={params} onOpenCatalog={onOpenCatalog} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
