import { describe, expect, it } from "vitest";

import { formatAssetAmount, parseAssetAmount } from "../lib/vaults/deposit";

/** USDC decimals — the number every deposit-path caller passes today. */
const USDC = 6;

describe("parseAssetAmount", () => {
  it("parses whole numbers into base units", () => {
    expect(parseAssetAmount("100", USDC)).toBe(100_000_000n);
  });

  it("parses fractional amounts, padding to the requested precision", () => {
    expect(parseAssetAmount("1.5", USDC)).toBe(1_500_000n);
    expect(parseAssetAmount("0.000001", USDC)).toBe(1n);
  });

  it("accepts a leading period", () => {
    expect(parseAssetAmount(".25", USDC)).toBe(250_000n);
  });

  it("rejects too many fractional digits so we never silently truncate", () => {
    expect(parseAssetAmount("1.1234567", USDC)).toBeNull();
  });

  it("rejects empty and malformed input", () => {
    expect(parseAssetAmount("", USDC)).toBeNull();
    expect(parseAssetAmount(" ", USDC)).toBeNull();
    expect(parseAssetAmount(".", USDC)).toBeNull();
    expect(parseAssetAmount("abc", USDC)).toBeNull();
    expect(parseAssetAmount("1.2.3", USDC)).toBeNull();
    // A leading minus is refused so a `-5` in the input box never becomes
    // `5` after the regex fails — the whole string is rejected.
    expect(parseAssetAmount("-5", USDC)).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseAssetAmount("  42.5  ", USDC)).toBe(42_500_000n);
  });
});

describe("formatAssetAmount", () => {
  it("renders whole units without decorations", () => {
    expect(formatAssetAmount(100_000_000n, USDC)).toBe("100");
  });

  it("trims trailing zeros in the fractional part", () => {
    expect(formatAssetAmount(1_500_000n, USDC)).toBe("1.5");
    expect(formatAssetAmount(100n, USDC)).toBe("0.0001");
  });

  it("caps the fractional part at maxFractionDigits", () => {
    // A dust amount that would otherwise print as `0.000001` gets trimmed
    // to 4 digits in a UI that requested it.
    expect(formatAssetAmount(1n, USDC, 4)).toBe("0");
  });

  it("round-trips values parsed back through parseAssetAmount", () => {
    for (const raw of ["0", "1", "1.5", "0.0001", "9999.999999"]) {
      const parsed = parseAssetAmount(raw, USDC)!;
      expect(formatAssetAmount(parsed, USDC)).toBe(raw === "0" ? "0" : raw);
    }
  });

  it("returns 0 for zero input, no decimal point", () => {
    expect(formatAssetAmount(0n, USDC)).toBe("0");
  });
});
