/**
 * The inspector bodies: what goes inside panel `// 08` when you click
 * something on the canvas.
 *
 * Four of them, one per thing you can select — the vault, one operator, the
 * chain node, and one strike from the ticker. They live in `app/` rather than
 * `components/` because they read `lib/` directly (the deploy config, the
 * environment fixture, the formatters); `components/` stays a pure props-in
 * layer. See the layering note in README.md.
 */
import type { Journal } from "@priime-demo/journal-schema";

import { Badge } from "@/components/Badge";
import { DataList, type DataRow } from "@/components/DataList";
import { FieldRow } from "@/components/FieldRow";
import { OperatorModule, type OperatorStatus } from "@/components/OperatorModule";
import { QuorumMeter } from "@/components/QuorumMeter";
import { Metric, Readout, Screen } from "@/components/Screen";
import { BLANK_HASH, BLANK_PCT, CHAIN_LABEL, SIM_NOTE } from "@/lib/copy";
import { DEPLOY_FORM } from "@/lib/deploy-config";
import { demoEnvironment, registryEntryFor } from "@/lib/environment";
import { EMPTY_TIME, formatNavPct, formatUtcTime, truncateAddress, truncateHash } from "@/lib/format";
import { MARKET_LLTV_BPS, NAV_BASELINE, SIM_CONFIG } from "@/lib/simulate";

/* --------------------------------------------------------- vault inspector */

export interface VaultInspectorProps {
  /** Full vault address. */
  address: string;
  /** NAV as a signed percentage of the deployed baseline. */
  navPct: string;
  /** Simulated loan-to-value, as a percentage. */
  ltvPct: number;
  /** Simulated health factor. */
  healthFactorValue: number;
  /** `strike_id` of the most recent settled strike, or null. */
  lastSettled: string | null;
}

/** What the vault is, and what it is doing right now. */
export function VaultInspector({
  address,
  navPct,
  ltvPct,
  healthFactorValue,
  lastSettled,
}: VaultInspectorProps): React.JSX.Element {
  const floor = SIM_CONFIG.healthFactorFloor;
  const safe = healthFactorValue > floor;

  const rows: readonly DataRow[] = [
    { key: "venue", label: "Venue", value: DEPLOY_FORM.venue },
    { key: "market", label: "Market", value: DEPLOY_FORM.market },
    { key: "chain", label: "Chain", value: CHAIN_LABEL },
    { key: "address", label: "Vault", value: truncateAddress(address), title: address },
    { key: "lltv", label: "Market LLTV", value: `${(MARKET_LLTV_BPS / 100).toFixed(1)}%` },
    { key: "nav-source", label: "NAV source", value: "On-chain position only" },
    {
      key: "settled",
      label: "Last settled",
      value: lastSettled === null ? "none yet" : truncateHash(lastSettled, 12, 8),
      title: lastSettled ?? undefined,
    },
  ];

  return (
    <>
      <div className="deploy__venue">
        <Badge tone="neutral">{DEPLOY_FORM.venue}</Badge>
        <Badge tone="neutral">{DEPLOY_FORM.market}</Badge>
        <Badge tone="accent">{CHAIN_LABEL}</Badge>
      </div>

      <Screen label="Position · simulated" status={safe ? "Healthy" : "At floor"} tone={safe ? "ok" : "warn"} scanlines>
        <Metric
          value={navPct}
          label="NAV vs deployed baseline"
          caption="Percentages and attestations, never dollar P&L"
          tone="ok"
          medium
          testId="vault-nav"
        />
        <Readout label="Loan to value" value={`${ltvPct.toFixed(2)}%`} />
        <Readout
          label="Health factor"
          value={`${healthFactorValue.toFixed(3)} vs ${floor.toFixed(2)} floor`}
          tone={safe ? "ok" : "bad"}
          testId="vault-hf"
        />
        <Readout label="Target leverage" value={`${DEPLOY_FORM.parameters[0]?.display ?? "5.0x"}`} />
      </Screen>

      {DEPLOY_FORM.parameters.map((parameter) => (
        <FieldRow
          key={parameter.key}
          label={parameter.label}
          value={parameter.display}
          help={parameter.help}
          testId={`field-${parameter.key}`}
        />
      ))}

      <DataList rows={rows} testId="vault-facts" />
      <p className="smallprint">
        Parameters are the scripted deploy config. Loan-to-value and health factor are simulated
        telemetry, not a reading from a deployed position.
      </p>
    </>
  );
}

/* ------------------------------------------------------ operator inspector */

