/**
 * Replay-engine tests. Driven by the two **real captures** in
 * schema/samples/ (imported through lib/journal.ts), never by synthetic
 * journals — the one exception is the "partial journal" case, which is a
 * *projection* of the settled capture: exactly the bytes a live poll would
 * have returned mid-strike.
 */
import { describe, expect, it } from "vitest";

import type { Journal } from "@priime-demo/journal-schema";

import { strikeSabotage, strikeSettled } from "@/lib/journal";
import {
  REPLAY_PACING,
  REPLAY_PHASE_RANK,
  buildTimeline,
  deriveReplayState,
  replayDurationMs,
  type ReplayEventKind,
} from "@/lib/replay";

const SABOTEUR_ID = "0x3333333333333333333333333333333333333333";

/** Mid-strike snapshot of the settled capture, as a live poll would return it. */
const partialSettled: Journal = {
  ...strikeSettled,
  status: "pending",
  operators: strikeSettled.operators.slice(0, 1),
  quorum: {
    ...strikeSettled.quorum,
    reached: false,
    winning_result_hash: null,
    transitions: strikeSettled.quorum.transitions.slice(0, 1),
  },
  attestation: {
    ...strikeSettled.attestation,
    tx_hash: null,
    block_number: null,
    nav_final: null,
    timestamp: null,
  },
};

describe("buildTimeline", () => {
  it("orders events trigger -> submission -> transition -> attestation (settled)", () => {
    const kinds = buildTimeline(strikeSettled).events.map((e) => e.kind);
    expect(kinds).toEqual<ReplayEventKind[]>([
      "trigger",
      "submission",
      "transition",
      "submission",
      "transition",
      "submission",
      "transition",
      "attestation",
    ]);
  });

  it("emits the saboteur's submission but no transition for it (sabotage)", () => {
    const { events } = buildTimeline(strikeSabotage);
    expect(events.map((e) => e.kind)).toEqual<ReplayEventKind[]>([
      "trigger",
      "submission",
      "transition",
      "submission",
      "transition",
      "submission",
      "attestation",
    ]);
    const transitionOperators = events
      .filter((e) => e.kind === "transition")
      .map((e) => (e.kind === "transition" ? e.transition.operator_id : ""));
    expect(transitionOperators).not.toContain(SABOTEUR_ID);
  });

  it("keeps submissions in journal timestamp order", () => {
    const stamps = buildTimeline(strikeSabotage)
      .events.filter((e) => e.kind === "submission")
      .map((e) => (e.kind === "submission" ? e.operator.timestamp : 0));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });

  it("respects the min/max gap window and strictly increases atMs", () => {
    for (const journal of [strikeSettled, strikeSabotage]) {
      const { events } = buildTimeline(journal);
      for (let i = 1; i < events.length; i += 1) {
        const gap = events[i]!.atMs - events[i - 1]!.atMs;
        expect(gap).toBeGreaterThanOrEqual(REPLAY_PACING.minGapMs);
        expect(gap).toBeLessThanOrEqual(REPLAY_PACING.maxGapMs);
      }
      expect(events[0]!.atMs).toBe(REPLAY_PACING.leadInMs);
    }
  });

  it("lands both captures inside the 15-25s demo target", () => {
    expect(replayDurationMs(strikeSettled)).toBe(17_200);
    expect(replayDurationMs(strikeSabotage)).toBe(15_000);
    for (const ms of [replayDurationMs(strikeSettled), replayDurationMs(strikeSabotage)]) {
      expect(ms).toBeGreaterThanOrEqual(15_000);
      expect(ms).toBeLessThanOrEqual(25_000);
    }
  });
});

describe("deriveReplayState — t=0 and t=infinity", () => {
  it("is empty at t=0", () => {
    const state = deriveReplayState(strikeSettled, 0);
    expect(state.phase).toBe("idle");
    expect(state.triggered).toBe(false);
    expect(state.operators).toHaveLength(0);
    expect(state.awaitingOperatorCount).toBe(3);
    expect(state.quorum.cumulative).toBe(0);
    expect(state.quorum.reached).toBe(false);
    expect(state.attestation.status).toBe("not-landed");
    expect(state.eventsFired).toBe(0);
    expect(state.lastEvent).toBeNull();
    expect(state.done).toBe(false);
  });

  it("clamps negative t to the t=0 state", () => {
    expect(deriveReplayState(strikeSettled, -5_000)).toEqual(
      deriveReplayState(strikeSettled, 0),
    );
  });

  it("is complete at t=Infinity (settled: 3/3 agreement, attestation landed)", () => {
    const state = deriveReplayState(strikeSettled, Number.POSITIVE_INFINITY);
    expect(state.done).toBe(true);
    expect(state.phase).toBe("complete");
    expect(state.progress).toBe(1);
    expect(state.operators).toHaveLength(3);
    expect(state.awaitingOperatorCount).toBe(0);
    expect(state.operators.every((o) => o.matchesWinningHash === true)).toBe(true);
    expect(state.quorum.cumulative).toBe(3);
    expect(state.quorum.reached).toBe(true);
    expect(state.attestation).toMatchObject({
      status: "landed",
      chainId: 8453,
      navFinal: "500000000",
      blockNumber: 49_480_003,
    });
  });

  it("is pure: same journal and t always give the same state", () => {
    expect(deriveReplayState(strikeSabotage, 7_777)).toEqual(
      deriveReplayState(strikeSabotage, 7_777),
    );
  });
});

