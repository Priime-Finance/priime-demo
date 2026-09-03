/**
 * Attested-vault facts: the bridge between the frozen NAV-strike journals and
 * the vault directory.
 *
 * Everything here is a pure read of a `Journal`. No modeled math, no clock, no
 * localStorage. The one vault in the directory that is backed by these numbers
 * (the hero, `lib/vaults/hero.ts`) renders them in the *attested* register:
 * mono, ink, never green, never labeled "modeled".
 *
 * Journals themselves are only ever read through `lib/source.ts`; this module
 * takes them as arguments so it stays trivially testable.
 */

import type { Journal, Operator, Status } from "@priime-demo/journal-schema";

import { truncateAddress, truncateHash } from "@/lib/format";

/**
 * Shares outstanding for the hero vault, in whole shares.
 *
 * The demo vault was seeded with the desk's own capital at a share price of
 * exactly 1.000000, so the share count equals the seed NAV in `nav_unit`
 * units. It is a published constant rather than a journal field because the
 * v1 journal attests the position's NAV, not the share supply — pretending to
 * read it from the journal would be exactly the kind of fake this demo exists
 * to catch.
 */
export const HERO_SHARES_OUTSTANDING = 500;

/**
 * Integer base units (`"500000000"`) to a decimal number (`500`).
 *
 * The journal never carries floats, so the string is the source of truth and
 * this conversion is the only place the value becomes lossy. Throws on
 * anything that is not an integer string, because a silent `NaN` in a NAV is
 * worse than a crash.
 */