export interface OperatorInspectorProps {
  /** Registry label, e.g. `"node-1"`. */
  label: string;
  /** Full signing address. */
  address: string;
  /** Quorum weight. */
  weight: number;
  /** Block the operator was registered at. */
  registeredBlock: number;
  /** Full libp2p peer id. */
  peerId: string;
  /** Connected-peer count. */
  peers: number;
  /** `result_hash` from the live strike, or null before it submits. */
  resultHash: string | null;
  /** NAV as a signed percentage, or null. */
  navPct: string | null;
  /** Whether the submission entered the quorum; null while undetermined. */
  accepted: boolean | null;
  /** True while this node is flipped to lie. */
  corrupt: boolean;
  /** Submission time, UTC, preformatted. */
  observed: string;
}

/** One node: who it is, what it said, and whether it is lying on purpose. */
export function OperatorInspector({
  label,
  address,
  weight,
  registeredBlock,
  peerId,
  peers,
  resultHash,
  navPct,
  accepted,
  corrupt,
  observed,
}: OperatorInspectorProps): React.JSX.Element {
  const rows: readonly DataRow[] = [
    { key: "address", label: "Signing address", value: truncateAddress(address), title: address },
    { key: "weight", label: "Quorum weight", value: `${weight}` },
    { key: "registered", label: "Registered", value: `block #${registeredBlock}` },
    { key: "peer", label: "Peer id", value: truncateHash(peerId, 12, 6), title: peerId },
    { key: "peers", label: "Connected", value: `${peers} peers · mDNS` },
    { key: "observed", label: "Observed", value: observed },
  ];

  return (
    <>
      <div className="deploy__venue">
        <Badge tone={corrupt ? "bad" : "ok"} dot testId="operator-health">
          {corrupt ? "Corrupted · lying from the next strike" : "Honest"}
        </Badge>
        {accepted === null ? null : (
          <Badge tone={accepted ? "ok" : "bad"}>
            {accepted ? "In quorum" : "Excluded from quorum"}
          </Badge>
        )}
      </div>

      <Screen
        label={`${label} · last submission`}
        status={corrupt ? "Corrupted" : accepted === false ? "Rejected" : "Signed"}
        tone={corrupt || accepted === false ? "bad" : "ok"}
        scanlines
      >
        <Readout
          label="Result hash"
          value={resultHash === null ? BLANK_HASH : truncateHash(resultHash, 14, 8)}
          tone={resultHash === null ? "dim" : accepted === false ? "bad" : "ok"}
          hash
          testId="inspector-hash"
        />
        <Readout
          label="NAV vs deployed"
          value={navPct ?? BLANK_PCT}
          tone={navPct === null ? "dim" : accepted === false ? "bad" : "normal"}
        />
      </Screen>

      <DataList rows={rows} testId="operator-facts" />
      <p className="smallprint">
        The corrupt switch is the demo&rsquo;s whole point: a node that inflates NAV lands on a
        different hash and is outvoted, not trusted. It takes effect from the next strike, because
        a node already mid-strike has already signed.
      </p>
    </>
  );
}

/* --------------------------------------------------------- chain inspector */

export interface ChainInspectorProps {
  /** Full registry contract address. */
  registryAddress: string;
  /** Quorum threshold line, e.g. `"2-of-3"`. */
  quorumLabel: string;
  /** Attestation tx hash, or null. */
  txHash: string | null;
  /** Block it landed in, or null. */
  blockNumber: number | null;
  /** Unix seconds it landed at, or null. */
  attestedAt: number | null;
  /** Settled NAV in base units, or null. */
  navFinal: string | null;
}

/** Where the attestation lands, and why none of it is a link yet. */
export function ChainInspector({
  registryAddress,
  quorumLabel,
  txHash,
  blockNumber,
  attestedAt,
  navFinal,
}: ChainInspectorProps): React.JSX.Element {
  const rows: readonly DataRow[] = [
    { key: "chain", label: "Chain", value: CHAIN_LABEL },
    {
      key: "registry",
      label: "Operator registry",
      value: truncateAddress(registryAddress),
      title: registryAddress,
    },
    { key: "threshold", label: "Quorum threshold", value: quorumLabel },
    { key: "block", label: "Attested block", value: blockNumber === null ? "awaiting" : `#${blockNumber}` },
    { key: "time", label: "Landed", value: attestedAt === null ? EMPTY_TIME : formatUtcTime(attestedAt) },
  ];

  return (
    <>
      <div className="deploy__venue">
        <Badge tone="warn">Registry address is a placeholder</Badge>
        <Badge tone="warn" dot>
          Simulated tx · not deep-linked
        </Badge>
      </div>

      <Screen
        label="Attestation · simulated"
        status={txHash === null ? "Not landed" : "Landed"}
        tone={txHash === null ? "idle" : "ok"}
        scanlines
      >
        <Metric
          value={navFinal === null ? BLANK_PCT : formatNavPct(navFinal, NAV_BASELINE)}
          label="Settled NAV vs deployed baseline"
          caption={txHash === null ? "Awaiting quorum" : "Attested by the quorum"}
          tone={txHash === null ? "idle" : "ok"}
        />
        <Readout
          label="Tx hash"
          value={txHash === null ? BLANK_HASH : truncateHash(txHash, 14, 8)}
          tone={txHash === null ? "dim" : "normal"}
          testId="chain-inspector-tx"
        />
      </Screen>

      <DataList rows={rows} testId="chain-facts" />
      <p className="smallprint">
        The transaction hash above is generated in your browser. It is deliberately not a Basescan
        link: a dead explorer link on a verification demo would be exactly the failure mode this
        product exists to catch. Real captures replay with real links.
      </p>
    </>
  );
}

