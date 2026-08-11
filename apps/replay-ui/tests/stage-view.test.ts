/**
 * The page's whole derivation, driven off real simulated strikes rather than
 * synthetic view models. The claims that matter here are the ones a presenter
 * would be embarrassed by: a stalled strike must not report weight it never
 * accumulated, an honest node in a stalled strike must not be called
 * "rejected", and the quorum note must never quote a count that is still
 * climbing.
 */
import { describe, expect, it } from "vitest";

import { demoEnvironment } from "@/lib/environment";
import { buildTimeline, deriveReplayState, REPLAY_PACING } from "@/lib/replay";
import { initialSimState, nextStrike, type SimState } from "@/lib/simulate";
import { buildStageView, type StageInput } from "@/lib/stage-view";

const REGISTRY = demoEnvironment.registry.operators;

/** Switch positions to override, when they differ from the ones the run used. */
interface FrameOverrides {
  /**
   * The switch positions *now*. Pass it to model a flip made while the strike
   * is still on screen: switches moved, journal did not.
   */
  liveCorrupt?: readonly string[];
  /**
   * The positions the strike is *known* to have run under. Pass `[]` to model
   * a source that does not record who lied, which is what a real journal is.
   */
  strikeCorrupt?: readonly string[];
}

/**
 * Run `count` strikes with `corrupt` flipped, and derive the frame at `tMs`.
 *
 * Both switch sets default to `corrupt`, the honest case where nothing has been
 * touched since the strike fired.
 */
function frame(
  corrupt: readonly string[],
  tMs: number,
  count = 1,
  overrides: FrameOverrides = {},
): ReturnType<typeof buildStageView> {
  const liveCorrupt = overrides.liveCorrupt ?? corrupt;
  const strikeCorrupt = overrides.strikeCorrupt ?? corrupt;
  let state: SimState = initialSimState(7, 1_760_000_000, corrupt);
  let journal = nextStrike(state).journal;
  for (let i = 1; i < count; i += 1) {
    const result = nextStrike(state);
    journal = result.journal;
    state = result.state;
  }
  const timeline = buildTimeline(journal);
  const input: StageInput = {
    registry: REGISTRY,
    journal,
    timeline,
    state: deriveReplayState(journal, tMs, timeline),
    tMs,
    sim: state,
    corrupt: new Set(liveCorrupt.map((id) => id.toLowerCase())),
    strikeCorrupt: new Set(strikeCorrupt.map((id) => id.toLowerCase())),
    reducedMotion: false,
    history: [journal],
  };
  return buildStageView(input);
}

const NODE_2 = REGISTRY[1]!.id.toLowerCase();
const NODE_3 = REGISTRY[2]!.id.toLowerCase();

