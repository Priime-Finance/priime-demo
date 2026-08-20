import { describe, expect, it } from "vitest";

import { componentConfigFor, cronFromSeconds, validateLoopConfig, ValidationError } from "../src/config.ts";
import { validLoopInput } from "./fixtures.ts";

describe("validateLoopConfig", () => {
  it("accepts a valid config and normalizes addresses to lowercase", () => {
    const cfg = validateLoopConfig(validLoopInput());
    expect(cfg.strategist).toBe("0xabcd00000000000000000000000000000000abcd");
    expect(cfg.marketId).toBe("0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354");
    expect(cfg.name).toBe("my recursive loop");
  });

  it("defaults the name when omitted", () => {
    const input = validLoopInput();
    delete input.name;
    expect(validateLoopConfig(input).name).toBe("unnamed loop");
  });

  it("collects every issue instead of stopping at the first", () => {
    const input = validLoopInput();
    input.strategist = "nope";
    input.twapWindowSecs = 10;
    input.marketId = "0x1234";
    try {
      validateLoopConfig(input);
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues).toHaveLength(3);
    }
  });

  it("rejects a twap window below the component's 300s floor", () => {
    const input = validLoopInput();
    input.twapWindowSecs = 299;
    expect(() => validateLoopConfig(input)).toThrow(ValidationError);
  });

  it("rejects non-whole-minute cadences at 60s or more", () => {
    const input = validLoopInput();
    input.cronSeconds = 90;
    expect(() => validateLoopConfig(input)).toThrow(/multiple of 60/);
  });

  it("rejects lltv of zero and above 1e18", () => {
    for (const lltv of ["0", "1000000000000000001"]) {
      const input = validLoopInput();
      input.lltv = lltv;
      expect(() => validateLoopConfig(input)).toThrow(ValidationError);
    }
  });

  it("rejects non-object input", () => {
    expect(() => validateLoopConfig("hi")).toThrow(ValidationError);
    expect(() => validateLoopConfig(null)).toThrow(ValidationError);
    expect(() => validateLoopConfig([1])).toThrow(ValidationError);
  });
});

describe("cronFromSeconds", () => {
  it("uses the seconds field below one minute", () => {
    expect(cronFromSeconds(10)).toBe("*/10 * * * * *");
    expect(cronFromSeconds(59)).toBe("*/59 * * * * *");
  });

  it("uses the minutes field for whole minutes", () => {
    expect(cronFromSeconds(60)).toBe("0 */1 * * * *");
    expect(cronFromSeconds(600)).toBe("0 */10 * * * *");
  });

  it("uses the hour form at 3600", () => {
    expect(cronFromSeconds(3600)).toBe("0 0 * * * *");
  });

  it("rejects out-of-range and ragged cadences", () => {
    expect(() => cronFromSeconds(4)).toThrow(ValidationError);
    expect(() => cronFromSeconds(90)).toThrow(ValidationError);
    expect(() => cronFromSeconds(3601)).toThrow(ValidationError);
  });
});

describe("componentConfigFor", () => {
  it("emits exactly the keys vault-nav reads, with server fields injected", () => {
    const cfg = validateLoopConfig(validLoopInput());
    const out = componentConfigFor(cfg, {
      chainKey: "evm:31337",
      usdcAddress: "0x2222222222222222222222222222222222222222",
      vaultAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
    });
    expect(Object.keys(out).sort()).toEqual([
      "chain_id",
      "inputs_block_lag",
      "irm_address",
      "lltv",
      "market_id",
      "morpho_address",
      "oracle_address",
      "pool_address",
      "twap_window_secs",
      "usdc_address",
      "usde_address",
      "vault_address",
    ]);
    expect(out.vault_address).toBe("0xdddddddddddddddddddddddddddddddddddddddd");
    expect(out.twap_window_secs).toBe("1800");
    expect(out.inputs_block_lag).toBe("2");
  });
});
