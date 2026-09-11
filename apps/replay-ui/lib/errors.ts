/**
 * Friendly error message extraction.
 *
 * viem's `BaseError` walks the wallet + RPC + revert stack up a chain of
 * `cause`s and joins each layer into one `.message` string. That message
 * carries every layer's URL, hex request body, response headers, docs
 * link, and version stamp; when a page renders it verbatim, the user
 * sees their own RPC endpoint (or `/api/rpc/8453` in our case, plus
 * whatever calldata) as a scrollable italic block. That is the shape
 * roadmap P0 #3 called out.
 *
 * viem also exposes a per-layer `.shortMessage` on every `BaseError`
 * subclass — the one-line English summary of what went wrong. Everything
 * else on `.message` is metadata for a debugger, not a user. This helper
 * pulls the deepest `shortMessage` out of the cause chain and falls back
 * to the raw `.message`'s first line for anything else (native `Error`,
 * plain strings).
 *
 * Kept purely functional so the DepositCard, RedeemCard, PublishFlow and
 * the pause action can all rely on the same one-line surface.
 */

/** Deepest `shortMessage` string in the cause chain, or `null`. */
function deepestShortMessage(err: unknown): string | null {
  let cursor: unknown = err;
  let deepest: string | null = null;
  // Cap the walk so a self-referential `cause` cannot loop forever. Ten
  // layers covers wallet -> RPC -> revert -> internal wrapper -> viem
  // internal chain, with room to spare.
  for (let i = 0; i < 10; i += 1) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") break;
    if ("shortMessage" in cursor) {
      const short = cursor.shortMessage;
      if (typeof short === "string" && short.length > 0) {
        deepest = short;
      }
    }
    cursor = "cause" in cursor ? cursor.cause : null;
  }
  return deepest;
}
/** First non-blank line of a multi-line `.message`. */
function firstLine(message: string): string {
  const line = message.split("\n").find((l) => l.trim().length > 0);
  return line !== undefined ? line.trim() : message.trim();
}

/**
 * One-line, user-facing summary of an unknown error. Peels viem's cause
 * chain for the deepest `shortMessage`; on native `Error`s, returns the
 * first non-blank line of `.message`; on anything else, `String(err)`.
 *
 * Never returns an empty string.
 */
export function friendlyErrorMessage(err: unknown): string {
  const short = deepestShortMessage(err);
  if (short !== null) return short;
  if (err instanceof Error) {
    const trimmed = firstLine(err.message);
    return trimmed.length > 0 ? trimmed : "unknown error";
  }
  const s = String(err);
  return s.length > 0 ? s : "unknown error";
}
