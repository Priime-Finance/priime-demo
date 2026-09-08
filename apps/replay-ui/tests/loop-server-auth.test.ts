import { afterEach, describe, expect, it, vi } from "vitest";

import { loopServerFetch } from "@/lib/loop-server";

/**
 * THE ONE PLACE A CREDENTIAL IS DEFAULTED, and the boundary that keeps it
 * harmless.
 *
 * `lib/loop-server.ts` falls back to the demo token so a fresh clone can
 * publish against a local fork without being handed a secret first. The
 * token is not one: `deploy/run-live-demo.sh` and `docs/LIVE_DEMO.md` both
 * carry the same string in the open.
 *
 * The rule that makes it safe is that the fallback is LOCALHOST ONLY.
 * loop-server deploys handlers with a funded owner key, so a default that
 * reached a remote host would publish a working credential for a service
 * that spends money. These tests are the gate on that rule; a change that
 * widens the fallback has to delete one of them to land.
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

/** Capture the Authorization header `loopServerFetch` sends, if it sends one. */
async function authHeaderFor(baseUrl: string, token?: string): Promise<string | null> {
  process.env.LOOP_SERVER_URL = baseUrl;
  if (token === undefined) delete process.env.LOOP_SERVER_TOKEN;
  else process.env.LOOP_SERVER_TOKEN = token;
  let seen: string | null = null;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    seen = new Headers(init.headers).get("authorization");
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  await loopServerFetch("/loops");
  return seen;
}

describe("loop-server auth", () => {
  it("defaults the demo token on localhost, so a clone runs with no .env.local", async () => {
    for (const url of ["http://127.0.0.1:8090", "http://localhost:8090"]) {
      expect(await authHeaderFor(url)).toBe("Bearer demo-token-0123456789abcdef");
    }
  });

  it("never defaults a token off localhost", async () => {
    process.env.LOOP_SERVER_URL = "https://loops.example.com";
    delete process.env.LOOP_SERVER_TOKEN;
    await expect(loopServerFetch("/loops")).rejects.toThrow(/LOOP_SERVER_TOKEN is not set/);
  });

  it("fails closed when the base url cannot be parsed", async () => {
    /* An unparseable host is not localhost. Reading it as one would hand the
       default to whatever the string actually resolves to. */
    process.env.LOOP_SERVER_URL = "not a url";
    delete process.env.LOOP_SERVER_TOKEN;
    await expect(loopServerFetch("/loops")).rejects.toThrow(/LOOP_SERVER_TOKEN is not set/);
  });

  it("always prefers a configured token over the default", async () => {
    expect(await authHeaderFor("http://127.0.0.1:8090", "real-token")).toBe("Bearer real-token");
    expect(await authHeaderFor("https://loops.example.com", "real-token")).toBe("Bearer real-token");
  });
});
