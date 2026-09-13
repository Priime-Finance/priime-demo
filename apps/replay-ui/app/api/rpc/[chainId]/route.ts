/**
 * `POST /api/rpc/[chainId]` — server-side JSON-RPC proxy so the keyed
 * upstream endpoint (Alchemy on mainnet, anvil localhost on the fork) stays
 * out of the browser bundle.
 *
 * The browser wagmi transport (`lib/wagmi.ts`) posts a JSON-RPC envelope at
 * `/api/rpc/8453` (or `/31337` on the fork); this route forwards it verbatim
 * to `PRIIME_RPC_URL` and returns the response. A small allow-list of RPC
 * methods prevents someone from turning the endpoint into a free general-
 * purpose RPC for other apps.
 *
 * Failure modes are surfaced as JSON-RPC errors rather than HTTP 5xx so the
 * viem transport's own retry/backoff logic sees them the way it would a
 * direct RPC error.
 */

import { NextResponse } from "next/server";

import { clientIdentity } from "@/lib/request-identity";
import { RPC_BUCKET, takeToken, type Bucket } from "@/lib/canvas/copilot/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Only chain ids the demo actually deploys against. Extra ids reject up
 * front rather than proxying to a wrong endpoint.
 */
const ALLOWED_CHAIN_IDS: Record<string, true> = {
  "8453": true,
  "31337": true,
  "11155111": true,
};

/**
 * Read-only + write RPC methods this demo exercises. Everything wagmi's
 * `useReadContracts` / `useReadContract` batching produces plus the
 * transaction lifecycle. Requests for anything else return method-not-found
 * so the endpoint cannot be co-opted as a general-purpose RPC.
 */
const ALLOWED_METHODS: Record<string, true> = {
  eth_chainId: true,
  eth_blockNumber: true,
  eth_getBlockByNumber: true,
  eth_call: true,
  eth_getBalance: true,
  eth_getCode: true,
  eth_getStorageAt: true,
  eth_getLogs: true,
  eth_getTransactionByHash: true,
  eth_getTransactionReceipt: true,
  eth_getTransactionCount: true,
  eth_gasPrice: true,
  eth_maxPriorityFeePerGas: true,
  eth_feeHistory: true,
  eth_estimateGas: true,
  eth_sendRawTransaction: true,
  eth_syncing: true,
};
/** JSON-RPC error envelope, so viem's error path stays consistent. */
function rpcError(id: string | number | null, code: number, message: string): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: 200 });
}

/** Extract the RPC method from an unknown body via `in` narrowing. */
function methodOf(body: unknown): string | null {
  if (body === null || typeof body !== "object" || !("method" in body)) return null;
  const raw = body.method;
  return typeof raw === "string" ? raw : null;
}

/** Extract the RPC id from an unknown body via `in` narrowing. */
function idOf(body: unknown): string | number | null {
  if (body === null || typeof body !== "object" || !("id" in body)) return null;
  const raw = body.id;
  return typeof raw === "string" || typeof raw === "number" ? raw : null;
}

/**
 * Rate-limit buckets keyed by spoof-resistant client identity. `wagmi.ts`
 * documents this as promised behaviour — a same-origin browser client
 * gets a token bucket per identity; a rogue caller with `curl -X POST`
 * cannot burn our upstream RPC quota faster than the bucket allows.
 * Kept module-level so buckets survive across route invocations inside
 * the same Node process.
 */
const rpcBuckets = new Map<string, Bucket>();

/** Same-origin gate: this endpoint only exists to serve our own
 *  wallet + wagmi + subgraph reads. A `curl` from a foreign origin
 *  has no reason to reach it; a cross-site JS caller (via a
 *  compromised third-party embed) has none either. Missing origin
 *  or missing host: reject. Mirrors `apps/replay-ui/app/api/loops/route.ts`
 *  guard shape. */
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

/** Scrub URL-shaped substrings and long hex blobs from upstream error
 *  messages: `viem`/`fetch` wrap the full RPC URL (Alchemy key path
 *  included) inside transport-error strings, and this endpoint is
 *  reachable by any browser session. Cheap parity with the
 *  `friendlyErrorMessage` helper on the loop-server side. */
const URL_RE = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g;
function scrubUpstreamMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(URL_RE, "[url redacted]");
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ chainId: string }> },
): Promise<NextResponse> {
  const { chainId } = await params;
  if (!sameOrigin(req)) {
    // No JSON-RPC id at this point — the body hasn't been parsed yet.
    return rpcError(null, -32000, "cross-origin request refused");
  }
  if (ALLOWED_CHAIN_IDS[chainId] !== true) {
    return rpcError(null, -32601, `chain ${chainId} not proxied`);
  }

  const upstream = process.env.PRIIME_RPC_URL;
  if (typeof upstream !== "string" || upstream.length === 0) {
    return rpcError(null, -32603, "PRIIME_RPC_URL not configured");
  }

  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    return rpcError(null, -32700, "invalid JSON payload");
  }

  // Reject batch requests up front — viem never sends them and allowing
  // them would let a caller mix disallowed methods into a batch.
  if (Array.isArray(body)) {
    return rpcError(null, -32600, "batch requests not supported");
  }

  const method = methodOf(body);
  const id = idOf(body);
  if (method === null) {
    return rpcError(id, -32600, "missing method");
  }
  if (ALLOWED_METHODS[method] !== true) {
    return rpcError(id, -32601, `method ${method} not allowed`);
  }
  const take = takeToken(rpcBuckets, clientIdentity(req), Date.now(), RPC_BUCKET);
  if (!take.ok) {
    return rpcError(id, -32005, `rate limited, retry in ${String(take.retryAfterMs)}ms`);
  }

  try {
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // Node's fetch defaults are fine; no need to cache RPC responses.
      cache: "no-store",
    });
    // Pass the upstream body through verbatim so viem sees any RPC-level
    // error (revert data, gas estimation failures, rate limits) exactly as
    // the endpoint returned it.
    const text = await upstreamRes.text();
    return new NextResponse(text, {
      status: upstreamRes.status,
      headers: { "content-type": upstreamRes.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return rpcError(id, -32603, `upstream unreachable: ${scrubUpstreamMessage(err)}`);
  }
}
