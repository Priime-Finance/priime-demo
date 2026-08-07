/**
 * OperatorModule — the kit's `layout/Module` card, one per operator: the node
 * name with its slash index, the signing address, a recessed screen showing
 * what the node reported, and a status badge.
 *
 * Every value arrives preformatted. `matches` mirrors the engine's
 * `matchesWinningHash`: `null` means no winning hash exists yet, which renders
 * as "undetermined" and never as a mismatch.
 */
import { Badge, type BadgeTone } from "@/components/Badge";
import { Readout, Screen, type ScreenTone } from "@/components/Screen";

/** Where an operator is in the submission lifecycle. */
export type OperatorStatus =
  | "awaiting"
  | "computing"
  | "submitted"
  | "accepted"
  /** Diverged from the winning hash and was outvoted. */
  | "rejected"
  /**
   * Submitted honestly into a strike that never reached quorum. Not the same
   * failure as `rejected`: nothing was outvoted, the threshold was simply
   * never met, so this is amber (drift) rather than red (alarm).
   */
  | "no-quorum";

interface StatusStyle {
  /** Badge copy. */
  label: string;
  /** Badge register. */
  tone: BadgeTone;
  /** Screen status word. */
  screen: string;
  /** Screen status dot register. */
  screenTone: ScreenTone;
}

/**
 * Status copy and colour per lifecycle step. "Rejected" uses `·` rather than
 * an em dash: no em dashes anywhere in Priime copy.
 */
const STATUS: Readonly<Record<OperatorStatus, StatusStyle>> = {
  awaiting: { label: "Awaiting", tone: "ghost", screen: "Idle", screenTone: "idle" },
  computing: { label: "Computing", tone: "accent", screen: "Computing", screenTone: "live" },
  submitted: { label: "Submitted", tone: "neutral", screen: "Signed", screenTone: "live" },
  accepted: { label: "Accepted", tone: "ok", screen: "Accepted", screenTone: "ok" },
  rejected: {
    label: "Rejected · hash mismatch",
    tone: "bad",
    screen: "Rejected",
    screenTone: "bad",
  },
  "no-quorum": {
    label: "No quorum · strike stalled",
    tone: "warn",
    screen: "No quorum",
    screenTone: "warn",
  },
};

/** Shown in a readout that has no value yet. */
const PENDING = "awaiting";

export interface OperatorModuleProps {
  /** Slash index, e.g. `"// 01"`. */
  index: string;
  /** Node label from the registry, e.g. `"node-1"`. */
  name: string;
  /** Truncated signing address. */
  address: string;
  /** Full signing address, for the title attribute. */
  addressTitle: string;
  /** Lifecycle step. */
  status: OperatorStatus;
  /** Truncated `result_hash`, or null before the submission fires. */
  resultHash: string | null;
  /** NAV as a signed percentage of the deployed baseline, or null. */
  navPct: string | null;
  /** Truncated signature, revealed with the submission. */
  signature: string | null;
  /** Submission time, UTC. */
  timestamp: string;
  /** `result_hash === quorum.winning_result_hash`; null while undetermined. */
  matches: boolean | null;
  /** Registry line, e.g. `"Weight 1 · registered #49479001"`. */
  registry: string;
  /** Test hook. */
  testId?: string;
}

/** One operator plate. */
export function OperatorModule({
  index,
  name,
  address,
  addressTitle,
  status,
  resultHash,
  navPct,
  signature,
  timestamp,
  matches,
  registry,
  testId,
}: OperatorModuleProps): React.JSX.Element {
  const style = STATUS[status];
  const rejected = status === "rejected";
  const stalled = status === "no-quorum";
  const live = status === "computing" || status === "submitted";

  const matchLabel =
    matches === null ? "undetermined" : matches ? "identical" : "divergent";
  const matchTone = matches === null ? "dim" : matches ? "ok" : "bad";

  const classes = [
    "op",
    rejected ? "op--rejected" : null,
    stalled ? "op--stalled" : null,
    live ? "op--live" : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");

  return (
    <article className={classes} data-testid={testId} data-status={status}>
      <div className="op__head">
        <span className="op__name">{name}</span>
        <span className="op__idx">{index}</span>
      </div>
      <span className="op__addr" title={addressTitle}>
        {address}
      </span>

      <Screen
        label="Result hash · keccak256"
        status={style.screen}
        tone={style.screenTone}
        scanlines
      >
        <Readout
          label="Hash"
          value={resultHash ?? PENDING}
          tone={resultHash === null ? "dim" : rejected ? "bad" : stalled ? "normal" : "ok"}
          hash
          testId={testId === undefined ? undefined : `${testId}-hash`}
        />
        <Readout
          label="NAV vs deployed"
          value={navPct ?? PENDING}
          tone={navPct === null ? "dim" : rejected ? "bad" : "normal"}
          testId={testId === undefined ? undefined : `${testId}-nav`}
        />
        <Readout
          label="Vs winning hash"
          value={resultHash === null ? PENDING : matchLabel}
          tone={resultHash === null ? "dim" : matchTone}
          testId={testId === undefined ? undefined : `${testId}-match`}
        />
        <Readout
          label="Signature"
          value={signature ?? PENDING}
          tone={signature === null ? "dim" : "normal"}
        />
        <Readout label="Observed" value={timestamp} tone={resultHash === null ? "dim" : "normal"} />
      </Screen>

      <div className="op__foot op__foot--stack">
        <Badge tone={style.tone} dot={status !== "awaiting"} testId={testId === undefined ? undefined : `${testId}-badge`}>
          {style.label}
        </Badge>
        <span className="op__weight">{registry}</span>
      </div>
    </article>
  );
}
