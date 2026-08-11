/**
 * The headless-driving params. These exist so a screenshot lands on an exact
 * frame, so the parsing has to be boring and total: junk falls back, it never
 * throws, and `?corrupt=` resolves labels and addresses to the same ids.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_BOOT, parseBootFrom, resolveOperatorId } from "@/lib/boot";
import { demoEnvironment } from "@/lib/environment";
import { MAX_PRE_STRIKES } from "@/lib/simulate";

const NODE_1 = demoEnvironment.registry.operators[0]!;

describe("parseBootFrom", () => {
  it("returns the defaults for an empty query", () => {
    expect(parseBootFrom("")).toEqual(DEFAULT_BOOT);
  });

  it("reads every knob", () => {
    const boot = parseBootFrom(
      "?sim-seed=42&sim-interval=500&sim-strikes=6&sim-freeze=9000&corrupt=node-1",
    );
    expect(boot.seed).toBe(42);
    expect(boot.intervalMs).toBe(500);
    expect(boot.preStrikes).toBe(6);
    expect(boot.freezeMs).toBe(9_000);
    expect(boot.corrupt).toEqual([NODE_1.id.toLowerCase()]);
  });

  it("falls back rather than throwing on junk", () => {
    const boot = parseBootFrom("?sim-seed=abc&sim-interval=nope&sim-freeze=xyz&corrupt=,,nobody");
    expect(boot.seed).toBe(DEFAULT_BOOT.seed);
    expect(boot.intervalMs).toBe(DEFAULT_BOOT.intervalMs);
    expect(boot.freezeMs).toBeNull();
    expect(boot.corrupt).toEqual([]);
  });

  it("treats a present-but-empty numeric param as absent", () => {
    // Number("") is 0 and 0 is finite, so an empty value used to read as a
    // *request* for zero. A templated headless URL drops one of these easily,
    // and `?sim-freeze=` freezing the canvas at offset 0 with no strikes ever
    // scheduled is a dead page, not a default.
    expect(parseBootFrom("?sim-interval=").intervalMs).toBe(DEFAULT_BOOT.intervalMs);
    expect(parseBootFrom("?sim-seed=").seed).toBe(DEFAULT_BOOT.seed);
    expect(parseBootFrom("?sim-strikes=").preStrikes).toBe(DEFAULT_BOOT.preStrikes);
    expect(parseBootFrom("?sim-freeze=").freezeMs).toBeNull();
    expect(parseBootFrom("?sim-freeze=%20").freezeMs).toBeNull();
  });

  it("rejects a non-finite value rather than passing it through", () => {
    // Infinity parses and is not NaN, so the old NaN-only guard let it past.
    expect(parseBootFrom("?sim-freeze=Infinity").freezeMs).toBeNull();
    expect(parseBootFrom("?sim-seed=Infinity").seed).toBe(DEFAULT_BOOT.seed);
  });

  it("clamps sim-strikes so a typo cannot hang the tab", () => {
    // The warmup loop is synchronous: ?sim-strikes=1000000000 would run a
    // billion strikes on mount. Only HISTORY_LIMIT survive into the ticker.
    expect(parseBootFrom("?sim-strikes=1000000000").preStrikes).toBe(MAX_PRE_STRIKES);
    expect(parseBootFrom("?sim-strikes=-5").preStrikes).toBe(0);
    expect(parseBootFrom("?sim-strikes=6.7").preStrikes).toBe(6);
  });

  it("distinguishes a missing sim-freeze from sim-freeze=0", () => {
    expect(parseBootFrom("").freezeMs).toBeNull();
    expect(parseBootFrom("?sim-freeze=0").freezeMs).toBe(0);
  });

  it("takes a comma list", () => {
    const boot = parseBootFrom("?corrupt=node-2,node-3");
    expect(boot.corrupt).toHaveLength(2);
  });
});

describe("resolveOperatorId", () => {
  it("resolves a label, an address and either case to the same id", () => {
    const expected = NODE_1.id.toLowerCase();
    expect(resolveOperatorId(NODE_1.label)).toBe(expected);
    expect(resolveOperatorId(NODE_1.id)).toBe(expected);
    expect(resolveOperatorId(NODE_1.id.toUpperCase())).toBe(expected);
    expect(resolveOperatorId(` ${NODE_1.label} `)).toBe(expected);
  });

  it("returns null for an unknown or empty token", () => {
    expect(resolveOperatorId("")).toBeNull();
    expect(resolveOperatorId("node-99")).toBeNull();
  });
});
