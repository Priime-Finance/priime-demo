"use client";

/**
 * VaultPlate (UX_SPEC §2.1 terminus) — the lane's vault plate. Net APY
 * counts up/down on every reprice (the hero moment); the wiring→live green
 * flip reuses the landing's .live treatment (values verbatim in hm.css).
 */

import { useCountUp } from "./PlateScreen";

export default function VaultPlate({
  laneLabel,
  netApy,
  blockNumber,
  live,
  dim,
  quoting,
}: {
  laneLabel: string;
  netApy: number | null;
  blockNumber: number | null;
  live: boolean;
  dim: boolean;
  quoting: boolean;
}) {
  const shown = useCountUp(netApy);
  return (
    <div className={`rk-plate rk-vault${live ? " live" : ""}${dim ? " rk-vault--dim" : ""}${quoting ? " rk-plate--quoting" : ""}`} data-wire-node data-vault>
      <div className="hm-hw">
        <div className="hm-body">
          <div className="hm-tag">
            <span className="nm">Vault</span>
            <span className="n">—</span>
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
              <div className="hm-src-val">{shown !== null ? `${(shown * 100).toFixed(1)}%` : "——"}</div>
              <div className="hm-sb">
                {blockNumber ? `modeled · block ${blockNumber}` : laneLabel.toUpperCase()}
              </div>
            </div>
            {/* The attestation declaration. Constant text: there is one
                composable vault and its NAV is always attested by the operator
                set at 2-of-3, whatever the lane is composed of. The LED is the
                plate's own armed green, which is a status and not a number. */}
            <div className="hm-att">
              <span className="hm-att-led" />
              <span className="hm-att-t">NAV attested by Priime Operator</span>
              <span className="hm-att-q">quorum 2 of 3</span>
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
