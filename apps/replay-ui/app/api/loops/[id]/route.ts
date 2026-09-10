/**
 * Proxy: GET /api/loops/[id] -> loop-server GET /loops/{id}.
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

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const res = await loopServerFetch(`/loops/${encodeURIComponent(id)}`, { method: "DELETE" });
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
