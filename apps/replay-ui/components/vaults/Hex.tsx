"use client";

/**
 * One-line copyable hex: the truncated display users already see, plus
 * the full string on hover (native `title`) and a one-click copy. The
 * middle-truncated form (`0x1234…abcd`) is what a scan reads at a
 * glance; the full string is what a developer needs to search, paste
 * into a block explorer, or drop into a config. Before this component
 * the full address existed nowhere on the vault page and the display
 * was the only path to the datum.
 *
 * Copy uses `navigator.clipboard.writeText` where available; falls back
 * to a hidden `<textarea>` + `document.execCommand("copy")` for
 * environments (older Safari, some in-app browsers) that gate the async
 * API behind a permission prompt. Both paths are user-gesture-scoped.
 *
 * `full` is the ONLY source of truth: `display` defaults to
 * `truncateHash(full, lead, tail)` so a call site cannot show one
 * string and copy another.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { truncateHash } from "@/lib/format";

const COPIED_HOLD_MS = 1_100;

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the sync fallback */
    }
  }
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "absolute";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function Hex({
  full,
  lead = 6,
  tail = 4,
  display,
}: {
  full: string;
  lead?: number;
  tail?: number;
  display?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = useCallback(async () => {
    const ok = await copyToClipboard(full);
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_HOLD_MS);
  }, [full]);

  const shown = display ?? truncateHash(full, lead, tail);

  return (
    <button
      type="button"
      className={`vx-hex${copied ? " vx-hex--copied" : ""}`}
      title={copied ? "Copied" : full}
      aria-label={`Copy ${full}`}
      onClick={() => void onClick()}
    >
      <span className="vx-hex-val">{shown}</span>
      <span className="vx-hex-badge" aria-hidden="true">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}
