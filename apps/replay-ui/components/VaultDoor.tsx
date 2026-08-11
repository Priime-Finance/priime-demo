/**
 * VaultDoor — the centrepiece, drawn as an SVG bank-vault door in the kit's
 * hardware idiom: a machined bezel, a recessed face, twelve rim bolts, two
 * hinges, a spoke handle, and a single status lamp.
 *
 * It follows the register rather than the LCD rule: black steel on the dark
 * chassis, brushed aluminium on the light one, because a vault door is
 * hardware, not a readout. The lamp and the small display inset are the only
 * places colour is allowed.
 *
 * Presentation only. Every value arrives preformatted; the wheel spins when
 * `reading` is true and the lamp register comes from `tone`.
 */

/** Status registers the lamp can carry. */
export type VaultTone = "idle" | "reading" | "settled" | "stalled";

const LAMP: Readonly<Record<VaultTone, string>> = {
  idle: "var(--status-ok)",
  reading: "var(--o-500)",
  settled: "var(--status-ok)",
  stalled: "var(--status-warn)",
};

export interface VaultDoorProps {
  /** Door radius in canvas user units. */
  radius: number;
  /** Lamp register. */
  tone: VaultTone;
  /** Spin the handle: a strike is reading the position. */
  reading: boolean;
  /** Suppress the spin and the lamp pulse. */
  reducedMotion: boolean;
  /** Mono caption engraved under the handle, e.g. `"NAV +0.42%"`. */
  caption: string;
  /** Second engraved line, e.g. `"HF 1.17"`. */
  subCaption: string;
}

/** Twelve rim bolts, evenly spaced. */
const BOLTS = Array.from({ length: 12 }, (_unused, index) => (index * 360) / 12);

/** Four handle spokes at 45 degrees. */
const SPOKES = [0, 45, 90, 135];

/** The vault door. Renders as an SVG group centred on the origin. */
export function VaultDoor({
  radius,
  tone,
  reading,
  reducedMotion,
  caption,
  subCaption,
}: VaultDoorProps): React.JSX.Element {
  const boltRing = radius - 16;
  const face = radius - 12;
  const hub = Math.max(13, radius * 0.16);
  // Short enough that the engraved plate below the hub stays clear of the
  // handle: the readout is part of the door, not a label pasted over it.
  const spoke = face * 0.42;
  const plate = {
    x: -radius * 0.62,
    y: radius * 0.4,
    width: radius * 1.24,
    height: radius * 0.34,
  };
  const lamp = LAMP[tone];

  return (
    <g className="vaultdoor" data-tone={tone}>
      {/* Hinges, always on the left, so the door reads as a door. */}
      {[-0.42, 0.42].map((offset) => (
        <rect
          key={offset}
          className="vaultdoor__hinge"
          x={-radius - 14}
          y={radius * offset - 13}
          width={22}
          height={26}
          rx={4}
        />
      ))}

      {/* Bezel, face, engraved ring. */}
      <circle className="vaultdoor__bezel" r={radius} />
      <circle className="vaultdoor__face" r={face} />
      <circle className="vaultdoor__ring" r={radius - 26} />

      {BOLTS.map((angle) => (
        <circle
          key={angle}
          className="vaultdoor__bolt"
          r={2.6}
          cx={boltRing * Math.cos((angle * Math.PI) / 180)}
          cy={boltRing * Math.sin((angle * Math.PI) / 180)}
        />
      ))}

      {/* Spoke handle. Spins only while the position is being read. */}
      <g
        className={
          reading && !reducedMotion ? "vaultdoor__wheel vaultdoor__wheel--turning" : "vaultdoor__wheel"
        }
      >
        {SPOKES.map((angle) => (
          <rect
            key={angle}
            className="vaultdoor__spoke"
            x={-spoke}
            y={-3}
            width={spoke * 2}
            height={6}
            rx={3}
            transform={`rotate(${angle})`}
          />
        ))}
        <circle className="vaultdoor__hub" r={hub} />
        <circle className="vaultdoor__hubcap" r={hub - 5} />
      </g>

      {/* Status lamp, top of the door. */}
      <g transform={`translate(0 ${-radius + 30})`}>
        <circle
          className={reducedMotion ? "lamp" : "lamp lamp--breathing"}
          r={5}
          style={{ fill: lamp }}
        />
      </g>

      {/* The door's own readout, recessed into the face below the handle. */}
      <rect
        className="lcd"
        x={plate.x}
        y={plate.y}
        width={plate.width}
        height={plate.height}
        rx={5}
      />
      <text
        className="vaultdoor__caption"
        x={0}
        y={plate.y + plate.height * 0.46}
        textAnchor="middle"
        data-testid="vault-door-nav"
      >
        {caption}
      </text>
      <text
        className="vaultdoor__sub"
        x={0}
        y={plate.y + plate.height * 0.84}
        textAnchor="middle"
      >
        {subCaption}
      </text>
    </g>
  );
}
