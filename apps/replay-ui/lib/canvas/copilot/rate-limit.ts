/**
 * In-process token bucket per IP (IT4_COPILOT_SPEC §1.7). Pure takeToken so
 * it unit-tests without a route. Capacity 10, refill 10 per 60s; on empty
 * bucket the caller gets retryAfterMs = time to the next token. The map is
 * pruned to the newest 5000 entries (Vercel instance memory hygiene).
 */

export interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

export const BUCKET_CAPACITY = 10;
export const REFILL_PER_MS = 10 / 60_000; // 10 tokens per minute
export const MAX_BUCKETS = 5000;

export type TakeResult = { ok: true } | { ok: false; retryAfterMs: number };

export function takeToken(map: Map<string, Bucket>, key: string, nowMs: number): TakeResult {
  const prev = map.get(key);
  let tokens = prev
    ? Math.min(BUCKET_CAPACITY, prev.tokens + (nowMs - prev.updatedAtMs) * REFILL_PER_MS)
    : BUCKET_CAPACITY;
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
  return { ok: false, retryAfterMs: Math.ceil((1 - tokens) / REFILL_PER_MS) };
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
