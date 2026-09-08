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

function loopServerConfig(): LoopServerConfig {
  const baseUrl = process.env.LOOP_SERVER_URL ?? "http://127.0.0.1:8090";
  const token = process.env.LOOP_SERVER_TOKEN ?? "";
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

/** Fetch a loop-server route with bearer auth. Never throws on non-2xx;
 *  callers inspect `res.status` and map errors themselves. */
export async function loopServerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { baseUrl, token } = loopServerConfig();
  if (token === "") {
    throw new Error("LOOP_SERVER_TOKEN is not set");
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers, cache: "no-store" });
}
