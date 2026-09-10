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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ chainId: string }> },
): Promise<NextResponse> {
  const { chainId } = await params;
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
    const message = err instanceof Error ? err.message : String(err);
    return rpcError(id, -32603, `upstream unreachable: ${message}`);
  }
}
