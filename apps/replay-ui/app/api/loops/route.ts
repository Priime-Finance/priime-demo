/**
 * Proxy: GET /api/loops -> loop-server GET /loops.
 *
 * Server-side so the bearer token never crosses the wire to the browser.
 * Falls through to a 502 if the server is unreachable so the client can
 * degrade to captured journals instead of blanking.
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
    const body: unknown = await res.json();
    return NextResponse.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `loop-server unreachable: ${message}` }, { status: 502 });
  }
}
