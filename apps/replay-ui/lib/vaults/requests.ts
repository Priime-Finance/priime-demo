/**
 * Async deposit requests (ERC-7540 register) for the attested hero vault.
 *
 * The house rule: the UI never asserts what the source of truth has not
 * confirmed. The hero vault's source of truth is the NAV-strike journal, so a
 * deposit is a *request* that stays pending until a strike settles, and the
 * price it fills at is the journal's own `attestation.nav_final`, converted
 * with `nav_unit.decimals` and nothing else.
 *
 * Modeled vaults keep the kit's instant mock deposit (`store.addPosition`);
 * nothing in this module touches them.
 *
 * Split: the top half is pure (validation, fill math, state transitions) and is
 * unit-tested; the bottom half is the localStorage mirror of the kit's store,
 * SSR-guarded the same way.
 */

import type { Journal } from "@priime-demo/journal-schema";

import { REPLAY_PACING } from "@/lib/replay";

import {
  HERO_SHARES_OUTSTANDING,
  attestedNavPerShare,
  attestedNavUsd,
  sharesForDeposit,
} from "./attested";
import { VAULTS_EVENT } from "./store";

/** Minimum deposit, matching the kit's register. */
export const MIN_DEPOSIT_USD = 10;

/**
 * How long a request waits for the next NAV strike, in ms.
 *
 * Derived from the replay engine's own pacing rather than invented: one lead-in
 * plus one worst-case inter-event gap plus the tail hold is exactly the dwell
 * the replay budgets for a strike to fire, fill and land (8.0 s today). The
 * demo waits one of those, which is long enough to read "Pending" and short
 * enough to stay a beat rather than an interruption.
 */
export const STRIKE_ARRIVAL_MS =
  REPLAY_PACING.leadInMs + REPLAY_PACING.maxGapMs + REPLAY_PACING.tailHoldMs;

/** Lifecycle of a deposit request. */
type RequestStatus = "pending" | "settled" | "cancelled";

/** What a strike filled a request at. Every field is read off the journal. */
interface SettledFill {
  /** `Journal.strike_id` the request settled against. */
  strikeId: string;
  /** Block the strike was triggered at. */
  strikeBlock: number;
  /** `attestation.nav_final`, verbatim, in base units. */
  navFinalBase: string;
  /** `nav_unit.decimals`. */
  navDecimals: number;
  /** `nav_unit.asset`. */
  navAsset: string;
  /** `nav_final` converted with `navDecimals`. */
  navUsd: number;
  /** Attested NAV per share: the exact entry price shown to the depositor. */
  navPerShare: number;
  /** amount / navPerShare. */
  shares: number;
  /** Wall-clock ms the replayed strike landed in this session. */
  settledAt: number;
}

/** One deposit request against the attested vault. */
export interface DepositRequest {
  id: string;
  vaultSlug: string;
  amountUsd: number;
  /** ISO timestamp the request was submitted. */
  requestedAt: string;
  status: RequestStatus;
  /** Present only once `status === "settled"`. */
  fill?: SettledFill;
}

/* ─────────────────────────────────────────────────────── pure: validation ── */

/** Result of validating the amount field, before anything is submitted. */
type AmountCheck =
  | { ok: true; amountUsd: number }
  | { ok: false; empty: boolean; message: string };

/**
 * Validate a raw amount field. Called on every keystroke so the warning renders
 * under the input *before* submit, never as a failure after it.
 */
export function checkAmount(raw: string): AmountCheck {
  const trimmed = raw.trim().replace(/[$,]/g, "");
  if (trimmed === "") return { ok: false, empty: true, message: "" };
  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return { ok: false, empty: false, message: "Enter an amount in USD." };
  }
  if (amount < MIN_DEPOSIT_USD) {
    return { ok: false, empty: false, message: `Minimum deposit is $${String(MIN_DEPOSIT_USD)}.` };
  }
  return { ok: true, amountUsd: amount };
}

/* ─────────────────────────────────────────────────────────── pure: fills ── */

/**
 * The fill a settled journal produces for an amount, or null when the strike
 * has not settled (no attested NAV means no price to quote).
 */
