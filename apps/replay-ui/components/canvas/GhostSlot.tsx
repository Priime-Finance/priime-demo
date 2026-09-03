"use client";

/**
 * Ghost slot (UX_SPEC §1) — the landing .pg-slot treatment: 1.5px dashed
 * #C9B49A, radius 16, 8.5px mono tracking .18em. `want` pulses orange: the
 * canvas itself proposes the next action, no instructional copy anywhere.
 */

export default function GhostSlot({
  label,
  want,
  onClick,
  installKey,
  onInstall,
}: {
  label: string;
  want?: boolean;
  onClick: () => void;
  /** Label of the one lit key inside the slot (the INSTALL DEFAULTS path). */
  installKey?: string;
  onInstall?: () => void;
}) {
  return (
    <button
      type="button"
      className={`rk-slot${want ? " want" : ""}`}
      data-wire-node
      onClick={onClick}
    >
      <span>{label}</span>
      {installKey && onInstall ? (
        <span
          role="button"
          tabIndex={0}
          className="hm-key lit"
          data-key="install"
          onClick={(e) => {
            e.stopPropagation();
            onInstall();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onInstall();
            }
          }}
        >
          <span className="hm-led" />
          {installKey}
        </span>
      ) : null}
    </button>
  );
}