/* ----------------------------------------------------------- strike detail */

export interface StrikeDetailProps {
  /** One strike out of the ticker's history. */
  journal: Journal;
}

/** One strike from history, opened out. */
export function StrikeDetail({ journal }: StrikeDetailProps): React.JSX.Element {
  const winning = journal.quorum.winning_result_hash;
  const last = journal.quorum.transitions[journal.quorum.transitions.length - 1] ?? null;
  const cumulative = winning === null ? 0 : (last?.cumulative ?? 0);
  const excluded = journal.operators.filter((operator) => !operator.accepted).length;

  const rows: readonly DataRow[] = [
    { key: "strike", label: "Strike", value: truncateHash(journal.strike_id, 12, 8), title: journal.strike_id },
    { key: "status", label: "Status", value: journal.status, ok: journal.status === "settled" },
    { key: "trigger", label: "Trigger", value: journal.trigger.type },
    { key: "block", label: "Inputs block", value: `#${journal.inputs_block}` },
    { key: "unit", label: "NAV unit", value: `${journal.nav_unit.asset} · ${journal.nav_unit.decimals} dp` },
    {
      key: "winner",
      label: "Winning hash",
      value: winning === null ? "none" : truncateHash(winning, 12, 8),
      title: winning ?? undefined,
    },
  ];

  return (
    <>
      <div className="opgrid" data-testid="strike-operators">
        {journal.operators.map((operator) => {
          const entry = registryEntryFor(operator.id);
          // The slash index is the node's place in the registry, not its
          // arrival order in this strike: node-1 is always "// 01".
          const ordinal = demoEnvironment.registry.operators.findIndex(
            (candidate) => candidate.id.toLowerCase() === operator.id.toLowerCase(),
          );
          // In a stalled strike the journal cannot say who lied — nobody was
          // outvoted, the threshold was simply never met. Every submission is
          // amber. (The canvas can be redder about it, because there the
          // presenter is the one who flipped the switch.)
          const status: OperatorStatus = operator.accepted
            ? "accepted"
            : journal.status === "stalled"
              ? "no-quorum"
              : "rejected";
          return (
            <OperatorModule
              key={operator.id}
              index={`// 0${ordinal + 1}`}
              name={entry?.label ?? truncateAddress(operator.id)}
              address={truncateAddress(operator.id)}
              addressTitle={operator.id}
              status={status}
              resultHash={truncateHash(operator.result_hash, 10, 6)}
              navPct={formatNavPct(operator.nav, NAV_BASELINE)}
              signature={truncateHash(operator.signature, 10, 6)}
              timestamp={formatUtcTime(operator.timestamp)}
              matches={winning === null ? null : operator.result_hash === winning}
              registry={`Weight ${entry?.weight ?? 1} · block #${entry?.registered_block ?? 0}`}
              testId={`strike-operator-${entry?.label ?? operator.id}`}
            />
          );
        })}
      </div>

      <div style={{ marginTop: "var(--sp-4)" }}>
        <QuorumMeter
          threshold={journal.quorum.threshold}
          total={journal.quorum.total}
          cumulative={cumulative}
          reached={journal.quorum.reached}
          excluded={excluded}
          note={
            journal.status === "stalled"
              ? "No hash reached the threshold. Every divergent node sits in a bucket of its own, so the strike stalled and nothing was attested."
              : undefined
          }
          testId="strike-quorum"
        />
      </div>

      <div style={{ marginTop: "var(--sp-4)" }}>
        <DataList rows={rows} testId="strike-facts" />
      </div>
      <p className="smallprint">{SIM_NOTE}</p>
    </>
  );
}
