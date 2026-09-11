"use client";

/**
 * DepositCard: the user surface for depositing USDC into a live loop's
 * vault and watching the operator quorum attest the escrow into shares.
 *
 * The card owns three transitions the user walks through in order:
 *
 *   1. NOT CONNECTED → the primary CTA opens the wallet sheet.
 *   2. CONNECTED, no pending, no claimable → an amount input plus a single
 *      button that morphs between `Approve USDC` and `Deposit`. The card
 *      auto-picks the right one from the current `allowance`, and after an
 *      approve settles it flips to Deposit without user action.
 *   3. PENDING → the amount input is hidden; the card names how much is
 *      escrowed and reminds that the next strike will fold it in. The
 *      LiveLoopDetail poll surfaces the strike; the card's own poll
 *      surfaces the escrow-to-claimable transition.
 *   4. CLAIMABLE → a single `Claim shares` button that mints the ERC-4626
 *      shares to the user.
 *
 * ONE SET OF CALLS. All three writes (approve, requestDeposit, deposit)
 * share the same tx-state machine below: `useWriteContract` + a status
 * banner that stays until the receipt lands. Consequences:
 *   - The button is disabled while any in-flight write is unconfirmed.
 *   - `useWaitForTransactionReceipt` drives a `refetch()` on the reading
 *     hook whenever the receipt lands, so balances update without a
 *     manual page action.
 *   - The banner names the tx hash; on a chain with an explorer we link
 *     it, on the fork we just show the hash.
 *
 * Never uses `previewDeposit` / `previewMint` — the vault reverts on those
 * because ERC-7540 forbids sync previews. Share-count estimates for the
 * input branch come from `nav / supply` here, and the user's actual mint
 * ratio is fixed at the attested NAV of the fulfilling strike.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";

import { useAccount, useConnectModal } from "@/lib/wallet";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";

import {
  ERC20_ABI,
  VAULT_ABI,
  formatAssetAmount,
  parseAssetAmount,
  useDepositReading,
} from "@/lib/vaults/deposit";
import { cadenceText } from "./live-loop";
import { friendlyErrorMessage } from "@/lib/errors";

interface DepositCardProps {
  handlerAddress: Address;
  /**
   * True once the operator quorum has settled at least one strike on this
   * vault. Before that a `requestDeposit` still works but the escrow only
   * unlocks with the first strike; the copy leans on that.
   */
  hasSettledStrike: boolean;
  /**
   * Strike cadence in seconds, from `loop-server`'s config. Used only for
   * the "folded into NAV on the next strike (about every N s / min)" line
   * above the input, so a reader knows roughly when their escrow settles.
   * `null` on a loop with no cadence recorded yet.
   */
  cronSeconds: number | null;
}

/** Human-shaped states the card renders. */
type Phase =
  | { kind: "disconnected" }
  | { kind: "ready"; needsApproval: boolean }
  | { kind: "pending" }
  | { kind: "claimable" };

/** Explorer URL for a settled tx, or null on chains with no explorer. */
function explorerTxUrl(chainId: number, txHash: string): string | null {
  switch (chainId) {
    case 8453:
      return `https://basescan.org/tx/${txHash}`;
    case 84532:
      return `https://sepolia.basescan.org/tx/${txHash}`;
    default:
      return null;
  }
}

