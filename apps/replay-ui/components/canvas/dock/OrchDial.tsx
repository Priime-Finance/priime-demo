"use client";

/**
 * OrchDial (IT4_DOCK_SPEC §5.2) — the orchestrator dial renderer, extracted
 * from OrchestratorPlate's private Dial so the plate and the dock's
 * portfolio panel render the SAME control: one renderer, two surfaces, one
 * store behind both.
 */

import type { ParamDescriptor, ParamValue } from "@/lib/canvas/types";

export default function OrchDial({
  desc,
  value,
  onChange,
}: {
  desc: ParamDescriptor;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
}) {
  if (desc.type === "segmented") {
    return (
      <div className="pc-dial">
        <span className="pc-lab">{desc.friendlyLabel}</span>
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
              {o.label}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const v = typeof value === "number" ? value : Number(desc.default);
  return (
    <div className="pc-dial">
      <div className="pc-dialrow">
        <span className="pc-lab">{desc.friendlyLabel}</span>
        <span className="pc-val">
          {v}
          {desc.unit ? ` ${desc.unit}` : ""}
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
    </div>
  );
}
