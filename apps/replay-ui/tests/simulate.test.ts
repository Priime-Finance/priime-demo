/**
 * Simulator invariants.
 *
 * The simulator is allowed to be fake. It is not allowed to be *shaped* wrong:
 * everything it emits must be a legal v1 journal, and the quorum arithmetic
 * must tell the same story the canvas draws. These tests are the contract that
 * lets the canvas swap to a live `JournalSource` without a renderer change.
 */
import { describe, expect, it } from "vitest";

import type { Journal } from "@priime-demo/journal-schema";

import { demoEnvironment } from "@/lib/environment";
import { deriveReplayState } from "@/lib/replay";
import {
  bootSession,
  healthFactor,
  initialSimState,
  isCorrupt,
  MAX_PRE_STRIKES,
  NAV_BASELINE,
  nextStrike,
  setCorrupt,
  SIM_CONFIG,
  STRIKE_INTERVAL_MS,
  summariseStrike,
  type SimState,
} from "@/lib/simulate";

const HASH32 = /^0x[0-9a-f]{64}$/;
const SIGNATURE = /^0x[0-9a-f]{130}$/;
const UINT_STRING = /^[0-9]+$/;
const HEX_BYTES = /^0x([0-9a-f]{2})*$/;

const START_UNIX = 1_800_000_000;
const NODES = demoEnvironment.registry.operators;

/** Run `count` strikes from a fresh session. */
function run(
  count: number,
  options: { seed?: number; corrupt?: readonly string[] } = {},
): { journals: readonly Journal[]; state: SimState } {
  let state = initialSimState(options.seed ?? 1, START_UNIX, options.corrupt ?? []);
  const journals: Journal[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = nextStrike(state, SIM_CONFIG);
    journals.push(result.journal);
    state = result.state;
  }
  return { journals, state };
}

/** One strike with the given nodes corrupted. */
function one(corrupt: readonly string[], seed = 3): Journal {
  return run(1, { seed, corrupt }).journals[0]!;
}

describe("nextStrike — structural conformance to the frozen v1 journal", () => {
  const { journals } = run(12, { seed: 11 });

  it("emits the frozen schema version and a service-scoped strike id", () => {
    for (const journal of journals) {
      expect(journal.schema_version).toBe("1.0.0");
      expect(journal.strike_id).toBe(`${SIM_CONFIG.serviceId}:${journal.inputs_block}`);
      expect(journal.service_id).toBe(SIM_CONFIG.serviceId);
    }
  });

  it("emits one submission per registered operator, in registry membership", () => {
    for (const journal of journals) {
      expect(journal.operators).toHaveLength(NODES.length);
      const ids = journal.operators.map((operator) => operator.id).sort();
      expect(ids).toEqual(NODES.map((node) => node.id).sort());
    }
  });

  it("emits hex fields at the widths the JSON Schema pins", () => {
    for (const journal of journals) {
      for (const operator of journal.operators) {
        expect(operator.result_hash).toMatch(HASH32);
        expect(operator.signature).toMatch(SIGNATURE);
        expect(operator.nav).toMatch(UINT_STRING);
        expect(operator.result_payload ?? "0x").toMatch(HEX_BYTES);
      }
      if (journal.attestation.tx_hash !== null) {
        expect(journal.attestation.tx_hash).toMatch(HASH32);
      }
    }
  });

  it("never floats a NAV: every value is an integer string in base units", () => {
    for (const journal of journals) {
      for (const operator of journal.operators) {
        expect(BigInt(operator.nav).toString()).toBe(operator.nav);
      }
      if (journal.attestation.nav_final !== null) {
        expect(BigInt(journal.attestation.nav_final).toString()).toBe(
          journal.attestation.nav_final,
        );
      }
    }
  });

  it("orders submissions by arrival and anchors them to the trigger block", () => {
    for (const journal of journals) {
      expect(journal.trigger.block).toBe(journal.inputs_block);
      expect(journal.trigger.tx_hash).toBeNull();
      const stamps = journal.operators.map((operator) => operator.timestamp);
      expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    }
  });

  it("advances the block height strictly, with unique strike ids", () => {
    const blocks = journals.map((journal) => journal.inputs_block);
    for (let i = 1; i < blocks.length; i += 1) {
      expect(blocks[i]!).toBeGreaterThan(blocks[i - 1]!);
    }
    expect(new Set(journals.map((journal) => journal.strike_id)).size).toBe(journals.length);
  });

  it("drifts NAV gently and keeps it inside the simulated band", () => {
    const base = BigInt(NAV_BASELINE);
    for (const journal of journals) {
      const honest = journal.operators.find((operator) => operator.accepted);
      expect(honest).toBeDefined();
      const value = BigInt(honest!.nav);
      expect(value).toBeGreaterThanOrEqual((base * 9_600n) / 10_000n);
      expect(value).toBeLessThanOrEqual((base * 10_400n) / 10_000n);
    }
  });
});

