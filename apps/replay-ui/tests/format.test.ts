/**
 * Display-helper tests. Values come from the real captures in
 * schema/samples/ wherever a real value exists, so the assertions double as
 * a check that the samples still say what the UI copy assumes.
 */
import { describe, expect, it } from "vitest";

import { strikeSabotage, strikeSettled } from "@/lib/journal";
import {
  EMPTY_TIME,
  explorerAddressUrl,
  explorerBaseUrl,
  explorerTxUrl,
  formatNavPct,
  formatUtcTime,
  truncateAddress,
  truncateHash,
} from "@/lib/format";

const honestNav = strikeSettled.operators[0]!.nav; // "500000000"
const inflatedNav = strikeSabotage.operators[2]!.nav; // "750000000"

describe("formatNavPct", () => {
  it("renders the saboteur's inflation as a signed percentage of the settled NAV", () => {
    expect(formatNavPct(inflatedNav, honestNav)).toBe("+50.00%");
  });

  it("renders a negative move", () => {
    expect(formatNavPct(honestNav, inflatedNav)).toBe("-33.33%");
  });

  it("renders no change without a sign", () => {
    expect(formatNavPct(honestNav, honestNav)).toBe("0.00%");
  });

  it("keeps sub-1% moves visible", () => {
    expect(formatNavPct("500250000", honestNav)).toBe("+0.05%");
    expect(formatNavPct("499750000", honestNav)).toBe("-0.05%");
  });

  it("rounds halves away from zero, symmetrically", () => {
    // 1/8000 = 0.0125% -> 12.5 thousandths of a percent.
    expect(formatNavPct("8001", "8000", 3)).toBe("+0.013%");
    expect(formatNavPct("7999", "8000", 3)).toBe("-0.013%");
  });

  it("honours a decimals argument of 0", () => {
    expect(formatNavPct(inflatedNav, honestNav, 0)).toBe("+50%");
  });

  it("is exact past float precision (BigInt, not Number)", () => {
    // Number("100000000000000000001") === Number("100000000000000000000");
    // a float implementation would render this as an unsigned zero.
    expect(formatNavPct("100000000000000000001", "100000000000000000000", 20)).toBe(
      "+0.00000000000000000100%",
    );
  });

  it("rejects a zero baseline", () => {
    expect(() => formatNavPct(honestNav, "0")).toThrow(RangeError);
  });
});

describe("truncateHash / truncateAddress", () => {
  it("middle-truncates a 32-byte result hash", () => {
    expect(truncateHash(strikeSettled.operators[0]!.result_hash)).toBe("0xa1a1…a1a1");
    expect(truncateHash(strikeSabotage.operators[2]!.result_hash)).toBe("0xdede…dede");
  });

  it("middle-truncates operator and vault addresses", () => {
    expect(truncateAddress(strikeSettled.operators[2]!.id)).toBe("0x3333…3333");
    expect(truncateAddress(strikeSettled.vault.address)).toBe("0x2184…cb42");
  });

  it("leaves already-short values alone", () => {
    expect(truncateHash("0x1234")).toBe("0x1234");
    expect(truncateHash("-")).toBe("-");
  });

  it("honours custom lead/tail", () => {
    expect(truncateHash(strikeSettled.operators[0]!.result_hash, 10, 6)).toBe(
      "0xa1a1a1a1…a1a1a1",
    );
  });
});

describe("explorer links", () => {
  const txHash = strikeSettled.attestation.tx_hash!;
  const { address } = strikeSettled.vault;

  it("deep-links Base mainnet (8453)", () => {
    expect(explorerBaseUrl(8453)).toBe("https://basescan.org");
    expect(explorerTxUrl(8453, txHash)).toBe(`https://basescan.org/tx/${txHash}`);
    expect(explorerAddressUrl(8453, address)).toBe(
      `https://basescan.org/address/${address}`,
    );
  });

  it("returns null for the anvil fork (31337) so renderers show plain text", () => {
    expect(explorerBaseUrl(31337)).toBeNull();
    expect(explorerTxUrl(31337, txHash)).toBeNull();
    expect(explorerAddressUrl(31337, address)).toBeNull();
  });

  it("returns null for unknown chains", () => {
    expect(explorerTxUrl(1, txHash)).toBeNull();
    expect(explorerAddressUrl(999_999, address)).toBeNull();
  });
});

describe("formatUtcTime", () => {
  it("formats journal unix seconds as a UTC wall clock", () => {
    expect(formatUtcTime(strikeSettled.operators[0]!.timestamp)).toBe("16:00:00");
    expect(formatUtcTime(strikeSettled.attestation.timestamp)).toBe("16:00:09");
  });

  it("renders a placeholder for a time that does not exist yet", () => {
    expect(formatUtcTime(null)).toBe(EMPTY_TIME);
    expect(formatUtcTime(Number.NaN)).toBe(EMPTY_TIME);
  });
});