describe("buildStageView", () => {
  it("draws one view per registered operator, in registry order", () => {
    const view = frame([], 20_000);
    expect(view.operators.map((operator) => operator.label)).toEqual(
      REGISTRY.map((entry) => entry.label),
    );
    expect(view.operators.map((operator) => operator.index)).toEqual([
      "// 01",
      "// 02",
      "// 03",
    ]);
  });

  it("settles an honest strike with every node accepted and no note", () => {
    const view = frame([], 20_000);
    expect(view.stalled).toBe(false);
    expect(view.quorumNote).toBeUndefined();
    expect(view.excludedWeight).toBe(0);
    expect(view.attestation.landed).toBe(true);
    expect(view.operators.every((operator) => operator.lamp === "accepted")).toBe(true);
  });

  it("excludes one liar and quotes the THRESHOLD, not the running count", () => {
    const view = frame([NODE_3], 20_000);
    expect(view.stalled).toBe(false);
    expect(view.excludedWeight).toBe(1);
    expect(view.quorumNote).toContain("the honest 2-of-3 settles the truth");
  });

  it("never says 0-of-3 mid-collection, at any point in the strike", () => {
    // The bug this replaces interpolated the live cumulative, so a frame taken
    // before the second honest submission read "the honest 0-of-3 settles the
    // truth" while the ladder above it said otherwise.
    for (let tMs = 0; tMs <= 20_000; tMs += 250) {
      const note = frame([NODE_3], tMs).quorumNote;
      if (note === undefined) continue;
      expect(note).not.toMatch(/the honest [01]-of-/);
    }
  });

  it("stalls on two liars: no weight, nothing attested, honest node not slandered", () => {
    const view = frame([NODE_2, NODE_3], 20_000);
    expect(view.stalled).toBe(true);
    // No bucket won, so no weight ever entered the bar — not "the biggest
    // losing bucket happened to hold 1".
    expect(view.quorumWeight).toBe(0);
    expect(view.chain.quorum).toBe("0-of-3");
    expect(view.chain.quorumWord).toBe("Not reached");
    expect(view.attestation.landed).toBe(false);
    expect(view.attestation.txHash).toBeNull();

    const lamps = new Map(view.operators.map((operator) => [operator.id.toLowerCase(), operator.lamp]));
    expect(lamps.get(REGISTRY[0]!.id.toLowerCase())).toBe("stalled");
    expect(lamps.get(NODE_2)).toBe("rejected");
    expect(lamps.get(NODE_3)).toBe("rejected");
    expect(view.quorumNote).toContain("stalled and nothing was attested");
  });

  it("leaves the honest slot out of the excluded weight when a strike stalls", () => {
    // Nobody is accepted in a stalled strike, so reading "not accepted" put all
    // three weights in the alarm register — including the node the operator
    // panel draws amber. The bar and the panel have to agree about the same
    // node in the same frame.
    const view = frame([NODE_2, NODE_3], 20_000);
    expect(view.stalled).toBe(true);
    expect(view.quorumWeight).toBe(0);
    expect(view.excludedWeight).toBe(2);
  });

  it("drains the bar rather than accusing everyone when no liar is known", () => {
    // What a stalled strike off a real journal looks like: three hashes, no
    // winner, and nothing in the record naming the honest node. Empty is true
    // and blames nobody; all-red would be neither.
    const view = frame([NODE_2, NODE_3], 20_000, 1, { strikeCorrupt: [] });
    expect(view.stalled).toBe(true);
    expect(view.excludedWeight).toBe(0);
    expect(view.quorumWeight).toBe(0);
  });

  it("keeps a mid-strike flip out of the strike already on screen", () => {
    // A flip takes effect from the NEXT strike. Reading the live switches here
    // relabelled honest node-1 "rejected" over a journal that shows it did
    // nothing wrong, and named it in the note as having diverged.
    const view = frame([NODE_2, NODE_3], 20_000, 1, {
      liveCorrupt: [REGISTRY[0]!.id.toLowerCase(), NODE_2, NODE_3],
    });

    const lamps = new Map(view.operators.map((operator) => [operator.id.toLowerCase(), operator.lamp]));
    expect(lamps.get(REGISTRY[0]!.id.toLowerCase())).toBe("stalled");
    expect(view.quorumNote).not.toContain(REGISTRY[0]!.label);
    expect(view.quorumNote).toContain(REGISTRY[1]!.label);
    expect(view.quorumNote).toContain(REGISTRY[2]!.label);
  });

  it("still draws the flipped switch as on, even mid-strike", () => {
    // The switch is the one thing that must track the live set: it renders its
    // own position, not the strike's.
    const view = frame([], 20_000, 1, { liveCorrupt: [NODE_3] });
    const switches = new Map(
      view.operators.map((operator) => [operator.id.toLowerCase(), operator.corrupt]),
    );
    expect(switches.get(NODE_3)).toBe(true);
    expect(switches.get(NODE_2)).toBe(false);
    // ...while the strike beneath it still reads as the clean strike it was.
    expect(view.stalled).toBe(false);
    expect(view.excludedWeight).toBe(0);
  });

  it("blanks every readout before the strike triggers", () => {
    const view = frame([], 0);
    expect(view.operators.every((operator) => operator.hash === "awaiting")).toBe(true);
    expect(view.operators.every((operator) => operator.navPct === "--.--%")).toBe(true);
    expect(view.chain.txLabel).toBe("awaiting");
    expect(view.chain.navLine).toBe("NAV pending");
  });

  it("fans a read pulse out to every operator the instant the strike triggers", () => {
    // Three independent reads of the same position at the same block, so all
    // three wires light together at exactly the same progress.
    const reading = frame([], REPLAY_PACING.leadInMs).pulses.filter((pulse) =>
      pulse.edgeId.startsWith("read:"),
    );
    expect(reading).toHaveLength(REGISTRY.length);
    expect(reading.every((pulse) => pulse.tone === "read")).toBe(true);
    expect(new Set(reading.map((pulse) => pulse.progress))).toEqual(new Set([0]));
  });

  it("builds the rail from the fixture, one row per node", () => {
    const view = frame([], 20_000);
    expect(view.peers).toHaveLength(REGISTRY.length);
    expect(view.peers.every((peer) => peer.connected === "2 peers")).toBe(true);
    expect(view.registryRows).toHaveLength(REGISTRY.length);
    expect(view.registryTotals).toBe("3 operators · total weight 3");
  });

  it("is total with no strike at all", () => {
    const view = buildStageView({
      registry: REGISTRY,
      journal: null,
      timeline: null,
      state: null,
      tMs: 0,
      sim: initialSimState(7, 0),
      corrupt: new Set(),
      strikeCorrupt: new Set(),
      reducedMotion: false,
      history: [],
    });
    expect(view.pulses).toEqual([]);
    expect(view.ticker).toEqual([]);
    expect(view.quorumNote).toBeUndefined();
    expect(view.chain.quorum).toBe("0-of-3");
    // The vault sat spinning here: with no timeline the trigger fell back to 0,
    // so `tMs >= triggerAtMs` was trivially true and the SSR frame plus the
    // first client paint showed the door reading a position that did not exist.
    expect(view.vault.reading).toBe(false);
    expect(view.vault.tone).toBe("idle");
  });

  it("holds the vault idle right up to the trigger, then reads", () => {
    expect(frame([], 0).vault.reading).toBe(false);
    expect(frame([], REPLAY_PACING.leadInMs).vault.reading).toBe(true);
  });
});
