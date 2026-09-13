/**
 * Proxy: GET /api/loops/[id] -> loop-server GET /loops/{id}.
 *
 * Read-only. DELETE is not exposed here on purpose: the loop-server binds
 * 127.0.0.1 only, so the pause path (which spends the owner key's gas)
 * has no browser-reachable HTTP surface. An operator who legitimately
 * needs to pause a loop hits loop-server directly with the bearer token.
 */

import { NextResponse } from "next/server";

import { loopServerFetch } from "@/lib/loop-server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const res = await loopServerFetch(`/loops/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      return NextResponse.json({ error: "loop not found" }, { status: 404 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `loop-server ${String(res.status)}` }, { status: 502 });
    }
    return NextResponse.json((await res.json()) as unknown);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `loop-server unreachable: ${message}` }, { status: 502 });
  }
}
