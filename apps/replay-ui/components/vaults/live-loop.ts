/**
 * THE ONE OWNER of what a DEPLOYED loop is allowed to say about itself.
 *
 * `/vaults/[slug]` now resolves two different kinds of record, and the whole
 * point of the merge is that they never blend:
 *
 * - a SEED or a published composition (`lib/vaults/seeds.ts`,
 *   `lib/vaults/store.ts`), rendered by `VaultDetail`. Its APY, its capacity,
 *   its instruments and its projection are MODELED and labeled so.
 * - a loop loop-server actually deployed (`isLiveLoopSlug`), rendered by
 *   `LiveLoopDetail`. There is no model behind it at all: the only things
 *   this surface may print are the fields loop-server stored at deploy
 *   (`LoopRecord` plus its validated `configJson`) and the attested facts the
 *   journal reader returns. Everything a modeled record carries and a
 *   deployment does not (a modeled APY, a TVL, a share value, a capacity
 *   ceiling, an automation instrument) is ABSENT here rather than faked with
 *   a placeholder number. That absence is the feature.
 *
 * This module holds the pure half of that rule so the page component holds
 * only markup, and so a test can pin every derivation without a DOM.
 *
 * WHAT IS DELIBERATELY NOT HERE: a share supply. `lib/vaults/attested.ts`
 * publishes `HERO_SHARES_OUTSTANDING` for the captured hero because that vault
 * was seeded at a share price of exactly 1.000000 and the desk published the
 * count. A freshly deployed loop has published no such thing, and the v1
 * journal attests a position's NAV, not a share supply. So a deployment
 * prints a NAV and never a share value.
 */

import type { Journal } from "@priime-demo/journal-schema";
import type { LoopRecord, Observations, StrikeRecord } from "@priime-demo/loop-deploy";

import { candidateSegments } from "@/lib/canvas/ids";
import { chainLabel, venueNoun } from "@/lib/canvas/labels";
import { truncateAddress, truncateHash } from "@/lib/format";
import { attestedNavUsd, AWAITING_LABEL, formatAttestedNav } from "@/lib/vaults/attested";
import type { OnchainExecution } from "@/lib/vaults/onchain-executions";

/**
 * The fields of the stored `LoopConfig` this surface renders.
 *
 * loop-server validated the whole config before it stored it
 * (`packages/loop-deploy/src/config.ts`), so every field below is already
 * known good on the server. The browser still cannot IMPORT that validator:
 * `@priime-demo/loop-deploy`'s entry point pulls the sqlite registry in, so
 * only its TYPES cross the seam (which is exactly what `live-source.ts`
 * does). Hence a narrow, total reader here: it never throws, and any field it
 * cannot vouch for comes back null so the page prints nothing rather than
 * printing a guess.
 */
export interface LoopConfigView {
  /** The market the composer picked, as the catalog keys it. */
  candidateId: string | null;
  /** Morpho Blue market id (bytes32). The on-chain identity of the market. */
  marketId: string | null;
  /** Strike cadence in seconds, the cron the workflow runs on. */
  cronSeconds: number | null;
  /** The leverage the loop was published at. */
  targetLeverage: number | null;
  /** TWAP window the component prices collateral over. */
  twapWindowSecs: number | null;
  /** Blocks behind the trigger the reads are pinned at (reorg depth). */
  inputsBlockLag: number | null;
  /** Every composer knob, string-encoded, as loop-server stored it. Empty
   *  object when none were sent. Names use the wire's snake_case so they
   *  match the observation keys the component emits. */
  strategyParams: Record<string, string>;
}

