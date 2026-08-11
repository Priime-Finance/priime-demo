/**
 * Panel — the kit's `layout/Panel` in its `tone="dark"` register: a plate with
 * a mono micro-label head, an optional orange slash-index, and a body.
 *
 * Presentation only. No engine imports live in this file (or any component in
 * this directory); the page derives every value and passes it down.
 */
import type { ReactNode } from "react";

export interface PanelProps {
  /** Mono UPPERCASE micro-label shown in the head. */
  title?: string;
  /** Slash index, e.g. `"// 02"`. Carries the orange accent. */
  index?: string;
  /** One-line framing under the head. */
  kicker?: string;
  /** Controls docked to the right of the head (badges, buttons). */
  actions?: ReactNode;
  /** Tighter padding for rail panels. */
  tight?: boolean;
  /** Extra class names for layout. */
  className?: string;
  /** Test hook. */
  testId?: string;
  children: ReactNode;
}

/** A neumorphic plate that holds one region of the console. */
export function Panel({
  title,
  index,
  kicker,
  actions,
  tight = false,
  className,
  testId,
  children,
}: PanelProps): React.JSX.Element {
  const classes = ["panel", tight ? "panel--tight" : null, className]
    .filter((value): value is string => value !== null && value !== undefined)
    .join(" ");

  return (
    <section className={classes} data-testid={testId}>
      {title === undefined && actions === undefined ? null : (
        <header className="panel__head">
          {title !== undefined ? <h2 className="panel__title">{title}</h2> : null}
          {index !== undefined ? <span className="panel__idx">{index}</span> : null}
          {actions !== undefined ? <div className="panel__actions">{actions}</div> : null}
        </header>
      )}
      {kicker !== undefined ? <p className="panel__kicker">{kicker}</p> : null}
      {children}
    </section>
  );
}
