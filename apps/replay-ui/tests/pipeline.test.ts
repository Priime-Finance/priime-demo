/**
 * The operator-pipeline view model (`lib/vaults/pipeline.ts`).
 *
 * These assertions are the demo's claim written as tests: the honest capture
 * settles 3-of-3 over one hash, and the sabotage capture puts operator 3
 * outside the quorum on a hash of its own while the honest two attest the
 * true number. If the money shot ever stops working, it fails here first.
 */
import { describe, expect, it } from "vitest";

import { buildTimeline, deriveReplayState, REPLAY_PACING } from "@/lib/replay";
import { STRIKE_IDS } from "@/lib/source";
import {
  buildPipelineView,
  CAPTURE_STRIKE_ID,
  captureJournal,
  type Capture,
} from "@/lib/vaults/pipeline";

/** The finished frame of a capture: playback run to its end. */
function finalView(capture: Capture) {
  const journal = captureJournal(capture);
  const timeline = buildTimeline(journal);
  return buildPipelineView(journal, deriveReplayState(journal, timeline.durationMs, timeline));
}

/** A frame at `t` ms into playback. */
function viewAt(capture: Capture, tMs: number) {
  const journal = captureJournal(capture);
  const timeline = buildTimeline(journal);
  return buildPipelineView(journal, deriveReplayState(journal, tMs, timeline));
}

describe("captureJournal", () => {
  it("maps each capture to its own recorded strike", () => {
    expect(CAPTURE_STRIKE_ID.honest).toBe(STRIKE_IDS.settled);
    expect(CAPTURE_STRIKE_ID.corrupted).toBe(STRIKE_IDS.sabotage);
    expect(captureJournal("honest").strike_id).toBe(STRIKE_IDS.settled);
    expect(captureJournal("corrupted").strike_id).toBe(STRIKE_IDS.sabotage);
  });

  it("returns captures, not edits: the two journals are different recordings", () => {
    const honest = captureJournal("honest");
    const corrupted = captureJournal("corrupted");
    expect(corrupted.strike_id).not.toBe(honest.strike_id);
    expect(corrupted.trigger.block).not.toBe(honest.trigger.block);
  });
});

describe("buildPipelineView, the resting frame", () => {
  it("shows three idle nodes before the trigger fires", () => {
    const view = viewAt("honest", 0);
    expect(view.triggered).toBe(false);
    expect(view.nodes).toHaveLength(3);
    for (const node of view.nodes) {
      expect(node.step).toBe("awaiting");
      expect(node.reported).toBe(false);
      expect(node.hashShort).toBeNull();
      expect(node.navText).toBeNull();
      expect(node.signaturePresent).toBe(false);
    }
    expect(view.quorum.cumulative).toBe(0);
    expect(view.quorum.reached).toBe(false);
    expect(view.quorum.outside).toBeNull();
    expect(view.attestation.landed).toBe(false);
    expect(view.attestation.navText).toBeNull();
  });

  it("flips every node to computing once the trigger has fired and nothing has landed", () => {
    // The trigger fires at the lead-in; the first submission is a min-gap later.
    const view = viewAt("honest", REPLAY_PACING.leadInMs);
    expect(view.triggered).toBe(true);
    expect(view.nodes.map((n) => n.step)).toEqual(["computing", "computing", "computing"]);
    expect(view.nodes.every((n) => n.stepLabel === "Computing")).toBe(true);
  });

  it("labels nodes in journal order and keeps their addresses", () => {
    const view = viewAt("honest", 0);
    expect(view.nodes.map((n) => n.label)).toEqual([
      "Operator 1",
      "Operator 2",
      "Operator 3",
    ]);
    expect(view.nodes.map((n) => n.id)).toEqual(
      captureJournal("honest").operators.map((o) => o.id),
    );
    expect(view.nodes[0]!.shortId).toBe("0x1111…1111");
  });
});

describe("buildPipelineView, the honest capture", () => {
  const view = finalView("honest");

  it("accepts all three nodes on one hash", () => {
    expect(view.nodes.map((n) => n.step)).toEqual(["accepted", "accepted", "accepted"]);
    const hashes = new Set(view.nodes.map((n) => n.hash));
    expect(hashes.size).toBe(1);
    expect(view.nodes.every((n) => n.reason === null)).toBe(true);
    expect(view.nodes.every((n) => n.signaturePresent)).toBe(true);
  });

  it("fills the quorum past the threshold with nothing outside it", () => {
    expect(view.quorum.threshold).toBe(2);
    expect(view.quorum.total).toBe(3);
    expect(view.quorum.cumulative).toBe(3);
    expect(view.quorum.reached).toBe(true);
    expect(view.quorum.thresholdLabel).toBe("2 of 3");
    expect(view.quorum.weightLabel).toBe("3 of 3");
    expect(view.quorum.fillPct).toBe(100);
    expect(view.quorum.outside).toBeNull();
    expect(view.quorum.winningHashShort).toBe("0xa1a1a1a1…a1a1a1");
  });

  it("lands the attestation at the settled NAV", () => {
    expect(view.attestation.landed).toBe(true);
    expect(view.attestation.navText).toBe("500.000000 USDC");
    expect(view.attestation.settledBy).toBe("3-of-3");
    expect(view.attestation.inputsBlock).toBe(49480000);
    expect(view.attestation.digestShort.startsWith("sha256:9c9c9")).toBe(true);
    expect(view.phaseLabel).toBe("Attested");
  });
});

describe("buildPipelineView, the sabotage capture", () => {
  const view = finalView("corrupted");

  it("rejects operator 3 on a hash mismatch and accepts the other two", () => {
    expect(view.nodes.map((n) => n.step)).toEqual(["accepted", "accepted", "rejected"]);
    const rejected = view.nodes[2]!;
    expect(rejected.reason).toBe("Result hash mismatch, outside the quorum");
    expect(rejected.hash).not.toBe(view.nodes[0]!.hash);
    // The corrupted node reports an inflated NAV; the number itself is data and
    // is rendered verbatim, in the capture's own units.
    expect(rejected.navText).toBe("750.000000 USDC");
    expect(view.nodes[0]!.navText).toBe("500.000000 USDC");
  });

  it("puts the mismatched hash in a bucket outside the quorum", () => {
    const outside = view.quorum.outside;
    expect(outside).not.toBeNull();
    expect(outside!.count).toBe(1);
    expect(outside!.navText).toBe("750.000000 USDC");
    expect(outside!.hash).toBe(view.nodes[2]!.hash);
    expect(outside!.hashShort).not.toBe(view.quorum.winningHashShort);
  });

  it("settles at 2-of-3 on the honest number", () => {
    expect(view.quorum.cumulative).toBe(2);
    expect(view.quorum.reached).toBe(true);
    expect(view.quorum.weightLabel).toBe("2 of 3");
    expect(view.attestation.landed).toBe(true);
    // The honest NAV, not the inflated one: a corrupted operator cannot move it.
    expect(view.attestation.navText).toBe("500.000000 USDC");
    expect(view.attestation.settledBy).toBe("2-of-3");
  });

  it("never marks a node rejected before its submission lands", () => {
    const early = viewAt("corrupted", REPLAY_PACING.leadInMs);
    expect(early.nodes.every((n) => n.step === "computing")).toBe(true);
    expect(early.quorum.outside).toBeNull();
  });
});
