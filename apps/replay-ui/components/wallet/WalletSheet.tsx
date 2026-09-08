"use client";

/**
 * The connect sheet. Antoni's card, wagmi's connect.
 *
 * Mounted once in the root layout. It listens for `WALLET_OPEN_EVENT`, which
 * `useConnectModal().openConnectModal()` dispatches (lib/wallet.ts), so the
 * Review card's Connect wallet key and the portfolio's Connect key open it
 * through the same hook shape the live product reads from its connect kit.
 *
 * This replaces `DemoWalletSheet`, which kept its own connected flag in the
 * browser and announced it with an event. The card,
 * its `.dws-*` material and its focus behaviour are unchanged; the primary
 * key is now one row per injected connector, and picking one runs wagmi's
 * `connect`. On success every `useAccount()` in the tree flips in place (the
 * nav reveals Portfolio, the Review key morphs to Publish vault) with no
 * reload, exactly as before.
 *
 * Jakub's `ConnectModal` supplied this mechanism. Its markup is not carried:
 * it styled itself with `.wc-*` rules that lived in `app/vault/directory.css`,
 * which the merge deleted along with the rest of the old vault tree, and the
 * product has one wallet card rather than two.
 *
 * Focus: the first row takes focus on open, Tab cycles inside the card, and
 * the element that opened the sheet gets focus back when it closes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnect } from "wagmi";

import { WALLET_CLOSE_EVENT, WALLET_OPEN_EVENT } from "@/lib/wallet";

export function WalletSheet() {
  const [open, setOpen] = useState(false);
  const { connectors, connect, isPending, error } = useConnect();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const ghostRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onOpen = () => {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement ? active : null;
      setOpen(true);
    };
    window.addEventListener(WALLET_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(WALLET_OPEN_EVENT, onOpen);
  }, []);

  /* Always announced, connected or not: `connectModalOpen` is what the
     Review card's Escape handler reads, and a sheet that connected without
     saying so would leave the card believing it is still covered. */
  const close = useCallback(() => {
    setOpen(false);
    window.dispatchEvent(new Event(WALLET_CLOSE_EVENT));
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    back?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      /* One loop across the card: Tab from the ghost returns to the first
         row and Shift+Tab from the first row lands on the ghost. */
      const first = primaryRef.current;
      const last = ghostRef.current;
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    <div
      className="bcrev-backdrop dws-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="dws" role="dialog" aria-modal="true" aria-labelledby="dws-kicker">
        <div className="dws-kicker" id="dws-kicker">
          Connect a wallet
        </div>
        <p className="dws-line">
          {connectors.length === 0
            ? "No wallet extension detected in this browser. Install one, then reopen this sheet."
            : "Your key signs the publish and becomes the vault's exit key. Nothing else is signed."}
        </p>
        <div className="dws-acts">
          {connectors.map((c, i) => (
            <button
              key={c.uid}
              ref={i === 0 ? primaryRef : undefined}
              type="button"
              className="dws-connect"
              disabled={isPending}
              onClick={() => {
                connect({ connector: c }, { onSuccess: () => close() });
              }}
            >
              {c.name}
            </button>
          ))}
          {error !== null ? <p className="dws-err">{error.message.split("\n")[0]}</p> : null}
          <button
            ref={connectors.length === 0 ? primaryRef : ghostRef}
            type="button"
            className="dws-ghost"
            onClick={close}
          >
            Not now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
