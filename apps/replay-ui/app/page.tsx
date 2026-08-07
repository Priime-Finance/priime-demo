"use client";

/**
 * The living system canvas: "The Vault That Cannot Lie", alive on one page.
 *
 * There is no transport here. No play, no replay, no scrub. A NAV strike fires
 * every `STRIKE_INTERVAL_MS`, flows out of the vault into three operators, back
 * into the chain node as signed submissions, and settles. Between strikes the
 * system breathes. The only control is the one that matters: a `corrupt` switch
 * on each operator.
 *
 * This route owns state and composition, nothing else. The clocks live in
 * `hooks/`, every derived string comes out of `buildStageView` in
 * `lib/stage-view.ts`, and the leaves in `components/` receive preformatted
 * props. That boundary is deliberate: see the layering note in README.md.
 *
 * ## Honesty
 * The feed is a **client-side simulator** until the backend exists, and the
 * page says so in the masthead, under the canvas, and on the chain node. No
 * simulated hash is ever deep-linked to an explorer: a dead Basescan link on a
 * verification demo would be exactly the disease we claim to cure.
 *
 * ## Headless driving (invisible to the presenter)
 * See `lib/boot.ts` and the query-param table in README.md.
 */
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/Badge";
import { HeaderBar } from "@/components/HeaderBar";
import { Panel } from "@/components/Panel";
import { QuorumMeter } from "@/components/QuorumMeter";
import { Screen } from "@/components/Screen";
import { AttestationPanel } from "@/components/AttestationPanel";
import { StrikeTicker } from "@/components/StrikeTicker";
import { SystemCanvas } from "@/components/SystemCanvas";
import { useCanvasMode } from "@/hooks/useCanvasMode";
import { useSimulator, type SimulatorFeed } from "@/hooks/useSimulator";
import { parseBoot, type Boot } from "@/lib/boot";
import { buildCanvasLayout } from "@/lib/canvas";
import { CHAIN_LABEL, SIM_NOTE } from "@/lib/copy";
import { demoEnvironment, peerStatusFor } from "@/lib/environment";
import { formatNavPct, formatUtcTime, truncateAddress, truncateHash } from "@/lib/format";
import { NAV_BASELINE, SIM_CONFIG } from "@/lib/simulate";
import { buildStageView } from "@/lib/stage-view";

import { ChainInspector, OperatorInspector, StrikeDetail, VaultInspector } from "./inspectors";
import { StageRail } from "./rail";

/* ------------------------------------------------------------------- page */

/**
 * Boot shell.
 *
 * The URL params are read in an effect, not during render, and the canvas does
 * not mount until they are known. That is deliberate: `?corrupt=node-3` would
 * otherwise make the first client render disagree with the server's (which has
 * no `window`), and a hydration mismatch does not merely warn — React keeps the
 * server's attributes while believing it applied the client's, so a corrupted
 * node would render its switch OFF for the rest of the session.
 */
export default function LivingSystemPage(): React.JSX.Element {
  const [boot, setBoot] = useState<Boot | null>(null);

  useEffect(() => {
    setBoot(parseBoot());
  }, []);

  if (boot === null) return <BootShell />;
  return <LivingSystemCanvas boot={boot} />;
}

interface MastheadProps {
  /**
   * Whether the digest on stage matches the registered one. `null` in the
   * pre-mount frame, where no strike exists yet.
   */
  digestVerified: boolean | null;
  /** Test hook on the provenance badge; only the live frame carries it. */
  feedTestId?: string;
}

/** The masthead, identical in the pre-mount frame and the live one. */
function Masthead({ digestVerified, feedTestId }: MastheadProps): React.JSX.Element {
  return (
    <HeaderBar
      title="The Vault That Cannot Lie"
      feed={
        <Badge tone="warn" dot testId={feedTestId}>
          Simulated feed · backend pending
        </Badge>
      }
      vaultLabel={truncateAddress(SIM_CONFIG.vaultAddress)}
      vaultHref={null}
      vaultTitle={SIM_CONFIG.vaultAddress}
      digest={truncateHash(SIM_CONFIG.componentDigest, 13, 6)}
      digestTitle={SIM_CONFIG.componentDigest}
      digestVerified={digestVerified}
    />
  );
}

