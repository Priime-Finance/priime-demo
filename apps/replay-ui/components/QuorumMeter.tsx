/**
 * QuorumMeter — the kit's `data/BarMeter` idiom (bars as texture on a screen)
 * turned into a weight ladder: one segment per registered weight, lit as the
 * quorum fills, green the moment the threshold is crossed.
 *
 * A weight that submitted but was not accepted never enters the bar. Its
 * segment is drawn hatched and outlined in alarm red, so "settled without the
 * saboteur" is visible rather than inferred.
 */
import { Badge } from "@/components/Badge";
import { Metric, Screen } from "@/components/Screen";

export interface QuorumMeterProps {
  /** Weight required to settle. */
  threshold: number;
  /** Total registered weight. */
  total: number;
  /** Weight accumulated over the winning hash so far. */
  cumulative: number;
  /** True once a transition with `reached` has fired. */
  reached: boolean;
  /** Weights that submitted and were not accepted (never enter the bar). */
  excluded: number;
  /** Caption under the ladder, e.g. the "settled without node-3" line. */
  note?: string;
  /**
   * Badge copy when quorum was not reached. Defaults to `"Collecting"`, which
   * is only true while a strike is open; a finished strike passes
   * `"Not reached"` so a stalled run does not read as still in progress.
   */
  unreachedLabel?: string;
  /** Test hook. */
  testId?: string;
}

/** Segment register, left to right. */
type SegmentKind = "lit" | "reached" | "excluded" | "empty";

/** Which register each weight slot is in. */
function segmentKinds(
  total: number,
  cumulative: number,
  excluded: number,
  reached: boolean,
): readonly SegmentKind[] {
  return Array.from({ length: total }, (_unused, index): SegmentKind => {
    if (index < cumulative) return reached ? "reached" : "lit";
    if (index >= total - excluded) return "excluded";
    return "empty";
  });
}

/** The quorum ladder. */
export function QuorumMeter({
  threshold,
  total,
  cumulative,
  reached,
  excluded,
  note,
  unreachedLabel = "Collecting",
  testId,
}: QuorumMeterProps): React.JSX.Element {
  const kinds = segmentKinds(total, cumulative, excluded, reached);

  return (
    <Screen label="Quorum · signed weight over the winning hash" scanlines>
      <div className="quorum">
        <div
          className="quorum__bar"
          role="meter"
          aria-valuenow={cumulative}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Quorum weight"
          data-testid={testId}
          data-cumulative={cumulative}
          data-reached={String(reached)}
        >
          {kinds.map((kind, index) => (
            <span
              // Segments are fixed positions in the ladder, not a reorderable list.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className={`quorum__seg quorum__seg--${kind}`}
              data-kind={kind}
            />
          ))}
        </div>
        <div className="quorum__scale">
          <span>Threshold {threshold}-of-{total}</span>
          <span>{total} registered</span>
        </div>
        <div className="op__foot">
          <Metric
            value={`${cumulative}-of-${total}`}
            label="Accumulated weight"
            tone={reached ? "ok" : cumulative > 0 ? "lcd" : "idle"}
            medium
            testId={testId === undefined ? undefined : `${testId}-count`}
          />
          <Badge tone={reached ? "ok" : "ghost"} dot={reached}>
            {reached ? "Quorum reached" : unreachedLabel}
          </Badge>
        </div>
        {note === undefined ? null : <p className="caption caption--quiet">{note}</p>}
      </div>
    </Screen>
  );
}