export function baseUnitsToNumber(value: string, decimals: number): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`Not an integer base-unit string: ${value}`);
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Not a base-unit decimal count: ${String(decimals)}`);
  }
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = decimals === 0 ? "" : `.${padded.slice(padded.length - decimals)}`;
  return Number(`${negative ? "-" : ""}${whole}${frac}`);
}

/** Settled NAV in `nav_unit` units, or null while the strike has not settled. */
export function attestedNavUsd(journal: Journal): number | null {
  const final = journal.attestation.nav_final;
  if (final === null || final === undefined) return null;
  return baseUnitsToNumber(final, journal.nav_unit.decimals);
}

/**
 * Attested NAV per share: settled NAV divided by shares outstanding.
 *
 * This is the entry price a deposit request fills at. Null until the strike
 * settles — the UI must never quote a price the quorum has not attested.
 */
export function attestedNavPerShare(
  journal: Journal,
  sharesOutstanding: number = HERO_SHARES_OUTSTANDING,
): number | null {
  if (sharesOutstanding <= 0) throw new Error("sharesOutstanding must be positive");
  const nav = attestedNavUsd(journal);
  return nav === null ? null : nav / sharesOutstanding;
}

/** Shares a deposit buys at an attested NAV per share. */
export function sharesForDeposit(amountUsd: number, navPerShare: number): number {
  if (navPerShare <= 0) throw new Error("navPerShare must be positive");
  return amountUsd / navPerShare;
}

/** One operator's submission, flattened for rendering. */
interface OperatorRow {
  /** Operator signing address. */
  id: string;
  /** `0x1111…1111`. */
  shortId: string;
  /** keccak256 of the result payload. */
  resultHash: string;
  /** `0xa1a1a1…a1a1`. */
  shortHash: string;
  /** The operator's own NAV reading, in `nav_unit` units. */
  navUsd: number;
  /** True when this submission joined the quorum-winning set. */
  accepted: boolean;
  /** Unix seconds the submission was observed. */
  timestamp: number;
}

function toOperatorRow(op: Operator, decimals: number): OperatorRow {
  return {
    id: op.id,
    shortId: truncateAddress(op.id),
    resultHash: op.result_hash,
    shortHash: truncateHash(op.result_hash),
    navUsd: baseUnitsToNumber(op.nav, decimals),
    accepted: op.accepted,
    timestamp: op.timestamp,
  };
}

/** Quorum shape of one strike, in the language the page renders. */
interface QuorumFacts {
  /** Operators whose hash joined the winning set. */
  accepted: number;
  /** Registered operator count. */
  total: number;
  /** Weight required to settle. */
  threshold: number;
  /** `"3-of-3"` / `"2-of-3"` — what actually settled, not what was required. */
  label: string;
  /** `"2 of 3"` — the configured requirement. */
  thresholdLabel: string;
  /** True once the winning hash reached the threshold. */
  reached: boolean;
  /**
   * The result hash the quorum formed over, straight from the journal. Null
   * when no quorum ever formed, in which case the UI shows a marker and never
   * a hash: an unattested strike has no winning hash to quote.
   */
  winningHash: string | null;
}

/** Quorum facts for one strike. */
export function quorumFacts(journal: Journal): QuorumFacts {
  const accepted = journal.operators.filter((o) => o.accepted).length;
  const total = journal.quorum.total;
  return {
    accepted,
    total,
    threshold: journal.quorum.threshold,
    label: `${accepted}-of-${total}`,
    thresholdLabel: `${journal.quorum.threshold} of ${total}`,
    reached: journal.quorum.reached,
    winningHash: journal.quorum.winning_result_hash,
  };
}

/** One NAV strike, flattened into everything the activity ledger renders. */
export interface StrikeRow {
  /** `service_id:block`. */
  strikeId: string;
  /** Trailing block of the strike id, the readable handle. */
  shortId: string;
  /** Block the trigger fired at. */
  triggerBlock: number;
  /** Block the NAV was computed against (the determinism anchor). */
  inputsBlock: number;
  /** How the strike was triggered. */
  trigger: string;
  /** Lifecycle at capture time. */
  status: Status;
  /** Settled NAV in `nav_unit` units, null until settled. */
  navUsd: number | null;
  /** `"USDC"`. */
  navAsset: string;
  /** Base-unit decimals for every NAV on this strike. */
  navDecimals: number;
  /** Attested NAV per share, null until settled. */
  navPerShare: number | null;
  quorum: QuorumFacts;
  operators: OperatorRow[];
  /** True when at least one operator diverged and was rejected. */
  hasRejection: boolean;
  /** Attestation timestamp in unix seconds, null until settled. */
  attestedAt: number | null;
}

/** Flatten one journal into a renderable strike row. */
function strikeRow(
  journal: Journal,
  sharesOutstanding: number = HERO_SHARES_OUTSTANDING,
): StrikeRow {
  const decimals = journal.nav_unit.decimals;
  const operators = journal.operators.map((o) => toOperatorRow(o, decimals));
  return {
    strikeId: journal.strike_id,
    shortId: String(journal.trigger.block),
    triggerBlock: journal.trigger.block,
    inputsBlock: journal.inputs_block,
    trigger: journal.trigger.type,
    status: journal.status,
    navUsd: attestedNavUsd(journal),
    navAsset: journal.nav_unit.asset,
    navDecimals: decimals,
    navPerShare: attestedNavPerShare(journal, sharesOutstanding),
    quorum: quorumFacts(journal),
    operators,
    hasRejection: operators.some((o) => !o.accepted),
    attestedAt: journal.attestation.timestamp,
  };
}

/** Strike rows for a set of captures, newest strike first. */
export function strikeRows(
  journals: readonly Journal[],
  sharesOutstanding: number = HERO_SHARES_OUTSTANDING,
): StrikeRow[] {
  return journals
    .map((j) => strikeRow(j, sharesOutstanding))
    .sort((a, b) => b.triggerBlock - a.triggerBlock);
}

/**
 * The strike a deposit request fills at: the most recent settled strike whose
 * quorum actually formed. Null when no capture has settled.
 */
export function settlingStrike(rows: readonly StrikeRow[]): StrikeRow | null {
  return rows.find((r) => r.status === "settled" && r.navPerShare !== null) ?? null;
}

/**
 * What an attested slot reads when the quorum has not attested a number yet.
 *
 * The attested register never falls back to a modeled number and never prints
 * a placeholder digit: a NAV or a share price the quorum has not signed is not
 * a number this page is allowed to state, so the slot says so in words.
 */
export const AWAITING_LABEL = "awaiting strike";

/** An attested value in its own format, or the awaiting marker when null. */
export function attestedText(value: number | null, format: (value: number) => string): string {
  return value === null ? AWAITING_LABEL : format(value);
}

/** An attested share price at journal precision, or the awaiting marker. */
export function attestedShareText(navPerShare: number | null): string {
  return attestedText(navPerShare, (v) => v.toFixed(6));
}

/** Format an attested NAV the way the journal states it: full base-unit precision. */
export function formatAttestedNav(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
