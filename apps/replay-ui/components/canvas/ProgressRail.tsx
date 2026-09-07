"use client";

/**
 * ProgressRail (IT4_HEADER_SPEC, on top of UX_ITERATION_3 §4/§5 + IT4) — the
 * header is ONE instrument cluster with three zones on a single grid:
 * [copilot key | identity | instrument | action | dock key].
 *
 * Identity sits quiet on the left (kicker + reduced title). The instrument
 * is the one voice in the center: a thin unlabeled 5-segment meter (only the
 * active segment names itself inline right; full labels on hover), the hero
 * YOUR PORTFOLIO count-up, and ONE merged mono status line beneath it
 * ("modeled · scanned 12d ago · block N · quoting… · draft saved" —
 * provenance, scan age, quote state and save-state share a single register).
 *
 * R1 (TIP_SPEC 2026-08-21): the stage-aware guide line is DELETED. The header
 * says WHAT IS TRUE; the canvas tip stack says WHAT TO DO NEXT, and it can do
 * it. Two voices saying the same sentence, one passive in chrome and one
 * actionable on canvas, was the founder's objection. "Waiting on the modeled
 * quote" was never a next step — it is a truth state, and it folds in here as
 * a status token. The action zone holds REVIEW & LAUNCH
 * vertically centered against the hero, with per-lane APY chips (2+ lanes)
 * as small quiet chips under the key. The IT4 panel toggles frame the strip
 * as small hm-keys (hidden on mobile — the sheet keys own that job there).
 * Register stays honest: always "modeled", block-pinned, never realized.
 */

import { useEffect, useRef, useState } from "react";
import { pct } from "@/lib/canvas/format";
import { useCountUp } from "./PlateScreen";

export type RailState = "done" | "now" | "todo" | "skip";

export interface RailLaneChip {
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
  /* The scan-age token is not printed on this build (docs/plans/LATEST_UI_PORT_SPEC.md
     2.6): the catalog is a committed snapshot, and `scanned 42d ago` would
     read as a fact about a scan this build never runs. The prop stays so the
     caller's contract is the live one. */
  scanAgeDays: _scanAgeDays,
  reviewable,
  reviewReason,
  onReviewFix,
  saveState,
  receipt,
  notice,
  noticeAction,
  onDismissNotice,
  cpOpen,
  dockOpen,
  onToggleCp,
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
  /** Oldest venue-scan age behind the shown numbers; null when unknown.
   *  R6: catalog staleness is chrome, never a tip. It lives here. */
  scanAgeDays: number | null;
  reviewable: boolean;
  /** Why the launch key is dark (recette UX-8: every disabled control says
   *  its reason). Null when armed. */
  reviewReason: string | null;
  /** Route out of the blockage — opens the offending lane's market catalog.
   *  Undefined when the reason has no single lane to fix. */
  onReviewFix?: () => void;
  /** Draft persistence state — merged into the mono status line. */
  saveState: "idle" | "saving" | "saved";
  /**
   * THE RECEIPT (COMPOSE_PANEL_SPEC §5.3) — four seconds of attribution, and
   * the ONLY place a jump is narrated. It CROSS-FADES the status line rather
   * than prepending a token: that line already holds
   * "modeled · scanned 12d ago · block 34412881 · draft saved", and
   * prepending wraps it at common widths, shoving the notice and the whole
   * canvas down. An APY explainer that makes the page jump is worse than no
   * explainer. `modeled` is never evicted.
   */
  receipt: { key: number; text: string } | null;
  /** One honest line (e.g. draft-integrity reset, P2-6); dismissable. */
  notice: string | null;
  onDismissNotice: () => void;
  /**
   * Optional action inside the notice. Exists for exactly one case today: the
   * Create vault CTA opens blank (`?new=1`), so the builder's saved
   * composition must be offered BACK rather than silently left behind. A
   * notice that reports a loss without a way to undo it is a worse notice.
   */
  noticeAction?: { label: string; onClick: () => void } | null;
  cpOpen: boolean;
  dockOpen: boolean;
  onToggleCp: () => void;
  onToggleDock: () => void;
  onReview: () => void;
}) {
  const shown = useCountUp(portfolioApy);
  const [flash, setFlash] = useState(0);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    // A NUMBER APPEARING IS NOT A NUMBER CHANGING (§5.4): the null → number
    // direction is an arrival and gets no flash, matching useCountUp's own
    // bail. Flashing a number the lane was never at is a lie about what
    // happened.
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
  if (quoting) status.push("quoting…");
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
        <button
          type="button"
          className="hm-key rail-panelkey"
          data-key="rail-cp"
          aria-pressed={cpOpen}
          aria-label="Toggle copilot panel"
          title="Toggle copilot ( [ )"
          onClick={onToggleCp}
        >
          <span className={`hm-led${cpOpen ? " lit" : ""}`} />
          Copilot
        </button>

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
              pct(shown)
            ) : (
              <i className="rail-hero-empty">not modeled yet</i>
            )}
          </b>
        </div>
        {/* One line, two faces. The token is keyed on the beat counter so a
            second change REMOUNTS and restarts the clock rather than queuing;
            it is not dismissable, because a 4s token with a close button is
            two controls for one idea. NOT `.rail-notice`: that is amber,
            boxed, dismissable and owns draft-integrity events. This is not a
            warning. */}
        <div className="rail-status" key={receipt ? `r${receipt.key}` : "s"} data-receipt={receipt ? "1" : undefined}>
          {receipt ? (
            <>
              <b>{receipt.text}</b> · modeled{quoting ? " · quoting…" : ""}
            </>
          ) : (
            status.join(" · ")
          )}
        </div>
        {notice ? (
          <div className="rail-notice">
            {notice}
            {noticeAction ? (
              <button type="button" className="rail-notice-key" onClick={noticeAction.onClick}>
                {noticeAction.label}
              </button>
            ) : null}
            {/* ONE cross in the product, not two: the same 9px SVG in a 28px
                hit box the tip layer uses (the old 11px raw glyph gave a
                ~15px target, optically off-centre). */}
            <button type="button" className="rail-notice-x" aria-label="Dismiss notice" onClick={onDismissNotice}>
              <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden focusable="false">
                <path d="M1 1L8 8M8 1L1 8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
              </svg>
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
          {/* §5.8 — the reason used to live ONLY in a `title=` on a disabled
              button, and disabled elements do not reliably dispatch pointer
              events in Safari or Firefox, so the tooltip frequently never
              appeared: the key was dead and said nothing. Render it for ALL
              reasons; one mechanism beats two. Neutral register, never amber:
              a market that stopped accepting deposits is a state, not an
              error the user caused. */}
          {!reviewable && reviewReason ? (
            <div className="rail-reason">
              <span>{reviewReason}</span>
              {onReviewFix ? (
                <button type="button" onClick={onReviewFix}>
                  Swap market
                </button>
              ) : null}
            </div>
          ) : null}
          {laneChips.length >= 2 ? (
            <div className="rail-lanes">
              {laneChips.map((c) => (
                <span key={c.id} className="rail-lanechip">
                  {c.label} <b>{c.netApy !== null ? pct(c.netApy) : "…"}</b>
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