describe("nextStrike — the honest path", () => {
  const journal = one([]);

  it("has every operator land on the identical hash", () => {
    const hashes = new Set(journal.operators.map((operator) => operator.result_hash));
    expect(hashes.size).toBe(1);
    expect(journal.quorum.winning_result_hash).toBe(journal.operators[0]!.result_hash);
  });

  it("settles, with an attestation over the honest NAV", () => {
    expect(journal.status).toBe("settled");
    expect(journal.quorum.reached).toBe(true);
    expect(journal.attestation.tx_hash).not.toBeNull();
    expect(journal.attestation.nav_final).toBe(journal.operators[0]!.nav);
    expect(journal.attestation.block_number).toBeGreaterThan(journal.inputs_block);
  });

  it("accepts every operator and fills the ladder to 3-of-3", () => {
    expect(journal.operators.every((operator) => operator.accepted)).toBe(true);
    const last = journal.quorum.transitions[journal.quorum.transitions.length - 1]!;
    expect(last.cumulative).toBe(3);
    expect(journal.quorum.transitions).toHaveLength(3);
  });
});

describe("nextStrike — one corrupted operator (the money shot)", () => {
  const liar = NODES[2]!;
  const journal = one([liar.id]);

  it("gives the liar an inflated NAV and a hash of its own", () => {
    const corrupted = journal.operators.find((operator) => operator.id === liar.id)!;
    const honest = journal.operators.filter((operator) => operator.id !== liar.id);
    expect(new Set(honest.map((operator) => operator.result_hash)).size).toBe(1);
    expect(corrupted.result_hash).not.toBe(honest[0]!.result_hash);
    expect(BigInt(corrupted.nav)).toBeGreaterThan(BigInt(honest[0]!.nav) * 12n / 10n - 1n);
    expect(BigInt(corrupted.nav)).toBeLessThanOrEqual((BigInt(honest[0]!.nav) * 18n) / 10n);
  });

  it("excludes the liar from quorum and settles on the honest 2-of-3", () => {
    const corrupted = journal.operators.find((operator) => operator.id === liar.id)!;
    expect(corrupted.accepted).toBe(false);
    expect(journal.status).toBe("settled");
    expect(journal.quorum.reached).toBe(true);
    expect(journal.quorum.winning_result_hash).not.toBe(corrupted.result_hash);
    expect(journal.attestation.nav_final).not.toBe(corrupted.nav);
  });

  it("never lets the divergent weight into the transition ladder", () => {
    for (const transition of journal.quorum.transitions) {
      expect(transition.operator_id).not.toBe(liar.id);
      expect(transition.result_hash).toBe(journal.quorum.winning_result_hash);
    }
  });

  it("holds for whichever node is flipped", () => {
    for (const node of NODES) {
      const strike = one([node.id], 17);
      const corrupted = strike.operators.find((operator) => operator.id === node.id)!;
      expect(corrupted.accepted).toBe(false);
      expect(strike.status).toBe("settled");
      expect(strike.operators.filter((operator) => operator.accepted)).toHaveLength(2);
    }
  });
});

describe("nextStrike — two or more liars stall the strike", () => {
  const journal = one([NODES[1]!.id, NODES[2]!.id]);

  it("reaches no quorum at all", () => {
    expect(journal.status).toBe("stalled");
    expect(journal.quorum.reached).toBe(false);
    expect(journal.quorum.winning_result_hash).toBeNull();
    expect(journal.operators.every((operator) => !operator.accepted)).toBe(true);
  });

  it("attests nothing", () => {
    expect(journal.attestation.tx_hash).toBeNull();
    expect(journal.attestation.nav_final).toBeNull();
    expect(journal.attestation.block_number).toBeNull();
    expect(journal.attestation.timestamp).toBeNull();
  });

  it("puts every liar in a bucket of its own, none of them reaching threshold", () => {
    const hashes = journal.operators.map((operator) => operator.result_hash);
    expect(new Set(hashes).size).toBe(3);
    for (const transition of journal.quorum.transitions) {
      expect(transition.reached).toBe(false);
      expect(transition.cumulative).toBeLessThan(journal.quorum.threshold);
    }
  });

  it("stalls with all three flipped too", () => {
    const all = one(NODES.map((node) => node.id));
    expect(all.status).toBe("stalled");
    expect(all.quorum.winning_result_hash).toBeNull();
  });
});