export function fillFromJournal(
  journal: Journal,
  amountUsd: number,
  settledAt: number,
  sharesOutstanding: number = HERO_SHARES_OUTSTANDING,
): SettledFill | null {
  const navPerShare = attestedNavPerShare(journal, sharesOutstanding);
  const navUsd = attestedNavUsd(journal);
  const navFinalBase = journal.attestation.nav_final;
  if (navPerShare === null || navUsd === null || navFinalBase === null || navFinalBase === undefined) {
    return null;
  }
  return {
    strikeId: journal.strike_id,
    strikeBlock: journal.trigger.block,
    navFinalBase,
    navDecimals: journal.nav_unit.decimals,
    navAsset: journal.nav_unit.asset,
    navUsd,
    navPerShare,
    shares: sharesForDeposit(amountUsd, navPerShare),
    settledAt,
  };
}

/**
 * Settle a pending request against a journal. A request that is not pending, or
 * a journal that has not settled, comes back untouched — settlement is never
 * asserted on the strength of a timer alone.
 */
export function settleRequest(
  request: DepositRequest,
  journal: Journal,
  settledAt: number,
  sharesOutstanding: number = HERO_SHARES_OUTSTANDING,
): DepositRequest {
  if (request.status !== "pending") return request;
  const fill = fillFromJournal(journal, request.amountUsd, settledAt, sharesOutstanding);
  if (fill === null) return request;
  return { ...request, status: "settled", fill };
}

/** Wall-clock ms at which a pending request's strike is due. */
export function strikeDueAt(request: DepositRequest): number {
  return Date.parse(request.requestedAt) + STRIKE_ARRIVAL_MS;
}

/** The holding a set of requests adds up to: settled fills only. */
interface AttestedPosition {
  /** Σ shares over settled fills. */
  shares: number;
  /** Σ deposited USD over settled fills. */
  costUsd: number;
  /** Cost-weighted entry price, or null with nothing settled. */
  entryNavPerShare: number | null;
  /** Requests still waiting on a strike. */
  pending: number;
  /** USD sitting in pending requests. */
  pendingUsd: number;
}

/** Aggregate a request set into a position. */
export function positionFrom(requests: readonly DepositRequest[]): AttestedPosition {
  let shares = 0;
  let costUsd = 0;
  let pending = 0;
  let pendingUsd = 0;
  for (const r of requests) {
    if (r.status === "settled" && r.fill) {
      shares += r.fill.shares;
      costUsd += r.amountUsd;
    } else if (r.status === "pending") {
      pending += 1;
      pendingUsd += r.amountUsd;
    }
  }
  return {
    shares,
    costUsd,
    entryNavPerShare: shares > 0 ? costUsd / shares : null,
    pending,
    pendingUsd,
  };
}

/** Value of a settled position at an attested NAV per share. */
export function positionValueUsd(position: AttestedPosition, navPerShare: number): number {
  return position.shares * navPerShare;
}

/* ──────────────────────────────────────────────────────────── persistence ── */

const LS_REQUESTS = "priime:deposit-requests:v1";

function isRequest(value: unknown): value is DepositRequest {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<DepositRequest>;
  return (
    typeof r.id === "string" &&
    typeof r.vaultSlug === "string" &&
    typeof r.amountUsd === "number" &&
    typeof r.requestedAt === "string" &&
    (r.status === "pending" || r.status === "settled" || r.status === "cancelled")
  );
}

/** All persisted requests, newest first. `[]` on the server and in private mode. */
function loadRequests(): DepositRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_REQUESTS);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRequest) : [];
  } catch {
    return [];
  }
}

function persist(rows: readonly DepositRequest[]): void {
  try {
    localStorage.setItem(LS_REQUESTS, JSON.stringify(rows));
    window.dispatchEvent(new Event(VAULTS_EVENT));
  } catch {
    /* private mode: the session still works, it just does not survive reload */
  }
}

/** Requests for one vault, newest first. */
export function loadRequestsFor(slug: string): DepositRequest[] {
  return loadRequests().filter((r) => r.vaultSlug === slug);
}

/** Create and persist a pending request. */
export function createRequest(slug: string, amountUsd: number, nowMs = Date.now()): DepositRequest {
  const rows = loadRequests();
  const request: DepositRequest = {
    id: `req_${String(nowMs)}_${String(rows.length + 1)}`,
    vaultSlug: slug,
    amountUsd,
    requestedAt: new Date(nowMs).toISOString(),
    status: "pending",
  };
  persist([request, ...rows]);
  return request;
}

/** Write one request back over its stored copy. */
export function saveRequest(request: DepositRequest): void {
  persist(loadRequests().map((r) => (r.id === request.id ? request : r)));
}

/** Cancel a pending request. Settled requests are immutable. */
export function cancelRequest(id: string): void {
  persist(
    loadRequests().map((r) =>
      r.id === id && r.status === "pending" ? { ...r, status: "cancelled" as const } : r,
    ),
  );
}
