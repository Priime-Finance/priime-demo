"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * The sticky right rail (the Morpho move): deposit card with the existing
 * mock-deposit choreography, a projection card that computes live with the
 * typed amount (the conversion engine), and a position card once one exists,
 * with the Withdraw block under it (docs/plans/LATEST_UI_PORT_SPEC.md WP4.9,
 * E.10). All math renders instantly from the input value; $0.00 when empty.
 *
 * Capacity binds HERE (recette item 11). The vault page reviews a capacity,
 * freezes it into the record, and the deposit rail is the only surface that
 * can actually test it, so the ceiling is computed once in this file and
 * every dead input carries the reason that killed it. A vault modelled at
 * $14,124 refuses $20,000 and says which resource ran out.
 *
 * THE ATTESTED SHARE VALUE. For the live record (`HERO_SLUG`) the share
 * value is `heroNavPerShare()`, read off the settling capture through
 * `lib/vaults/rows.ts`, at 4dp (A.3 #13). It never counts, ticks or drifts;
 * a deposit is recorded at it and a withdrawal is redeemed at it.
 */

import { useRef, useState } from "react";
import { depositAfterSettlement, settlementFeeUsd, withdrawalLine } from "@/lib/canvas/fees";
import { MIN_DEPOSIT_USD } from "@/lib/canvas/param-schema";
import { HERO_SLUG } from "@/lib/demo-scope";
import { heroNavPerShare } from "@/lib/vaults/rows";
import {
  addPosition,
  fmtPct,
  fmtUsd,
  fmtUsdFull,
  recordVenueParts,
  withdrawPosition,
  type PositionRecord,
  type VaultRecord,
} from "@/lib/vaults/store";

/**
 * A single ticket never claims the last slice of the modelled book: the
 * execution cost of a deposit scales with the share of the binding resource
 * (perp book depth, borrow liquidity, collateral cap) taken in one action.
 * The deposit max is therefore `utilization × remaining capacity`, not the
 * remaining capacity itself.
 */
export const SINGLE_DEPOSIT_UTILIZATION = 0.9;

/**
 * The green confirmation band's full life: CSS fades it at 4.8s, React
 * removes it at this mark. One declaration for the deposit band and the
 * withdraw band alike.
 */
export const DEPOSIT_CONFIRMATION_MS = 5000;

/** The key's arm: `Depositing…` / `Withdrawing…` for this long (F.6). */
const ARM_MS = 650;

export interface DepositCeiling {
  /** Published capacity; null on records written before capacity was carried. */
  capacityUsd: number | null;
  /** Published binding caption, if the record carries one. */
  bindingLabel: string | null;
  /** capacity − TVL, floored at zero. Null when capacity is unknown. */
  remainingUsd: number | null;
  /**
   * TVL ÷ capacity, clamped to [0, 1]. THE utilization fraction: the vault
   * page's headline bar and the directory card's glance bar both read this
   * one number so they cannot draw two different fills for one vault.
   *
   * It divides by the RECONCILED `capacityUsd` frozen on the record, which
   * `vaultCapacity` computed as a minimum over shared resource groups, never
   * a sum of lanes. A record that predates that field returns null here and
   * every surface renders no bar at all, because a bar drawn against a
   * fabricated denominator is worse than no bar.
   */
  usedFrac: number | null;
  /** Largest single deposit this vault accepts now. Null = uncapped record. */
  maxUsd: number | null;
  /** True when the vault cannot absorb one minimum deposit. */
  full: boolean;
}

/**
 * The published ceiling, read tolerantly: records written before the publish
 * wave carried `capacityUsd` return an uncapped ceiling rather than a
 * fabricated one. Nothing here re-derives capacity from a live catalog: the
 * number the depositor is held to is the number the composer was shown.
 */
export function depositCeiling(vault: VaultRecord, tvlUsd: number): DepositCeiling {
  const raw = vault.capacityUsd;
  const bindingLabel =
    typeof vault.capacityBindingLabel === "string" && vault.capacityBindingLabel.trim().length > 0
      ? vault.capacityBindingLabel.trim()
      : null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return {
      capacityUsd: null,
      bindingLabel,
      remainingUsd: null,
      usedFrac: null,
      maxUsd: null,
      full: false,
    };
  }
  const remainingUsd = Math.max(0, raw - tvlUsd);
  const maxUsd = Math.floor(remainingUsd * SINGLE_DEPOSIT_UTILIZATION);
  const usedFrac = Math.min(1, Math.max(0, (Number.isFinite(tvlUsd) ? tvlUsd : 0) / raw));
  return {
    capacityUsd: raw,
    bindingLabel,
    remainingUsd,
    usedFrac,
    maxUsd,
    full: maxUsd < MIN_DEPOSIT_USD,
  };
}