describe("nextStrike — quorum arithmetic agrees with the operator set", () => {
  const cases: readonly (readonly string[])[] = [
    [],
    [NODES[0]!.id],
    [NODES[2]!.id],
    [NODES[0]!.id, NODES[1]!.id],
  ];

  it("keeps transitions monotonic and consistent with `reached`", () => {
    for (const corrupt of cases) {
      const journal = one(corrupt, 23);
      const seen = new Map<string, number>();
      for (const transition of journal.quorum.transitions) {
        const previous = seen.get(transition.result_hash) ?? 0;
        expect(transition.cumulative).toBe(previous + 1);
        seen.set(transition.result_hash, transition.cumulative);
        expect(transition.reached).toBe(transition.cumulative >= journal.quorum.threshold);
      }
    }
  });

  it("matches accepted weight to the last winning transition", () => {
    for (const corrupt of cases) {
      const journal = one(corrupt, 29);
      const accepted = journal.operators.filter((operator) => operator.accepted).length;
      const last = journal.quorum.transitions[journal.quorum.transitions.length - 1] ?? null;
      if (journal.quorum.winning_result_hash === null) {
        expect(accepted).toBe(0);
      } else {
        expect(last?.cumulative).toBe(accepted);
        expect(accepted).toBeGreaterThanOrEqual(journal.quorum.threshold);
      }
      expect(journal.quorum.total).toBe(NODES.length);
      expect(journal.quorum.threshold).toBe(2);
    }
  });
});

describe("nextStrike — determinism", () => {
  it("replays a session exactly for the same seed", () => {
    expect(run(6, { seed: 42 }).journals).toEqual(run(6, { seed: 42 }).journals);
  });

  it("produces a different session for a different seed", () => {
    const a = run(6, { seed: 42 }).journals;
    const b = run(6, { seed: 43 }).journals;
    expect(a).not.toEqual(b);
  });

  it("is pure: calling it twice on the same state gives the same result", () => {
    const state = initialSimState(5, START_UNIX);
    expect(nextStrike(state, SIM_CONFIG)).toEqual(nextStrike(state, SIM_CONFIG));
  });

  it("advances the RNG, so consecutive strikes are not clones", () => {
    const { journals } = run(2, { seed: 8 });
    expect(journals[0]!.operators[0]!.result_hash).not.toBe(
      journals[1]!.operators[0]!.result_hash,
    );
  });
});

describe("corruption flags", () => {
  it("sets and clears without mutating the input state", () => {
    const state = initialSimState(1, START_UNIX);
    const dirty = setCorrupt(state, NODES[0]!.id, true);
    expect(isCorrupt(state, NODES[0]!.id)).toBe(false);
    expect(isCorrupt(dirty, NODES[0]!.id)).toBe(true);
    expect(isCorrupt(setCorrupt(dirty, NODES[0]!.id, false), NODES[0]!.id)).toBe(false);
  });

  it("is case-insensitive and never duplicates", () => {
    let state = initialSimState(1, START_UNIX);
    state = setCorrupt(state, NODES[0]!.id.toUpperCase(), true);
    state = setCorrupt(state, NODES[0]!.id.toLowerCase(), true);
    expect(state.corrupt).toHaveLength(1);
    expect(isCorrupt(state, NODES[0]!.id)).toBe(true);
  });

  it("heals a node on the strike after the flag clears", () => {
    let state = initialSimState(9, START_UNIX, [NODES[2]!.id]);
    const sick = nextStrike(state, SIM_CONFIG);
    expect(sick.journal.operators.find((o) => o.id === NODES[2]!.id)!.accepted).toBe(false);

    state = setCorrupt(sick.state, NODES[2]!.id, false);
    const healed = nextStrike(state, SIM_CONFIG);
    expect(healed.journal.operators.every((operator) => operator.accepted)).toBe(true);
    expect(new Set(healed.journal.operators.map((o) => o.result_hash)).size).toBe(1);
  });
});

describe("simulated vault telemetry", () => {
  it("keeps the health factor above the deploy-form floor", () => {
    let state = initialSimState(4, START_UNIX);
    for (let i = 0; i < 40; i += 1) {
      state = nextStrike(state, SIM_CONFIG).state;
      expect(healthFactor(state, SIM_CONFIG)).toBeGreaterThan(SIM_CONFIG.healthFactorFloor);
    }
  });
});

