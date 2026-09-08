/**
 * THE MODULE RULING (P0-D, 2026-08-22) — one owner for "does this market get a
 * leverage module at all".
 *
 * ── WHAT THE RULING IS ────────────────────────────────────────────────────
 * `netApy(L)` is affine in L with slope `f_b·(cy − bo)`, so the leverage
 * module's whole contribution to a lane is `(L−1)·(cy − bo)·f_b` and it is
 * exactly ZERO at `L = 1`: no borrow leg, no health band, `adverseMoveValue`
 * returns `no debt`, capacity unchanged. Where the slope is not positive the
 * bottom corner is the optimum on ALL THREE of the module's declared axes at
 * once (`netApy`, `cushion`, `capacity` — `modules.ts` "THE INSTALL
 * DECISION"), so the setting the product would choose is the setting at which
 * the module contributes nothing measurable on any axis it moves.
 *
 * A lane holding the module at `L = 1` and a lane not holding it are the same
 * machine on every axis the product has. So the module is ABSENT, not
 * defaulted and not disabled:
 *
 *   • absent, not defaulted — a plate whose every measured contribution is
 *     zero is a plate that teaches the builder a false shape of the product;
 *   • absent, not disabled — at `L = 1` `riskPreset`'s consequence
 *     (`driftBeforeTrim`) is UNDEFINED, and a disabled module keeps that null
 *     path reachable in `PlateControls`, where it falls back to the banned
 *     adjective register. An absent module does not.
 *
 * ── WHY IT IS SAFE TO TAKE THIS ONE ───────────────────────────────────────
 * The quant ledger's A2 attached a caution to exactly this move: "do NOT
 * eject `safety-buffer` to get there (ejecting drops the lane into the phantom
 * `targetLeverage ?? 3` path)". All three owners of that phantom are gone —
 * `store.ts` (2026-08-22), `pricing-params.ts` (writes `PRODUCT_MIN_LEVERAGE`
 * on a loop lane holding no module) and `compile-request.ts` (P0-I). A lane
 * with no leverage module now prices, publishes and decodes as the unlevered
 * machine it is. The caution is discharged; the ruling is not.
 *
 * ── WHY IT READS `notchMove` AND DOES NOT COMPUTE A SLOPE ─────────────────
 * `leverage-stops.notchMove` is the shipped single owner of `LEVERAGE_GRID ·
 * f_b · (cy − bo)`: it reads the one `escrowShare` accessor, it carries the
 * ratified `EVEN_FLOOR` gate, and it is the same instrument the dock prints
 * next to the dial. Deriving a second slope here would be a second owner of
 * the number this decision turns on, and the two would drift the way
 * `escrowShare`'s two copies already drifted once (hedge-econ.ts:149).
 *
 * The floor is load-bearing rather than incidental. `EVEN_FLOOR` is the point
 * below which a pp figure is not a measurement, so a slope inside it is a
 * module whose contribution the product cannot state at any leverage — and
 * under L4 a dial may be auto-set only where every axis it moves is inside the
 * model that sets it. Two fixture rows (`aave-v3-base weETH/WETH`, both lt
 * variants) sit at +0.0005pp per notch against a 0.05pp floor, and the quant
 * ledger records them as "exactly zero ... 12 of 15 not positive". They are
 * absent, and they are the reason this is a floor test and not `> 0`.
 *
 * ── THE THIRD VERDICT IS NOT A HEDGE, IT IS A DIFFERENT QUESTION ──────────
 * `unknown` means the row does not price AT ALL — no economics, or no `f_b`.
 * Absence of data is not evidence of a non-positive slope, so a caller must
 * keep whatever it would have done, which on every path here means installing.
 * It is separated on the same two reads `notchMove`'s own guard makes
 * (`candidate.economics` and `escrowShare(candidate)`), never on the sign of a
 * number, so there is still exactly one place the arithmetic happens.
 *
 * ── SCOPE ─────────────────────────────────────────────────────────────────
 * This answers a question about ONE module, and `safety-buffer` sits on the
 * `loop` chain and no other. A hand-authored row (`economics.model ===
 * "hand-authored"`, the one flag that tells every consumer not to run loop
 * arithmetic on a row) belongs to the dnlp or collar family, where there is no
 * leverage module to rule on — so the loop chain is not an answer that means
 * anything there, and `defaultInstallChain` returns nothing rather than a loop
 * shape a collar lane would then have to refuse.
 */

import { isHandAuthored, type ModuleKey } from "./types";
import type { ProjectedCandidate } from "./opportunities";
import { escrowShare } from "./hedge-econ";
import { notchMove } from "./leverage-stops";

/**
 * `installs` — the slope is positive beyond the ratified floor, so leverage
 *   buys yield here and the module is a control with a real trade.
 * `absent`  — the row prices and its optimum is `L = 1`, where the module
 *   contributes zero on every axis it moves.
 * `unknown` — the row does not price; the caller keeps its prior behaviour.
 */
export type LeverageModuleVerdict = "installs" | "absent" | "unknown";

