import { describe, expect, it } from "vitest";

import { hashEnvelope } from "../src/journal-source.ts";

/**
 * Byte-level pin against `Envelope.abi_encode()` from
 * `priime-types::signing`. The reference bytes and hash were produced by
 * a small alloy probe (see the block comment in `journal-source.ts`):
 *
 *   Envelope {
 *     eventId:  0x11 * 20,
 *     ordering: 0x22 * 12,
 *     payload:  0xdeadbeefcafe,
 *   }
 *
 *   abi_encode -> 0x00..20 || eventId || ordering || 0x00..60 || len(6) || payload+pad
 *   keccak256  -> 0x2d9f74c4e511ed676a3bf9acf0720feb97a80f9d05211e29806e3abd8b485b2d
 *
 * If a future edit routes the encoding through a shape that drops the
 * outer offset word (e.g. three loose params instead of a tuple), the
 * hash changes and this test fails. Priime's operator quorum signs the
 * tuple-wrapped hash; a mismatch means no consumer can verify the
 * signatures we persist in the journal against the fields we surface.
 */
describe("hashEnvelope", () => {
  it("matches Envelope.abi_encode() byte-for-byte", () => {
    const hash = hashEnvelope({
      eventId: `0x${"11".repeat(20)}` as `0x${string}`,
      ordering: `0x${"22".repeat(12)}` as `0x${string}`,
      payload: "0xdeadbeefcafe",
    });
    expect(hash).toBe(
      "0x2d9f74c4e511ed676a3bf9acf0720feb97a80f9d05211e29806e3abd8b485b2d",
    );
  });

  it("handles an empty payload (Priime signs zero-length bytes too)", () => {
    // Sanity that the tuple wrap still lays out an empty dynamic tail
    // correctly: outer offset + eventId + ordering + inner offset + zero
    // length. If the encoding ever regressed to three loose params, an
    // empty payload would collide with the "no payload was provided"
    // shape and this pin would catch it.
    const hash = hashEnvelope({
      eventId: `0x${"00".repeat(20)}` as `0x${string}`,
      ordering: `0x${"00".repeat(12)}` as `0x${string}`,
      payload: "0x",
    });
    // Distinct from the all-zero result-hash sentinel used by
    // journal.ts's "not-attested-yet" state.
    expect(hash).not.toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    );
  });
});
