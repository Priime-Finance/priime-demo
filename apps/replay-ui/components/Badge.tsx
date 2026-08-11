/**
 * Badge — the kit's `primitives/Badge`: a mono UPPERCASE status pill.
 *
 * `bad` is the one variant the shipped kit does not carry. It uses `--lcd-red`,
 * the alarm hue the design system reserves for displays and indicators, because
 * a rejected hash is exactly that: an alarm on a readout.
 */
import type { ReactNode } from "react";

/** Status registers a badge can carry. */
export type BadgeTone = "neutral" | "ok" | "warn" | "bad" | "accent" | "ghost";

export interface BadgeProps {
  /** Status register. */
  tone?: BadgeTone;
  /** Show the leading status dot. */
  dot?: boolean;
  /** Test hook. */
  testId?: string;
  children: ReactNode;
}

/** A small status pill. */
export function Badge({
  tone = "neutral",
  dot = false,
  testId,
  children,
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={tone === "neutral" ? "badge" : `badge badge--${tone}`}
      data-testid={testId}
      data-tone={tone}
    >
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
