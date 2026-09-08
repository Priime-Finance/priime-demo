"use client";

/**
 * The wallet seam. Wagmi behind the hook shapes the UI already reads.
 *
 * This file used to be a mock: one localStorage flag, no chain, no address,
 * shaped so `SiteNav`, `PublishFlow`, `RackCanvas` and `PortfolioView` could
 * be written against the real product's call sites before a wallet existed.
 * It is now the adapter it was designed to become. Every consumer imports
 * from `@/lib/wallet` exactly as before; only this file changed.
 *
 * `useAccount` is wagmi's own, re-exported. Its return type is a superset of
 * the mock's (`address` is a real `0x…` once connected instead of always
 * `undefined`, and `status` carries wagmi's four states rather than two), so
 * no call site needed editing. Two consequences worth knowing:
 *
 *   - `RackCanvas` guards its draft persistence on `address` being truthy.
 *     Under the mock that branch was unreachable and `/api/canvas/draft` was
 *     never called. It is live now.
 *   - Any code that assumed `address === undefined` is wrong rather than
 *     merely unreachable. There is none at the time of writing.
 *
 * `useConnectModal` has no wagmi equivalent (it is RainbowKit's shape, which
 * is what the UI was written against). It keeps its two window events, so the
 * sheet stays mounted once in the root layout and any component in the tree
 * can open it without a context or a prop drill. `WalletSheet` is what
 * listens; it renders Antoni's card and connects through wagmi for real.
 */

import { useCallback, useEffect, useState } from "react";

export { useAccount, useDisconnect } from "wagmi";

/** Dispatched by `openConnectModal`; the wallet sheet listens. */
export const WALLET_OPEN_EVENT = "priime:wallet-open";
/** Dispatched by the sheet when it closes, connected or not. */
export const WALLET_CLOSE_EVENT = "priime:wallet-close";

export interface ConnectModalState {
  openConnectModal: () => void;
  connectModalOpen: boolean;
}

/**
 * Shape of RainbowKit's hook as `PublishFlow` and `PortfolioView` read it.
 * `connectModalOpen` exists so the Review card's own Escape handler can tell
 * "the sheet is over me" from "close the card".
 */
export function useConnectModal(): ConnectModalState {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onClose = () => setOpen(false);
    window.addEventListener(WALLET_OPEN_EVENT, onOpen);
    window.addEventListener(WALLET_CLOSE_EVENT, onClose);
    return () => {
      window.removeEventListener(WALLET_OPEN_EVENT, onOpen);
      window.removeEventListener(WALLET_CLOSE_EVENT, onClose);
    };
  }, []);
  const openConnectModal = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(WALLET_OPEN_EVENT));
  }, []);
  return { openConnectModal, connectModalOpen: open };
}

/** Short `0x1234…abcd`, for the nav pill. */
export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
