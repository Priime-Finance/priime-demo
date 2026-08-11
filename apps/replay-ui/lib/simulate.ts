/**
 * The client-side NAV-strike simulator.
 *
 * ============================ READ THIS FIRST ============================
 * Nothing this module produces is attested, observed, or real. It exists so
 * the living-system canvas has a heartbeat before the backend does, and every
 * surface that renders it must say so ("SIMULATED FEED · backend pending").
 * A mocked proof of a verification product is the disease we claim to cure —
 * so the rule here is: simulate the *shape*, never the *authority*. The hashes
 * are cheap FNV mixes, not keccak; the signatures are padding, not secp256k1;
 * the attestation tx hash is a placeholder that must never be deep-linked to
 * an explorer.
 * ========================================================================
 *
 * What is real is the **structure**: `nextStrike` emits values typed as the
 * frozen `Journal` from `@priime-demo/journal-schema` and conforming to
 * `schema/journal.v1.schema.json` (hex widths, integer NAV strings, quorum
 * transitions that add up). The moment a live `JournalSource` exists, the
 * canvas swaps feeds without touching a renderer.
 *
 * The core is pure: `nextStrike(state, config) -> { journal, state }`. The RNG
 * state, the corruption flags, the block height and the drifting NAV all live
 * in `SimState`, so the same seed replays the same session exactly. A thin
 * React hook (`hooks/useSimulator.ts`) owns the clock and calls this.
 */
import type {
  Attestation,
  Journal,
  NavUnit,
  Operator,
  Quorum,
  Status,
  Transition,
} from "@priime-demo/journal-schema";
import { SCHEMA_VERSION } from "@priime-demo/journal-schema";

import { DEPLOY_FORM } from "@/lib/deploy-config";
import { demoEnvironment } from "@/lib/environment";

/* --------------------------------------------------------------- constants */

/**
 * The NAV the vault was deployed with, in `nav_unit` base units (USDC, 6dp).
 * Every NAV on screen is a percentage against this, never a dollar amount.
 */
export const NAV_BASELINE = "500000000";

/** Wall-clock gap between strikes. One knob for the whole heartbeat. */
export const STRIKE_INTERVAL_MS = 12_000;

/** Base blocks (~2 s) per strike interval, so `inputs_block` advances plausibly. */
const BLOCKS_PER_STRIKE = Math.round(STRIKE_INTERVAL_MS / 2_000);

/** Block the simulated session starts from (just past the fixture's registry). */
const START_BLOCK = 49_480_100;

/** Morpho Blue USDe/USDC market LLTV, in basis points (91.5%). */
export const MARKET_LLTV_BPS = 9_150;

/** Simulated LTV band, in basis points. Health factor = LLTV / LTV. */
const LTV_MIN_BPS = 7_650;
const LTV_MAX_BPS = 7_900;

/** Vault address the fixtures use. Simulated: never deep-linked. */
const VAULT_ADDRESS = "0x21844Ad9343AC9Aac3d9bD951DD74e95dBcccb42";

/* ---------------------------------------------------------------- config */

/** One operator the simulator drives, mirroring a registry entry. */
export interface SimOperator {
  /** Operator signing address; becomes `Operator.id`. */
  id: string;
  /** Display label ("node-1"). Fixture-only; the registry has no labels. */
  label: string;
  /** Quorum weight (1 each in the equal-weight demo). */
  weight: number;
}

/** Everything about the simulated service that does not change between strikes. */
export interface SimConfig {
  /** WAVS service id; the `strike_id` prefix. */
  serviceId: string;
  /** Chain id the vault (and the attestation) lives on. */
  chainId: number;
  /** Vault contract address. */
  vaultAddress: string;
  /** sha256 digest every operator claims to have run. */
  componentDigest: string;
  /** NAV denomination and base-unit decimals. */
  navUnit: NavUnit;
  /** The operator set, in registry order. */
  operators: readonly SimOperator[];
  /** Quorum threshold in weight (2 in the 2-of-3 demo). */
  threshold: number;
  /** Deployed NAV baseline, integer string in `navUnit` base units. */
  baselineNav: string;
  /** Blocks `inputs_block` advances per strike. */
  blocksPerStrike: number;
  /** Market LLTV in bps, for the simulated health factor. */
  lltvBps: number;
  /** Health-factor floor from the deploy form. */
  healthFactorFloor: number;
}

