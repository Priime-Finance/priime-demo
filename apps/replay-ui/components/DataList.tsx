/**
 * DataList — a stack of hairline-separated label/value rows, the rail's
 * workhorse (strike facts, registry entries, peer counts). Mono throughout,
 * dashed registration rules between rows.
 */
export interface DataRow {
  /** Stable key. */
  key: string;
  /** Mono UPPERCASE label. */
  label: string;
  /** Preformatted value. */
  value: string;
  /** Tint the value with the status green. */
  ok?: boolean;
  /** Full value for the title attribute, when the shown one is truncated. */
  title?: string;
}

export interface DataListProps {
  /** Rows in display order. */
  rows: readonly DataRow[];
  /** Test hook. */
  testId?: string;
}

/** A label/value stack. */
export function DataList({ rows, testId }: DataListProps): React.JSX.Element {
  return (
    <div className="datalist" data-testid={testId}>
      {rows.map((row) => (
        <div className="datarow" key={row.key}>
          <span className="datarow__label">{row.label}</span>
          <span
            className={row.ok === true ? "datarow__value datarow__value--ok" : "datarow__value"}
            title={row.title}
            data-testid={testId === undefined ? undefined : `${testId}-${row.key}`}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
