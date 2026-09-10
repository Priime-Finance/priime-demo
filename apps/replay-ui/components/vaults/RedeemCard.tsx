/**
 * Withdraw / redeem card for a live PriimeVault.
 *
 * ERC-7540 mirror of the DepositCard flow:
 *   1. NOT CONNECTED -> hidden (parent renders the deposit-side connect CTA).
 *   2. HAS SHARES + no pending + no claimable -> input for how many shares
 *      to redeem, single button that fires `requestRedeem(shares, you, you)`
 *      and escrows the shares in the vault.
 *   3. PENDING -> the request is queued, awaiting the next attested strike
 *      to fold NAV into a claimable USDC amount.
 *   4. CLAIMABLE -> button that fires `redeem(shares, you, you)`, returning
 *      the USDC to your wallet.
 *
 * Redemption reuses the same reading hook the DepositCard uses, so this
 * component pulls state without extra RPC pressure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { useAccount } from "@/lib/wallet";
import {
  formatAssetAmount,
  parseAssetAmount,
  useDepositReading,
  VAULT_ABI,
} from "@/lib/vaults/deposit";

interface RedeemCardProps {
  handlerAddress: Address;
}

type Phase =
  | { kind: "disconnected" }
  | { kind: "no-shares" }
  | { kind: "pending" }
  | { kind: "claimable" }
  | { kind: "ready" };

export default function RedeemCard({ handlerAddress }: RedeemCardProps) {
  const { address: user, isConnected } = useAccount();
  const reading = useDepositReading(handlerAddress);
  const decimals = reading.assetDecimals;
  const symbol = reading.assetSymbol ?? "USDC";
  const shareDecimals = decimals ?? 6;

  const [rawShares, setRawShares] = useState("");
  const setSharesFromInput = useCallback((value: string) => {
    setRawShares(value.trim().replace(",", ".").replace(/^\+/, ""));
  }, []);
  const parsedShares = useMemo(
    () => parseAssetAmount(rawShares, shareDecimals),
    [rawShares, shareDecimals],
  );

  const write = useWriteContract();
  const [pendingWrite, setPendingWrite] = useState<{ kind: "request" | "claim" } | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  useEffect(() => {
    if (!receipt.isSuccess) return;
    reading.refetch();
    setPendingWrite(null);
    if (pendingWrite?.kind === "request") setRawShares("");
  }, [receipt.isSuccess, pendingWrite?.kind, reading]);

  // Same latching pattern as DepositCard: a failed read this cycle should
  // not regress the card to `no-shares` and hide the claim CTA.
  const lastKnownPhase = useRef<Phase | null>(null);
  const phase: Phase = useMemo(() => {
    if (!isConnected || user === undefined) return { kind: "disconnected" };
    const claim = reading.claimableRedeemShares;
    const pend = reading.pendingShares;
    const held = reading.walletShares;
    let next: Phase;
    if (claim !== null && claim > 0n) next = { kind: "claimable" };
    else if (pend !== null && pend > 0n) next = { kind: "pending" };
    else if (claim === null && pend === null && lastKnownPhase.current !== null) return lastKnownPhase.current;
    else if (held !== null && held > 0n) next = { kind: "ready" };
    else next = { kind: "no-shares" };
    lastKnownPhase.current = next;
    return next;
  }, [isConnected, user, reading.claimableRedeemShares, reading.pendingShares, reading.walletShares]);

  const overShares = parsedShares !== null && reading.walletShares !== null && parsedShares > reading.walletShares;
  const inputInvalid = rawShares !== "" && parsedShares === null;
  const disableInputActions = pendingWrite !== null || receipt.isLoading;

  const onRequest = useCallback(() => {
    if (parsedShares === null || user === undefined) return;
    setPendingWrite({ kind: "request" });
    write.writeContract({
      address: handlerAddress,
      abi: VAULT_ABI,
      functionName: "requestRedeem",
      args: [parsedShares, user, user],
    });
  }, [parsedShares, user, handlerAddress, write]);

  const onClaim = useCallback(() => {
    if (
      user === undefined
      || reading.claimableRedeemShares === null
      || reading.claimableRedeemShares === 0n
    ) return;
    setPendingWrite({ kind: "claim" });
    write.writeContract({
      address: handlerAddress,
      abi: VAULT_ABI,
      functionName: "redeem",
      args: [reading.claimableRedeemShares, user, user],
      // Same rationale as the deposit-side claim: hard-code gas so
      // MetaMask/Blockaid does not run its own simulator and flag the
      // ERC-7540 redeem-as-claim pattern as suspicious.
      gas: 200_000n,
    });
  }, [user, reading.claimableRedeemShares, handlerAddress, write]);

  const banner = useMemo(() => {
    if (write.isPending) return <p className="vxd-dep-banner">Waiting for wallet…</p>;
    if (receipt.isLoading && write.data) {
      const label = pendingWrite?.kind === "claim" ? "Claiming your USDC…" : "Escrowing your redemption…";
      return (
        <p className="vxd-dep-banner">
          {label}{" "}
          <code>{write.data.slice(0, 10)}…</code>
        </p>
      );
    }
    if (write.error) return <p className="vxd-dep-banner vxd-dep-banner--err">{write.error.message}</p>;
    return null;
  }, [write.isPending, write.data, write.error, receipt.isLoading, pendingWrite?.kind]);

  if (phase.kind === "disconnected") return null;
  if (phase.kind === "no-shares") return null;

  if (phase.kind === "pending") {
    return (
      <div className="vx-panel vxd-dep">
        <div className="vx-panel-h">Redemption pending</div>
        <p className="vxd-desc">
          <b>{formatAssetAmount(reading.pendingShares ?? 0n, shareDecimals)} pvUSDC</b> escrowed.
          The next attested strike prices your shares at the settled NAV and moves the {symbol} to
          your claimable bucket.
        </p>
        {banner}
      </div>
    );
  }

  if (phase.kind === "claimable") {
    return (
      <div className="vx-panel vxd-dep">
        <div className="vx-panel-h">USDC ready to withdraw</div>
        <p className="vxd-desc">
          The quorum settled your redemption at{" "}
          <b>{formatAssetAmount(reading.claimableRedeemShares ?? 0n, shareDecimals)} pvUSDC</b>{" "}
          → <b>{formatAssetAmount(reading.claimableRedeemAssets ?? 0n, shareDecimals)} {symbol}</b>.
          Claim to move the {symbol} back to your wallet.
        </p>
        <p className="vxd-desc vxd-desc--note">
          Your wallet will label this transaction as <code>redeem</code>. That is the ERC-7540 claim
          selector on the redemption side — <b>no additional shares leave your wallet</b>; the vault
          already holds the pvUSDC you escrowed at request time, and this call just delivers the
          settled {symbol}.
        </p>
        <button
          type="button"
          className="vxd-dep-cta"
          onClick={onClaim}
          disabled={disableInputActions}
        >
          Claim {symbol}
        </button>
        {banner}
      </div>
    );
  }

  // phase.kind === "ready"
  return (
    <div className="vx-panel vxd-dep">
      <div className="vx-panel-h">Redeem shares</div>
      <p className="vxd-desc">
        Escrow shares into the vault; the next attested strike prices them at the settled NAV, and
        the {symbol} lands in your claimable bucket.
      </p>
      <div className="vxd-dep-row">
        <label htmlFor="redeem-amount" className="vxd-dep-lbl">
          Shares
        </label>
        <input
          id="redeem-amount"
          className="vxd-dep-input"
          inputMode="decimal"
          placeholder="0.00"
          value={rawShares}
          onChange={(e) => setSharesFromInput(e.target.value)}
          disabled={disableInputActions}
        />
        <span className="vxd-dep-unit">pvUSDC</span>
        <button
          type="button"
          className="vxd-dep-max"
          disabled={
            disableInputActions
            || reading.walletShares === null
            || reading.walletShares === 0n
          }
          onClick={() => {
            if (reading.walletShares === null) return;
            setRawShares(formatAssetAmount(reading.walletShares, shareDecimals, shareDecimals));
          }}
        >
          Max
        </button>
      </div>
      <p className="vxd-desc vxd-desc--note">
        Share balance:{" "}
        {reading.walletShares === null
          ? "…"
          : `${formatAssetAmount(reading.walletShares, shareDecimals)} pvUSDC`}
      </p>
      {inputInvalid ? (
        <p className="vxd-dep-err">
          Amount must be a decimal like 5 or 12.34 (up to {shareDecimals} places after the dot).
        </p>
      ) : overShares ? (
        <p className="vxd-dep-err">Amount exceeds your share balance.</p>
      ) : null}
      <button
        type="button"
        className="vxd-dep-cta"
        onClick={onRequest}
        disabled={disableInputActions || parsedShares === null || parsedShares === 0n || overShares}
      >
        Request redemption
      </button>
      {banner}
    </div>
  );
}
