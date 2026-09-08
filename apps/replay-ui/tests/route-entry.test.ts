/**
 * THE ROUTE LOADS ON ITS OWN, AND ITS LOOP SLOT CARRIES NO SCREEN (G5).
 *
 * Two gates in one file, and they share the reason for being here: both are
 * defects that appear at RUNTIME and never at build.
 *
 * F6, the load order. `rule-schema.ts` used to import `../capacity`, which
 * reaches `templates -> graph-ops -> orchestrator/index`, whose module body
 * calls back into `rule-schema`. A module graph entering `rule-schema` first
 * threw at load time, and this route's graph reaches it. The fix is at the
 * owner (`fmtCapacityUsd` moved to `format.ts`); the guard is that this file's
 * ONLY import is the route module, so a returning cycle fails to load it.
 *
 * F5, the screen. `ECON_FLOOR_APY` is the levered-loop SCAN gate and this
 * market never passed through one, so a screen on the loop slot leaves
 * `apy-floor` permanently breaching and `evacuationBreaching` then disqualifies
 * the loop as a DESTINATION, silently deleting the founder's return leg. The
 * whole return half of the mechanism disappears with no error anywhere.
 */

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/canvas/orchestrate/route";

describe("the orchestrate route, imported first", () => {
  it("loads and answers 200 with nothing else imported before it", async () => {
    const res = GET(new Request("http://localhost/api/canvas/orchestrate?regime=measured"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      modeled: boolean;
      decisions: { moved: { sourceSlotId: string; destSlotId: string } }[];
    };
    expect(body.ok).toBe(true);
    expect(body.modeled).toBe(true);
    expect(body.decisions.length).toBeGreaterThan(0);
  });

  it("builds both slots with no screen, so the loop stays a legal destination", async () => {
    /* Read off the ROUTE's own answer rather than off a rebuilt slot pair: the
       question is what the shipped fold hands the evaluator. A screened loop
       would show up as the loop never being a destination in any regime, so
       the return leg is asserted where it is actually visible. */
    const { foldRouterScenario } = (await import("@/lib/canvas/router-fold")) as {
      foldRouterScenario: (a: { regime: "measured" | "whipsaw" }) => {
        cfg: { loops: { slotId: string; screenedAtApy: number | null }[]; rules: { ruleId: string }[] };
        result: { decisions: { moved: { destSlotId: string } }[] };
      };
    };
    const fold = foldRouterScenario({ regime: "measured" });
    for (const l of fold.cfg.loops) expect(l.screenedAtApy).toBeNull();
    /* No screen means no `apy-floor` rule at all, which is the derivation
       agreeing with the slot rather than a second opinion about it. */
    expect(fold.cfg.rules.some((r) => r.ruleId.endsWith(":apy-floor"))).toBe(false);
    /* And the return leg exists: on `whipsaw` the loop IS a destination. */
    const whip = foldRouterScenario({ regime: "whipsaw" });
    expect(whip.result.decisions.some((d) => d.moved.destSlotId === "loop")).toBe(true);
  });
});