/** Quorum threshold for the demo: 2-of-3. Three nodes is the whole point. */
const THRESHOLD = 2;

/**
 * The simulated service, assembled from the same fixture the rest of the app
 * reads (`fixtures/environment.v1.json`) and the scripted deploy config, so the
 * canvas, the registry rail and the simulator can never disagree about who the
 * operators are.
 */
export const SIM_CONFIG: SimConfig = {
  serviceId: demoEnvironment.service_id,
  chainId: DEPLOY_FORM.chainId,
  vaultAddress: VAULT_ADDRESS,
  componentDigest: demoEnvironment.expected_component_digest,
  navUnit: { asset: "USDC", decimals: 6 },
  operators: demoEnvironment.registry.operators.map((entry) => ({
    id: entry.id,
    label: entry.label,
    weight: entry.weight,
  })),
  threshold: THRESHOLD,
  baselineNav: NAV_BASELINE,
  blocksPerStrike: BLOCKS_PER_STRIKE,
  lltvBps: MARKET_LLTV_BPS,
  healthFactorFloor:
    DEPLOY_FORM.parameters.find((p) => p.key === "health_factor_floor")?.value ?? 1.15,
};

/* ------------------------------------------------------------------ state */

/** Everything that carries from one simulated strike to the next. */
export interface SimState {
  /** Seed the session was started from; kept so a state can be re-derived. */
  seed: number;
  /** mulberry32 state (uint32). Advancing this is the only source of noise. */
  rng: number;
  /** How many strikes have been produced. `0` before the first. */
  strikeIndex: number;
  /** `inputs_block` the next strike will compute against. */
  block: number;
  /** Honest NAV going into the next strike, integer string in base units. */
  nav: string;
  /** Simulated loan-to-value in bps; health factor = LLTV / this. */
  ltvBps: number;
  /** Operator ids (lowercase) currently flipped to "corrupt". */
  corrupt: readonly string[];
  /** Unix seconds the next strike's trigger fires at. */
  unixSeconds: number;
}

/**
 * A fresh session.
 *
 * @param seed PRNG seed. Same seed, same session, forever.
 * @param unixSeconds unix seconds the first strike triggers at.
 * @param corrupt operator ids to start corrupted (headless driving).
 * @returns the initial state.
 */
export function initialSimState(
  seed: number,
  unixSeconds: number,
  corrupt: readonly string[] = [],
): SimState {
  return {
    seed,
    rng: seed >>> 0,
    strikeIndex: 0,
    block: START_BLOCK,
    nav: NAV_BASELINE,
    ltvBps: 7_800,
    corrupt: normaliseCorrupt(corrupt),
    unixSeconds,
  };
}

/** Lowercase + dedupe, so `corrupt` is a canonical set however it was built. */
function normaliseCorrupt(ids: readonly string[]): readonly string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))].sort();
}

/** Whether an operator is currently flipped to "corrupt". */
export function isCorrupt(state: SimState, operatorId: string): boolean {
  return state.corrupt.includes(operatorId.toLowerCase());
}

/**
 * Flip one operator's corruption flag. Pure: returns a new state.
 *
 * Takes effect from the **next** strike — a node that is already mid-strike
 * has already signed. That lag is the honest mechanic, not a bug.
 *
 * @param state current state.
 * @param operatorId operator signing address.
 * @param corrupt desired flag.
 * @returns the new state.
 */
export function setCorrupt(
  state: SimState,
  operatorId: string,
  corrupt: boolean,
): SimState {
  const wanted = operatorId.toLowerCase();
  const next = corrupt
    ? [...state.corrupt, wanted]
    : state.corrupt.filter((id) => id !== wanted);
  return { ...state, corrupt: normaliseCorrupt(next) };
}

/** Simulated health factor: market LLTV over current LTV. */
export function healthFactor(state: SimState, config: SimConfig = SIM_CONFIG): number {
  return config.lltvBps / state.ltvBps;
}

/* -------------------------------------------------------------------- rng */

/** One mulberry32 draw. Pure: state in, value + next state out. */
function draw(rng: number): { value: number; rng: number } {
  const next = (rng + 0x6d2b79f5) >>> 0;
  let x = next;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return { value: ((x ^ (x >>> 14)) >>> 0) / 4_294_967_296, rng: next };
}

