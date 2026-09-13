import { describe, expect, it } from "vitest";

import { ReplayCache, ReplayedIntentError } from "@priime-demo/loop-deploy";

/**
 * The single-use guard behind the signature verification. Three rules:
 *
 *   1. First observation of a signature must be accepted silently.
 *   2. A second observation of the same signature inside the TTL must
 *      throw `ReplayedIntentError`.
 *   3. A signature that has aged past the TTL must no longer count as
 *      "already seen" — the entry evicts and the same signature could
 *      arrive fresh from a legitimate retry. `verifyLoop*` still refuses
 *      it on freshness grounds, so this is a defense-in-depth ceiling on
 *      the cache size, not an opening a caller can exploit.
 */

describe("ReplayCache", () => {
  it("accepts a first-seen signature silently", () => {
    const cache = new ReplayCache(300);
    expect(() => cache.observe("0xdeadbeef", 1_800_000_000)).not.toThrow();
    expect(cache.size()).toBe(1);
  });

  it("throws ReplayedIntentError on the second sighting of the same signature", () => {
    const cache = new ReplayCache(300);
    cache.observe("0xdeadbeef", 1_800_000_000);
    expect(() => cache.observe("0xdeadbeef", 1_800_000_000 + 5)).toThrow(ReplayedIntentError);
  });

  it("distinguishes two different signatures at the same instant", () => {
    const cache = new ReplayCache(300);
    cache.observe("0xdeadbeef", 1_800_000_000);
    expect(() => cache.observe("0xfeedcafe", 1_800_000_000)).not.toThrow();
    expect(cache.size()).toBe(2);
  });

  it("evicts expired entries and re-accepts the same signature once its TTL has passed", () => {
    const cache = new ReplayCache(300);
    cache.observe("0xdeadbeef", 1_800_000_000);
    // Same signature, one full TTL + one second later. `verifyLoop*` would
    // refuse it on staleness by now, but the cache alone should accept it.
    expect(() => cache.observe("0xdeadbeef", 1_800_000_000 + 301)).not.toThrow();
    expect(cache.size()).toBe(1);
  });

  it("stays bounded: touching the map at each observation evicts every prior entry that has aged out", () => {
    const cache = new ReplayCache(300);
    // A hundred publishes across a range wider than the TTL. The
    // opportunistic sweep on each `observe` keeps only the ones inside
    // the TTL against the newest observation.
    const start = 1_800_000_000;
    for (let i = 0; i < 100; i++) {
      cache.observe(`0x${i.toString(16).padStart(8, "0")}`, start + i * 10);
    }
    // Newest entry is at start + 990; TTL is 300; anything before start + 690
    // should be gone. 30 entries fit inside [690, 990].
    expect(cache.size()).toBeLessThanOrEqual(31);
  });

  it("refuses a zero or negative TTL at construction (defense against typos)", () => {
    expect(() => new ReplayCache(0)).toThrow();
    expect(() => new ReplayCache(-1)).toThrow();
  });
});
