/**
 * `GET /api/canvas/orchestrate?regime=` — the router run, as the dock's panel
 * fetches it.
 *
 * THE FOLD ITSELF IS NOT HERE. It is `foldRouterRun` in
 * `lib/canvas/router-fold.ts`, because the vault page's Capital router
 * instrument states the same run's move count and last move without going
 * through HTTP, and two folds is two answers to one question. This file is
 * the transport: the regime off the query string, the answer as JSON, and the
 * one authored sentence a reader may see when it throws.
 */

import { NextResponse } from "next/server";

import { foldRouterRun } from "@/lib/canvas/router-fold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* SYNCHRONOUS, because the fold is. Next accepts a handler that returns a
   Response directly, and an `async` with nothing to await is a promise the
   route does not need and a lint the gate refuses. */
export function GET(req: Request): Response {
  try {
    const regime = new URL(req.url).searchParams.get("regime");
    return NextResponse.json(foldRouterRun(regime));
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "the router run did not answer" },
      { status: 500 },
    );
  }
}
