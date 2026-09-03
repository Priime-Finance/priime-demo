"use client";

/**
 * PlateControls (UX_ITERATION_3 §3) — the focused plate's hm-acts swap.
 * Safety-buffer and hedge carry NO front-surface dials any more: the lane
 * risk dial derives their params. Their v2 controls live intact behind an
 * ADVANCED disclosure, pre-filled with the derived values; touching any
 * advanced control notifies the lane (dial flips to "Custom"). Full v2
 * power is preserved — same descriptors, same clamps in graph-ops.
 * Auto-compound keeps its human controls on the surface unchanged.
 */

import { useState } from "react";
import type { ModuleKey, ParamDescriptor, ParamValue } from "@/lib/canvas/types";
import { getDef } from "@/lib/canvas/modules";

interface Props {
  moduleKey: ModuleKey;
  params: Record<string, ParamValue>;
  onParam: (field: string, value: ParamValue) => void;
  onEject?: () => void;
  /** Fired when an ADVANCED control is touched (lane dial goes Custom). */
  onAdvancedTouch?: () => void;
}

function Dial({ desc, value, onChange }: { desc: ParamDescriptor; value: ParamValue; onChange: (v: number) => void }) {
  const v = typeof value === "number" ? value : Number(desc.default);
  return (
    <div className="pc-dial">
      <div className="pc-dialrow">
        <span className="pc-lab">{desc.friendlyLabel}</span>
        <span className="pc-val">
          {v}
          {desc.unit === "x" ? "x" : desc.unit ? ` ${desc.unit}` : ""}
        </span>
      </div>
      <input
        type="range"
        min={desc.min}
        max={desc.max}
        step={desc.step}
        value={v}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {typeof desc.recommendedMin === "number" ? (
        <span className="pc-band">
          recommended {desc.recommendedMin}–{desc.recommendedMax}
          {desc.unit === "x" ? "x" : ""}
        </span>
      ) : null}
    </div>
  );
}

function SegKeys({ desc, value, onChange }: { desc: ParamDescriptor; value: ParamValue; onChange: (v: string) => void }) {
  return (
    <div className="hm-keys">
      {desc.options?.map((o) => (
        <div
          key={o.value}
          role="button"
          tabIndex={0}
          className={`hm-key${value === o.value ? " lit" : ""}`}
          data-key={o.value}
          onClick={(e) => {
            e.stopPropagation();
            onChange(o.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onChange(o.value);
          }}
        >
          <span className="hm-led" />
          {o.shortLabel ?? o.label}
        </div>
      ))}
    </div>
  );
}

function EjectKey({ onEject }: { onEject: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="hm-key pc-eject"
      data-key="eject"
      onClick={(e) => {
        e.stopPropagation();
        onEject();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onEject();
      }}
    >
      <span className="hm-led" />
      Eject
    </div>
  );
}

function AdvancedKey({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`hm-key${open ? " lit" : ""}`}
      data-key="advanced"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onToggle();
      }}
    >
      <span className="hm-led" />
      Advanced
    </div>
  );
}

export default function PlateControls({ moduleKey, params, onParam, onEject, onAdvancedTouch }: Props) {
  const def = getDef(moduleKey);
  const desc = (field: string) => def.params.find((p) => p.field === field)!;
  const [advOpen, setAdvOpen] = useState(false);
  const touch = (field: string, value: ParamValue) => {
    onAdvancedTouch?.();
    onParam(field, value);
  };

  if (moduleKey === "safety-buffer") {
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        {advOpen ? (
          <>
            <Dial desc={desc("targetLeverage")} value={params.targetLeverage!} onChange={(v) => touch("targetLeverage", v)} />
            <SegKeys desc={desc("riskPreset")} value={params.riskPreset!} onChange={(v) => touch("riskPreset", v)} />
          </>
        ) : (
          <div className="pc-auto">auto-levers · auto-delevers · set by the lane risk dial</div>
        )}
        <div className="hm-keys">
          <AdvancedKey open={advOpen} onToggle={() => setAdvOpen((v) => !v)} />
        </div>
      </div>
    );
  }

  if (moduleKey === "hedge") {
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        {advOpen ? (
          <>
            <Dial desc={desc("hedgeLeverage")} value={params.hedgeLeverage!} onChange={(v) => touch("hedgeLeverage", v)} />
            <Dial desc={desc("reserveFraction")} value={params.reserveFraction!} onChange={(v) => touch("reserveFraction", v)} />
          </>
        ) : (
          <div className="pc-auto">delta-neutral · margin auto-managed</div>
        )}
        <div className="hm-keys">
          <AdvancedKey open={advOpen} onToggle={() => setAdvOpen((v) => !v)} />
          {onEject ? <EjectKey onEject={onEject} /> : null}
        </div>
      </div>
    );
  }

  if (moduleKey === "auto-compound") {
    const min = desc("minActionUsd");
    const v = typeof params.minActionUsd === "number" ? params.minActionUsd : Number(min.default);
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        <SegKeys desc={desc("cadence")} value={params.cadence!} onChange={(x) => onParam("cadence", x)} />
        <div className="pc-num">
          <span className="pc-lab">{min.friendlyLabel}</span>
          <input
            type="number"
            min={min.min}
            max={min.max}
            step={min.step}
            value={v}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onParam("minActionUsd", Number(e.target.value))}
          />
          {onEject ? <EjectKey onEject={onEject} /> : null}
        </div>
      </div>
    );
  }

  return null;
}