export function leverageModuleVerdict(
  row: ProjectedCandidate | null | undefined,
): LeverageModuleVerdict {
  // The same two reads `notchMove` guards on, in the same order. No comp: the
  // ruling is a property of the MARKET, so `escrowShare` reads the row's own
  // escrow rather than a lane's dials, and the sign of `cy − bo` does not
  // depend on `f_b` in any case (`f_b > 0` by construction).
  if (!row?.economics) return "unknown";
  if (typeof escrowShare(row)?.fb !== "number") return "unknown";
  /* NO DEBT LEG MEANS NO LEVERAGE TO RULE ON (2026-08-23, `hyperliquid-funding`).
     ---------------------------------------------------------------------
     `notchMove` tests the sign of `cy − bo`, and on a row with no debt market
     `bo` is structurally 0 — not "borrowing is free" but "there is nothing to
     borrow". The slope test then degenerates into "does the spot leg pay
     anything", and it answered `installs` on exactly the three funding rows
     with a credited spot yield. MEASURED on the committed funding document:

       kHYPE  apy@1.00x = 7.6961%   apy@3.00x = 7.6961%
              notchMove = { costs: false, text: "each 0.25x adds 0.33pp here" }

     That is not an inert plate. It is a numeric promise of +0.33pp a notch on
     a control `repriceAtLeverage` refuses to deliver — its own guard returns a
     row with `loopLeverage <= 1` untouched — so a number on the control
     contradicts the number on the card. Worse, the seated plate is what makes
     `{liquidity-source, safety-buffer}` launch-shaped on a market with no debt:
     the naked long.

     The read is `lt === null`, not `debtSymbol === ""`. `borrowsNothing()` in
     `opportunities.ts` nulls `lt` for exactly this reason ("a spot-class row
     has no debt, so it has no liquidation threshold at all"), and the two
     hand-authored template rows carry a `debtSymbol` they never borrow. The
     `bo === 0` half keeps a real lending market with a momentarily zero
     marginal rate (all three Dolomite oriBGT rows) on the slope test where it
     belongs. */
  if (row.lt === null && row.economics.borrowApyMarginal === 0) return "absent";
  const move = notchMove(row, row.cls === "A");
  return move !== null && !move.costs ? "installs" : "absent";
}

/** The convenience predicate every caller in this wave actually wants: keep
 *  the shipped behaviour unless the row PROVED the module inert. */
export function leverageModuleInstalls(row: ProjectedCandidate | null | undefined): boolean {
  return leverageModuleVerdict(row) !== "absent";
}

// ── THE DEFAULT INSTALL CHAIN ─────────────────────────────────────────────

/**
 * What a market-first `Install defaults` press seats on a loop lane, in chain
 * order. PURE and in `lib/` rather than inside the component for the reason
 * `rack-row.ts` gives for the same move: the invariant it exists to guarantee
 * is swept over the whole fixture catalog in a test, and vitest cannot import
 * a `.tsx` (the Next tsconfig keeps `jsx: "preserve"`).
 *
 * Three clauses, each of which belongs to a rule that already exists:
 *
 *  1 · `safety-buffer` — THE MODULE RULING above. Present iff the market's
 *      leverage slope is positive beyond the ratified floor. `unknown` keeps
 *      it, because a row that does not price has not proved anything.
 *
 *  2 · `hedge` — the class-aware default (founder ruling 2026-08-21): the
 *      advertised catalog number and the default composition must describe the
 *      same machine, and a hedged-class row prices the funding leg INTO its
 *      headline. It is exactly the branch `validateGraph` already owns via
 *      `unhedged-class-forbids-hedge`, so an N1 row never carries it.
 *
 *  3 · `auto-compound` — it re-deploys what the other modules earned, so with
 *      nothing else on the chain there is nothing to compound and
 *      `validateGraph` says so (`compound-requires-carry`). Expressed as "the
 *      chain is not empty" rather than by re-typing graph-ops' carry set: the
 *      loop chain's only other two members ARE its carry modules, and the
 *      claim is pinned by a test that runs `validateGraph` over every lane
 *      this function builds on every fixture row, so the rule stays owned by
 *      the validator and this derivation is checked against it.
 *
 * ⚠ THE EMPTY RETURN IS A FINDING, NOT AN EDGE CASE. It is reached on exactly
 * the rows §4.3 already records as publishing no composition at all — the two
 * `syrupUSDC` N1 rows, where leverage subtracts (−0.96pp and −7.34pp a notch)
 * and there is no perp to hedge with, so the vault has nothing that earns.
 * THE HOLDING RULE is the same finding one level up: those rows model 4.38%
 * against a `collateralYieldApy` of 4.71%, so the wrapper subtracts value and
 * the honest product answer is that the market does not render. Until that
 * lands, a press on those rows correctly installs nothing.
 */
export function defaultInstallChain(row: ProjectedCandidate | null | undefined): ModuleKey[] {
  // Not a loop market at all: the loop chain is not the question. See SCOPE.
  if (isHandAuthored(row?.economics)) return [];
  const chain: ModuleKey[] = [];
  if (leverageModuleInstalls(row)) chain.push("safety-buffer");
  if (row?.cls === "A") chain.push("hedge");
  if (chain.length > 0) chain.push("auto-compound");
  return chain;
}

