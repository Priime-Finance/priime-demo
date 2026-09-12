import { describe, expect, it } from "vitest";

import {
  componentConfigFor,
  cronFromSeconds,
  resolveLoopConfig,
  validateLoopConfig,
  ValidationError,
} from "../src/config.ts";
import { validLoopInput, validLoopResolveInput } from "./fixtures.ts";

describe("validateLoopConfig", () => {
  it("accepts a valid config and normalizes addresses to lowercase", () => {
    const cfg = validateLoopConfig(validLoopInput());
    expect(cfg.strategist).toBe("0xabcd00000000000000000000000000000000abcd");
    expect(cfg.marketId).toBe("0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354");
    expect(cfg.name).toBe("my recursive loop");
    expect(cfg.candidateId).toBe("morpho-blue-base:8453:USDe-USDC:0x54cf9be5");
    expect(cfg.targetLeverage).toBe(5);
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
    expect(() => validateLoopConfig(input)).toThrow(/whole minute/);
  });

  it("rejects sub-60s cadences (roadmap P0 #2)", () => {
    /* User-published loops run on the operator quorum; anything faster than
       60 seconds hammers Base RPC and gives MEV bots more of a window than
       the operators have to sign. Seed vaults bypass this via the shell
       script, which is the operator's own knob. */
    for (const bad of [5, 10, 30, 59]) {
      const input = validLoopInput();
      input.cronSeconds = bad;
      expect(() => validateLoopConfig(input)).toThrow(/cronSeconds/);
    }
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

describe("resolveLoopConfig", () => {
  const CANDIDATE = "morpho-blue-base:8453:USDe-USDC:0x54cf9be5";

  it("resolves the candidate id to the catalog's addresses", () => {
    const cfg = resolveLoopConfig(validLoopResolveInput());
    expect(cfg.candidateId).toBe(CANDIDATE);
    expect(cfg.marketId).toBe("0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354");
    expect(cfg.usdeAddress).toBe("0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34");
    expect(cfg.targetLeverage).toBe(5);
    expect(cfg.cronSeconds).toBe(60);
    /* Regression pin: resolveLoopConfig must source the router and pool fee
       from the catalog, not the user input, so a composer-published loop
       can actually compose swap calldata every strike. */
    expect(cfg.swapRouter).toBe("0x2626664c2603336E57B271c5C0b26F421741e481");
    expect(cfg.poolFee).toBe(500);
  });

  it("rejects an unknown candidate id with a catalog-shaped error", () => {
    const input = validLoopResolveInput();
    input.candidateId = "morpho-blue-base:8453:ZZZ-YYY:0xdead0000";
    try {
      resolveLoopConfig(input);
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const issues = (err as ValidationError).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/not in the market catalog/);
    }
  });

  it("rejects a missing candidate id and other issues together", () => {
    const input = validLoopResolveInput();
    delete input.candidateId;
    input.strategist = "nope";
    input.targetLeverage = 42;
    try {
      resolveLoopConfig(input);
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const issues = (err as ValidationError).issues;
      expect(issues.some((i) => i.includes("strategist"))).toBe(true);
      expect(issues.some((i) => i.includes("targetLeverage"))).toBe(true);
      expect(issues.some((i) => i.includes("candidateId"))).toBe(true);
    }
  });

  it("rejects strategyParams keys the vault-nav component refuses (roadmap P2 #6)", () => {
    /* One test per refused key. Each landing in the composer's wire used
       to deploy a workflow that died on its first cycle with
       `redemption venue routing not implemented` (and the seven siblings);
       loop-server now rejects at validation so no bad config ever reaches
       the operator quorum. */
    const refused: Record<string, string> = {
      hedge_leverage: "2",
      delta_band_pct: "0.5",
      margin_trim_pct: "0.1",
      margin_restore_pct: "0.15",
      funding_floor_apr: "0.02",
      hl_coin: "ETH",
      exit_route_id: "instant-usdc",
      exit_settlement_days: "5",
    };
    for (const [key, value] of Object.entries(refused)) {
      const input = validLoopResolveInput();
      input.strategyParams = { [key]: value };
      try {
        resolveLoopConfig(input);
        expect.unreachable(`must reject ${key}`);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        expect(err.issues.some((i) => i.includes(key) && i.includes("refused"))).toBe(true);
      }
    }
  });

  it("still accepts the refused key when its value is meaningless (empty/zero)", () => {
    /* The composer strips these but a paranoid CLI author might still send
       `hl_coin: ""` or `exit_settlement_days: "0"`; treat these as unset
       and pass through, matching the component's `is_meaningfully_set`
       predicate so the two sides refuse the same input. */
    for (const empty of ["", "0", "0.0", "0.00"]) {
      const input = validLoopResolveInput();
      input.strategyParams = { exit_route_id: empty, hl_coin: empty };
      expect(() => resolveLoopConfig(input)).not.toThrow();
    }
  });

  it("rejects an out-of-range target leverage", () => {
    for (const bad of [0, 0.5, 11, Number.NaN, Number.POSITIVE_INFINITY]) {
      const input = validLoopResolveInput();
      input.targetLeverage = bad;
      expect(() => resolveLoopConfig(input)).toThrow(ValidationError);
    }
  });

  it("rejects non-object input", () => {
    expect(() => resolveLoopConfig("hi")).toThrow(ValidationError);
    expect(() => resolveLoopConfig(null)).toThrow(ValidationError);
  });
});

describe("cronFromSeconds", () => {
  it("uses the minutes field for whole minutes", () => {
    expect(cronFromSeconds(60)).toBe("0 */1 * * * *");
    expect(cronFromSeconds(120)).toBe("0 */2 * * * *");
    expect(cronFromSeconds(600)).toBe("0 */10 * * * *");
  });

  it("uses the hour form at 3600", () => {
    expect(cronFromSeconds(3600)).toBe("0 0 * * * *");
  });

  it("rejects sub-minute cadences (roadmap P0 #2)", () => {
    expect(() => cronFromSeconds(10)).toThrow(ValidationError);
    expect(() => cronFromSeconds(30)).toThrow(ValidationError);
    expect(() => cronFromSeconds(59)).toThrow(ValidationError);
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
      "pool_fee",
      "swap_router",
      "twap_window_secs",
      "usdc_address",
      "usde_address",
      "vault_address",
    ]);
    expect(out.vault_address).toBe("0xdddddddddddddddddddddddddddddddddddddddd");
    expect(out.twap_window_secs).toBe("1800");
    expect(out.inputs_block_lag).toBe("2");
    // Composer-published loops die on missing router/tickSpacing (vault-nav
    // returns PlanBuild::empty on either read failing); pin both.
    expect(out.swap_router).toBe("0x2626664c2603336e57b271c5c0b26f421741e481");
    expect(out.pool_fee).toBe("500");
  });
});
