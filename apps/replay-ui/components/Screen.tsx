/**
 * Screen — the kit's `data/Screen`: a recessed true-black LCD field with an
 * inner shadow and optional scanlines. The only surface in this app allowed to
 * carry the LCD micro-palette.
 *
 * `Readout` is one label/value line inside a screen; `Metric` is the large mono
 * number. Both live here because they only ever appear on a screen.
 */
import type { ReactNode } from "react";

/** Status dot register on a screen head. */
export type ScreenTone = "ok" | "warn" | "bad" | "live" | "idle";

const TONE_COLOR: Readonly<Record<ScreenTone, string>> = {
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  bad: "var(--status-bad)",
  live: "var(--o-500)",
  idle: "var(--text-faint)",
};

export interface ScreenProps {
  /** Mono micro-label, top left. */
  label?: string;
  /** Status readout, top right. */
  status?: string;
  /** Tint of the status dot and text. */
  tone?: ScreenTone;
  /** Overlay CRT scanlines. */
  scanlines?: boolean;
  /** Test hook. */
  testId?: string;
  children?: ReactNode;
}

/** A recessed LCD field. */
export function Screen({
  label,
  status,
  tone = "idle",
  scanlines = false,
  testId,
  children,
}: ScreenProps): React.JSX.Element {
  return (
    <div className="screen" data-testid={testId}>
      {scanlines ? <span className="screen__scan" aria-hidden="true" /> : null}
      <div className="screen__inner">
        {label === undefined && status === undefined ? null : (
          <div className="screen__head">
            <span className="screen__label">{label}</span>
            {status === undefined ? null : (
              <span className="screen__status" style={{ color: TONE_COLOR[tone] }}>
                <i aria-hidden="true" />
                {status}
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Value register for a readout line. */
export type ReadoutTone = "normal" | "dim" | "ok" | "bad";

export interface ReadoutProps {
  /** Mono UPPERCASE label. */
  label: string;
  /** The value; already formatted by the caller. */
  value: string;
  /** Value register. */
  tone?: ReadoutTone;
  /** Render the value at hash weight (bigger, semibold). */
  hash?: boolean;
  /** Test hook. */
  testId?: string;
}

/** One label/value line inside a `Screen`. */
export function Readout({
  label,
  value,
  tone = "normal",
  hash = false,
  testId,
}: ReadoutProps): React.JSX.Element {
  const classes = [
    "readout__value",
    tone === "normal" ? null : `readout__value--${tone}`,
    hash ? "readout__value--hash" : null,
  ]
    .filter((value_): value_ is string => value_ !== null)
    .join(" ");

  return (
    <div className="readout">
      <span className="readout__label">{label}</span>
      <span className={classes} data-testid={testId} data-tone={tone}>
        {value}
      </span>
    </div>
  );
}

/** Colour register for a metric. */
export type MetricTone = "lcd" | "ok" | "bad" | "idle";

export interface MetricProps {
  /** The number, preformatted by the caller. */
  value: string;
  /** Unit suffix, tinted. */
  unit?: string;
  /** Mono micro-label above. */
  label?: string;
  /** Mono micro caption below. */
  caption?: string;
  /** Colour register. */
  tone?: MetricTone;
  /** Render at the mid size (26px) instead of the 42px metric scale. */
  medium?: boolean;
  /** Test hook. */
  testId?: string;
}

/** A large mono numeric readout. Numbers over adjectives. */
export function Metric({
  value,
  unit,
  label,
  caption,
  tone = "lcd",
  medium = false,
  testId,
}: MetricProps): React.JSX.Element {
  const classes = [
    "metric__value",
    tone === "lcd" ? null : `metric__value--${tone}`,
    medium ? "metric__value--md" : null,
  ]
    .filter((value_): value_ is string => value_ !== null)
    .join(" ");

  return (
    <div>
      {label === undefined ? null : <div className="metric__label">{label}</div>}
      <div className={classes} data-testid={testId} data-tone={tone}>
        {value}
        {unit === undefined ? null : <span className="metric__unit">{unit}</span>}
      </div>
      {caption === undefined ? null : <div className="metric__caption">{caption}</div>}
    </div>
  );
}
