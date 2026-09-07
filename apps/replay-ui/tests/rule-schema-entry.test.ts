/**
 * THE LOAD ORDER, AS A GATE (F6, G5).
 *
 * `rule-schema.ts` used to import `../capacity`, which reaches `./templates`
 * -> `./graph-ops` -> `./orchestrator` (index), whose module body calls
 * `concentrationFloorPct` back into `rule-schema`. A module graph that entered
 * `rule-schema` FIRST therefore threw
 * "Cannot access 'CONCENTRATION_BASE_FLOOR_PCT' before initialization" at load
 * time — at runtime, not at build, which is exactly how a route ships broken.
 *
 * This file's ONLY import is the module under test, so it fails to load if the
 * cycle comes back. `demo-rules.ts` carried an import-ordering workaround for
 * the same defect and no longer needs one.
 */

import { describe, expect, it } from "vitest";

import {
  CONCENTRATION_BASE_FLOOR_PCT,
  concentrationFloorPct,
  UPGRADE_THRESHOLD_FLOOR,
} from "@/lib/canvas/orchestrator/rule-schema";

describe("rule-schema is safe to enter first", () => {
  it("initialises its own constants when nothing else has been loaded", () => {
    expect(CONCENTRATION_BASE_FLOOR_PCT).toBe(35);
    expect(concentrationFloorPct(2)).toBe(50);
    /* The register floor is untouched by the demo's own bar: G2 rules on
       which bar SHIPS, never on this constant. */
    expect(UPGRADE_THRESHOLD_FLOOR).toBe(0.03);
  });
});
