/**
 * Lossless JSON for service.json.
 *
 * Priime `Timestamp` serializes as a bare integer of nanoseconds since the
 * epoch (~1.8e18), which exceeds Number.MAX_SAFE_INTEGER. A naive
 * JSON.parse/stringify round trip silently corrupts those fields and the
 * node would then see a different trigger window than the one deployed.
 *
 * Node >= 21 ships the V8 "JSON.parse source access" proposal and
 * `JSON.rawJSON`, which together give an exact round trip with no
 * dependency: unsafe integers parse to BigInt, BigInt stringifies back to
 * the raw digits.
 */

// TS lib.d.ts does not model JSON.rawJSON / reviver source access yet; the
// runtime presence is checked before use.
const jsonRuntime = JSON as unknown as { rawJSON?: (s: string) => unknown };

/** Parse JSON, converting integers outside the safe range to BigInt. */
export function parseLossless(text: string): unknown {
  return JSON.parse(text, function reviver(_key, value, context?: { source?: string }) {
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      !Number.isSafeInteger(value) &&
      typeof context?.source === "string" &&
      /^-?\d+$/.test(context.source)
    ) {
      return BigInt(context.source);
    }
    return value;
  });
}

/** Stringify JSON, emitting BigInt values as raw integer literals. */
export function stringifyLossless(value: unknown, space?: number): string {
  const rawJSON = jsonRuntime.rawJSON;
  if (typeof rawJSON !== "function") {
    throw new Error("JSON.rawJSON is unavailable: Node >= 21 is required for lossless service.json handling");
  }
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? rawJSON(v.toString()) : v),
    space,
  );
}
