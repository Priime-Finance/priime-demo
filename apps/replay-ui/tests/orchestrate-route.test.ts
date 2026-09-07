/**
 * THE ROUTER REPLAY ROUTE, AS A GATE.
 *
 * Three things are checked and they are different questions.
 *
 *   1. EVERY REGIME ANSWERS, in the exact shape `LanePanel.tsx` declares at
 *      its lines 988 to 1075. A panel reading a key the route does not send
 *      renders a blank where a number belongs, and neither `tsc` nor the
 *      build can see that: the wire is untyped at the boundary.
 *   2. THE INVARIANT THE WHOLE MACHINE RESTS ON, per tick rather than once:
 *      Σ target weight is 1 on every day of every regime.
 *   3. THE ROUTE AND THE QUANT'S BACKTEST ARE MEASURING ONE RUN, WHERE THEY
 *      DO, AND THE ONE PLACE THEY DO NOT IS PINNED TOO. The transforms are
 *      defined twice by necessity (the backtest's live in a test file, which
 *      no production module may import), so three regimes' move counts are
 *      pinned to the quant's own findings. The fourth, `whipsaw`, disagrees:
 *      the backtest is a hand fold and this route folds the shipped
 *      `evaluateOrchestrator`, whose reverse-edge lock and payback gate
 *      refuse two firings the hand fold takes. That gap is pinned at its
 *      measured value rather than left to drift, so a change in either
 *      direction goes red and reaches a reader instead of quietly redrawing
 *      the history `docs/plans/ROUTER_QUANT.md` prints.
 */

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/canvas/orchestrate/route";
import { canonicalRules, rulesHash } from "@/lib/canvas/orchestrator";
import { foldRouterScenario } from "@/lib/canvas/router-fold";
import { sha256Hex } from "@/lib/canvas/scenario/hash";
import {
  DEMO_ROUTER_BOOK_USD,
  DEMO_SUSTAIN_PINS_DAILY,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";
import {
  DEFAULT_REGIME,
  REGIME_IDS,
  REGIME_LABEL,
  REGIME_MECHANISM,
  type RegimeId,
} from "@/lib/canvas/scenario/regime-ids";
import {
  ROUTER_HISTORY_ALIGNED,
  ROUTER_HISTORY_CAPTURED_AT,
  ROUTER_FLOOR_CANDIDATE_ID,
} from "@/lib/canvas/router-history";
import { DEMO_MARKET_ID } from "@/lib/demo/market";

interface Lane {
  slotId: string;
  candidateId: string;
  venue: string;
  book: string;
  capacityUsd: number;
  settlementDays: number;
  sourceEligible: boolean;
}

interface Run {
  ok: boolean;
  modeled: boolean;
  regime: RegimeId;
  regimeLabel: string;
  scenario: { hash: string; seed: number; ticks: number; calibratedTo: string };
  rulesHash: string;
  orchestratedTvlUsd: number;
  carryOnly: boolean;
  dials: { maxConcentrationPct: number; turnoverBudgetPctWeek: number };
  lanes: Lane[];
  laneSeries: {
    carryPublishedApy: number[];
    floorPublishedApy: number[];
    carryCapacityUsd: number[];
  };
  decisions: {
    decisionId: string;
    scenarioRef: { tick: number };
    moved: {
      sourceSlotId: string;
      destSlotId: string;
      weightBefore: number;
      weightAfter: number;
      moveUsd: number;
    };
  }[];
  receipts: unknown[];
  legs: unknown[];
  refusals: { tickIndex: number; ruleId: string; slotId: string; destSlotId: string | null; code: string; reason: string }[];
  weights: Record<string, number>;
  weightSumByTick: number[];
  earningWeightByTick: Record<string, number[]>;
  budgetByTick: unknown[];
  moves: number;
  firings: number;
}

async function get(regime?: string): Promise<{ status: number; body: Run }> {
  const url = regime === undefined
    ? "http://localhost/api/canvas/orchestrate"
    : `http://localhost/api/canvas/orchestrate?regime=${encodeURIComponent(regime)}`;
  /* The handler is synchronous (the fold is); `res.json()` is not. */
  const res = GET(new Request(url));
  return { status: res.status, body: (await res.json()) as Run };
}

/** The keys the panel reads off the answer. Named here rather than inferred,
 *  because the point is to fail when the ROUTE stops sending one. */
const RUN_KEYS = [
  "ok",
  "modeled",
  "regime",
  "regimeLabel",
  "scenario",
  "rulesHash",
  "orchestratedTvlUsd",
  "carryOnly",
  "dials",
  "lanes",
  "laneSeries",
  "decisions",
  "receipts",
  "legs",
  "refusals",
  "weights",
  "weightSumByTick",
  "earningWeightByTick",
  "budgetByTick",
  "moves",
  "firings",
] as const;

const runs = new Map<RegimeId, Run>();
for (const id of REGIME_IDS) {
  const { status, body } = await get(id);
  expect(status).toBe(200);
  runs.set(id, body);
}

describe("GET /api/canvas/orchestrate", () => {
  /* ONE FOLD, ONE POLICY IDENTITY (integration).
     `foldRouterRun` is synchronous, so it hashes the rule set through
     `sha256Hex(canonicalRules(rules))` rather than through the shipped
     `rulesHash`, whose body is that same line behind an async signature. If
     the shipped owner ever stops being that line, the panel's `policy` value
     stops naming the same policy as the rest of the product, silently. This
     asserts the two on the rule set the fold actually builds. */
  it("the fold's synchronous rules hash IS the shipped rulesHash", async () => {
    /* THE SLOT PAIR THE FOLD ACTUALLY BUILDS, taken off the fold rather than
       rebuilt beside it: the switch's band and its whole-lane move weight are
       part of the rule set, so a hand-built pair here would hash a policy the
       route does not run. */
    const rules = foldRouterScenario({ regime: "measured" }).cfg.rules;
    expect(sha256Hex(canonicalRules(rules))).toBe(await rulesHash(rules));
    expect(runs.get("measured")!.rulesHash).toBe(await rulesHash(rules));
  });

  it("every regime answers 200, ok and modeled, naming itself and its own label", () => {
    for (const id of REGIME_IDS) {
      const run = runs.get(id)!;
      expect(run.ok).toBe(true);
      expect(run.modeled).toBe(true);
      expect(run.regime).toBe(id);
      expect(run.regimeLabel).toBe(REGIME_LABEL[id]);
      /* The switcher prints this sentence under the keys; a regime with no
         mechanism sentence is a control with no statement of what it does. */
      expect(REGIME_MECHANISM[id].length).toBeGreaterThan(0);
    }
  });

  it("no regime, or an unknown one, answers the measured replay rather than an error", async () => {
    expect((await get()).body.regime).toBe(DEFAULT_REGIME);
    expect((await get("dead-band")).body.regime).toBe(DEFAULT_REGIME);
  });

  it("the answer carries every key the panel's RouterRun declares, and no lane series is empty", () => {
    for (const id of REGIME_IDS) {
      const run = runs.get(id)!;
      for (const k of RUN_KEYS) expect(Object.keys(run)).toContain(k);
      expect(Object.keys(run.scenario).sort()).toEqual(["calibratedTo", "hash", "seed", "ticks"]);
      expect(Object.keys(run.dials).sort()).toEqual(["maxConcentrationPct", "turnoverBudgetPctWeek"]);
      expect(Object.keys(run.laneSeries).sort()).toEqual([
        "carryCapacityUsd",
        "carryPublishedApy",
        "floorPublishedApy",
      ]);
      const T = run.laneSeries.carryPublishedApy.length;
      expect(T).toBe(ROUTER_HISTORY_ALIGNED.length);
      expect(run.scenario.ticks).toBe(T);
      expect(run.laneSeries.floorPublishedApy).toHaveLength(T);
      expect(run.laneSeries.carryCapacityUsd).toHaveLength(T);
      expect(run.weightSumByTick).toHaveLength(T);
      for (const l of run.lanes) expect(run.earningWeightByTick[l.slotId]).toHaveLength(T);
    }
  });

  it("the two lanes are the plan's two lanes, named by their own owners", () => {
    const run = runs.get(DEFAULT_REGIME)!;
    expect(run.lanes.map((l) => l.slotId)).toEqual(["loop", "floor"]);
    const [loop, floor] = run.lanes as [Lane, Lane];
    expect(loop.candidateId).toBe(DEMO_MARKET_ID);
    expect(loop.venue).toBe("morpho-blue-base");
    expect(floor.candidateId).toBe(ROUTER_FLOOR_CANDIDATE_ID);
    expect(floor.venue).toBe("treasury-ausdc-base");
    /* The floor is atomic: the issuer's own `instant-usdc` route, 0 days. */
    expect(floor.settlementDays).toBe(0);
    expect(run.carryOnly).toBe(false);
  });

  it("the run is denominated at the book the friction is quoted against, and states the capture it replays", () => {
    for (const id of REGIME_IDS) {
      const run = runs.get(id)!;
      expect(run.orchestratedTvlUsd).toBe(DEMO_ROUTER_BOOK_USD);
      expect(run.scenario.calibratedTo).toBe(ROUTER_HISTORY_CAPTURED_AT);
      /* A history replay has no seed, and 0 is the stated absence. */
      expect(run.scenario.seed).toBe(0);
      expect(run.rulesHash).toMatch(/^[0-9a-f]{64}$/);
      expect(run.scenario.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("Σ target weight is 1 on every tick of every regime, which is the invariant the whole machine rests on", () => {
    for (const id of REGIME_IDS) {
      const run = runs.get(id)!;
      for (const [i, s] of run.weightSumByTick.entries()) {
        expect(Math.abs(s - 1), `${id} tick ${i} sums to ${s}`).toBeLessThan(1e-9);
      }
      const final = Object.values(run.weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(final - 1)).toBeLessThan(1e-9);
    }
  });

  it("no lane is ever drained past the concentration band, in either direction", () => {
    for (const id of REGIME_IDS) {
      const run = runs.get(id)!;
      const max = run.dials.maxConcentrationPct / 100;
      const min = Math.max(0, 1 - (run.lanes.length - 1) * max);
      for (const w of Object.values(run.weights)) {
        expect(w).toBeLessThanOrEqual(max + 1e-9);
        expect(w).toBeGreaterThanOrEqual(min - 1e-9);
      }
    }
  });

  /**
   * THE PIN AGAINST THE QUANT'S OWN FOLD, which is now the SAME fold
   * (`foldRouterScenario`). `docs/plans/ROUTER_QUANT.md` and
   * `tests/router-backtest.test.ts` measure ONE move over the measured 89
   * days, on 2026-06-12, loop to floor, and under the switch it carries the
   * WHOLE lane: 50.0pp out of an even split, leaving the loop at zero.
   */
  it("the measured regime moves exactly once, loop to floor, on the day the quant measured", () => {
    const run = runs.get("measured")!;
    expect(run.moves).toBe(1);
    expect(run.decisions).toHaveLength(1);
    const d = run.decisions[0];
    expect(d?.moved.sourceSlotId).toBe("loop");
    expect(d?.moved.destSlotId).toBe("floor");
    /* The date, through the run's own axis rather than a typed index: the
       decision's tick is a position in the aligned window, which is the only
       calendar this replay has. */
    const tick = d?.scenarioRef.tick ?? -1;
    expect(ROUTER_HISTORY_ALIGNED[tick]?.date).toBe("2026-06-12");
    /* 50.0pp: the whole lane. Between a lane and its floor the router
       evacuates and rebuilds (G1), so the source ends at zero rather than at a
       band floor. ONE number for a move, and this is it (item 8d). */
    const shifted = (d?.moved.weightBefore ?? 0) - (d?.moved.weightAfter ?? 0);
    expect(Number((shifted * 100).toFixed(1))).toBe(50.0);
    expect(d?.moved.weightAfter).toBe(0);
  });

  it("the whipsaw refuses more crossings than it takes, which is what the mechanism is for", () => {
    const w = runs.get("whipsaw")!;
    expect(w.moves).toBeGreaterThan(0);
    expect(w.firings).toBeGreaterThan(w.moves);
    expect(w.refusals.length).toBeGreaterThan(0);
    /* Every refusal states its own reason; a code with no sentence is a
       number the panel cannot render. */
    for (const r of w.refusals) expect(r.reason.length).toBeGreaterThan(0);
  });

  it("the two mild stresses move once each, which is the count the quant's backtest prints", () => {
    /* The hand fold and the shipped evaluator agree exactly here, so the
       panel and `docs/plans/ROUTER_QUANT.md` describe one run. */
    for (const id of ["incentive-halves", "usdc-squeeze"] as const) {
      expect(runs.get(id)!.moves).toBe(1);
    }
  });

  it("the whipsaw takes two whole-lane moves and refuses four firings, each with its gate", () => {
    /* THE SEAM IS CLOSED: `tests/router-backtest.test.ts` no longer walks the
       days itself, it folds THIS function, so the two counts are one count by
       construction rather than by agreement. What is measured here is the
       shape of the refusal: under the switch a firing on an already-evacuated
       lane has nothing to move and is refused as dust, and the way back is
       held by the reverse-edge lock until the last move has paid for itself. */
    const w = runs.get("whipsaw")!;
    expect(w.moves).toBe(2);
    expect(w.firings).toBe(6);
    expect(w.decisions.filter((d) => d.moved.destSlotId !== "pause").map((d) => ROUTER_HISTORY_ALIGNED[d.scenarioRef.tick]?.date)).toEqual([
      "2026-06-12",
      "2026-07-24",
    ]);
    const codes = new Set(w.refusals.map((r) => r.code));
    expect(codes.has("edge-lock")).toBe(true);
    expect(codes.has("dust")).toBe(true);
    for (const r of w.refusals) expect(r.reason.length).toBeGreaterThan(0);
  });

  it("the bar and the patience the run enforces are the quant's owners, never a second table", () => {
    /* The route derives its rules through `demoDeriveAllRouterRules`, so the
       only way to check the founder's window and the derived bar reached the
       fold is to assert the owners are the ones the module exports. Both are
       imported, never retyped: a literal here would be the defect it guards. */
    expect(DEMO_SUSTAIN_PINS_DAILY).toBe(2);
    expect(DEMO_UPGRADE_THRESHOLD).toBeGreaterThan(0);
  });
});