/** Integer draw in `[min, max]` inclusive. */
function drawInt(rng: number, min: number, max: number): { value: number; rng: number } {
  const d = draw(rng);
  return { value: min + Math.floor(d.value * (max - min + 1)), rng: d.rng };
}

/* ------------------------------------------------------------- fake bytes */

/**
 * A deterministic 32-byte hex string.
 *
 * **Not keccak256.** Eight FNV-1a words concatenated: stable, collision-free
 * enough for a demo, and cheap. Its only job is that identical inputs produce
 * identical strings and different inputs do not.
 */
function simHash32(input: string): string {
  return `0x${fnvWords(input, 8)}`;
}

/** A deterministic 65-byte hex string shaped like an eip191 signature. */
function simSignature(input: string): string {
  return `0x${fnvWords(input, 17).slice(0, 130)}`;
}

/** `count` FNV-1a 32-bit words over `input`, as lowercase hex. */
function fnvWords(input: string, count: number): string {
  let out = "";
  for (let word = 0; word < count; word += 1) {
    let h = 0x811c9dc5;
    const chunk = `${input}#${word}`;
    for (let i = 0; i < chunk.length; i += 1) {
      h ^= chunk.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/* ------------------------------------------------------------------- math */

/** Scale an integer NAV string by `bps` basis points, rounding toward zero. */
function applyBps(nav: string, bps: number): string {
  const value = BigInt(nav);
  return ((value * BigInt(10_000 + bps)) / 10_000n).toString();
}

/** Clamp a NAV string into `[baseline * (1 - band), baseline * (1 + band)]` bps. */
function clampNav(nav: string, baseline: string, bandBps: number): string {
  const value = BigInt(nav);
  const base = BigInt(baseline);
  const low = (base * BigInt(10_000 - bandBps)) / 10_000n;
  const high = (base * BigInt(10_000 + bandBps)) / 10_000n;
  if (value < low) return low.toString();
  if (value > high) return high.toString();
  return value.toString();
}

/* ------------------------------------------------------------------ strike */

/** One simulated strike plus the state that follows it. */
export interface NextStrikeResult {
  /** The strike, shaped exactly like a captured journal. */
  journal: Journal;
  /** State to feed the next call. */
  state: SimState;
}

/** A submission before it becomes an `Operator` record. */
interface Draft {
  operator: SimOperator;
  hash: string;
  nav: string;
  signature: string;
  timestamp: number;
  corrupted: boolean;
}

/**
 * Produce the next NAV strike.
 *
 * Pure and total: same `state` + same `config` always yields the same journal
 * and the same successor state, which is what makes a seeded session
 * reproducible and the tests deterministic.
 *
 * Mechanics, in the order they matter:
 * - Every honest operator computes the *same* NAV against the *same*
 *   `inputs_block`, so their `result_hash` strings are identical. That
 *   identity is the whole product.
 * - A corrupted operator inflates NAV by 20-80% and therefore lands on a
 *   different hash, in a bucket of its own.
 * - Quorum forms over the first hash whose accumulated weight reaches
 *   `threshold`. With 0 or 1 liars the honest bucket gets there and the strike
 *   settles. With 2+ liars **each liar diverges independently**, no bucket
 *   reaches 2, and the strike stalls with `winning_result_hash: null`. That is
 *   exactly why the demo needs 3 nodes and 2-of-3.
 *
 * @param state current session state.
 * @param config service description; defaults to `SIM_CONFIG`.
 * @returns the journal and the successor state.
 */
export function nextStrike(
  state: SimState,
  config: SimConfig = SIM_CONFIG,
): NextStrikeResult {
  let rng = state.rng;

  /* ---- the position at inputs_block ---- */

  const driftDraw = drawInt(rng, -6, 9);
  rng = driftDraw.rng;
  const honestNav = clampNav(applyBps(state.nav, driftDraw.value), config.baselineNav, 400);

  const ltvDraw = drawInt(rng, -18, 18);
  rng = ltvDraw.rng;
  const ltvBps = Math.min(LTV_MAX_BPS, Math.max(LTV_MIN_BPS, state.ltvBps + ltvDraw.value));

  const inputsBlock = state.block;
  const triggerAt = state.unixSeconds;
  const strikeId = `${config.serviceId}:${inputsBlock}`;
  const honestHash = simHash32(
    `honest|${config.componentDigest}|${inputsBlock}|${honestNav}`,
  );

  /* ---- what each node reported ---- */

  const drafts: Draft[] = config.operators.map((operator) => {
    const corrupted = state.corrupt.includes(operator.id.toLowerCase());

    const inflationDraw = drawInt(rng, 2_000, 8_000);
    rng = inflationDraw.rng;
    const latencyDraw = drawInt(rng, 1, 3);
    rng = latencyDraw.rng;

    const nav = corrupted ? applyBps(honestNav, inflationDraw.value) : honestNav;
    const hash = corrupted
      ? simHash32(`corrupt|${operator.id}|${inputsBlock}|${nav}`)
      : honestHash;

    return {
      operator,
      hash,
      nav,
      corrupted,
      signature: simSignature(`${operator.id}|${strikeId}|${hash}`),
      timestamp: triggerAt + latencyDraw.value,
    };
  });

  // Submission order is arrival order: timestamp first, registry order to break
  // ties (two nodes can land in the same second).
  const arrival = [...drafts].sort((a, b) =>
    a.timestamp !== b.timestamp
      ? a.timestamp - b.timestamp
      : config.operators.indexOf(a.operator) - config.operators.indexOf(b.operator),
  );

  /* ---- quorum ---- */

  const buckets = new Map<string, number>();
  let winningHash: string | null = null;
  for (const draft of arrival) {
    const cumulative = (buckets.get(draft.hash) ?? 0) + draft.operator.weight;
    buckets.set(draft.hash, cumulative);
    if (winningHash === null && cumulative >= config.threshold) winningHash = draft.hash;
  }

  const total = config.operators.reduce((sum, operator) => sum + operator.weight, 0);

  // Transitions record weight accumulating over the hash that WON. When
  // nothing wins (2+ liars) there is no winning bucket to follow, so they
  // record every bucket's dead end instead — each submission at the weight its
  // own hash reached, none of them ever `reached`.
  const running = new Map<string, number>();
  const transitions: Transition[] = [];
  for (const draft of arrival) {
    if (winningHash !== null && draft.hash !== winningHash) continue;
    const cumulative = (running.get(draft.hash) ?? 0) + draft.operator.weight;
    running.set(draft.hash, cumulative);
    transitions.push({
      cumulative,
      operator_id: draft.operator.id,
      result_hash: draft.hash,
      reached: cumulative >= config.threshold,
      timestamp: draft.timestamp,
    });
  }

  const quorum: Quorum = {
    threshold: config.threshold,
    total,
    reached: winningHash !== null,
    winning_result_hash: winningHash,
    transitions,
  };

  const operators: Operator[] = arrival.map((draft) => ({
    id: draft.operator.id,
    result_hash: draft.hash,
    nav: draft.nav,
    signature: draft.signature,
    timestamp: draft.timestamp,
    accepted: winningHash !== null && draft.hash === winningHash,
    result_payload: `0x${BigInt(draft.nav).toString(16).padStart(64, "0")}`,
  }));

  /* ---- attestation ---- */

  const settleDraw = drawInt(rng, 3, 6);
  rng = settleDraw.rng;
  const lastSubmission = arrival[arrival.length - 1]?.timestamp ?? triggerAt;

  const status: Status = winningHash === null ? "stalled" : "settled";
  const settledNav = winningHash === null ? null : honestNav;

  const attestation: Attestation =
    winningHash === null
      ? {
          tx_hash: null,
          chain_id: config.chainId,
          block_number: null,
          nav_final: null,
          timestamp: null,
        }
      : {
          tx_hash: simHash32(`attestation|${strikeId}|${winningHash}`),
          chain_id: config.chainId,
          block_number: inputsBlock + settleDraw.value,
          nav_final: settledNav,
          timestamp: lastSubmission + settleDraw.value,
        };

  const journal: Journal = {
    schema_version: SCHEMA_VERSION,
    strike_id: strikeId,
    status,
    service_id: config.serviceId,
    vault: { chain_id: config.chainId, address: config.vaultAddress },
    component_digest: config.componentDigest,
    trigger: { type: "cron", block: inputsBlock, tx_hash: null },
    inputs_block: inputsBlock,
    nav_unit: config.navUnit,
    operators,
    quorum,
    attestation,
  };

  return {
    journal,
    state: {
      ...state,
      rng,
      strikeIndex: state.strikeIndex + 1,
      block: inputsBlock + config.blocksPerStrike,
      // A stalled strike settles nothing, so the position the next strike
      // reads from is still the one the honest nodes computed.
      nav: honestNav,
      ltvBps,
      unixSeconds: triggerAt + Math.round(STRIKE_INTERVAL_MS / 1_000),
    },
  };
}

/* -------------------------------------------------------------- session */

/** A booted session: warmed-up history plus the state that follows it. */
export interface SessionBoot {
  /** Strikes newest first, live one at index 0. */
  history: readonly Journal[];
  /** State after the live strike. */
  state: SimState;
  /** Corruption flags the live strike ran under. */
  strikeCorrupt: readonly string[];
}

/**
 * Boot a session: run `preStrikes` of pre-history, then the live strike.
 *
 * The pre-history is seeded in the **past**, one interval per warmup strike,
 * so the run ends at `unixSeconds` rather than starting there. Seeding at
 * `unixSeconds` instead would stamp every warmup entry *after* the live strike
 * that follows it, and a history strip whose clock runs backwards is the sort
 * of detail that costs a demo its credibility.
 *
 * Pure, so the ordering is testable without a clock or a mounted hook.
 *
 * @param seed PRNG seed.
 * @param unixSeconds unix seconds the LIVE strike triggers at.
 * @param corrupt operator ids to start corrupted.
 * @param preStrikes strikes of pre-history; negatives are treated as zero.
 * @param config service description.
 * @returns history newest first, the successor state, and the live flags.
 */
export function bootSession(
  seed: number,
  unixSeconds: number,
  corrupt: readonly string[],
  preStrikes: number,
  config: SimConfig = SIM_CONFIG,
): SessionBoot {
  const warmupCount = Math.max(0, Math.floor(preStrikes));
  const stepSeconds = Math.round(STRIKE_INTERVAL_MS / 1_000);

  let state = initialSimState(
    seed,
    unixSeconds - warmupCount * stepSeconds,
    corrupt,
  );

  const warmup: Journal[] = [];
  for (let i = 0; i < warmupCount; i += 1) {
    const result = nextStrike(state, config);
    warmup.unshift(result.journal);
    state = result.state;
  }

  // No reset: the warmup has walked the clock forward to exactly `unixSeconds`.
  const strikeCorrupt = state.corrupt;
  const live = nextStrike(state, config);

  return {
    history: [live.journal, ...warmup],
    state: live.state,
    strikeCorrupt,
  };
}

/* ------------------------------------------------------------ derived view */

/** How a strike came out, for the history strip. */
export interface StrikeSummary {
  /** `Journal.strike_id`. */
  strikeId: string;
  /** Short ordinal label ("#012"). */
  ordinal: string;
  /** Lifecycle. */
  status: Status;
  /** Block the NAV was computed against. */
  inputsBlock: number;
  /** Accumulated weight over the winning hash. */
  cumulative: number;
  /** Total registered weight. */
  total: number;
  /** Quorum threshold. */
  threshold: number;
  /** Settled NAV, or the honest NAV the quorum failed to certify. */
  nav: string | null;
  /** Operators whose weight never entered the quorum bucket. */
  divergent: number;
  /** Unix seconds of the last event in the strike. */
  timestamp: number;
}

/**
 * Summarise a finished journal for the strike ticker.
 *
 * @param journal a completed strike.
 * @param ordinal 1-based position in the session.
 * @returns the summary row.
 */
export function summariseStrike(journal: Journal, ordinal: number): StrikeSummary {
  const last = journal.quorum.transitions[journal.quorum.transitions.length - 1] ?? null;
  const winning = journal.quorum.winning_result_hash;
  const honest = journal.operators.find((operator) => operator.accepted) ?? null;

  return {
    strikeId: journal.strike_id,
    ordinal: `#${ordinal.toString().padStart(3, "0")}`,
    status: journal.status,
    inputsBlock: journal.inputs_block,
    cumulative: winning === null ? 0 : (last?.cumulative ?? 0),
    total: journal.quorum.total,
    threshold: journal.quorum.threshold,
    nav: journal.attestation.nav_final ?? honest?.nav ?? null,
    divergent: journal.operators.filter((operator) => !operator.accepted).length,
    timestamp:
      journal.attestation.timestamp ??
      journal.operators[journal.operators.length - 1]?.timestamp ??
      0,
  };
}
