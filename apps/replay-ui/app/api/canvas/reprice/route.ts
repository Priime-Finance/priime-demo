import { NextResponse } from "next/server";

// INTENTIONAL 501: this build ships no live quote service. The client reads
// the JSON body, classifies the answer as `failed` (definitive, not `gone`),
// and falls back to the offline mock quote (lib/canvas/mock-quote.ts), which
// prices the canvas client-side. A real 404 stays reserved for its own
// meaning: the market left the live scan.
export function POST() {
  return NextResponse.json(
    { ok: false, error: "no live quote service in this build" },
    { status: 501 },
  );
}