/**
 * Every string the utilization bar prints, derived ONCE.
 *
 * The vault page draws the headline instrument and the directory card draws a
 * 4px glance version of it; they are different instruments, but they may not
 * be different READINGS. Both call this, so a vault cannot say "62% of $4.5M"
 * on the card and "63% of $4.5M" on its own page, and the at-capacity register
 * is one word in one place.
 *
 * Returns null on a record that carries no reconciled capacity: the caller's
 * contract is to render NO BAR, never a bar against a guessed denominator.
 */
export interface CapacityReading {
  /** [0,1]. The fill proportion, and the only number either bar scales by. */
  frac: number;
  /** The terminal value label, e.g. "62%". */
  pct: string;
  /** The instrument's own name, which carries the state: "At capacity". */
  head: string;
  /** Left endpoint: what is in the vault now. */
  usedUsd: string;
  /** Right endpoint: total reconciled capacity. */
  totalUsd: string;
  /** What binds, in nouns ("limited by the ETH perp book"). */
  binding: string | null;
  full: boolean;
}

export function capacityReading(c: DepositCeiling, tvlUsd: number): CapacityReading | null {
  if (c.capacityUsd === null || c.usedFrac === null) return null;
  return {
    frac: c.usedFrac,
    // A capacity bar is read to the whole percent; a tenth of a percent of a
    // book-depth snapshot is noise dressed as precision.
    pct: fmtPct(c.usedFrac, 0),
    // A full vault is a filled vault, not a failed one. State it flat.
    head: c.full ? "At capacity" : "Capacity used",
    usedUsd: fmtUsd(Math.min(tvlUsd, c.capacityUsd)),
    totalUsd: fmtUsd(c.capacityUsd),
    binding: c.bindingLabel,
    full: c.full,
  };
}

/**
 * The APY display gate. A record whose graph never validated, or whose
 * modeled APY is not a finite number, prints no number at all: a confident
 * wrong figure is worse than an absent one. `graphOk` is read tolerantly:
 * the publish wave writes it, older records simply omit it.
 */
export function apyDisplayable(vault: VaultRecord): boolean {
  const graphOk = (vault as VaultRecord & { graphOk?: boolean }).graphOk;
  if (graphOk === false) return false;
  return typeof vault.modeledApy === "number" && Number.isFinite(vault.modeledApy);
}

/** Monthly accrual that survives a modelled loss (pow breaks below −100%). */
function monthlyRate(apy: number): number {
  return apy > -1 ? Math.pow(1 + apy, 1 / 12) - 1 : apy / 12;
}

/** Capacity phrased as a sentence, with its binding when the record has one. */
function capacitySentence(c: DepositCeiling): string {
  const cap = fmtUsdFull(c.capacityUsd ?? 0);
  return c.bindingLabel ? `${cap}, ${c.bindingLabel}` : cap;
}

type Stop = { ok: true } | { ok: false; reason: string | null };

/** One evaluation, one reason. Every dead button below traces to a line here. */
function evaluate(raw: string, parsed: number, c: DepositCeiling): Stop {
  if (c.full) {
    return {
      ok: false,
      reason: `This vault is at its modeled capacity of ${capacitySentence(c)}. It cannot take another deposit.`,
    };
  }
  if (raw.trim() === "") return { ok: false, reason: null };
  if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, reason: "Enter an amount in USD." };
  if (parsed < MIN_DEPOSIT_USD) {
    return { ok: false, reason: `The minimum deposit is ${fmtUsdFull(MIN_DEPOSIT_USD)}.` };
  }
  if (c.maxUsd !== null && parsed > c.maxUsd) {
    return {
      ok: false,
      reason: `This vault models ${capacitySentence(c)}. The largest single deposit it accepts right now is ${fmtUsdFull(c.maxUsd)}.`,
    };
  }
  return { ok: true };
}

/**
 * The withdraw key's one reason per dead state (WP4.9). No minimum, one quick
 * key: the exit has no floor.
 */
