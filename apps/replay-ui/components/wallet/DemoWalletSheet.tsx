"use client";

/**
 * The demo wallet sheet. UI only: no address, no chain list, nothing signed.
 *
 * Mounted once in the root layout. It listens for `WALLET_OPEN_EVENT`, which
 * `useConnectModal().openConnectModal()` dispatches (lib/wallet.ts), so the
 * Review card's Connect wallet key and the portfolio's Connect key open it
 * through the same hook shape the live product reads from its connect kit.
 * Connect writes the flag through `connectDemoWallet()`, which announces
 * `WALLET_EVENT`; every `useAccount()` in the tree flips in place (the nav
 * reveals Portfolio, the Review key morphs to Publish vault) with no reload.
 * Not now and Escape close it and announce `WALLET_CLOSE_EVENT`, which is
 * what returns `connectModalOpen` to false for the card's own Escape handler.
 *
 * Material: the Review card's navy `.pf` card, carried in globals.css as
 * `.dws-*` so the sheet reads the same on /portfolio, where build.css is not
 * loaded. The backdrop takes both class names for the same reason.
 *
 * Focus: the primary key takes focus on open, Tab cycles inside the card,
 * and the element that opened the sheet gets focus back when it closes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { WALLET_CLOSE_EVENT, WALLET_OPEN_EVENT, connectDemoWallet } from "@/lib/wallet";

export function DemoWalletSheet() {
  const [open, setOpen] = useState(false);
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

  const close = useCallback((connected: boolean) => {
    setOpen(false);
    if (!connected) window.dispatchEvent(new Event(WALLET_CLOSE_EVENT));
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    back?.focus();
  }, []);

  const connect = useCallback(() => {
    connectDemoWallet();
    close(true);
  }, [close]);

  const dismiss = useCallback(() => close(false), [close]);

  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key !== "Tab") return;
      /* Two keys, one loop: Tab from the ghost returns to the primary and
         Shift+Tab from the primary lands on the ghost. */
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
  }, [open, dismiss]);

  if (!open) return null;

  return createPortal(
    <div
      className="bcrev-backdrop dws-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="dws" role="dialog" aria-modal="true" aria-labelledby="dws-kicker">
        <div className="dws-kicker" id="dws-kicker">
          Demo wallet
        </div>
        <p className="dws-line">Client state only. Nothing is signed.</p>
        <div className="dws-acts">
          <button ref={primaryRef} type="button" className="dws-connect" onClick={connect}>
            Connect
          </button>
          <button ref={ghostRef} type="button" className="dws-ghost" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
