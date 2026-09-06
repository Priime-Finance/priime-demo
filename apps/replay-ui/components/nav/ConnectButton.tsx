"use client";

import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";

import { ConnectModal } from "./ConnectModal";

/** Short 0x1234...abcd address for display. */
function shortAddress(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  if (isConnected && address !== undefined) {
    return (
      <button
        type="button"
        className="nav-connect nav-connect--on"
        onClick={() => {
          disconnect();
        }}
        title="Disconnect"
      >
        {shortAddress(address)}
      </button>
    );
  }
  return (
    <>
      <button type="button" className="nav-connect" onClick={() => setOpen(true)}>
        Connect
      </button>
      {open ? <ConnectModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
