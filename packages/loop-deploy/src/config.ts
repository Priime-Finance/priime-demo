/**
 * User-supplied loop configuration: the validated subset of the vault-nav
 * component config a loop creator may set, plus the cron cadence and the
 * strategist (the user address that owns the loop's handler escape hatch).
 *
 * Everything else in the component config (chain id, USDC, the handler
 * address) is server-owned and injected by the deployer. Keys emitted by
 * `componentConfigFor` must stay in lockstep with what vault-nav reads in
 * components/vault-nav/src/lib.rs (cfg / cfg_address / cfg_u64 calls) and
 * with deploy/vault-service.sh's component-config.json.
 */

import { isRecord } from "./guards.ts";

export class ValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`invalid loop config: ${issues.join("; ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export interface LoopConfig {
  /** Display name, informational only. */
  name: string;
  /** User address; becomes the handler's strategist (WAVS-independent exit). */
  strategist: string;
  /** Strike cadence in seconds. 5..59, or a multiple of 60 up to 3600. */
  cronSeconds: number;
  /** Morpho Blue market id (bytes32). */
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

/** Validate untrusted input into a LoopConfig. Throws ValidationError. */
export function validateLoopConfig(input: unknown): LoopConfig {
  if (!isRecord(input)) throw new ValidationError(["config must be a JSON object"]);
  const issues: string[] = [];

  let name = "unnamed loop";
  if (input.name !== undefined) {
    if (typeof input.name === "string" && NAME_RE.test(input.name)) name = input.name;
    else issues.push("name must be 1..64 printable ASCII characters");
  }

  const strategist = addressField(input, "strategist", issues);
  const usdeAddress = addressField(input, "usdeAddress", issues);
  const oracleAddress = addressField(input, "oracleAddress", issues);
  const irmAddress = addressField(input, "irmAddress", issues);
  const morphoAddress = addressField(input, "morphoAddress", issues);
  const poolAddress = addressField(input, "poolAddress", issues);

  let marketId = "";
  if (typeof input.marketId === "string" && BYTES32_RE.test(input.marketId)) marketId = input.marketId.toLowerCase();
  else issues.push("marketId must be a 0x-prefixed 32-byte hex string");

  let lltv = "";
  if (typeof input.lltv === "string" && /^[0-9]{1,19}$/.test(input.lltv) && BigInt(input.lltv) > 0n && BigInt(input.lltv) <= WAD) {
    lltv = input.lltv;
  } else {
    issues.push("lltv must be a decimal string in (0, 1e18]");
  }

  const cronSeconds = intField(input, "cronSeconds", 5, 3600, issues);
  if (cronSeconds >= 60 && cronSeconds % 60 !== 0) issues.push("cronSeconds of 60 or more must be a multiple of 60");

  // 300 mirrors vault-nav's effective-window floor: configuring below it
  // would produce a loop whose every cycle fails.
  const twapWindowSecs = intField(input, "twapWindowSecs", 300, 86400, issues);
  const inputsBlockLag = intField(input, "inputsBlockLag", 0, 100, issues);

  if (issues.length > 0) throw new ValidationError(issues);

  return {
    name,
    strategist,
    cronSeconds,
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
