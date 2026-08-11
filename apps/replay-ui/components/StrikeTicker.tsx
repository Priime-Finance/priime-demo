/**
 * StrikeTicker — the last N strikes as a scrolling strip of hardware tabs.
 *
 * One cell per strike: ordinal, outcome, NAV against the deployed baseline,
 * and the quorum that carried it. Clicking a cell parks the inspector on that
 * strike. The newest cell is the one currently in flight.
 *
 * Presentation only; every value arrives preformatted.
 */

/** Outcome register for a ticker cell. */
export type StrikeTone = "ok" | "warn" | "live";

/** One strike in the strip. */
export interface StrikeTickerItem {
  /** `Journal.strike_id`; the selection key. */
  strikeId: string;
  /** Ordinal label, e.g. `"#012"`. */
  ordinal: string;
  /** Outcome word, e.g. `"settled"` / `"stalled"`. */
  status: string;
  /** NAV as a signed percentage of the deployed baseline. */
  navPct: string;
  /** Quorum line, e.g. `"2-of-3"`. */
  quorum: string;
  /** Colour register. */
  tone: StrikeTone;
  /** True for the strike currently in flight. */
  live: boolean;
}

export interface StrikeTickerProps {
  /** Cells, newest first. */
  items: readonly StrikeTickerItem[];
  /** Currently inspected strike id, or null. */
  selected: string | null;
  /** Inspect a strike. */
  onSelect: (strikeId: string) => void;
  /** Test hook. */
  testId?: string;
}

/** The recent-strikes strip. */
export function StrikeTicker({
  items,
  selected,
  onSelect,
  testId,
}: StrikeTickerProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <p className="ticker__empty" data-testid={testId}>
        Waiting for the first strike.
      </p>
    );
  }

  return (
    <div className="ticker" data-testid={testId}>
      <div className="ticker__rail">
        {items.map((item) => (
          <button
            key={item.strikeId}
            type="button"
            className="ticker__cell"
            data-tone={item.tone}
            data-live={String(item.live)}
            aria-pressed={selected === item.strikeId}
            onClick={() => onSelect(item.strikeId)}
            data-testid={
              testId === undefined ? undefined : `${testId}-${item.ordinal.replace("#", "")}`
            }
          >
            <span className="ticker__ordinal">{item.ordinal}</span>
            <span className="ticker__nav">{item.navPct}</span>
            <span className="ticker__meta">
              {item.status} · {item.quorum}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