describe("deriveReplayState — monotonic progression", () => {
  it("never moves phase, operator count, quorum weight or events backwards", () => {
    for (const journal of [strikeSettled, strikeSabotage]) {
      const duration = replayDurationMs(journal);
      let phaseRank = -1;
      let operators = -1;
      let cumulative = -1;
      let events = -1;
      for (let t = 0; t <= duration + 500; t += 50) {
        const state = deriveReplayState(journal, t);
        expect(REPLAY_PHASE_RANK[state.phase]).toBeGreaterThanOrEqual(phaseRank);
        expect(state.operators.length).toBeGreaterThanOrEqual(operators);
        expect(state.quorum.cumulative).toBeGreaterThanOrEqual(cumulative);
        expect(state.eventsFired).toBeGreaterThanOrEqual(events);
        phaseRank = REPLAY_PHASE_RANK[state.phase];
        operators = state.operators.length;
        cumulative = state.quorum.cumulative;
        events = state.eventsFired;
      }
    }
  });

  it("passes through triggered -> collecting -> quorum-reached -> attested -> complete", () => {
    const duration = replayDurationMs(strikeSettled);
    const seen = new Set<string>();
    for (let t = 0; t <= duration; t += 25) {
      seen.add(deriveReplayState(strikeSettled, t).phase);
    }
    expect([...seen]).toEqual(
      expect.arrayContaining([
        "idle",
        "triggered",
        "collecting",
        "quorum-reached",
        "attested",
        "complete",
      ]),
    );
  });

  it("scrubbing backward returns the earlier state exactly", () => {
    const forward = deriveReplayState(strikeSettled, 4_000);
    deriveReplayState(strikeSettled, 16_000);
    expect(deriveReplayState(strikeSettled, 4_000)).toEqual(forward);
  });
});

describe("deriveReplayState — sabotage capture", () => {
  it("flags the divergent operator: accepted false, hash mismatched", () => {
    const state = deriveReplayState(strikeSabotage, Number.POSITIVE_INFINITY);
    const saboteur = state.operators.find((o) => o.id === SABOTEUR_ID);
    expect(saboteur).toBeDefined();
    expect(saboteur!.accepted).toBe(false);
    expect(saboteur!.matchesWinningHash).toBe(false);
    expect(saboteur!.result_hash).not.toBe(state.quorum.winningResultHash);
    expect(saboteur!.nav).toBe("750000000");
  });

  it("settles the honest 2-of-3 and never counts the saboteur toward quorum", () => {
    const state = deriveReplayState(strikeSabotage, Number.POSITIVE_INFINITY);
    expect(state.operators).toHaveLength(3);
    expect(state.operators.filter((o) => o.matchesWinningHash === true)).toHaveLength(2);
    expect(state.quorum.cumulative).toBe(2);
    expect(state.quorum.threshold).toBe(2);
    expect(state.quorum.total).toBe(3);
    expect(state.quorum.reached).toBe(true);
    expect(state.quorum.transitionsFired).toBe(2);
    expect(state.attestation.status === "landed" && state.attestation.navFinal).toBe(
      "500000000",
    );
    expect(state.phase).toBe("complete");
  });

  it("shows the saboteur only from the moment its submission lands", () => {
    const timeline = buildTimeline(strikeSabotage);
    const saboteurEvent = timeline.events.find(
      (e) => e.kind === "submission" && e.operator.id === SABOTEUR_ID,
    );
    expect(saboteurEvent).toBeDefined();
    const before = deriveReplayState(strikeSabotage, saboteurEvent!.atMs - 1, timeline);
    const after = deriveReplayState(strikeSabotage, saboteurEvent!.atMs, timeline);
    expect(before.operators.some((o) => o.id === SABOTEUR_ID)).toBe(false);
    expect(after.operators.some((o) => o.id === SABOTEUR_ID)).toBe(true);
  });
});

describe("deriveReplayState — partial (pending) journal", () => {
  it("ends the timeline early instead of inventing events", () => {
    const timeline = buildTimeline(partialSettled);
    expect(timeline.events.map((e) => e.kind)).toEqual<ReplayEventKind[]>([
      "trigger",
      "submission",
      "transition",
    ]);
    expect(timeline.durationMs).toBe(3_900 + REPLAY_PACING.tailHoldMs);
  });

  it("stays collecting when playback runs out, with attestation not landed", () => {
    const state = deriveReplayState(partialSettled, Number.POSITIVE_INFINITY);
    expect(state.done).toBe(true);
    expect(state.phase).toBe("collecting");
    expect(state.status).toBe("pending");
    expect(state.attestation).toEqual({ status: "not-landed", chainId: 8453 });
    expect(state.quorum.reached).toBe(false);
    expect(state.quorum.cumulative).toBe(1);
    expect(state.awaitingOperatorCount).toBe(0);
  });

  it("reports matchesWinningHash as null while no winning hash exists", () => {
    const state = deriveReplayState(partialSettled, Number.POSITIVE_INFINITY);
    expect(state.operators).toHaveLength(1);
    expect(state.operators[0]!.matchesWinningHash).toBeNull();
  });
});
