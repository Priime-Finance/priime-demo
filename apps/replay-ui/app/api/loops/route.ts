/**
 * Proxy: GET /api/loops -> loop-server GET /loops (list loops).
 *          POST /api/loops -> loop-server POST /loops (deploy a loop).
 *
 * Server-side so the bearer token never crosses the wire to the browser.
 * Falls through to 502 if the server is unreachable so the client can
 * degrade to captured journals instead of blanking; POST maps loop-server's
 * own status codes through (400 for invalid config, 500 otherwise).
 */

import { NextResponse } from "next/server";

import { loopServerFetch } from "@/lib/loop-server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const res = await loopServerFetch("/loops");
    if (!res.ok) {
      return NextResponse.json({ error: `loop-server ${String(res.status)}` }, { status: 502 });
    }
    return NextResponse.json((await res.json()) as unknown);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `loop-server unreachable: ${message}` }, { status: 502 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
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
