/**
 * Loop configuration.
 *
 * `LoopConfigInput` is what a caller (the UI, curl in tests) POSTs: a
 * chosen market candidate id, the desired strike cadence, a target
 * leverage, and the strategist wallet. `resolveLoopConfig` looks the market
 * up in the `catalog.ts` and produces the full `LoopConfig` the deployer
 * stores and hands to `componentConfigFor`.
 *
 * Everything vault-nav-facing (chain id, USDC, the handler address) is
 * server-owned and injected by the deployer. Keys emitted by
 * `componentConfigFor` must stay in lockstep with what vault-nav reads in
 * components/vault-nav/src/lib.rs (cfg / cfg_address / cfg_u64 calls) and
 * with deploy/vault-service.sh's component-config.json.
 */

import { lookupMarket, type MarketSpec } from "./catalog.ts";
import { isRecord } from "./guards.ts";

export class ValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`invalid loop config: ${issues.join("; ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export interface LoopConfigInput {
  /** Optional user-visible name. Falls back to a placeholder when missing. */
  name?: string;
  /** User address; becomes the handler's strategist (Priime-independent exit). */
  strategist: string;
  /** Strike cadence in seconds. Whole minutes only: 60..3600, `cronSeconds % 60 === 0`. Enforced by `cronField`. */
  cronSeconds: number;
  /** Market picked on the composer. Must be in `catalog.ts`. */
  candidateId: string;
  /** Target leverage the loop runs at, informational at deploy time. */
  targetLeverage: number;
  /**
   * Every other knob the composer captured, as string values. Merged into
   * the workflow's `componentConfig` verbatim, so anything the user tuned
   * (risk preset, HF bands, auto-compound cadence, exit route, ...) lands
   * in the pinned service.json exactly as the composer sent it. Loop-server
   * does not interpret the shape here; each entry is passed through
   * unchanged and the component owns validation of what it reads.
   * Absent entries default to `{}`, matching pre-composer callers.
   */
  strategyParams?: Record<string, string>;
}

export interface LoopConfig {
  /** Display name, informational only. */
  name: string;
  /** User address; becomes the handler's strategist (Priime-independent exit). */
  strategist: string;
  /** Strike cadence in seconds. Whole minutes only: 60..3600, `cronSeconds % 60 === 0`. Enforced by `cronField`. */
  cronSeconds: number;
  /** Composer candidate id, resolved against the catalog on create. */
  candidateId: string;
  /** Target leverage the loop runs at. Stored on the record for display. */
  targetLeverage: number;
  /** Morpho Blue market id (bytes32). Resolved from the catalog. */
  marketId: string;
  /** Market LLTV, 1e18 scale, as a decimal string. */
  lltv: string;
  /** Collateral token (18 decimals assumed by vault-nav). */
  usdeAddress: string;
  /** Morpho market oracle. */
  oracleAddress: string;
  /** Morpho IRM. */
  irmAddress: string;
  /** Morpho Blue core. */
  morphoAddress: string;
  /** TWAP pool for min(par, TWAP) collateral pricing. */
  poolAddress: string;
  /** TWAP window seconds. Component floors the effective window at 300. */
  twapWindowSecs: number;
  /** Blocks behind the trigger-time block to pin reads (reorg depth). */
  inputsBlockLag: number;
  /**
   * Uniswap V3 router for USDC<->USDe swaps. Set on vault
   * construction AND read every strike by the WASM component when it
   * composes StrategyPlan swap calldata. Absent -> the component emits an
   * empty plan on every strike (dead loop). Sourced from the market catalog
   * on `resolveLoopConfig`; the value the composer wrote never overrides.
   */
  swapRouter: string;
  /**
   * Uniswap V3 tick spacing for the USDC/USDe pool (not a fee tier).
   * Same lifecycle as `swapRouter` — set at construction, read every
   * strike. Zero/absent -> empty plan.
   */
  poolFee: number;
  /**
   * The composer's knobs, string-encoded. Copied verbatim from the publish
   * input and merged into `componentConfigFor`'s output, so every workflow
   * on IPFS carries every choice the user made. Empty object on legacy
   * callers that never sent one.
   */
  strategyParams: Record<string, string>;
}

/**
 * Strategy-param keys the on-chain vault-nav component's `refuse_unimplemented`
 * refuses to attest against. Kept in lockstep with
 * `components/vault-nav/src/lib.rs::UNIMPLEMENTED`. Composer publishes that
 * carry any of these die on the first strike, so loop-server rejects them
 * at validation time rather than deploying a workflow that will never
 * attest. Remove a key here the same commit a component honors it.
 */
const REFUSED_STRATEGY_PARAMS: Record<string, true> = {
  hedge_leverage: true,
  delta_band_pct: true,
  margin_trim_pct: true,
  margin_restore_pct: true,
  funding_floor_apr: true,
  hl_coin: true,
  exit_route_id: true,
  exit_settlement_days: true,
};

/** A "meaningfully-set" value: present and not empty/zero-shaped. Mirrors
 *  the component's `is_meaningfully_set`. */
function isMeaningfullySet(v: unknown): boolean {
  const s = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
  return !(s === "" || s === "0" || s === "0.0" || s === "0.00");
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const NAME_RE = /^[\x20-\x7E]{1,64}$/;
const WAD = 10n ** 18n;

/** Validated lowercase address from `input[field]`, or push an issue and return "". */
function addressField(input: Record<string, unknown>, field: string, issues: string[]): string {
  const v = input[field];
  if (typeof v === "string" && ADDRESS_RE.test(v)) return v.toLowerCase();
  issues.push(`${field} must be a 0x-prefixed 20-byte hex address`);
  return "";
}

/** Validated integer in [min, max] from `input[field]`, or push an issue and return min. */
function intField(input: Record<string, unknown>, field: string, min: number, max: number, issues: string[]): number {
  const v = input[field];
  if (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max) return v;
  issues.push(`${field} must be an integer in [${min}, ${max}]`);
  return min;
}

/** Validated finite number in [min, max] from `input[field]`, or push an issue and return min. */
function numberField(input: Record<string, unknown>, field: string, min: number, max: number, issues: string[]): number {
  const v = input[field];
  if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) return v;
  issues.push(`${field} must be a finite number in [${min}, ${max}]`);
  return min;
}

/** Validated name (or the default when omitted). */
function nameField(input: Record<string, unknown>, issues: string[]): string {
  if (input.name === undefined) return "unnamed loop";
  if (typeof input.name === "string" && NAME_RE.test(input.name)) return input.name;
  issues.push("name must be 1..64 printable ASCII characters");
  return "unnamed loop";
}

/**
 * Validated strike cadence. User-published loops must run at 60 seconds or
 * more (measured on the operator side: shorter intervals hammer Base RPC,
 * confuse indexers, and give MEV bots a bigger window than the operators
 * have to sign a quorum). Multiples of 60 up to 3600 are accepted.
 *
 * The seed vault's cadence comes from `deploy/targets/<TARGET>.json` and
 * bypasses this path; the shell script is the operator's own knob.
 */
function cronField(input: Record<string, unknown>, issues: string[]): number {
  const seconds = intField(input, "cronSeconds", 60, 3600, issues);
  if (seconds % 60 !== 0) issues.push("cronSeconds must be a whole minute (60, 120, ..., 3600)");
  return seconds;
}

/** Validate a full LoopConfig (stored/internal path — resume, tests). */
export function validateLoopConfig(input: unknown): LoopConfig {
  if (!isRecord(input)) throw new ValidationError(["config must be a JSON object"]);
  const issues: string[] = [];

  const name = nameField(input, issues);
  const strategist = addressField(input, "strategist", issues);
  const usdeAddress = addressField(input, "usdeAddress", issues);
  const oracleAddress = addressField(input, "oracleAddress", issues);
  const irmAddress = addressField(input, "irmAddress", issues);
  const morphoAddress = addressField(input, "morphoAddress", issues);
  const poolAddress = addressField(input, "poolAddress", issues);

  let candidateId = "";
  if (typeof input.candidateId === "string" && input.candidateId.length > 0 && input.candidateId.length <= 128) {
    candidateId = input.candidateId;
  } else {
    issues.push("candidateId must be a non-empty string (max 128 chars)");
  }

  const targetLeverage = numberField(input, "targetLeverage", 1, 10, issues);

  let marketId = "";
  if (typeof input.marketId === "string" && BYTES32_RE.test(input.marketId)) marketId = input.marketId.toLowerCase();
  else issues.push("marketId must be a 0x-prefixed 32-byte hex string");

  let lltv = "";
  if (typeof input.lltv === "string" && /^[0-9]{1,19}$/.test(input.lltv) && BigInt(input.lltv) > 0n && BigInt(input.lltv) <= WAD) {
    lltv = input.lltv;
  } else {
    issues.push("lltv must be a decimal string in (0, 1e18]");
  }

  const cronSeconds = cronField(input, issues);
  // 300 mirrors vault-nav's effective-window floor: configuring below it
  // would produce a loop whose every cycle fails.
  const twapWindowSecs = intField(input, "twapWindowSecs", 300, 86400, issues);
  const inputsBlockLag = intField(input, "inputsBlockLag", 0, 100, issues);
  const swapRouter = addressField(input, "swapRouter", issues);
  const poolFee = intField(input, "poolFee", 100, 10_000, issues);

  // strategyParams is optional at the stored/internal boundary too, so old
  // configs that predate the composer still validate.
  const strategyParams: Record<string, string> = {};
  if (input.strategyParams !== undefined) {
    if (!isRecord(input.strategyParams)) {
      issues.push("strategyParams must be a JSON object when present");
    } else {
      for (const [k, v] of Object.entries(input.strategyParams)) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(k)) {
          issues.push(`strategyParams key "${k}" must match /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/`);
          continue;
        }
        if (REFUSED_STRATEGY_PARAMS[k] === true && isMeaningfullySet(v)) {
          issues.push(
            `strategyParams key "${k}" is refused by the vault-nav component (see refuse_unimplemented in components/vault-nav/src/lib.rs); remove the knob or publish against a component that honors it`,
          );
          continue;
        }
        strategyParams[k] = typeof v === "string" ? v : String(v);
      }
    }
  }

  if (issues.length > 0) throw new ValidationError(issues);

  return {
    name,
    strategist,
    cronSeconds,
    candidateId,
    targetLeverage,
    marketId,
    lltv,
    usdeAddress,
    oracleAddress,
    irmAddress,
    morphoAddress,
    poolAddress,
    twapWindowSecs,
    inputsBlockLag,
    swapRouter,
    poolFee,
    strategyParams,
  };
}

/**
 * Resolve untrusted user input into a LoopConfig via the market catalog.
 *
 * The UI/CLI POSTs a small shape ({ name?, strategist, cronSeconds,
 * candidateId, targetLeverage }); we validate it and merge with the
 * catalog's addresses for the picked market. Unknown `candidateId`s are
 * rejected with a single-line issue so the client can render a hint.
 */
export function resolveLoopConfig(input: unknown): LoopConfig {
  if (!isRecord(input)) throw new ValidationError(["config must be a JSON object"]);
  const issues: string[] = [];

  const name = nameField(input, issues);
  const strategist = addressField(input, "strategist", issues);
  const cronSeconds = cronField(input, issues);
  const targetLeverage = numberField(input, "targetLeverage", 1, 10, issues);

  let market: MarketSpec | null = null;
  if (typeof input.candidateId !== "string" || input.candidateId.length === 0) {
    issues.push("candidateId must be a non-empty string");
  } else {
    market = lookupMarket(input.candidateId);
    if (market === null) {
      issues.push(`candidateId "${input.candidateId}" is not in the market catalog; publish an offered market`);
    }
  }

  // Composer knobs, string-encoded. Absent -> empty object. Every entry is a
  // string; anything else is a client-side bug and gets stringified rather
  // than silently dropped, so the user's choice is preserved.
  const strategyParams: Record<string, string> = {};
  if (input.strategyParams !== undefined) {
    if (!isRecord(input.strategyParams)) {
      issues.push("strategyParams must be a JSON object when present");
    } else {
      for (const [k, v] of Object.entries(input.strategyParams)) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(k)) {
          issues.push(`strategyParams key "${k}" must match /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/`);
          continue;
        }
        if (REFUSED_STRATEGY_PARAMS[k] === true && isMeaningfullySet(v)) {
          issues.push(
            `strategyParams key "${k}" is refused by the vault-nav component (see refuse_unimplemented in components/vault-nav/src/lib.rs); remove the knob or publish against a component that honors it`,
          );
          continue;
        }
        strategyParams[k] = typeof v === "string" ? v : String(v);
      }
    }
  }

  if (issues.length > 0 || market === null) throw new ValidationError(issues);

  return {
    name,
    strategist,
    cronSeconds,
    candidateId: market.candidateId,
    targetLeverage,
    marketId: market.marketId,
    lltv: market.lltv,
    usdeAddress: market.usdeAddress,
    oracleAddress: market.oracleAddress,
    irmAddress: market.irmAddress,
    morphoAddress: market.morphoAddress,
    poolAddress: market.poolAddress,
    twapWindowSecs: market.twapWindowSecs,
    inputsBlockLag: market.inputsBlockLag,
    swapRouter: market.swapRouter,
    poolFee: market.poolFee,
    strategyParams,
  };
}

/**
 * Six-field cron expression (seconds granularity) for a cadence in seconds.
 * Whole minutes only (60..3600); sub-minute cadences are refused for the
 * same reason `cronField` refuses them at validation time.
 */
export function cronFromSeconds(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600) {
    throw new ValidationError([`unsupported cron cadence: ${seconds}`]);
  }
  if (seconds % 60 !== 0) {
    throw new ValidationError([`cadence must be a whole minute: ${seconds}`]);
  }
  if (seconds === 3600) return "0 0 * * * *";
  return `0 */${seconds / 60} * * * *`;
}

/** The full vault-nav component config for this loop (server fields injected). */
export function componentConfigFor(
  cfg: LoopConfig,
  server: { chainKey: string; usdcAddress: string; vaultAddress: string },
): Record<string, string> {
  // Composer-supplied knobs are spread FIRST, so the market/server-derived
  // fields on the right shadow any collision - a user cannot accidentally
  // (or maliciously) override the vault address or market oracle here.
  return {
    ...cfg.strategyParams,
    chain_id: server.chainKey,
    vault_address: server.vaultAddress,
    usdc_address: server.usdcAddress,
    usde_address: cfg.usdeAddress,
    oracle_address: cfg.oracleAddress,
    irm_address: cfg.irmAddress,
    morpho_address: cfg.morphoAddress,
    market_id: cfg.marketId,
    lltv: cfg.lltv,
    pool_address: cfg.poolAddress,
    twap_window_secs: String(cfg.twapWindowSecs),
    inputs_block_lag: String(cfg.inputsBlockLag),
    // Required by vault-nav to compose Uniswap V3 swap calldata every strike
    // (`build_action_plan` in `components/vault-nav/src/lib.rs`); absent -> the
    // WASM emits an empty plan every cycle. Vault constructor also reads these
    // via `deployHandler`, so the two sides stay pinned to the same catalog row.
    swap_router: cfg.swapRouter,
    pool_fee: String(cfg.poolFee),
  };
}
