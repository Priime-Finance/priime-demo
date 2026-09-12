"use client";

/**
 * The Graph panel: vault stats, recent strikes and daily rollups pulled from the `priime-demo` subgraph indexed on Subgraph Studio.
 *
 * Complements the loop-server-fed data: same vault, different provider, so a reader can cross-check numbers between the operator quorum's journal API and the independently-indexed on-chain event history.
 */

import { useEffect, useState } from "react";

import { Hex } from "./Hex";
import {
  SUBGRAPH_ENDPOINT,
  fetchSubgraphSnapshot,
  type SubgraphSnapshot,
} from "@/lib/vaults/subgraph";

const SIX_DECIMALS = 1_000_000;
const REFETCH_INTERVAL_MS = 30_000;

interface SubgraphPanelProps {
  vaultAddress: string;
}

type PanelState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshot: SubgraphSnapshot };

function formatUsdc(base: string): string {
  const n = Number(base) / SIX_DECIMALS;
  if (!Number.isFinite(n)) return base;
  return n.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

function formatDay(daySeconds: string): string {
  const d = new Date(Number(daySeconds) * 1000);
  if (Number.isNaN(d.getTime())) return daySeconds;
  return d.toISOString().slice(0, 10);
}

export default function SubgraphPanel({ vaultAddress }: SubgraphPanelProps) {
  const [state, setState] = useState<PanelState>({
    kind: SUBGRAPH_ENDPOINT === null ? "empty" : "loading",
  });

  useEffect(() => {
    if (SUBGRAPH_ENDPOINT === null) return;
    let alive = true;
    const load = () => {
      fetchSubgraphSnapshot(vaultAddress)
        .then((snapshot) => {
          if (!alive) return;
          if (snapshot === null) setState({ kind: "empty" });
          else setState({ kind: "ready", snapshot });
        })
        .catch((err: unknown) => {
          if (!alive) return;
          const message = err instanceof Error ? err.message : String(err);
          setState({ kind: "error", message });
        });
    };
    load();
    const id = window.setInterval(load, REFETCH_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [vaultAddress]);

  if (state.kind === "empty") return null;

  return (
    <div className="vx-panel vx-attest vx-subgraph" style={{ marginTop: 16 }}>
      <div className="vx-panel-h">Indexed by The Graph</div>
      <p className="vxd-desc vxd-desc--note">
        The vault&apos;s on-chain event history, indexed on Subgraph Studio and served over GraphQL. Same numbers as the operator quorum&apos;s journal API, resolved by an independent indexer against the ERC-4626 / Priime schema — reload the page and cross-check.
      </p>

      {state.kind === "loading" && (
        <p className="vxd-desc vxd-desc--note">Loading subgraph snapshot…</p>
      )}
      {state.kind === "error" && (
        <p className="vxd-desc vxd-desc--note vxd-desc--err">Subgraph error: {state.message}</p>
      )}
      {state.kind === "ready" && <SubgraphBody snapshot={state.snapshot} />}
    </div>
  );
}

function SubgraphBody({ snapshot }: { snapshot: SubgraphSnapshot }) {
  const { vault, strikes, dailyMetrics, meta } = snapshot;
  if (vault === null) {
    return <p className="vxd-desc vxd-desc--note">Subgraph is syncing; no vault entity yet.</p>;
  }
  return (
    <>
      <div className="vx-kv">
        <span>Vault</span>
        <b data-kind="hex"><Hex full={vault.id} /></b>
      </div>
      <div className="vx-kv">
        <span>Update count</span>
        <b data-kind="reading">{vault.updateCount}</b>
      </div>
      <div className="vx-kv">
        <span>Last attested NAV</span>
        <b data-kind="reading">{formatUsdc(vault.lastNav)} USDC</b>
      </div>
      <div className="vx-kv">
        <span>Total deposit fulfilled</span>
        <b data-kind="reading">{formatUsdc(vault.totalDepositFulfilled)} USDC</b>
      </div>
      <div className="vx-kv">
        <span>Total redeem fulfilled</span>
        <b data-kind="reading">{formatUsdc(vault.totalRedeemFulfilled)} USDC</b>
      </div>
      <div className="vx-kv">
        <span>Shares outstanding</span>
        <b data-kind="reading">{formatUsdc(vault.totalShares)}</b>
      </div>
      <div className="vx-kv">
        <span>Latest indexed block</span>
        <b data-kind="reading">{meta === null ? "?" : meta.block}</b>
      </div>
      {meta !== null && meta.hasIndexingErrors && (
        <div className="vx-kv">
          <span>Status</span>
          <b data-kind="phrase" className="vx-subgraph-warn">indexing errors reported</b>
        </div>
      )}

      {strikes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="vx-panel-h" style={{ fontSize: 12 }}>Recent strikes (subgraph)</div>
          <div className="vx-decisions">
            {strikes.map((s) => (
              <div key={s.id} className="vx-kv vx-kv--prose">
                <span>
                  strike {s.updateCount} · block {s.block}
                </span>
                <b data-kind="phrase">
                  <Hex full={s.eventId} lead={6} tail={4} /> · nav {formatUsdc(s.nav)} USDC
                  {s.breachFlags !== 0 && <> · breachFlags {s.breachFlags}</>}
                </b>
              </div>
            ))}
          </div>
        </div>
      )}

      {dailyMetrics.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="vx-panel-h" style={{ fontSize: 12 }}>Daily rollups (subgraph)</div>
          <div className="vx-decisions">
            {dailyMetrics.map((d) => (
              <div key={d.id} className="vx-kv">
                <span>{formatDay(d.day)}</span>
                <b data-kind="reading">
                  {d.strikeCount} strikes · nav end {formatUsdc(d.navEnd)} USDC
                  {d.planRejected > 0 && <> · {d.planRejected} plan rejected</>}
                </b>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
