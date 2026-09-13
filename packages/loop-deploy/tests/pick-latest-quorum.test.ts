import { describe, expect, it } from "vitest";

import { pickLatestQuorum } from "../src/journal-source.ts";

const FALLBACK = { threshold: 2, total: 3 };

describe("pickLatestQuorum", () => {
  it("takes the last well-formed emission as chain-authoritative", () => {
    const q = pickLatestQuorum(
      [
        { args: { numerator: 1n, denominator: 1n } },
        { args: { numerator: 2n, denominator: 3n } },
        { args: { numerator: 3n, denominator: 5n } },
      ],
      FALLBACK,
    );
    expect(q).toEqual({ threshold: 3, total: 5, source: "chain" });
  });

  it("falls back on an empty stream and tags the source", () => {
    const q = pickLatestQuorum([], FALLBACK);
    expect(q).toEqual({ threshold: 2, total: 3, source: "fallback" });
  });

  it("skips malformed entries (undefined args, zero denominator) and prefers the newest usable one", () => {
    /* The manager could plausibly land a malformed emission (indexer
       reorg, RPC ABI mismatch on one log). Missing args and a zero
       denominator are both refused; the walk continues backwards to
       the newest well-formed entry. */
    const q = pickLatestQuorum(
      [
        { args: { numerator: 2n, denominator: 3n } },
        { args: { numerator: 4n, denominator: 5n } },
        { args: { numerator: 1n, denominator: 0n } },
        { args: { numerator: undefined, denominator: 7n } },
      ],
      FALLBACK,
    );
    expect(q).toEqual({ threshold: 4, total: 5, source: "chain" });
  });

  it("falls back when every entry is malformed", () => {
    const q = pickLatestQuorum(
      [
        { args: { numerator: 1n, denominator: 0n } },
        { args: { numerator: undefined, denominator: undefined } },
      ],
      FALLBACK,
    );
    expect(q).toEqual({ threshold: 2, total: 3, source: "fallback" });
  });
});