describe("engine compatibility", () => {
  it("drives the replay engine to a terminal phase", () => {
    const settled = one([]);
    const stalled = one([NODES[0]!.id, NODES[1]!.id]);
    expect(deriveReplayState(settled, Number.POSITIVE_INFINITY).phase).toBe("complete");
    expect(deriveReplayState(stalled, Number.POSITIVE_INFINITY).phase).toBe("stalled");
  });

  it("shows the divergent operator as not matching the winning hash", () => {
    const journal = one([NODES[2]!.id]);
    const state = deriveReplayState(journal, Number.POSITIVE_INFINITY);
    const liar = state.operators.find((operator) => operator.id === NODES[2]!.id)!;
    expect(liar.matchesWinningHash).toBe(false);
    expect(liar.accepted).toBe(false);
  });
});

describe("summariseStrike", () => {
  it("summarises a settled strike", () => {
    const summary = summariseStrike(one([]), 12);
    expect(summary.ordinal).toBe("#012");
    expect(summary.status).toBe("settled");
    expect(summary.cumulative).toBe(3);
    expect(summary.divergent).toBe(0);
    expect(summary.nav).not.toBeNull();
  });

  it("summarises a sabotaged strike", () => {
    const summary = summariseStrike(one([NODES[2]!.id]), 3);
    expect(summary.cumulative).toBe(2);
    expect(summary.divergent).toBe(1);
  });

  it("summarises a stalled strike without inventing a settled NAV", () => {
    const summary = summariseStrike(one([NODES[1]!.id, NODES[2]!.id]), 4);
    expect(summary.status).toBe("stalled");
    expect(summary.cumulative).toBe(0);
    expect(summary.divergent).toBe(3);
    expect(summary.nav).toBeNull();
  });
});

describe("bootSession", () => {
  const NOW = 1_760_000_000;
  const STEP = Math.round(STRIKE_INTERVAL_MS / 1_000);

  /** Latest moment anything in this strike happened. */
  function observedAt(journal: Journal): number {
    return Math.max(...journal.operators.map((operator) => operator.timestamp));
  }

  it("returns the live strike first, then the warmup newest-first", () => {
    const boot = bootSession(7, NOW, [], 6);
    expect(boot.history).toHaveLength(7);
    expect(boot.history[0]!.strike_id).toBe(
      boot.history.reduce((newest, entry) =>
        observedAt(entry) > observedAt(newest) ? entry : newest,
      ).strike_id,
    );
  });

  it("runs the ticker's clock forwards, so no warmup entry post-dates the live strike", () => {
    // The bug this replaces seeded the warmup at `now` and then reset the live
    // strike back to `now`, stamping every older entry up to STEP*(N-1) seconds
    // AFTER the one below it. Opening a warmup strike showed Observed/Landed
    // readouts running backwards, in exactly the ?sim-strikes=6 frames the
    // README advertises.
    const stamps = bootSession(7, NOW, [], 6).history.map(observedAt);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]!).toBeLessThan(stamps[i - 1]!);
    }
  });

  it("lands the live strike at the requested moment, not one warmup ahead of it", () => {
    const withWarmup = observedAt(bootSession(7, NOW, [], 6).history[0]!);
    const withNone = observedAt(bootSession(7, NOW, [], 0).history[0]!);
    expect(withWarmup).toBe(withNone);
  });

  it("reaches back one interval per warmup strike", () => {
    const history = bootSession(7, NOW, [], 6).history;
    const oldest = observedAt(history[history.length - 1]!);
    const live = observedAt(history[0]!);
    expect(live - oldest).toBe(6 * STEP);
  });

  it("is a single live strike when no pre-history is asked for", () => {
    expect(bootSession(7, NOW, [], 0).history).toHaveLength(1);
    expect(bootSession(7, NOW, [], -3).history).toHaveLength(1);
  });

  it("reports the flags the live strike actually ran under", () => {
    const corrupt = [NODES[2]!.id.toLowerCase()];
    const boot = bootSession(7, NOW, corrupt, 3);
    expect(boot.strikeCorrupt).toEqual(corrupt);
  });
});

describe("bootSession — warmup clamp", () => {
  it("refuses to run more warmup strikes than the ceiling", () => {
    // The loop is synchronous: unclamped, ?sim-strikes=1e9 hangs the tab.
    const boot = bootSession(7, 1_760_000_000, [], 1_000_000_000);
    expect(boot.history).toHaveLength(MAX_PRE_STRIKES + 1);
  });

  it("treats a non-finite or negative count as no pre-history", () => {
    expect(bootSession(7, 1_760_000_000, [], Number.POSITIVE_INFINITY).history).toHaveLength(1);
    expect(bootSession(7, 1_760_000_000, [], Number.NaN).history).toHaveLength(1);
    expect(bootSession(7, 1_760_000_000, [], -5).history).toHaveLength(1);
  });
});
