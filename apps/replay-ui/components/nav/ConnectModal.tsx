"use client";

/**
 * Wallet-picker modal, invoked from `SiteNav`'s Connect button.
 *
 * Direct port of `priime-pools-frontend/vault/components/ConnectModal.tsx`
 * (styling adapted to the vault CSS tokens). Portals to `document.body` so
 * the sticky nav's backdrop-filter never traps the modal off-screen.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useConnect } from "wagmi";

export function ConnectModal({ onClose }: { onClose: () => void }) {
  const { connectors, connect, isPending, error } = useConnect();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className="wc-bg" onClick={onClose} role="dialog" aria-modal="true">
      <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
        <button className="wc-x" aria-label="Close" type="button" onClick={onClose}>
          x
        </button>
        <div className="wc-h">Connect</div>
        <h3 className="wc-t">Pick a wallet</h3>
        {connectors.length === 0 ? (
          <p className="wc-empty">No injected wallets detected in this browser.</p>
        ) : (
          connectors.map((c) => (
            <button
              key={c.uid}
              type="button"
              className="wc-row"
              disabled={isPending}
              onClick={() => {
                connect({ connector: c }, { onSuccess: () => onClose() });
              }}
            >
              <span>{c.name}</span>
              <span className="wc-arrow">-&gt;</span>
            </button>
          ))
        )}
        {error !== null && error !== undefined ? (
          <div className="wc-err">{error.message.split("\n")[0]}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
