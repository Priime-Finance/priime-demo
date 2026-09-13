/**
 * Replay guard for the mutating loop-server routes.
 *
 * `verifyLoopPublish` and `verifyLoopPause` refuse a stale signature and a
 * signature that recovers to the wrong address. Neither refuses a
 * signature that arrives twice inside the freshness window: the same
 * strategist-signed publish body carries a fresh crypto.randomUUID for the
 * loop id on the server side, so a captured signature replayed inside its
 * 5-minute window would spawn a second vault deploy on the owner's gas.
 * This cache is the guard: on first sight, record the signature and let
 * the request through; on a second sight of the same signature, refuse
 * with `ReplayedIntentError`.
 *
 * Bounded in memory: entries evict once their signature is past the age
 * `verifyLoop*` already refuses on its own, so the cache never grows
 * without limit. The size ceiling is the sustained publish rate times the
 * age window (5 min); at the current demo scale that is a handful of
 * entries at once.
 */

/** Raised on the second sighting of a signature that already passed
 *  freshness + recovery. The response is `409` so the caller can retry
 *  with a fresh signature. */
export class ReplayedIntentError extends Error {
  constructor(signature: string) {
    // The signature itself is not sensitive — it is not a secret and is
    // recoverable to the caller's own public address. Including its head
    // in the error helps a legitimate retry differentiate one signed
    // publish from another.
    super(`signature has already been consumed inside its freshness window (${signature.slice(0, 18)}...)`);
    this.name = "ReplayedIntentError";
  }
}

/** In-memory single-use signature cache. Insert-if-new is the entire API. */
export class ReplayCache {
  /** `signature -> unix-seconds this entry expires`. */
  private readonly entries = new Map<string, number>();
  private readonly ttlSeconds: number;

  constructor(ttlSeconds: number) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error(`ttlSeconds must be a positive integer, got ${String(ttlSeconds)}`);
    }
    this.ttlSeconds = ttlSeconds;
  }
  /**
   * Record a signature. Returns `true` when the signature was new (and is
   * now stored); throws `ReplayedIntentError` when the same signature has
   * been recorded before inside its TTL. Evicts expired entries opportunistically
   * on every call so the map never outgrows one TTL of traffic.
   */
  observe(signature: string, nowSeconds: number): void {
    this.evictExpired(nowSeconds);
    if (this.entries.has(signature)) {
      throw new ReplayedIntentError(signature);
    }
    this.entries.set(signature, nowSeconds + this.ttlSeconds);
  }

  /** Test seam: current live-entry count. */
  size(): number {
    return this.entries.size;
  }

  private evictExpired(nowSeconds: number): void {
    for (const [sig, expiry] of this.entries) {
      if (expiry <= nowSeconds) this.entries.delete(sig);
    }
  }
}