/** The pre-mount frame. Identical on the server and the first client render. */
function BootShell(): React.JSX.Element {
  return (
    <main className="console">
      <div className="console__inner">
        <Masthead digestVerified={null} />
        <div className="beat__head">
          <h2 className="beat__title">The system, running</h2>
          <p className="beat__kicker">Bringing the operator set up.</p>
        </div>
        <Panel title="System canvas" index="// 02" className="canvaspanel">
          <Screen label="Canvas">
            <span className="readout__value readout__value--dim">warming up</span>
          </Screen>
        </Panel>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ stage */

interface LivingSystemCanvasProps {
  boot: Boot;
}

/** The running system: two clocks, one derived frame, one layout. */
function LivingSystemCanvas({ boot }: LivingSystemCanvasProps): React.JSX.Element {
  const feed = useSimulator({
    seed: boot.seed,
    intervalMs: boot.intervalMs,
    preStrikes: boot.preStrikes,
    freezeMs: boot.freezeMs,
    corrupt: boot.corrupt,
  });

  const mode = useCanvasMode();
  const registry = demoEnvironment.registry.operators;
  const layout = useMemo(
    () => buildCanvasLayout(mode, registry.map((entry) => entry.id)),
    [mode, registry],
  );

  const [selected, setSelected] = useState<string | null>("vault");
  const [inspectStrikeId, setInspectStrikeId] = useState<string | null>(null);

  const view = buildStageView({ ...feed, registry });

  const selectNode = (nodeId: string): void => {
    setSelected(nodeId);
    setInspectStrikeId(null);
  };

  const selectStrike = (strikeId: string): void => {
    setInspectStrikeId((current) => (current === strikeId ? null : strikeId));
    setSelected(null);
  };

  const inspector = pickInspector({ feed, view, selected, inspectStrikeId });
  const cycleSeconds = Math.round(boot.intervalMs / 1_000);
  const { state } = feed;

  return (
    <main className="console">
      <div className="console__inner">
        <Masthead
          digestVerified={feed.journal === null ? null : true}
          feedTestId="sim-badge"
        />

        <div className="beat__head">
          <h2 className="beat__title" data-testid="canvas-title">
            The system, running
          </h2>
          <p className="beat__kicker">
            One vault, three operators, one chain. A NAV strike every {cycleSeconds} seconds:
            every node re-executes the same component against the same block, identical hashes
            form a quorum, and the result is attested.
          </p>
        </div>
        <p className="caption" data-testid="canvas-caption">
          Flip a node&rsquo;s corrupt switch. From the next strike it reports an inflated NAV,
          lands on a hash of its own, and never enters the quorum. Flip two and nothing reaches
          2-of-3: the strike stalls, which is the whole reason the set is three.
        </p>

        <Panel
          title="System canvas"
          index="// 02"
          className="canvaspanel"
          actions={
            <>
              <Badge tone="ghost">{`Strike every ${cycleSeconds}s`}</Badge>
              <Badge tone={view.stalled ? "warn" : state?.done === true ? "ok" : "accent"} dot>
                {view.stalled ? "Stalled" : (state?.phase ?? "idle")}
              </Badge>
            </>
          }
          testId="canvas-panel"
        >
          <SystemCanvas
            layout={layout}
            vault={view.vault}
            operators={view.operators}
            chain={view.chain}
            pulses={view.pulses}
            selected={selected}
            onSelect={selectNode}
            onToggleCorrupt={feed.toggleCorrupt}
            reducedMotion={feed.reducedMotion}
          />
          <p className="smallprint" data-testid="sim-note">
            {SIM_NOTE}
          </p>
        </Panel>

        <div className="stage">
          <div className="stage__main">
            <div className="stage__pair">
              <Panel title="Quorum" index="// 05" tight>
                {state === null ? (
                  <Screen label="Quorum">
                    <span className="readout__value readout__value--dim">warming up</span>
                  </Screen>
                ) : (
                  <QuorumMeter
                    threshold={state.quorum.threshold}
                    total={state.quorum.total}
                    cumulative={view.quorumWeight}
                    reached={state.quorum.reached}
                    excluded={view.excludedWeight}
                    note={view.quorumNote}
                    unreachedLabel={view.stalled ? "Not reached" : "Collecting"}
                    testId="quorum-meter"
                  />
                )}
              </Panel>

              <Panel title="Attestation" index="// 06" tight>
                <AttestationPanel
                  landed={view.attestation.landed}
                  navPct={
                    view.attestation.navFinal === null
                      ? null
                      : formatNavPct(view.attestation.navFinal, NAV_BASELINE)
                  }
                  txLabel={
                    view.attestation.txHash === null
                      ? null
                      : truncateHash(view.attestation.txHash, 10, 6)
                  }
                  txHref={null}
                  txTitle={view.attestation.txHash}
                  blockNumber={
                    view.attestation.blockNumber === null
                      ? null
                      : `#${view.attestation.blockNumber}`
                  }
                  timestamp={formatUtcTime(view.attestation.timestamp)}
                  chainLabel={CHAIN_LABEL}
                  txNote="simulated"
                />
              </Panel>
            </div>

            <Panel
              title="Recent strikes"
              index="// 07"
              tight
              actions={<Badge tone="ghost">{`${feed.history.length} in memory`}</Badge>}
              testId="ticker-panel"
            >
              <StrikeTicker
                items={view.ticker}
                selected={inspectStrikeId}
                onSelect={selectStrike}
                testId="ticker"
              />
            </Panel>

            <Panel title={inspector.title} index="// 08" testId="inspector">
              {inspector.body}
            </Panel>
          </div>

          <StageRail
            peers={view.peers}
            operators={view.registryRows}
            totals={view.registryTotals}
          />
        </div>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------- inspector */

interface InspectorInput {
  feed: SimulatorFeed;
  view: ReturnType<typeof buildStageView>;
  selected: string | null;
  inspectStrikeId: string | null;
}

/** What panel `// 08` shows: a strike beats a node, and the vault is default. */
function pickInspector({
  feed,
  view,
  selected,
  inspectStrikeId,
}: InspectorInput): { title: string; body: React.JSX.Element } {
  const { state } = feed;
  const registry = demoEnvironment.registry.operators;

  const inspectedStrike =
    inspectStrikeId === null
      ? null
      : (feed.history.find((entry) => entry.strike_id === inspectStrikeId) ?? null);

  if (inspectedStrike !== null) {
    return { title: "Strike detail", body: <StrikeDetail journal={inspectedStrike} /> };
  }

  if (selected === "chain") {
    return {
      title: "Base attestation node",
      body: (
        <ChainInspector
          registryAddress={demoEnvironment.registry.contract_address}
          quorumLabel={`${state?.quorum.threshold ?? 2}-of-${state?.quorum.total ?? registry.length}`}
          txHash={view.attestation.txHash}
          blockNumber={view.attestation.blockNumber}
          attestedAt={view.attestation.timestamp}
          navFinal={view.attestation.navFinal}
        />
      ),
    };
  }

  const operator = registry.find((entry) => entry.id === selected) ?? null;
  if (operator !== null) {
    const live =
      state?.operators.find((op) => op.id.toLowerCase() === operator.id.toLowerCase()) ?? null;
    const peer = peerStatusFor(operator.id);
    return {
      title: `Operator ${operator.label}`,
      body: (
        <OperatorInspector
          label={operator.label}
          address={operator.id}
          weight={operator.weight}
          registeredBlock={operator.registered_block}
          peerId={peer?.peer_id ?? "unknown"}
          peers={peer?.connected_peers.length ?? 0}
          resultHash={live?.result_hash ?? null}
          navPct={live === null ? null : formatNavPct(live.nav, NAV_BASELINE)}
          accepted={live?.accepted ?? null}
          corrupt={feed.corrupt.has(operator.id.toLowerCase())}
          observed={formatUtcTime(live?.timestamp ?? null)}
        />
      ),
    };
  }

  return {
    title: "Vault",
    body: (
      <VaultInspector
        address={SIM_CONFIG.vaultAddress}
        navPct={view.vaultNavPct}
        ltvPct={view.ltvPct}
        healthFactorValue={view.healthFactorValue}
        lastSettled={feed.history.find((entry) => entry.status === "settled")?.strike_id ?? null}
      />
    ),
  };
}
