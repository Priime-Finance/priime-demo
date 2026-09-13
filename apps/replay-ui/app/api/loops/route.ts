/**
 * Proxy: GET /api/loops -> loop-server GET /loops (list loops).
 *          POST /api/loops -> loop-server POST /loops (deploy a loop).
 *
 * The bearer token stays on the server. POST is a state-changing route that
 * spends the owner key's gas, so every mutation is guarded on two axes:
 *
 *   1. `content-type` MUST be `application/json`. A `text/plain` or
 *      `application/x-www-form-urlencoded` POST is a "simple request" that
 *      the browser will issue cross-origin with no preflight, so it is the
 *      canonical CSRF vehicle. Requiring `application/json` forces a
 *      preflight, and the preflight fails because we do not send CORS
 *      headers.
 *   2. `Origin` MUST match this request's own host. Same-origin fetches
 *      from the browser send exactly that; cross-origin fetches send a
 *      different origin and are rejected. `Origin` is always set on
 *      state-changing requests from modern browsers.
 *
 * Both guards are cheap and defensive: either alone stops the same class of
 * attack. Keeping both means a browser bug that drops one still fails the
 * other.
 */

import { NextResponse } from "next/server";

import { loopServerFetch } from "@/lib/loop-server";

export const dynamic = "force-dynamic";

/** Same-origin gate: the `Origin` header's host must match the `Host` header the client sent. `req.url` under `next dev` is often normalized to the internal `localhost` even when the client used `127.0.0.1`, so we key off the client-visible `Host` instead. Missing origin or missing host: reject; the mutating path is not a place to guess. */
function sameOrigin(req: Request): boolean {
  const originHeader = req.headers.get("origin");
  const hostHeader = req.headers.get("host");
  if (originHeader === null || hostHeader === null) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(originHeader);
  } catch {
    return false;
  }
  return originUrl.host.toLowerCase() === hostHeader.toLowerCase();
}

export async function GET(req: Request): Promise<NextResponse> {
  // Forward the strategist filter through untouched — the shape is checked
  // and rejected on the loop-server side, so this proxy stays a byte pipe.
  const strategist = new URL(req.url).searchParams.get("strategist");
  const path = strategist === null ? "/loops" : `/loops?strategist=${encodeURIComponent(strategist)}`;
  try {
    const res = await loopServerFetch(path);
    if (!res.ok) {
      return NextResponse.json({ error: `loop-server ${String(res.status)}` }, { status: res.status === 400 ? 400 : 502 });
    }
    return NextResponse.json((await res.json()) as unknown);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `loop-server unreachable: ${message}` }, { status: 502 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const contentType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "content-type must be application/json" }, { status: 415 });
  }
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "cross-origin request refused" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await loopServerFetch("/loops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (res.status === 201) {
      return NextResponse.json(payload, { status: 201 });
    }
    if (res.status === 400) {
      return NextResponse.json(payload ?? { error: "invalid config" }, { status: 400 });
    }
    return NextResponse.json(payload ?? { error: `loop-server ${String(res.status)}` }, { status: 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `loop-server unreachable: ${message}` }, { status: 502 });
  }
}
