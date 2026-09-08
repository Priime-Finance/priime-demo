import { NextResponse } from "next/server";
import { demoVenues } from "@/lib/canvas/catalog-server";

export const dynamic = "force-dynamic";

/**
 * The market catalog the canvas discovers: the six committed scanner snapshots
 * with the demo market's row spliced in, from the one loader
 * (`lib/canvas/catalog-server.ts`) the copilot route reads too.
 *
 * `?refresh=1` and `?venues=` are the live loader's controls over a durable
 * store this build does not have; they are read by nothing here.
 */
export function GET() {
  return NextResponse.json(demoVenues(Date.now()));
}
