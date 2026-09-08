/**
 * Server-side helper for hitting loop-server.
 *
 * Route handlers under `app/api/loops/*` use this so the bearer token stays
 * on the server. Called from Node runtime only; do not import from a client
 * component.
 */

export interface LoopServerConfig {
  baseUrl: string;
  token: string;
}

/**
 * The token `deploy/run-live-demo.sh` already hands loop-server, so a clone
 * with no .env.local can publish against a local fork without being told a
 * secret first. It is not one: the same string is committed in that script
 * and printed three times in docs/LIVE_DEMO.md.
 *
 * IT APPLIES TO LOCALHOST ONLY. loop-server deploys handlers with a funded
 * owner key, so a default that reached a remote host would be a published
 * credential for a service that spends money. Off localhost the variable is
 * required and its absence is fatal, which is the same rule
 * `deploy/targets/mainnet.json` keeps: the fork defaults everything, a real
 * chain defaults nothing.
 */
const LOCAL_DEV_TOKEN = "demo-token-0123456789abcdef";

function isLocal(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

function loopServerConfig(): LoopServerConfig {
  const baseUrl = process.env.LOOP_SERVER_URL ?? "http://127.0.0.1:8090";
  const token = process.env.LOOP_SERVER_TOKEN ?? (isLocal(baseUrl) ? LOCAL_DEV_TOKEN : "");
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

/** Fetch a loop-server route with bearer auth. Never throws on non-2xx;
 *  callers inspect `res.status` and map errors themselves. */
export async function loopServerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { baseUrl, token } = loopServerConfig();
  if (token === "") {
    throw new Error(
      "LOOP_SERVER_TOKEN is not set, and loop-server is not on localhost so the demo default does not apply",
    );
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers, cache: "no-store" });
}