// ── WHAT THE MARKET RULED OUT ─────────────────────────────────────────────

/**
 * THE GHOST BAY RULING (2026-08-22) — the one channel through which a MARKET's
 * verdict reaches a GRAPH derivation.
 *
 * ── WHY THIS FUNCTION EXISTS AT ALL ───────────────────────────────────────
 * `leverageModuleVerdict` answers a question about one module. `addableModules`
 * and `rackItems` ask a question about a lane: "which modules does this market
 * put out of reach". Without a named crossing, every surface that needs the
 * second answer has to spell `leverageModuleInstalls(row) ? [] : ["safety-buffer"]`
 * for itself, and the mapping from THE MODULE RULING to a module key becomes as
 * many opinions as there are call sites. It is one line, and one line copied
 * four times is how `escrowShare` drifted (hedge-econ.ts:149).
 *
 * It also keeps `graph-ops` free of this file. A `ModuleKey[]` crosses the seam,
 * not a `ProjectedCandidate`, so the graph layer never imports the pricing layer
 * and there is no cycle to reason about.
 *
 * ── WHAT "DOMINATED" MEANS HERE, AND WHAT IT DOES NOT ─────────────────────
 * Dominated is a statement about the CONTROL, under L1: every setting the module
 * offers on this market is beaten on all three declared axes at once, so the
 * module is not an instrument here and the rack must not propose it. It is NOT a
 * statement about the lane's legality — `validateGraph` would still take the
 * module, the dock shelf still offers it priced, and a lane already holding it
 * still draws its plate. The rack may refuse to OFFER a module; it may never
 * fail to DRAW one the lane is holding.
 *
 * ── AND WHY `unknown` RETURNS THE EMPTY LIST ──────────────────────────────
 * Same three-valued reason `defaultInstallChain` keeps the module on a row that
 * does not price: absence of data is not evidence of a non-positive slope. An
 * empty list is exactly the shipped behaviour, so a caller that has no row yet
 * (a cold catalog, a quote in flight) gets the rack it has always drawn.
 */
export function dominatedModules(row: ProjectedCandidate | null | undefined): ModuleKey[] {
  // Not a loop market at all: the loop chain is not the question, exactly as
  // `defaultInstallChain` states it under SCOPE. A hand-authored row belongs to
  // the dnlp or collar family, where there is no leverage module to rule on, so
  // naming one as dominated would be an answer to a question nobody asked.
  if (isHandAuthored(row?.economics)) return [];
  return leverageModuleInstalls(row) ? [] : ["safety-buffer"];
}

// ── THE SIGN FALLBACK ─────────────────────────────────────────────────────

/**
 * THE ROW THE VERDICT READS, when the catalog row is gone (2026-08-23).
 *
 * ── THE LEAK ──────────────────────────────────────────────────────────────
 * Every verdict above keys on the LIVE catalog row, `catalogRow(oppData, id)`.
 * When a venue answers empty (morpho-blue-hyperevm did, on the founder's
 * screen) that row is null, `dominatedModules(null)` is `[]`, the ghost bay
 * RETURNS, `Install defaults` seats the module, and the stops then price off
 * the cached `reprice.candidate` — three cells, NO DEBT lit, on a market the
 * ruling had already closed. The verdict went blind exactly when the market
 * kept pricing.
 *
 * ── WHY THE REPRICED CANDIDATE IS A LEGAL INPUT FOR THE SIGN ──────────────
 * `leverageModuleVerdict` decides on `sign(cy − bo)` through `notchMove`, and
 * `repriceAtLeverage` never touches `collateralYieldApy` or
 * `borrowApyMarginal`: the sign is REPRICE-INVARIANT (quant ruling
 * 2026-08-23). So a lane's own candidate — the one `mockQuote` already priced
 * it from — may answer the sign question whenever the raw row cannot.
 *
 * ── AND WHY IT IS THE SIGN ONLY ───────────────────────────────────────────
 * It may NEVER feed the sweep ceiling. The caution at `RackCanvas` over
 * `laneLeverageStops` and `scanRowFor` is about `economics.loopLeverage`: a
 * repriced candidate carries the lane's CURRENT leverage as its ceiling, so
 * every stop above it collapses onto it and a real trade reports as a tie.
 * That caution is untouched. This helper exists so the two questions — the
 * sign, and the ceiling — are answered from two named inputs and nobody
 * spells the fallback order twice.
 *
 * Order: the raw row when it exists (byte-identical to the shipped product on
 * every row the catalog serves), else the lane's own candidate, else null —
 * which is `unknown`, and `unknown` keeps the shipped behaviour.
 */
export function verdictRow(
  raw: ProjectedCandidate | null | undefined,
  repriced: ProjectedCandidate | null | undefined,
): ProjectedCandidate | null {
  return raw ?? repriced ?? null;
}
