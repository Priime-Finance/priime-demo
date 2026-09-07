"use client";

import { useEffect, useRef, useState } from "react";

/**
 * LiveNumber — wraps a numeric span with a 220ms crossfade whenever the value
 * changes. Per DESIGN_AUDIT M1, the dashboard auto-refreshes every 30s but
 * numbers swap instantly with no perceptual feedback; this atom adds the
 * "the data just updated" signal Apple's Stocks app uses.
 *
 * Usage:
 *   <LiveNumber value={tvlString}>{tvlString}</LiveNumber>
 *
 * The component keys on the `value` prop (string-cast) and remounts the
 * inner span on change. The `.crossfade` CSS class then runs its 220ms
 * ease-out from 0.7 → 1.0 opacity, defined in globals.css.
 *
 * Reduced-motion respected automatically — the @media block in globals.css
 * disables the keyframe in prefers-reduced-motion.
 *
 * Why a wrapper rather than `key={value}` on the inline span: we want to
 * skip the crossfade on first render (the page just loaded — no update
 * happened) but run it on every subsequent value change.
 */
export function LiveNumber({
  value,
  children,
  className,
}: {
  value: string | number | bigint;
  children?: React.ReactNode;
  className?: string;
}) {
  const [renderKey, setRenderKey] = useState(0);
  const prevValue = useRef<string | null>(null);

  // Coerce to a stable string key.
  const valStr = typeof value === "bigint" ? value.toString() : String(value);

  useEffect(() => {
    if (prevValue.current !== null && prevValue.current !== valStr) {
      setRenderKey((k) => k + 1);
    }
    prevValue.current = valStr;
  }, [valStr]);

  return (
    <span key={renderKey} className={`crossfade ${className ?? ""}`}>
      {children ?? valStr}
    </span>
  );
}
