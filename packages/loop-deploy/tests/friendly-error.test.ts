import { describe, expect, it } from "vitest";

import { friendlyErrorMessage } from "../src/friendly-error.ts";

describe("friendlyErrorMessage", () => {
  it("redacts an https provider URL with an API key in the path", () => {
    // Realistic viem transport-error shape: the URL, key path and all.
    const err = new Error(
      'HTTP request failed. URL: https://base-mainnet.g.alchemy.com/v2/alch_SECRET_KEY_HERE. Status: 429.',
    );
    const out = friendlyErrorMessage(err);
    expect(out).not.toContain("alch_SECRET_KEY_HERE");
    expect(out).not.toContain("alchemy");
    expect(out).toContain("[url redacted]");
    // Still legible.
    expect(out).toContain("HTTP request failed");
    expect(out).toContain("Status: 429");
  });

  it("redacts wss:// endpoints too (viem websocket transport)", () => {
    const out = friendlyErrorMessage(
      new Error("WebSocket disconnected from wss://mainnet.provider.example/v1/API_KEY"),
    );
    expect(out).not.toContain("API_KEY");
    expect(out).not.toContain("provider.example");
    expect(out).toContain("[url redacted]");
  });

  it("redacts bearer tokens", () => {
    const out = friendlyErrorMessage(
      new Error("upstream refused Authorization: Bearer sk_live_deadbeef"),
    );
    expect(out).not.toContain("sk_live_deadbeef");
    expect(out).toContain("Bearer [redacted]");
  });

  it("redacts long 0x hex blobs (raw txs, private keys) but leaves addresses and bytes32 alone", () => {
    /* Addresses (20 bytes = 42 chars) and bytes32 hashes (66 chars)
       are legitimate for a caller to see: they land unchanged. Longer
       hex blobs (68+ chars — the threshold sits just above bytes32)
       are always suspicious in an error message and are scrubbed. */
    const address = "0x1234567890abcdef1234567890abcdef12345678"; // 42 chars
    const bytes32 = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"; // 66 chars
    const rawTx = "0x02f8" + "ab".repeat(60); // 128 chars — deliberately over threshold
    const out = friendlyErrorMessage(new Error(`ctx: ${address} hash: ${bytes32} tx: ${rawTx}`));
    expect(out).toContain(address);
    expect(out).toContain(bytes32);
    expect(out).not.toContain(rawTx);
    expect(out).toContain("0x[redacted]");
  });

  it("passes strings without URLs, tokens or long hex through unchanged", () => {
    expect(friendlyErrorMessage(new Error("nonce too low")))
      .toBe("nonce too low");
  });

  it("handles non-Error values by stringifying first", () => {
    expect(friendlyErrorMessage("plain string https://leak.example/key"))
      .toBe("plain string [url redacted]");
    expect(friendlyErrorMessage({ toString: () => "obj at https://k.example/2" }))
      .toBe("obj at [url redacted]");
  });
});
