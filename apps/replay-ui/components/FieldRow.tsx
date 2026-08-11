/**
 * FieldRow — the kit's `primitives/Field` in a read-only register: mono label,
 * a recessed well showing the value, and a help line under it.
 *
 * Beat 1 is scripted config, not a form the presenter fills in, so the value
 * is a static well rather than an input: no focus ring, no validation theater.
 */
export interface FieldRowProps {
  /** Field label. */
  label: string;
  /** Preformatted value, e.g. `"5.0x"`. */
  value: string;
  /** One-line rationale under the label. */
  help: string;
  /** Test hook. */
  testId?: string;
}

/** One read-only parameter row. */
export function FieldRow({ label, value, help, testId }: FieldRowProps): React.JSX.Element {
  return (
    <div className="fieldrow" data-testid={testId}>
      <span className="fieldrow__label">{label}</span>
      <span className="fieldrow__value" data-testid={testId === undefined ? undefined : `${testId}-value`}>
        {value}
      </span>
      <span className="fieldrow__help">{help}</span>
    </div>
  );
}
