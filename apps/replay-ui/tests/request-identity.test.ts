import { describe, expect, it } from "vitest";

import { clientIdentity } from "@/lib/request-identity";

/** Construct a fake `Request` where only the headers matter. */
function reqWith(headers: Record<string, string>): Request {
  return new Request("https://example.com/probe", { headers });
}

describe("clientIdentity", () => {
  it("prefers x-vercel-forwarded-for over everything else", () => {
    /* Vercel's edge sets this header and strips any inbound copy, so
       it is the one entry a browser client cannot forge. */
    const req = reqWith({
      "x-vercel-forwarded-for": "203.0.113.9",
      "x-real-ip": "10.0.0.2",
      "x-forwarded-for": "192.0.2.1, 10.0.0.2",
    });
    expect(clientIdentity(req)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip when x-vercel-forwarded-for is absent", () => {
    const req = reqWith({
      "x-real-ip": "198.51.100.17",
      "x-forwarded-for": "attacker-value, 10.0.0.2",
    });
    expect(clientIdentity(req)).toBe("198.51.100.17");
  });

  it("uses the LAST x-forwarded-for hop, never the attacker-set first hop", () => {
    /* This is the whole point of the helper: a browser client can
       prepend arbitrary values to the header, but the last entry is
       the one set by the trusted reverse proxy immediately upstream.
       Naive code that uses `xff.split(',')[0]` lets an attacker mint
       a fresh rate-limit identity per request. */
    const req = reqWith({
      "x-forwarded-for": "SPOOFED-BY-ATTACKER, 10.0.0.2, 203.0.113.9",
    });
    expect(clientIdentity(req)).toBe("203.0.113.9");
    expect(clientIdentity(req)).not.toContain("SPOOFED");
  });

  it("returns \"local\" when no forwarding header is present", () => {
    /* Direct same-process bench runs don't set any of the proxy
       headers. Still needs a stable key so the rate-limit map has
       something to bucket into. */
    expect(clientIdentity(reqWith({}))).toBe("local");
  });

  it("skips empty header values and trims whitespace", () => {
    // Edge case: some proxies pad values with whitespace.
    const req = reqWith({
      "x-vercel-forwarded-for": "  203.0.113.42  ",
    });
    expect(clientIdentity(req)).toBe("203.0.113.42");
  });
});
