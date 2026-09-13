"use client";

/**
 * VaultPlate (UX_SPEC §2.1 terminus) — the lane's vault plate. Net APY
 * counts up/down on every reprice (the hero moment); the wiring→live green
 * flip reuses the landing's .live treatment (values verbatim in hm.css).
 */

import { pct } from "@/lib/canvas/format";
import { useCountUp } from "./PlateScreen";

/**
 * THE COMPOSER PLATE HAS NO ATTESTATION LINE.
 *
 * The prior implementation read `heroSettlingJournal()` and printed
 * `nav attested · quorum N of M` whenever the plate was `live`
 * (`props.laneReviewable`). But `live` here means "the draft is fully
 * composed and reviewable", not "this vault has been published and its
 * NAV has been attested by a quorum". A draft has never seen a strike;
 * borrowing the hero fixture's quorum figure to fill the line printed
 * a false factual claim on every unpublished composition.
 *
 * If a future companion line is added, it MUST be a fact about the
 * draft itself (e.g. cadence, target leverage, market pair), not a
 * borrowed value from any captured journal. The composer is not a
 * ledger.
 */

export default function VaultPlate({
  laneLabel,
  netApy,
  blockNumber,
  live,
  dim,
  quoting,
  note,
}: {
  laneLabel: string;
  netApy: number | null;
  blockNumber: number | null;
  live: boolean;
  dim: boolean;
  quoting: boolean;
  /** QNT-3 — the companion fact a family rules must print beside its figure
   *  (the collar's forfeited upside), pre-split to `.hm-sb`'s own 34-char
   *  nowrap budget (`collarForfeitPlateLines`). Null on every other lane. */
  note?: readonly string[] | null;
}) {
  const shown = useCountUp(netApy);
  const lines = [...(note ?? [])];
  return (
    <div
      className={`rk-plate rk-vault${live ? " live" : ""}${dim ? " rk-vault--dim" : ""}${quoting ? " rk-plate--quoting" : ""}`}
      data-wire-node
      data-vault
      aria-label={`${laneLabel} vault`}
    >
      <div className="hm-hw">
        <div className="hm-body">
          <div className="hm-tag">
            <span className="nm">Vault</span>
            {/* The terminus carries no bay number; the slot prints nothing (docs/plans/LATEST_UI_PORT_SPEC.md 2.7). */}
            <span className="n" />
          </div>
          <span className="hm-jack tin" data-jack="vault:in" />
          <span className="hm-jack bus" />
          <div className="hm-scr">
            <div className="hm-st">
              <span>Net APY</span>
              <span className={`hm-bdg${live ? " ok" : ""}`} data-badge>
                {quoting ? "…" : live ? "modeled" : "wiring"}
              </span>
            </div>
            <div className="hm-mid hm-mid-src">
              {/* R5 grep: a private `pct` plus a `——` null that was TWO em
                  dashes where the product's mute glyph is one. `format.pct`
                  renders the null itself, so the ternary goes with it. */}
              <div className="hm-src-val">{pct(shown)}</div>
              {/* §4.6 — `modeled` → `as composed`. This is the ONE plate
                  allowed to print a percentage in `.hm-src-val`, and the
                  sub-line has to say which of the three frames it is. The
                  module count is dropped: the modules are literally visible
                  next to the plate, and at 8px in a 216px interior the count
                  pushed the block number off the screen. */}
              <div className="hm-sb">
                {blockNumber ? `as composed · block ${blockNumber}` : "as composed"}
              </div>
              {/* QNT-3 — the terminus prints the collar's number, so it
                  carries the forgone upside too, in the screen's own
                  sub-register. Absent on every family without the ruling. */}
              {lines.length > 0 && netApy !== null
                ? lines.map((line) => (
                    <div key={line} className="hm-sb">
                      {line}
                    </div>
                  ))
                : null}
            </div>
          </div>
          <div className="hm-acts">
            <div className="hm-al">Terminus</div>
            <div className="hm-keys">
              <div className={`hm-key${live ? " lit" : ""}`} data-key="deposit">
                <span className="hm-led" />
                Deposits
              </div>
              <div className="hm-key" data-key="hold">
                <span className="hm-led" />
                Shadow
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
