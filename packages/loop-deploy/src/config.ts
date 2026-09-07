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
  /** Display name, informational only. Optional; defaults to "unnamed loop". */
  name?: string;
  /** User address; becomes the handler's strategist (WAVS-independent exit). */
  strategist: string;
  /** Strike cadence in seconds. 5..59, or a multiple of 60 up to 3600. */
  cronSeconds: number;
  /** Market picked on the composer. Must be in `catalog.ts`. */
  candidateId: string;
  /** Target leverage the loop runs at, informational at deploy time. */
  targetLeverage: number;
}

export interface LoopConfig {
  /** Display name, informational only. */
  name: string;
  /** User address; becomes the handler's strategist (WAVS-independent exit). */
  strategist: string;
  /** Strike cadence in seconds. 5..59, or a multiple of 60 up to 3600. */
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

/** Validated strike cadence. */
function cronField(input: Record<string, unknown>, issues: string[]): number {
  const seconds = intField(input, "cronSeconds", 5, 3600, issues);
  if (seconds >= 60 && seconds % 60 !== 0) issues.push("cronSeconds of 60 or more must be a multiple of 60");
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
  };
}

/** Six-field cron expression (seconds granularity) for a cadence in seconds. */
export function cronFromSeconds(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) throw new ValidationError([`unsupported cron cadence: ${seconds}`]);
  if (seconds < 60) return `*/${seconds} * * * * *`;
  if (seconds % 60 !== 0) throw new ValidationError([`cadence of 60s or more must be a whole minute: ${seconds}`]);
  if (seconds === 3600) return "0 0 * * * *";
  return `0 */${seconds / 60} * * * *`;
}

/** The full vault-nav component config for this loop (server fields injected). */
export function componentConfigFor(
  cfg: LoopConfig,
  server: { chainKey: string; usdcAddress: string; vaultAddress: string },
): Record<string, string> {
  return {
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
  };
}