export default function DepositCard({ handlerAddress, hasSettledStrike, cronSeconds }: DepositCardProps) {
  const { address: user, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();

  const reading = useDepositReading(handlerAddress);
  const decimals = reading.assetDecimals;
  const symbol = reading.assetSymbol ?? "USDC";

  const [rawAmount, setRawAmount] = useState("");
  // Sanitise: strip whitespace, accept comma-decimal (European locales),
  // drop leading `+`. Parser stays strict; sanitising here means one
  // canonical string reaches every consumer of `rawAmount`.
  const setAmountFromInput = useCallback((value: string) => {
    setRawAmount(value.trim().replace(",", ".").replace(/^\+/, ""));
  }, []);
  const parsedAmount = useMemo(
    () => (decimals === null ? null : parseAssetAmount(rawAmount, decimals)),
    [rawAmount, decimals],
  );

  // Write plumbing. One hook drives all three tx types; the tx hash + a
  // `kind` label ("approve" | "deposit" | "claim") is what the banner
  // reads to name the receipt.
  const write = useWriteContract();
  const [pendingWrite, setPendingWrite] = useState<{ kind: "approve" | "deposit" | "claim" } | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  // Whenever a receipt lands, clear the write, refetch the reading (so the
  // UI reflects the new allowance / pending / claimable / share balance)
  // and stop showing the banner for the next tx.
  useEffect(() => {
    if (!receipt.isSuccess) return;
    reading.refetch();
    setPendingWrite(null);
    if (pendingWrite?.kind === "deposit") setRawAmount("");
  }, [receipt.isSuccess, pendingWrite?.kind, reading]);

  // Latch the last known non-null phase so a rate-limited RPC batch that
  // momentarily fails does not regress the card from `claimable` back to
  // `ready` (which would hide the Claim button for a poll cycle). The ref
  // holds only positive-signal transitions; when a later read explicitly
  // returns 0 for both pending and claimable, the card flips to `ready`.
  const lastKnownPhase = useRef<Phase | null>(null);
  const phase: Phase = useMemo(() => {
    if (!isConnected || user === undefined) return { kind: "disconnected" };
    const claim = reading.claimableAssets;
    const pend = reading.pendingAssets;
    let next: Phase;
    if (claim !== null && claim > 0n) next = { kind: "claimable" };
    else if (pend !== null && pend > 0n) next = { kind: "pending" };
    else if (claim === null && pend === null && lastKnownPhase.current !== null) {
      // Both reads failed this cycle; keep last known phase rather than
      // false-transitioning to `ready`.
      return lastKnownPhase.current;
    } else {
      const needsApproval = parsedAmount !== null && (reading.walletAllowance ?? 0n) < parsedAmount;
      next = { kind: "ready", needsApproval };
    }
    lastKnownPhase.current = next;
    return next;
  }, [isConnected, user, reading.claimableAssets, reading.pendingAssets, reading.walletAllowance, parsedAmount]);

  const onApprove = useCallback(() => {
    if (parsedAmount === null) return;
    setPendingWrite({ kind: "approve" });
    write.writeContract({
      address: reading.asset!,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [handlerAddress, parsedAmount],
    });
  }, [parsedAmount, reading.asset, handlerAddress, write]);

  const onDeposit = useCallback(() => {
    if (parsedAmount === null || user === undefined) return;
    setPendingWrite({ kind: "deposit" });
    write.writeContract({
      address: handlerAddress,
      abi: VAULT_ABI,
      functionName: "requestDeposit",
      args: [parsedAmount, user, user],
    });
  }, [parsedAmount, user, handlerAddress, write]);

  const onClaim = useCallback(() => {
    if (
      user === undefined
      || reading.claimableAssets === null
      || reading.claimableAssets === 0n
    ) return;
    setPendingWrite({ kind: "claim" });
    write.writeContract({
      address: handlerAddress,
      abi: VAULT_ABI,
      functionName: "deposit",
      args: [reading.claimableAssets, user],
      // Hard-code gas so MetaMask/Blockaid does not run its own simulator
      // and flag the ERC-7540 deposit-as-claim pattern as suspicious. Real
      // cost measured on Base mainnet: ~65k gas; 200k is a generous ceiling
      // that leaves headroom without over-refunding.
      gas: 200_000n,
    });
  }, [user, reading.claimableAssets, handlerAddress, write]);

  const overWallet = parsedAmount !== null && reading.walletAssets !== null && parsedAmount > reading.walletAssets;
  // Gate on `decimals !== null`: while the batch is still loading it
  // cannot possibly parse the amount, and rendering the "must be a
  // decimal" hint on a perfectly legal `5` was the reported UX bug.
  const inputInvalid = rawAmount !== "" && decimals !== null && parsedAmount === null;
  const isBreached = (reading.breachFlags ?? 0) !== 0;
  const disableInputActions = pendingWrite !== null || receipt.isLoading || isBreached;

  // Shared for the panel body: the banner. Also handles the "the receipt
  // failed" case so a reverted tx does not appear as a permanent spinner.
  const banner = pendingWrite === null && receipt.isError === false
    ? null
    : (() => {
        const txHash = write.data;
        const url = txHash !== undefined && chainId !== undefined ? explorerTxUrl(chainId, txHash) : null;
        if (receipt.isError) {
          return (
            <p className="vxd-dep-banner vxd-dep-banner--err">
              Transaction failed: {friendlyErrorMessage(receipt.error)}
            </p>
          );
        }
        const label = pendingWrite?.kind === "approve" ? "Approving USDC…" : pendingWrite?.kind === "deposit" ? "Escrowing your deposit…" : "Claiming your shares…";
        return (
          <p className="vxd-dep-banner">
            {label}
            {txHash === undefined ? null : url === null ? <> · <code>{txHash.slice(0, 10)}…{txHash.slice(-8)}</code></> : (
              <>
                {" · "}
                <a href={url} target="_blank" rel="noreferrer">view tx</a>
              </>
            )}
          </p>
        );
      })();

  if (phase.kind === "disconnected") {
    return (
      <div className="vx-panel vxd-dep">
        <div className="vx-panel-h">Deposit USDC</div>
        <p className="vxd-desc">
          Deposit into this vault to see your own dollars attested by the operator quorum. The
          deposit escrows into the vault and folds into NAV on the next strike.
        </p>
        <button type="button" className="vxd-dep-cta" onClick={openConnectModal}>
          Connect wallet
        </button>
      </div>
    );
  }

  if (phase.kind === "pending") {
    return (
      <div className="vx-panel vxd-dep">
        <div className="vx-panel-h">Deposit pending</div>
        <p className="vxd-desc">
          <b>{formatAssetAmount(reading.pendingAssets ?? 0n, decimals ?? 6)} {symbol}</b> escrowed. The
          next strike folds it into NAV and mints your shares; the ledger below shows when.
        </p>
        {banner}
      </div>
    );
  }

  if (phase.kind === "claimable") {
    return (
      <div className="vx-panel vxd-dep">
        <div className="vx-panel-h">Shares ready to claim</div>
        <p className="vxd-desc">
          The quorum settled your deposit at{" "}
          <b>{formatAssetAmount(reading.claimableAssets ?? 0n, decimals ?? 6)} {symbol}</b>{" "}
          → <b>{formatAssetAmount(reading.claimableShares ?? 0n, decimals ?? 6)} pvUSDC</b>. Claim to
          mint the shares to your wallet.
        </p>
        <p className="vxd-desc vxd-desc--note">
          Your wallet will label this transaction as <code>deposit</code>. That is the
          ERC-7540 claim selector — <b>no additional USDC leaves your wallet</b>; the vault
          already holds the {formatAssetAmount(reading.claimableAssets ?? 0n, decimals ?? 6)} {symbol} you escrowed at request time, and this call just mints your shares against it.
        </p>
        <button
          type="button"
          className="vxd-dep-cta"
          onClick={onClaim}
          disabled={disableInputActions}
        >
          Claim shares
        </button>
        {banner}
      </div>
    );
  }

  // phase.kind === "ready"
  const shareBalanceLine =
    reading.walletShares === null || reading.walletShares === 0n
      ? null
      : (
        <p className="vxd-desc vxd-desc--note">
          You already hold <b>{formatAssetAmount(reading.walletShares, decimals ?? 6)} pvUSDC</b> in
          this vault.
        </p>
      );

  return (
    <div className="vx-panel vxd-dep">
      <div className="vx-panel-h">Deposit USDC</div>
      <p className="vxd-desc">
        {hasSettledStrike
          ? `Your deposit escrows into the vault and is folded into NAV on the next attested strike${
              cronSeconds === null ? "." : ` (${cadenceText(cronSeconds)}).`
            }`
          : "The vault has not settled a strike yet. Your deposit will escrow and fold into NAV as soon as the operator quorum lands its first attestation."}
      </p>
      <div className="vxd-dep-row">
        <label htmlFor="deposit-amount" className="vxd-dep-lbl">
          Amount
        </label>
        <input
          id="deposit-amount"
          className="vxd-dep-input"
          inputMode="decimal"
          placeholder="0.00"
          value={rawAmount}
          onChange={(e) => setAmountFromInput(e.target.value)}
          disabled={disableInputActions}
        />
        <span className="vxd-dep-unit">{symbol}</span>
        <button
          type="button"
          className="vxd-dep-max"
          disabled={
            disableInputActions
            || reading.walletAssets === null
            || reading.walletAssets === 0n
            || decimals === null
          }
          onClick={() => {
            if (reading.walletAssets === null || decimals === null) return;
            setRawAmount(formatAssetAmount(reading.walletAssets, decimals, decimals));
          }}
        >
          Max
        </button>
      </div>
      <p className="vxd-desc vxd-desc--note">
        Wallet balance:{" "}
        {reading.walletAssets === null
          ? "…"
          : `${formatAssetAmount(reading.walletAssets, decimals ?? 6)} ${symbol}`}
      </p>
      {shareBalanceLine}
      {inputInvalid ? (
        <p className="vxd-dep-err">
          Amount must be a decimal like 5 or 12.34 (up to {decimals ?? 6} places after the dot).
        </p>
      ) : overWallet ? (
        <p className="vxd-dep-err">Amount exceeds your wallet balance.</p>
      ) : null}
      {isBreached ? (
        <p className="vxd-dep-err">
          Vault is under a strategist-configured breach (flags {reading.breachFlags}) — new
          deposits are blocked until the next clean strike. Existing claims are unaffected.
        </p>
      ) : null}
      {/*
        Two-step flow surfaced as two buttons instead of one morphing label so
        the user sees BOTH signatures coming (approve, then deposit) before
        they start. Enablement follows `phase.needsApproval`: the button that
        will actually fire lights up, the other greys. Same disable rules as
        the single-button version so nothing lets the user tap through when
        the input is invalid, the wallet is short, or the vault is breached.
       */}
      <div className="vxd-dep-cta-row">
        <button
          type="button"
          className="vxd-dep-cta"
          onClick={onApprove}
          disabled={
            disableInputActions
            || !phase.needsApproval
            || parsedAmount === null
            || parsedAmount === 0n
            || overWallet
          }
          title="Grant the vault permission to move USDC on your behalf (one-time per amount)."
        >
          1. Approve {symbol}
        </button>
        <button
          type="button"
          className="vxd-dep-cta"
          onClick={onDeposit}
          disabled={
            disableInputActions
            || phase.needsApproval
            || parsedAmount === null
            || parsedAmount === 0n
            || overWallet
          }
          title="Escrow the approved USDC and queue a deposit request. Fulfilled on the next attested strike."
        >
          2. Deposit
        </button>
      </div>
    </div>
  );
}
