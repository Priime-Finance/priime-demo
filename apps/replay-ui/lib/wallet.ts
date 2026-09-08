"use client";

/**
 * The mock wallet. UI only: no wallet library, no chain, no address.
 *
 * Connected state is one localStorage flag and one window event, read behind
 * the same two hook shapes the live product reads from its wallet library and
 * connect kit (`useAccount`, `useConnectModal`), so `SiteNav`, `PublishFlow`
 * and `PortfolioView` keep their live call sites byte for byte. Jakub's
 * Providers + ConnectButton replace this file; nothing else moves.
 *
 * SSR-safe: the server render and the first client render are disconnected;
 * the flag is read in an effect. Every storage access is wrapped, so a
 * private window or blocked storage reads as disconnected rather than
 * throwing.
 */

import { useCallback, useEffect, useState } from "react";

export const WALLET_KEY = "priime:demo-wallet";
export const WALLET_EVENT = "priime:demo-wallet-changed";
/** Dispatched by `openConnectModal`; the demo wallet sheet listens. */
export const WALLET_OPEN_EVENT = "priime:demo-wallet-open";
/** Dispatched by the sheet when it closes without connecting (Not now, Esc). */
export const WALLET_CLOSE_EVENT = "priime:demo-wallet-close";

function readConnected(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WALLET_KEY) === "1";
  } catch {
    return false;
  }
}

/** Write the flag and announce it. The sheet calls this on Connect. */
export function connectDemoWallet(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WALLET_KEY, "1");
  } catch {
    // storage blocked: the event still flips the session, the next load forgets
  }
  window.dispatchEvent(new Event(WALLET_EVENT));
}

export type AccountStatus = "connected" | "disconnected";

export interface DemoAccount {
  isConnected: boolean;
  /** Never an address in this build: nothing is signed. */
  address: undefined;
  status: AccountStatus;
}

export function useAccount(): DemoAccount {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const sync = () => setConnected(readConnected());
    sync();
    window.addEventListener(WALLET_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WALLET_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return {
    isConnected: connected,
    address: undefined,
    status: connected ? "connected" : "disconnected",
  };
}

export interface DemoConnectModal {
  openConnectModal: () => void;
  connectModalOpen: boolean;
}

/** Shape of RainbowKit's hook as `PublishFlow.tsx:258` reads it. */
export function useConnectModal(): DemoConnectModal {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onClose = () => setOpen(false);
    window.addEventListener(WALLET_OPEN_EVENT, onOpen);
    window.addEventListener(WALLET_CLOSE_EVENT, onClose);
    window.addEventListener(WALLET_EVENT, onClose);
    return () => {
      window.removeEventListener(WALLET_OPEN_EVENT, onOpen);
      window.removeEventListener(WALLET_CLOSE_EVENT, onClose);
      window.removeEventListener(WALLET_EVENT, onClose);
    };
  }, []);
  const openConnectModal = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(WALLET_OPEN_EVENT));
  }, []);
  return { openConnectModal, connectModalOpen: open };
}