export function evaluateWithdraw(raw: string, parsed: number, heldUsd: number): Stop {
  if (raw.trim() === "") return { ok: false, reason: null };
  if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, reason: "Enter an amount in USD." };
  // Half a cent of slack: `Max` prints the held value at 2dp.
  if (parsed > heldUsd + 0.005) return { ok: false, reason: `You hold ${fmtUsdFull(heldUsd)} in this vault.` };
  return { ok: true };
}

/** The share value the rail records at: attested for the live record. */
function railShareValue(vault: VaultRecord, sv: number): number {
  if (vault.slug !== HERO_SLUG) return sv;
  return heroNavPerShare() ?? sv;
}

export default function DepositRail({
  vault,
  sv: svProp,
  positions,
  tvlUsd,
  onDeposited,
  onWithdrawn,
}: {
  vault: VaultRecord;
  sv: number;
  positions: PositionRecord[];
  /** Current TVL (base + recorded deposits): the capacity is tested against
   *  what the vault already holds, not against an empty book. */
  tvlUsd: number;
  onDeposited: (amountUsd: number) => void;
  onWithdrawn?: (amountUsd: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const [depositing, setDepositing] = useState(false);
  const [justDeposited, setJustDeposited] = useState<number | null>(null);
  const [writeFailed, setWriteFailed] = useState(false);
  const [wAmount, setWAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [justWithdrew, setJustWithdrew] = useState<number | null>(null);
  const [wFailed, setWFailed] = useState(false);
  const dismissTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const attested = vault.slug === HERO_SLUG;
  const sv = railShareValue(vault, svProp);
  const parsed = Number(amount);
  const ceiling = depositCeiling(vault, tvlUsd);
  const stop = evaluate(amount, parsed, ceiling);
  const valid = stop.ok;
  const amt = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  // The projection card sells on arrival: empty input renders a $1,000
  // example, snapping to the typed amount on the first keystroke. The
  // example never exceeds what the vault can actually take.
  const exampleBasis = ceiling.maxUsd !== null ? Math.min(1000, Math.max(MIN_DEPOSIT_USD, ceiling.maxUsd)) : 1000;
  const basis = amt > 0 ? amt : exampleBasis;
  // Dollars at the published rate are earned on the principal actually
  // deployed: the deposit net of its one-time settlement fee (E.10).
  const deployed = depositAfterSettlement(basis);

  const apyOk = apyDisplayable(vault);
  const apy = vault.modeledApy;
  const negative = apyOk && apy < 0;
  // Quick keys only offer amounts the vault can actually absorb.
  const quick = [1000, 5000, 25000].filter(
    (v) => v >= MIN_DEPOSIT_USD && (ceiling.maxUsd === null || v <= ceiling.maxUsd),
  );

  const myDeposited = positions.reduce((s, p) => s + p.amountUsd, 0);
  const myValue = positions.reduce((s, p) => s + (p.amountUsd / p.shareValueAtDeposit) * sv, 0);
  const myPnl = myValue - myDeposited;
  const pnlFlat = Math.abs(myPnl) < 0.005;
  /* The Projection card's own head. Through `recordVenueParts` so this row
     and the configuration panel's `Venue` row can never name two vaults; on a
     routed record the label alone says `Multi-venue` and the split reads that
     as the chain too. */
  const { venue, chain } = recordVenueParts(vault);

  const wParsed = Number(wAmount);
  const wStop = evaluateWithdraw(wAmount, wParsed, myValue);
  const wValid = wStop.ok;

  const deposit = () => {
    if (!valid || depositing) return;
    setDepositing(true);
    setWriteFailed(false);
    setTimeout(() => {
      // The store returns null when the write did not land (private mode,
      // quota). A deposit that was not recorded is never reported as one.
      const written = addPosition({
        vaultSlug: vault.slug,
        vaultName: vault.name,
        amountUsd: parsed,
        shareValueAtDeposit: sv,
        depositedAt: new Date().toISOString(),
      });
      setDepositing(false);
      if (!written) {
        setWriteFailed(true);
        return;
      }
      setJustDeposited(parsed);
      setAmount("");
      onDeposited(parsed);
      // The green band is a moment, not a state: CSS fades it at 4.8s,
      // React removes it at DEPOSIT_CONFIRMATION_MS.
      dismissTimers.current.push(setTimeout(() => setJustDeposited(null), DEPOSIT_CONFIRMATION_MS));
    }, ARM_MS);
  };

  const withdraw = () => {
    if (!wValid || withdrawing) return;
    setWithdrawing(true);
    setWFailed(false);
    setTimeout(() => {
      // Redeem at the share value this rail prints, never above what is held.
      const amountUsd = Math.min(wParsed, myValue);
      const left = withdrawPosition(vault.slug, amountUsd);
      setWithdrawing(false);
      if (left === null) {
        setWFailed(true);
        return;
      }
      setJustWithdrew(amountUsd);
      setWAmount("");
      onWithdrawn?.(amountUsd);
      dismissTimers.current.push(setTimeout(() => setJustWithdrew(null), DEPOSIT_CONFIRMATION_MS));
    }, ARM_MS);
  };

  const noteLine =
    ceiling.maxUsd !== null && !ceiling.full
      ? `Mock deposit, executes instantly. ${fmtUsdFull(MIN_DEPOSIT_USD)} to ${fmtUsdFull(ceiling.maxUsd)}.`
      : `Mock deposit, executes instantly. Minimum ${fmtUsdFull(MIN_DEPOSIT_USD)}.`;

  return (
    <div className="vxd-rail-in">
      <div className="vx-panel">
        <div className="vx-panel-h">Deposit</div>
        {myValue > 0 ? (
          <div className="vx-pos" key={positions.length}>
            <i>Your position</i>
            <b>{fmtUsdFull(myValue)}</b>
          </div>
        ) : null}
        {justDeposited !== null ? (
          <div className="vx-dep-done" key={`d${positions.length}`}>
            <b>Deposited {fmtUsdFull(justDeposited)}</b>
            <span>
              Position recorded at share value {sv.toFixed(4)}. Track it in{" "}
              <a href="/portfolio">your portfolio</a>.
            </span>
          </div>
        ) : null}
        {justWithdrew !== null ? (
          <div className="vx-dep-done" key={`w${positions.length}`}>
            <b>Withdrew {fmtUsdFull(justWithdrew)}</b>
            <span>Position updated at share value {sv.toFixed(4)}.</span>
          </div>
        ) : null}
        {quick.length > 0 ? (
          <div className="vx-dep-quick">
            {quick.map((v) => (
              <button key={v} type="button" onClick={() => setAmount(String(v))}>
                ${v.toLocaleString("en-US")}
              </button>
            ))}
          </div>
        ) : null}
        <div className="vx-dep-row">
          <input
            className="vx-dep-input"
            inputMode="decimal"
            placeholder="Amount, USD"
            value={amount}
            disabled={ceiling.full}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") deposit();
            }}
          />
          <button type="button" className="vx-dep-btn" disabled={!valid || depositing} onClick={deposit}>
            {depositing ? "Depositing…" : "Deposit"}
          </button>
        </div>
        {/* The reason travels with the dead key. A disabled control that
            states nothing is the failure ProgressRail already fixed on the
            canvas; the deposit rail carries the same rule. */}
        {!stop.ok && stop.reason ? <div className="vx-dep-note">{stop.reason}</div> : null}
        {writeFailed ? (
          <div className="vx-dep-note">
            This deposit was not recorded: browser storage refused the write. Nothing was charged and no
            position exists. Try again, or open this page outside private browsing.
          </div>
        ) : null}
        <div className="vx-dep-note">{noteLine}</div>
      </div>

      <div className="vx-panel">
        <div className="vx-panel-h">Projection</div>
        <div className="vxj-row">
          <span>Venue</span>
          <b>
            {venue} · {chain}
          </b>
        </div>
        <div className="vxj-row">
          <span>Deposit amount</span>
          <b>{amt > 0 ? fmtUsdFull(amt) : `${fmtUsdFull(exampleBasis)} example`}</b>
        </div>
        {ceiling.capacityUsd !== null ? (
          <div className="vxj-row">
            <span>Remaining capacity</span>
            <b>{fmtUsdFull(ceiling.remainingUsd ?? 0)}</b>
          </div>
        ) : null}
        {/* DL-4: the deposit box's range ("$100.00 to $X") and this card used
            to print two unexplained dollars for one question: remaining
            capacity, and 90% of it (`SINGLE_DEPOSIT_UTILIZATION`, a single
            ticket never claims the last slice of the book). Both quantities
            now appear here, each under its own name, off the ONE `ceiling`
            this file computes, so the max the box enforces is the max this
            card states, byte for byte. */}
        {ceiling.maxUsd !== null && !ceiling.full ? (
          <div className="vxj-row">
            <span>Max single deposit</span>
            <b>{fmtUsdFull(ceiling.maxUsd)}</b>
          </div>
        ) : null}
        <div className="vxj-row">
          <span>Modeled APY</span>
          <b className={negative ? "vx-pnl neg" : undefined}>{apyOk ? fmtPct(apy) : "Not modeled"}</b>
        </div>
        {apyOk ? (
          <>
            {/* The settlement fee is charged once on the deposit and never
                inside a rate (`lib/canvas/fees.ts`): the dollars below are
                earned on the principal that is actually deployed. */}
            <div className="vxj-row">
              <span>Settlement fee, 2% of the deposit</span>
              <b>{fmtUsdFull(settlementFeeUsd(basis))}</b>
            </div>
            <div className="vxj-row">
              <span>Deployed</span>
              <b>{fmtUsdFull(deployed)}</b>
            </div>
            <div className="vxj-row">
              <span>{negative ? "Projected monthly change" : "Projected monthly earnings"}</span>
              <b className={negative ? "vx-pnl neg" : undefined}>{fmtUsdFull(deployed * monthlyRate(apy))}</b>
            </div>
            <div className="vxj-row vxj-row--lead">
              <span>{negative ? "Projected yearly change" : "Projected yearly earnings"}</span>
              <b className={negative ? "vx-pnl neg" : undefined}>{fmtUsdFull(deployed * apy)}</b>
            </div>
          </>
        ) : null}
        <div className="vx-dep-note">
          {apyOk
            ? "At the current modeled rate, on the deposit net of its settlement fee."
            : "This vault's composition never priced, so no rate is projected here."}
        </div>
      </div>

      {positions.length > 0 ? (
        <div className="vx-panel">
          <div className="vx-panel-h">Your position</div>
          <div className="vxj-row">
            <span>Deposited</span>
            <b>{fmtUsdFull(myDeposited)}</b>
          </div>
          <div className="vxj-row">
            <span>Share value now</span>
            <b>{sv.toFixed(4)}</b>
          </div>
          <div className="vxj-row">
            <span>Current value</span>
            <b>{fmtUsdFull(myValue)}</b>
          </div>
          <div className="vxj-row">
            <span>{attested ? "P&L" : "Modeled P&L"}</span>
            <b className={pnlFlat ? "vx-pnl flat" : myPnl > 0 ? "vx-pnl pos" : "vx-pnl neg"}>
              {pnlFlat ? "" : myPnl > 0 ? "+" : ""}
              {fmtUsdFull(pnlFlat ? 0 : myPnl)}
            </b>
          </div>

          {/* THE EXIT (WP4.9). Ghost register: the rail's one loud beat is
              Deposit. One quick key, an input, no minimum. The position is
              redeemed at the share value printed above, through
              `withdrawPosition`, and the ledger gains the row. */}
          <div className="vx-panel-h" style={{ marginTop: 14 }}>
            Withdraw
          </div>
          <div className="vx-dep-quick">
            <button type="button" onClick={() => setWAmount(myValue.toFixed(2))}>
              Max
            </button>
          </div>
          <div className="vx-dep-row">
            <input
              className="vx-dep-input"
              inputMode="decimal"
              placeholder="Amount, USD"
              value={wAmount}
              onChange={(e) => setWAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") withdraw();
              }}
            />
            <button
              type="button"
              className="vx-cta vx-cta--ghost"
              disabled={!wValid || withdrawing}
              onClick={withdraw}
            >
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </button>
          </div>
          {!wStop.ok && wStop.reason ? <div className="vx-dep-note">{wStop.reason}</div> : null}
          {wFailed ? (
            <div className="vx-dep-note">
              This withdrawal was not recorded: browser storage refused the write. Your position is
              unchanged. Try again, or open this page outside private browsing.
            </div>
          ) : null}
          {/* The sentence is read from `fees.withdrawalLine(record)`, the same
              string the record's schedule row prints, so the page and the
              record cannot answer the exit question two ways. */}
          <div className="vx-dep-note">
            {positions.length === 1 ? "1 deposit" : `${positions.length} deposits`} in this vault, tracked in
            your portfolio. Withdrawal: {withdrawalLine(vault)}.
          </div>
        </div>
      ) : null}
    </div>
  );
}
