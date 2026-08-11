/**
 * Chip — the kit's `primitives/Chip` as a labelled pill. Renders as an anchor
 * when `href` is set (explorer deep link) and as plain text when it is null,
 * so an unknown chain never produces a dead link.
 */
export interface ChipProps {
  /** Mono UPPERCASE prefix, e.g. `"VAULT"`. */
  label?: string;
  /** The value, usually a truncated address or hash. */
  value: string;
  /** Explorer URL, or null for "no explorer for this chain". */
  href?: string | null;
  /** Accessible label for the link. */
  title?: string;
  /** Test hook. */
  testId?: string;
}

/** A labelled pill, optionally deep-linked. */
export function Chip({
  label,
  value,
  href = null,
  title,
  testId,
}: ChipProps): React.JSX.Element {
  const body = (
    <>
      {label !== undefined ? <span className="chip__label">{label}</span> : null}
      <span>{value}</span>
      {href !== null ? (
        <span className="chip__arrow" aria-hidden="true">
          ↗
        </span>
      ) : null}
    </>
  );

  if (href === null) {
    return (
      <span className="chip" data-testid={testId} title={title}>
        {body}
      </span>
    );
  }

  return (
    <a
      className="chip"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      data-testid={testId}
      title={title}
    >
      {body}
    </a>
  );
}
