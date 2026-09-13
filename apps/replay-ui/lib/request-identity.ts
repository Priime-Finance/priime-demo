/**
 * A best-effort caller identity for rate-limiting a Next.js route
 * handler. Callers give us a `Request` and get a stable string that a
 * regular browser client cannot simply rotate by sending a spoofed
 * `X-Forwarded-For` header.
 *
 * The header hierarchy (most trustworthy first):
 *
 *   1. `X-Vercel-Forwarded-For` — set by Vercel's edge and stripped
 *      from any inbound request. A client cannot forge this header
 *      against a Vercel deployment.
 *   2. `X-Real-IP` — set by common reverse proxies (nginx, Caddy,
 *      Cloudflare when configured). Same story: the proxy sets it and
 *      any client-supplied value is overwritten.
 *   3. The **last** entry of `X-Forwarded-For`. In a proxy chain the
 *      last hop is the one closest to us, so the last entry was set by
 *      the trusted proxy directly upstream — the FIRST entry, which
 *      most naive code uses, is whatever the ORIGINAL client sent and
 *      is fully attacker-controlled. See CVE-style writeups on
 *      "X-Forwarded-For header injection".
 *   4. `"local"` as a last-resort literal so a same-process bench run
 *      (no headers at all) still produces a stable key.
 *
 * This is NOT a security boundary — a determined attacker behind a
 * botnet still gets multiple identities. It IS an abuse-cost floor:
 * one browser session cannot mint infinite rate-limit buckets by
 * cycling `X-Forwarded-For` values.
 */
export function clientIdentity(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel !== null && vercel.length > 0) {
    const first = vercel.split(",")[0];
    if (first !== undefined) return first.trim();
  }

  const real = req.headers.get("x-real-ip");
  if (real !== null && real.length > 0) return real.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff !== null && xff.length > 0) {
    // Last entry = closest trusted proxy in the chain.
    const parts = xff.split(",");
    const last = parts[parts.length - 1];
    if (last !== undefined) {
      const trimmed = last.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  return "local";
}
