"use client";

/**
 * ProgressRail (IT4_HEADER_SPEC, on top of UX_ITERATION_3 §4/§5 + IT4) — the
 * header is ONE instrument cluster with three zones on a single grid:
 * [copilot key | identity | instrument | action | dock key].
 *
 * Identity sits quiet on the left (kicker + reduced title). The instrument
 * is the one voice in the center: a thin unlabeled 5-segment meter (only the
 * active segment names itself inline right; full labels on hover), the hero
 * YOUR PORTFOLIO count-up, ONE merged mono status line beneath it
 * ("modeled · block N · draft saved" — provenance and save-state share a
 * single register), and the stage-aware guide line docked directly under,
 * left-aligned with the hero block. The action zone holds REVIEW & LAUNCH
 * vertically centered against the hero, with per-lane APY chips (2+ lanes)
 * as small quiet chips under the key. The IT4 panel toggles frame the strip
 * as small hm-keys (hidden on mobile — the sheet keys own that job there).
 * Register stays honest: always "modeled", block-pinned, never realized.
 */

import { useEffect, useRef, useState } from "react";
import { useCountUp } from "./PlateScreen";

export type RailState = "done" | "now" | "todo" | "skip";

interface RailLaneChip {
  id: string;
  label: string;
  netApy: number | null;
}

export default function ProgressRail({
  title = "Compose a vault",
  steps,
  portfolioApy,
  laneChips,
  blockNumber,
  quoting,
  reviewable,
  reviewReason,
  guide,
  saveState,
  notice,
  onDismissNotice,
  dockOpen,
  onToggleDock,
  onReview,
}: {
  /** Header title; templates land "…name… · template" here. */
  title?: string;
  steps: { label: string; state: RailState }[];
  /** Allocation-weighted blend; single-loop portfolios pass that loop's APY. */
  portfolioApy: number | null;
  /** Secondary per-lane chips (rendered when the portfolio has 2+ lanes). */
  laneChips: RailLaneChip[];
  blockNumber: number | null;
  quoting: boolean;
  reviewable: boolean;
  /** Why the launch key is dark (recette UX-8: every disabled control says
   *  its reason). Null when armed. */
  reviewReason: string | null;
  /** Stage-aware one-line guide: the next action, imperative. */
  guide: string;
  /** Draft persistence state — merged into the mono status line. */
  saveState: "idle" | "saving" | "saved";
  /** One honest line (e.g. draft-integrity reset, P2-6); dismissable. */
  notice: string | null;
  onDismissNotice: () => void;
  dockOpen: boolean;
  onToggleDock: () => void;
  onReview: () => void;
}) {
  const shown = useCountUp(portfolioApy);
  const [flash, setFlash] = useState(0);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (portfolioApy !== null && prev.current !== null && portfolioApy !== prev.current) setFlash((f) => f + 1);
    prev.current = portfolioApy;
  }, [portfolioApy]);

  // The active segment: the first "now"; when everything is settled the last
  // settled stage names itself (the meter never goes mute mid-build).
  const active =
    steps.find((s) => s.state === "now") ??
    [...steps].reverse().find((s) => s.state === "done") ??
    steps[0] ??
    null;

  // ONE merged mono status line: provenance + save-state, single register.
  // The save register stays quiet until a market has actually been picked —
  // a fresh canvas has nothing worth calling a draft.
  const hasLane = portfolioApy !== null || quoting;
  const status = ["modeled"];
  if (blockNumber) status.push(`block ${blockNumber}`);
  if (hasLane) {
    if (saveState === "saving") status.push("saving…");
    else if (saveState === "saved") status.push("draft saved");
  }

  return (
    <div className="rail">
      {/* IT4C §4: the strip spans gutter-to-gutter — identity cluster on the
          LEFT page gutter, the instrument truly centered on the VIEWPORT
          (1fr | auto | 1fr), action cluster on the RIGHT gutter. */}
      <div className="rail-zone rail-zone--l">
        <div className="rail-id">
          <span className="bc-kicker">Priime Build</span>
          <h1 className="rail-title">{title}</h1>
        </div>
      </div>

      <div className="rail-instr">
        <div className="rail-meter">
          <div className="rail-segs">
            {steps.map((s) => (
              <span key={s.label} className={`rail-seg ${s.state}`} />
            ))}
            <span className="rail-seg-labels" aria-hidden>
              {steps.map((s) => (
                <i key={s.label} className={s.state}>
                  {s.label.toLowerCase()}
                </i>
              ))}
            </span>
          </div>
          {active ? <span className="rail-seg-active">· {active.label.toLowerCase()}</span> : null}
        </div>
        <div className="rail-hero">
          <span className="rail-hero-k">Your portfolio</span>
          <b key={flash} className={flash ? "flash" : undefined}>
            {quoting && shown === null ? (
              "…"
            ) : shown !== null ? (
              `${(shown * 100).toFixed(1)}%`
            ) : (
              <i className="rail-hero-empty">not modeled yet</i>
            )}
          </b>
        </div>
        <div className="rail-status">{status.join(" · ")}</div>
        <div className="rail-guide">{guide}</div>
        {notice ? (
          <div className="rail-notice">
            {notice}
            <button type="button" className="rail-notice-x" aria-label="Dismiss" onClick={onDismissNotice}>
              ×
            </button>
          </div>
        ) : null}
      </div>

      <div className="rail-zone rail-zone--r">
        <div className="rail-action">
          <button
            type="button"
            className={`rail-launch${reviewable ? " lit" : ""}`}
            disabled={!reviewable}
            title={reviewable ? undefined : (reviewReason ?? undefined)}
            onClick={onReview}
          >
            <span className="hm-led" />
            Review &amp; publish
          </button>
          {laneChips.length >= 2 ? (
            <div className="rail-lanes">
              {laneChips.map((c) => (
                <span key={c.id} className="rail-lanechip">
                  {c.label} <b>{c.netApy !== null ? `${(c.netApy * 100).toFixed(1)}%` : "…"}</b>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="hm-key rail-panelkey"
          data-key="rail-dock"
          aria-pressed={dockOpen}
          aria-label="Toggle context dock"
          title="Toggle dock ( ] )"
          onClick={onToggleDock}
        >
          <span className={`hm-led${dockOpen ? " lit" : ""}`} />
          Dock
        </button>
      </div>
    </div>
  );
}
