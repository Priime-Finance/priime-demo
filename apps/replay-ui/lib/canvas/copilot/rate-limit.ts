/**
 * In-process token bucket per IP. Pure `takeToken` so it unit-tests
 * without a route. Default capacity 10, refill 10 per 60s (copilot);
 * callers with cheaper per-request cost (RPC proxy) pass a widened
 * config so the same guard doesn't stall a normal browser session.
 * The map is pruned to the newest 5000 entries (Vercel instance
 * memory hygiene).
 */

export interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

/** Default copilot-flavoured limits (unchanged from Copilot spec §1.7). */
export const BUCKET_CAPACITY = 10;
export const REFILL_PER_MS = 10 / 60_000; // 10 tokens per minute
export const MAX_BUCKETS = 5000;

export interface BucketConfig {
  /** Max tokens the bucket can hold. */
  capacity: number;
  /** Tokens returned per millisecond. */
  refillPerMs: number;
}

/** Copilot: 10 requests per minute — Anthropic tokens cost money. */
export const COPILOT_BUCKET: BucketConfig = {
  capacity: BUCKET_CAPACITY,
  refillPerMs: REFILL_PER_MS,
};

/**
 * RPC proxy: 600 requests per minute (10/sec, burst 600). A single
 * DepositCard fires 5-15 reads per 12-second poll (multicall-batched
 * balance/allowance/pending/claimable + a few standalone gas/chainId
 * probes), plus wallet event listeners can flood a page-load spike.
 * The same-origin gate is the actual abuse control here; the bucket
 * is defense-in-depth against a rogue tab on the SAME origin, so the
 * ceiling is tuned to a real browser session's high-water mark.
 */
export const RPC_BUCKET: BucketConfig = {
  capacity: 600,
  refillPerMs: 600 / 60_000,
};

export type TakeResult = { ok: true } | { ok: false; retryAfterMs: number };

export function takeToken(
  map: Map<string, Bucket>,
  key: string,
  nowMs: number,
  cfg: BucketConfig = COPILOT_BUCKET,
): TakeResult {
  const prev = map.get(key);
  let tokens = prev
    ? Math.min(cfg.capacity, prev.tokens + (nowMs - prev.updatedAtMs) * cfg.refillPerMs)
    : cfg.capacity;
  if (tokens >= 1) {
    tokens -= 1;
    map.delete(key); // re-insert so Map order tracks recency for pruning
    map.set(key, { tokens, updatedAtMs: nowMs });
    prune(map);
    return { ok: true };
  }
  map.delete(key);
  map.set(key, { tokens, updatedAtMs: nowMs });
  prune(map);
  return { ok: false, retryAfterMs: Math.ceil((1 - tokens) / cfg.refillPerMs) };
}

function prune(map: Map<string, Bucket>): void {
  if (map.size <= MAX_BUCKETS) return;
  const excess = map.size - MAX_BUCKETS;
  let i = 0;
  for (const k of map.keys()) {
    if (i++ >= excess) break;
    map.delete(k);
  }
}
