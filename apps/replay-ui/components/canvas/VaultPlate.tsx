"use client";

/**
 * VaultPlate (UX_SPEC §2.1 terminus) — the lane's vault plate. Net APY
 * counts up/down on every reprice (the hero moment); the wiring→live green
 * flip reuses the landing's .live treatment (values verbatim in hm.css).
 */

import { pct } from "@/lib/canvas/format";
import { quorumFacts } from "@/lib/vaults/attested";
import { heroSettlingJournal } from "@/lib/vaults/rows";
import { useCountUp } from "./PlateScreen";

/**
 * THE ATTESTATION LINE (docs/plans/LATEST_UI_PORT_SPEC.md A.3 #28). The
 * composition publishes onto the one attested record, so once the lane is
 * modeled the terminus states the fact the record carries: its NAV is read off
 * the captured journal and the quorum that settles it, from the journal's own
 * threshold. Inside the 34-char `.hm-sb` budget; nothing here is typed as a
 * figure. Null when no journal is captured, and then nothing prints.
 */
function attestedNote(): string | null {
  const journal = heroSettlingJournal();
  if (!journal) return null;
  return `nav attested · quorum ${quorumFacts(journal).thresholdLabel}`;
}

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
  const attested = live ? attestedNote() : null;
  const lines = [...(note ?? []), ...(attested ? [attested] : [])];
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
