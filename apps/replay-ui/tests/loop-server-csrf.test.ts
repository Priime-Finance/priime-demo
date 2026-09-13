import { afterEach, describe, expect, it, vi } from "vitest";

import * as loopIdRoute from "@/app/api/loops/[id]/route";
import { POST } from "@/app/api/loops/route";

/**
 * The CSRF gate on the mutating proxy routes.
 *
 * `/api/loops` POST spends the owner key's gas on the loop-server side, so
 * it cannot be reachable to a cross-origin browser. Two independent
 * guards defend it:
 *
 *   1. `content-type: application/json` is required. Simple-request POSTs
 *      (`text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`)
 *      go without a CORS preflight and are the canonical CSRF vehicle;
 *      requiring `application/json` forces a preflight the route does not
 *      answer.
 *   2. `Origin` must match this request's own host. Cross-site fetches send
 *      a different origin and are rejected.
 *
 * `/api/loops/[id]` deliberately does NOT expose a DELETE handler at all —
 * the loop-server binds 127.0.0.1 only, so the pause route has no
 * browser-reachable HTTP surface without a matching proxy handler. That
 * absence is verified here so a future edit that re-adds it goes through
 * this file.
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});
function makeRequest(init: {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  url?: string;
}): Request {
  const headers: Record<string, string> = { host: "localhost:3000", ...init.headers };
  return new Request(init.url ?? "http://localhost:3000/api/loops", {
    method: init.method,
    headers,
    body: init.body,
  });
}

describe("POST /api/loops CSRF gates", () => {
  it("rejects text/plain even when the body parses as JSON", async () => {
    const res = await POST(
      makeRequest({
        method: "POST",
        headers: { "content-type": "text/plain", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "x", strategist: "0x0", cronSeconds: 60, candidateId: "y", targetLeverage: 1 }),
      }),
    );
    expect(res.status).toBe(415);
  });

  it("rejects application/x-www-form-urlencoded, the classic CSRF wire format", async () => {
    const res = await POST(
      makeRequest({
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "http://localhost:3000",
        },
        body: "name=x&strategist=0x0",
      }),
    );
    expect(res.status).toBe(415);
  });

  it("rejects a cross-origin JSON POST", async () => {
    const res = await POST(
      makeRequest({
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://evil.example" },
        body: JSON.stringify({ name: "x", strategist: "0x0", cronSeconds: 60, candidateId: "y", targetLeverage: 1 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a JSON POST with no Origin header", async () => {
    const res = await POST(
      makeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x", strategist: "0x0", cronSeconds: 60, candidateId: "y", targetLeverage: 1 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("accepts a same-origin JSON POST and forwards to loop-server", async () => {
    process.env.LOOP_SERVER_URL = "http://127.0.0.1:8090";
    process.env.LOOP_SERVER_TOKEN = "demo-token-0123456789abcdef";
    let seenPath: string | null = null;
    vi.stubGlobal("fetch", (url: string) => {
      seenPath = url;
      return Promise.resolve(
        new Response(JSON.stringify({ loop: { id: "loop-abcd1234" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const res = await POST(
      makeRequest({
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "x", strategist: "0x0", cronSeconds: 60, candidateId: "y", targetLeverage: 1 }),
      }),
    );
    expect(res.status).toBe(201);
    expect(seenPath).toBe("http://127.0.0.1:8090/loops");
  });
});

describe("DELETE /api/loops/[id] is not exposed", () => {
  it("does not export a DELETE handler", () => {
    expect("DELETE" in (loopIdRoute as Record<string, unknown>)).toBe(false);
  });
});