function str(source: Record<string, unknown>, key: string): string | null {
  const v = source[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(source: Record<string, unknown>, key: string): number | null {
  const v = source[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The stored config, read defensively. Null when the column is not an object. */
export function readLoopConfig(configJson: string): LoopConfigView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const cfg = parsed as Record<string, unknown>;
  return {
    candidateId: str(cfg, "candidateId"),
    marketId: str(cfg, "marketId"),
    cronSeconds: num(cfg, "cronSeconds"),
    targetLeverage: num(cfg, "targetLeverage"),
    twapWindowSecs: num(cfg, "twapWindowSecs"),
    inputsBlockLag: num(cfg, "inputsBlockLag"),
    strategyParams: readStrategyParams(cfg),
  };
}

/** Read strategyParams as a flat string map. Non-object -> empty. */
function readStrategyParams(cfg: Record<string, unknown>): Record<string, string> {
  const raw = cfg.strategyParams;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * The cadence, in the mono's own reading register.
 *
 * loop-server accepts 5..59 seconds or a whole number of minutes up to an
 * hour (`cronFromSeconds`), so those are the only two shapes that can reach
 * this page. Seconds stay seconds; everything else reads in minutes, so
 * `3600` says `every 60 min` rather than inventing a third word for an hour.
 */
export function cadenceText(cronSeconds: number): string {
  if (!Number.isFinite(cronSeconds) || cronSeconds <= 0) return "unknown";
  if (cronSeconds < 60) return `every ${String(Math.round(cronSeconds))}s`;
  return `every ${String(Math.round(cronSeconds / 60))} min`;
}

/**
 * The market the composer picked, split into the two words a header may say.
 *
 * A v2 candidate id is `${venue}:${chainId}:${pair}:${marketKey}`
 * (`lib/canvas/ids.ts` states the shape and owns the last segment). Anything
 * that is not that shape comes back null, and the caller prints the raw id.
 *
 * THE CHAIN SEGMENT IS DELIBERATELY IGNORED. The catalog entry says `8453`
 * because it names the Base market whose addresses the workflow was built
 * from, but the deployment this page describes runs on whatever chain its
 * journals were attested on, which on the demo is the local fork (31337).
 * Reading the chain off the candidate id would print `Base` over a fork run.
 * The chain comes from the journal (`journalChainLabel`) or it is not stated.
 */
export function marketWords(candidateId: string): { pair: string; venue: string } | null {
  const seg = candidateSegments(candidateId);
  if (seg === null) return null;
  return { pair: seg.pair.replace(/-/g, "/"), venue: venueNoun(seg.venue) };
}

/** `USDe/USDC on Morpho Blue`, or the raw id when it is not a v2 candidate. */
function marketLine(candidateId: string): string {
  const words = marketWords(candidateId);
  return words === null ? candidateId : `${words.pair} on ${words.venue}`;
}

/**
 * The chain the quorum actually attested on, named from the journal.
 *
 * `chainLabel` falls through to `chain 31337` for the fork, which is the
 * honest answer: there is no public explorer for it, which is also why no row
 * on this surface carries a Verify key.
 */
function journalChainLabel(journal: Journal): string {
  return chainLabel(journal.vault.chain_id);
}

/**
 * The newest journal that actually settled: the only one whose NAV the quorum
 * has signed. Journals arrive newest-first from loop-server, but this sorts
 * on the determinism anchor rather than trusting an order.
 */
function settledJournal(journals: readonly Journal[]): Journal | null {
  return (
    [...journals]
      .filter((j) => j.status === "settled" && j.attestation.nav_final !== null)
      .sort((a, b) => b.inputs_block - a.inputs_block)[0] ?? null
  );
}

/**
 * The attested NAV of the newest settled strike, with the unit it is
 * denominated in. Null until a strike settles.
 *
 * The VALUE, not a formatted string, because the two places that print it
 * print it differently on purpose: the stat band rounds it like every other
 * headline figure on the product, and the Attestation panel prints it at the
 * journal's full base-unit precision. Six decimal places live in the
 * Attestation panel and nowhere else on a vault page
 * (docs/plans/LATEST_UI_PORT_SPEC.md A.3 #13), and that rule holds here too.
 */
export function attestedNavReading(
  journals: readonly Journal[],
): { value: number; asset: string } | null {
  const journal = settledJournal(journals);
  if (journal === null) return null;
  const nav = attestedNavUsd(journal);
  return nav === null ? null : { value: nav, asset: journal.nav_unit.asset };
}

/**
 * THE QUORUM THIS DEPLOYMENT ACTUALLY RUNS, read off the journal.
 *
 * The captured showcase settles 2 of 3 because the capture does. The deployed
 * service registers ONE operator at 1/1 (`deploy/vault-service.sh:220`, and
 * `apps/loop-server/src/env.ts` defaults `QUORUM_THRESHOLD` and
 * `QUORUM_TOTAL` to 1), so any live surface that printed `2 of 3` would be
 * stating a fact about a quorum that has never run. Every quorum figure on
 * this page comes through here, from the journal's own `quorum` block, and no
 * threshold is typed anywhere in the live path.
 */
export interface LiveQuorum {
  threshold: number;
  total: number;
  /** `1 of 1`: what the deployment REQUIRES. */
  requiredLabel: string;
  /** `1-of-1`: what actually agreed on the newest strike. */
  agreedLabel: string;
  reached: boolean;
}

export function liveQuorum(journals: readonly Journal[]): LiveQuorum | null {
  const newest =
    [...journals].sort((a, b) => b.inputs_block - a.inputs_block)[0] ?? null;
  if (newest === null) return null;
  const accepted = newest.operators.filter((o) => o.accepted).length;
  return {
    threshold: newest.quorum.threshold,
    total: newest.quorum.total,
    requiredLabel: `${String(newest.quorum.threshold)} of ${String(newest.quorum.total)}`,
    agreedLabel: `${String(accepted)}-of-${String(newest.quorum.total)}`,
    reached: newest.quorum.reached,
  };
}

/**
 * The honesty line under the live Attestation rows.
 *
 * `ATTESTATION_NOTE` in `AttestationPanel` says "Three operators", which is
 * true of the CAPTURE it sits under and false of this deployment. So the live
 * sentence counts the operators the journal actually carries and says what
 * that means, rather than borrowing a number from the showcase.
 */
export function liveAttestationNote(quorum: LiveQuorum): string {
  const one = quorum.total === 1;
  const who = one
    ? "One operator re-executes the component"
    : `${String(quorum.total)} operators re-execute the same component`;
  // `requiredLabel` traces through the journal reader back to
  // loop-server's `QUORUM_THRESHOLD` / `QUORUM_TOTAL` env vars, not
  // to a manager view function (the interface only exposes
  // `QuorumThresholdUpdated` as an event; a proper chain read would
  // scan those). Attribute the number to its real source rather than
  // let the sentence pose as a chain fact.
  return `${who} against one pinned input block, and the handler checks the signature before it acts. loop-server is configured for ${quorum.requiredLabel} (from QUORUM_THRESHOLD / QUORUM_TOTAL in the server's env), so a divergence has nothing to be outvoted by; an independent set is a registry change, not a code change.`;
}

/**
 * An execution row for the shared ledger renderer, plus the chain it landed
 * on so the renderer can decide whether a Verify key is even possible.
 *
 * `OnchainExecution` (`lib/vaults/onchain-executions.ts`) is the shape the
 * Activity table already reads for the captured Base rows. A live journal
 * maps onto exactly that shape, so ONE renderer prints both sources and there
 * is no second activity table anywhere in the product.
 */
export type LedgerExecution = OnchainExecution & { chainId: number };

/**
 * The strikes that reached the chain, as ledger rows.
 *
 * Only a journal that carries BOTH an attestation transaction and its
 * timestamp becomes a row: an execution the ledger prints is one that
 * happened, at a time it can state. A pending or stalled strike is not
 * dropped from the page, it is shown in the Verification ledger where its
 * status is the point.
 */
export function journalExecutions(journals: readonly Journal[]): LedgerExecution[] {
  const rows: LedgerExecution[] = [];
  for (const j of journals) {
    const { tx_hash: txHash, timestamp, block_number: block, chain_id: chainId } = j.attestation;
    if (txHash === null || timestamp === null) continue;
    rows.push({
      txHash,
      // The attestation's own block where it has one; the determinism anchor
      // otherwise. Both are blocks this strike is pinned to, and the ledger
      // states which by printing nothing else in the cell.
      blockNumber: block ?? j.inputs_block,
      timestamp,
      chainId,
    });
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * A digest of all zeros is the sentinel loop-server writes when
 * `COMPONENT_DIGEST` is unset (`apps/loop-server/src/env.ts`), not a digest.
 * That field exists so a third party can re-verify the component, and a page
 * that printed 64 zeros as one would be inviting a check that cannot pass.
 */
const DIGEST_UNSET_LABEL = "not published by this deployment";

function digestText(componentDigest: string): string {
  /* The sentinel is `sha256:` followed by 64 zeros, which is how
     `apps/loop-server/src/env.ts` spells "COMPONENT_DIGEST was never set".
     Matching `0x`-prefixed zeros instead (as this did until the pre-PR sweep)
     never fired, so an unset digest printed 64 zeros and invited a check that
     cannot pass, which is the one thing this function exists to stop. The
     prefix is optional and the algorithm name is not assumed. */
  return /^(?:[a-z0-9]+:|0x)?0+$/i.test(componentDigest) ? DIGEST_UNSET_LABEL : componentDigest;
}

/**
 * The deployment's identity rows, in reading order.
 *
 * Every value is a field loop-server stored or a fact the journal attests.
 * A field the server does not have yet (a handler address while the deploy is
 * still walking its steps) prints its own honest marker rather than an
 * address-shaped placeholder.
 */
export interface LoopFact {
  label: string;
  value: string;
  /** Full hex string when `value` is a truncated address / hash. When
   *  set, the renderer swaps the value for a copyable Hex control so
   *  the user has a path to the datum the display hides. */
  full?: string;
}

/** Rendered in place of a server field that has not been filled in yet. */
const PENDING_LABEL = "pending deploy";

export function loopFacts(
  loop: LoopRecord,
  config: LoopConfigView | null,
  journals: readonly Journal[],
): LoopFact[] {
  const rows: LoopFact[] = [];
  rows.push({ label: "Loop id", value: loop.id });
  rows.push({ label: "Strategist", value: truncateAddress(loop.strategist), full: loop.strategist });
  rows.push({
    label: "Handler",
    value: loop.handlerAddress === null ? PENDING_LABEL : truncateAddress(loop.handlerAddress),
    full: loop.handlerAddress ?? undefined,
  });
  rows.push({ label: "Workflow", value: loop.workflowId });
  if (config !== null) {
    if (config.cronSeconds !== null) {
      rows.push({ label: "Strike cadence", value: cadenceText(config.cronSeconds) });
    }
    if (config.candidateId !== null) {
      rows.push({ label: "Market", value: marketLine(config.candidateId) });
    }
    if (config.marketId !== null) {
      rows.push({ label: "Market id", value: config.marketId });
    }
    if (config.targetLeverage !== null) {
      /* PUBLISHED AT, NOT RUNNING AT. `targetLeverage` is informational at
         deploy time (`packages/loop-deploy/src/config.ts` says so):
         loop-server stores what the composer asked for, and nothing on chain
         reports the leverage the position is actually carrying. The label has
         to say which of the two it is. */
      rows.push({ label: "Published leverage", value: `${config.targetLeverage.toFixed(2)}x` });
    }
  }
  const newest = [...journals].sort((a, b) => b.inputs_block - a.inputs_block)[0] ?? null;
  if (newest !== null) {
    rows.push({ label: "Chain", value: journalChainLabel(newest) });
    rows.push({ label: "Vault", value: truncateAddress(newest.vault.address), full: newest.vault.address });
  }
  if (config !== null) {
    if (config.twapWindowSecs !== null) {
      rows.push({ label: "TWAP window", value: `${String(config.twapWindowSecs)}s` });
    }
    if (config.inputsBlockLag !== null) {
      rows.push({ label: "Inputs block lag", value: `${String(config.inputsBlockLag)} blocks` });
    }
  }
  return rows;
}

/**
 * The Attestation rows for a DEPLOYED loop.
 *
 * Deliberately the same rows, in the same order, as `attestationRows` in
 * `AttestationPanel`: a reader who has looked at the showcase should be able
 * to read this table without learning a second layout. The difference is
 * where every value comes from. `attestationRows` reads
 * `captureJournal("honest")`, a file committed to this repo; every value
 * below is read off the journal loop-server returned for THIS loop, and no
 * figure on it (least of all the quorum) is typed anywhere in this build.
 */
export function liveAttestationRows(journals: readonly Journal[]): LoopFact[] {
  const ordered = [...journals].sort((a, b) => b.inputs_block - a.inputs_block);
  const newest = ordered[0] ?? null;
  const quorum = liveQuorum(journals);
  if (newest === null || quorum === null) return [];
  const oldestFirst = [...ordered].reverse();
  const nav = attestedNavUsd(newest);
  return [
    { label: "Quorum", value: `${quorum.requiredLabel} required` },
    {
      label: "Settled",
      value: oldestFirst
        .map((j) => {
          const accepted = j.operators.filter((o) => o.accepted).length;
          return `${String(accepted)} of ${String(j.quorum.total)} at block ${String(j.inputs_block)}`;
        })
        .join(" · "),
    },
    { label: "Component digest", value: digestText(newest.component_digest) },
    { label: "Service id", value: truncateAddress(newest.service_id), full: newest.service_id },
    { label: "Vault", value: truncateAddress(newest.vault.address), full: newest.vault.address },
    { label: "Chain id", value: String(newest.vault.chain_id) },
    { label: "Operators registered", value: String(quorum.total) },
    ...newest.operators.map((op, index) => ({
      label: `Operator ${String(index + 1)}`,
      value: truncateAddress(op.id),
      full: op.id,
    })),
    {
      label: "NAV unit",
      value: `${newest.nav_unit.asset}, ${String(newest.nav_unit.decimals)} decimals`,
    },
    { label: "Latest inputs block", value: String(newest.inputs_block) },
    {
      label: "Winning result hash",
      value:
        newest.quorum.winning_result_hash === null
          ? "no quorum formed"
          : truncateHash(newest.quorum.winning_result_hash, 10, 6),
      full: newest.quorum.winning_result_hash ?? undefined,
    },
    {
      label: "Latest attested NAV",
      value:
        nav === null
          ? AWAITING_LABEL
          : `${formatAttestedNav(nav, newest.nav_unit.decimals)} ${newest.nav_unit.asset}`,
    },
  ];
}

/**
 * Rows for the "Composer knobs, observed" panel: each composer knob that the
 * component now attests against paired with the quorum-measured counterpart
 * at the newest strike.
 *
 * The wiring is:
 *   applied_leverage       -> leverageBps
 *   hf_target_bps          -> ltvBps
 *   hf_deleverage_bps      -> ltvBps
 *   hf_floor_bps           -> ltvBps
 *   reserve_fraction       -> reserveBps
 *   collateral_yield_apy   -> supplyApyBps
 *   compound_cadence_hours -> hoursSinceUpdate
 *
 * `configured` is what the strategist published; `measured` is what the
 * quorum attested. `null` on either side means "no strike yet" (measured)
 * or "strategist did not set this" (configured). The row is emitted either
 * way so the user can see which dials the composer surfaced.
 *
 * Every measured value is deterministic from chain state at `inputs_block`,
 * so two operators running the same config produce identical bytes and any
 * per-operator lie shows up as a divergent hash outside the quorum.
 */
export interface ObservedKnob {
  key: string;
  label: string;
  configured: string | null;
  measured: string | null;
}

export function observedKnobRows(
  config: LoopConfigView | null,
  strikes: readonly StrikeRecord[],
): ObservedKnob[] {
  const params = config?.strategyParams ?? {};
  const newest = [...strikes].sort((a, b) => b.inputs_block - a.inputs_block)[0] ?? null;
  const obs: Observations | null = newest?.observations ?? null;

  const fromBps = (bps: number, suffix = "x"): string =>
    suffix === "x" ? `${(bps / 10_000).toFixed(2)}${suffix}` : `${(bps / 100).toFixed(2)}%`;

  return [
    {
      key: "applied_leverage",
      label: "Applied leverage",
      configured: params.applied_leverage ? `${params.applied_leverage}x` : null,
      measured: obs === null ? null : fromBps(obs.leverageBps, "x"),
    },
    {
      key: "hf_target_bps",
      label: "HF target",
      configured: params.hf_target_bps ? `${params.hf_target_bps} bps LTV target` : null,
      measured: obs === null ? null : `${obs.ltvBps} bps LTV`,
    },
    {
      key: "hf_deleverage_bps",
      label: "HF deleverage trigger",
      configured: params.hf_deleverage_bps ? `${params.hf_deleverage_bps} bps LTV trim` : null,
      measured: obs === null ? null : `${obs.ltvBps} bps LTV`,
    },
    {
      key: "hf_floor_bps",
      label: "HF floor",
      configured: params.hf_floor_bps ? `${params.hf_floor_bps} bps below LLTV` : null,
      measured: obs === null ? null : `${obs.ltvBps} bps LTV`,
    },
    {
      key: "reserve_fraction",
      label: "USDC reserve",
      configured: params.reserve_fraction ? `${params.reserve_fraction}` : null,
      measured: obs === null ? null : fromBps(obs.reserveBps, "%"),
    },
    {
      key: "collateral_yield_apy",
      label: "Supply APY",
      configured: params.collateral_yield_apy ? `${params.collateral_yield_apy}%` : null,
      measured: obs === null ? null : fromBps(obs.supplyApyBps, "%"),
    },
    {
      key: "compound_cadence_hours",
      label: "Compound cadence",
      configured: params.compound_cadence_hours ? `${params.compound_cadence_hours} h` : null,
      measured: obs === null ? null : `${obs.hoursSinceUpdate} h since market update`,
    },
  ];
}
