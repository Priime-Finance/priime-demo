/**
 * Proxy: GET /api/loops/[id]/journals -> loop-server GET /loops/{id}/journals.
 *
 * The upstream returns `Journal[]` (matches `schema/journal.v1.schema.json`),
 * so consumers can drop this response into the same code paths that read
 * `schema/samples/*.json`. `?limit=N` is forwarded verbatim.
 */

import { NextResponse } from "next/server";

import { loopServerFetch } from "@/lib/loop-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const search = new URL(req.url).search;
  try {
    const res = await loopServerFetch(`/loops/${encodeURIComponent(id)}/journals${search}`);
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
