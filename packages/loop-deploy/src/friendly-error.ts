/**
 * Convert a caught error into a message safe to persist on a public
 * record or return in an unauthenticated response. The default surface
 * for viem transport errors embeds the full RPC URL (which usually
 * carries a provider API key in the path), and the deployer persists
 * whatever `err.message` says on `LoopRecord.error` — served through
 * the unauthenticated `GET /loops` endpoint. Strip URLs and known
 * secret shapes so a leaked message can't be replayed.
 *
 * Never truncates the useful text: a "connection refused" still reads
 * as "connection refused" once every URL is redacted. Never hides
 * information the caller ALREADY knows (chain id, method name); only
 * removes fields no unauthenticated reader is entitled to.
 */

/** URL matcher: `scheme://` up to the first whitespace or angle. Covers
 *  every viem transport-error shape observed (`http://…/v2/<key>`,
 *  `wss://…/v2/<key>`, `HTTP request failed. URL: http://…`). */
const URL_RE = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g;

/** Bearer token shape used by the loop-server auth header. Matches
 *  headers viem or a proxy library might echo back inside an error. */
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/g;

/** 0x-prefixed hex runs 32 bytes or longer. Covers a stray raw
 *  transaction (`0x02f8…`) or private-key material (`0x…64 hex`). Does
 *  not match short bytes4 selectors, addresses (20 bytes = 42 chars)
 *  or bytes32 hashes (32 bytes = 66 chars) that a caller has a
 *  legitimate need to see — the threshold sits above bytes32. */
const LONG_HEX_RE = /0x[0-9a-fA-F]{68,}/g;

export function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(URL_RE, "[url redacted]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(LONG_HEX_RE, "0x[redacted]")
    // Collapse the whitespace left by inline redactions so a
    // "URL: [url redacted]." reads cleanly instead of `URL:  .`.
    .replace(/[ \t]+([.,;])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
