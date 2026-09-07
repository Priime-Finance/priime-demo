/**
 * Proposal APPLY replay (IT4_COPILOT_SPEC §3.5). Pure.
 *
 * buildPortfolioFromProposal replays a validated ProposalPayload through the
 * SAME pure ops the RackCanvas reducer cases call — addLoop / addModule /
 * updateParam / setAllocations / deriveRiskParams — so every clamp, snap and
 * derivation applies identically to a hand-built canvas. The copilot never
 * mutates the canvas; the user presses APPLY and RackCanvas dispatches ONE
 * atomic { type: "load" } with the built portfolio.
 *
 * ── THE SECOND OWNER OF THE LANE NUMBER IS GONE (D2, 2026-08-24) ──────────
 *
 * Pricing the blueprint card from the compile route was a second owner of
 * the lane number that only ever answered for two venues: `liveScan` ends
 * `else { throw "live scan supports the launchable Morpho venues only" }`, and
 * the canvas has NEVER priced a non-Morpho lane through that route. A funding
 * blueprint therefore came back with a null blend, an honest violation, and an
 * APPLY gate that read neither — so the key was live over a card with no number
 * on it.
 *
 * There is now ONE owner, `publishedNetApy` through `laneEconomicsFor`, which
 * prices every venue because it prices the catalog row. The card and the rack
 * are the same machine at the same dials in the same frame. the compile route
 * survives as a RAIL CHECK ONLY — sent for launchable venues, consumed for its
 * violations and its pinned block, and contributing no APY at all.
 */

/* eslint-disable @typescript-eslint/array-type, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/non-nullable-type-assertion-style --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import type { LoopId, ModuleKey, PortfolioGraph } from "@/lib/canvas/types";
import type { PortfolioCompiledView } from "@/components/canvas/types";
import {
  addLoop,
  addModule,
  emptyPortfolio,
  setAllocations,
  updateParam,
} from "@/lib/canvas/graph-ops";
import type { LaneFamily } from "@/lib/canvas/graph-ops";
import { defaultValueFor, type ParamContext } from "@/lib/canvas/modules";
import { nodeId } from "@/lib/canvas/ids";
import { landingLeverage, snapToLeverageGrid } from "@/lib/canvas/leverage-stops";
import { PRODUCT_MIN_LEVERAGE } from "@/lib/canvas/param-schema";
import type { LaneComposition } from "@/lib/canvas/mock-quote";
import { LAUNCHABLE_VENUES, type CanvasVenueId } from "@/lib/canvas/opportunities";
import { CANVAS_TEMPLATES, type TemplateId } from "@/lib/canvas/templates";
import type { PortfolioCompileRequestBody } from "@/lib/canvas/server-shim";
import { seatedComposition, seatedModulesFor } from "./lane-frame";
import type { ProposalPayload, ProposalSeat, SeatedProposal } from "./tools";

export interface BuiltProposal {
  portfolio: PortfolioGraph;
  /** Every node id added — for the snap animation (markSnap). */
  nodeIds: string[];
}

/**
 * The lane's market bounds, resolved on the lane AS SEATED SO FAR (recette v2,
 * PO-2, 2026-09-02).
 *
 * A function rather than a `ParamContext`, for two reasons. The context is a
 * fact about the SEATED lane — `paramContextForLoop` reads the pinned
 * `candidateId` off the graph — so it cannot be computed before the source is
 * written, and it must be re-read after it. And it is built from
 * `pricing-params` + `mock-quote` + the live payload, which the copilot layer
 * has no business importing: the caller that holds the payload passes its own
 * reader in, exactly as `graph-ops.seatMarket` takes one.
 *
 * Omitted (templates today) means the STRUCTURAL envelope, which is what this
 * builder has always used.
 */
export type LaneParamContextOf = (loop: PortfolioGraph["loops"][number]) => ParamContext;

// ── APPLY gate (recette P0-1 / P1-2) ──────────────────────────────────────
//
// A blueprint whose markets fail to resolve against the LIVE compile scan
// must never compose: applying one bricks the draft into the permanent
// quote dead end. The gate reads the card's compile state; APPLY stays
// locked until the model verified every lane against a live block.

/** The blueprint card's compile state (mirrors CopilotPanel's CompileState). */
export type ProposalCompileState =
  | { status: "pending" }
  | { status: "done"; blendedApyPct: number | null; violations: string[]; perLoopApyPct: (number | null)[] }
  | { status: "error"; message: string };

/** Violations that mean a market did not resolve against the live scan. */
const UNRESOLVED_MARKET_RE = /not found in the live scan|market row missing from the live scan/i;

export interface ApplyGate {
  ok: boolean;
  /** Human reason APPLY is locked; null when ok. */
  reason: string | null;
}

export function proposalApplyGate(
  compile: ProposalCompileState,
  payload: ProposalPayload,
): ApplyGate {
  if (compile.status === "pending") {
    return { ok: false, reason: "modeling this blueprint" };
  }
  if (compile.status === "error") {
    return { ok: false, reason: "this blueprint could not be verified. Ask for a fresh proposal" };
  }
  /* THE QUARANTINE (2026-08-24). A lane with no modeled number never applies.
     This is the clause the funding defect walked through: the compile route
     could not price a funding lane, the card printed a null blend, and the key
     was live anyway. The number now comes from the payload, so its absence is
     a fact about the lane rather than about a fetch. */
  if (payload.loops.some((l) => l.lane.vaultApy === null)) {
    return {
      ok: false,
      reason: "one lane in this blueprint has no modeled number. Ask for a fresh proposal",
    };
  }
  /* The belt to the validator's absence refusal: an unmeasured market must
     never reach the rack, whichever path built the payload. */
  const absent = payload.loops.find((l) => l.lane.absenceReason !== null);
  if (absent) {
    return { ok: false, reason: `${absent.snapshot.pair}: ${absent.lane.absenceReason}` };
  }
  const unresolved = compile.violations.some((v) => UNRESOLVED_MARKET_RE.test(v));
  if (unresolved) {
    return {
      ok: false,
      reason: "a market in this blueprint left the latest live scan. Ask for a fresh proposal",
    };
  }
  /* ⚠ A RAIL VERDICT NEVER LOCKS APPLY. Eyes-open pinning is the shipped
     behaviour: a fully measured, rail-less market pins, composes, reaches
     review and publishes as a modeled design wearing its verdict. The verdict
     is PRINTED, not enforced. */
  return { ok: true, reason: null };
}

/** The template registry's own seed params for a hand-authored market, keyed
 *  by the candidate id it seeds. Read, never re-typed: the number on the row
 *  was computed at these dials and a second copy of them is how a card and a
 *  lane come to describe two different collars. */
function templateSeedParams(
  candidateId: string,
): Partial<Record<ModuleKey, ReadonlyArray<readonly [string, string]>>> {
  for (const id of Object.keys(CANVAS_TEMPLATES) as TemplateId[]) {
    const seed = CANVAS_TEMPLATES[id].seed;
    if (seed.kind === "mock-candidate" && seed.candidate.id === candidateId) {
      return seed.params ?? {};
    }
  }
  return {};
}

export function buildPortfolioFromProposal(
  p: SeatedProposal,
  ctxOf?: LaneParamContextOf,
): BuiltProposal {
  let g = emptyPortfolio();
  const nodeIds: string[] = [];
  const loopIds: LoopId[] = [];

  for (const l of p.loops as readonly ProposalSeat[]) {
    g = addLoop(g);
    const id = g.loops[g.loops.length - 1].id;
    loopIds.push(id);
    /* The lane's bounds, re-read after every write. The market is seated by
       the `fields` loop below, so a context taken before it would be the
       EMPTY one on every lane — the same stale-context defect `seatMarket`
       closes on the rack, one layer over. */
    const ctx = (): ParamContext | undefined => {
      if (!ctxOf) return undefined;
      const loop = g.loops.find((x) => x.id === id);
      return loop ? ctxOf(loop) : undefined;
    };

    g = addModule(g, id, "liquidity-source", ctx());
    nodeIds.push(nodeId(id, "liquidity-source"));
    const fields: [string, string][] = [
      ["venue", l.snapshot.venue],
      ["candidateId", l.candidateId],
      ["pairLabel", l.snapshot.pair],
      ["contentHash", l.snapshot.contentHash],
      ["cls", l.snapshot.cls],
      ["hlCoin", l.snapshot.hlCoin ?? ""],
    ];
    for (const [f, v] of fields) g = updateParam(g, id, "liquidity-source", f, v, ctx());

    /* THE CHAIN IS THE STRATEGY'S, NOT THE LOOP'S (2026-08-24).
       ------------------------------------------------------------------
       This seated `[safety-buffer?, hedge?, auto-compound?]` unconditionally,
       which is the LOOP chain, so a treasury collar blueprint applied as a
       loop lane on an options market and a delta-neutral LP applied with no
       range at all. `seatedModulesFor` is the one place a chain is spelled in
       the copilot subsystem, and `laneEconomicsFor` priced the card with the
       same call, so what the card advertised and what APPLY seats are one set
       of modules by construction rather than by agreement.

       THE MODULE RULING SURVIVES INSIDE IT: `leverageModule` false means the
       plate is ABSENT, not defaulted at 1.0, and `pricingParamsFor` then
       answers `PRODUCT_MIN_LEVERAGE` on the loop family — the unlevered
       machine the lane actually is. */
    const seatParams = templateSeedParams(l.candidateId);
    for (const key of seatedModulesFor(l.strategy ?? "loop", l)) {
      if (key === "liquidity-source") continue;
      g = addModule(g, id, key, ctx());
      nodeIds.push(nodeId(id, key));
      /* ONE PARAM ON THE PLATE. The old branch also wrote `riskPreset`, which
         is how the adjective ladder came to own the CEILING as well as the
         position: `houseMaxLeverage` is preset-aware, so a stop moved the cap
         it was derived from. The preset is the user's own Advanced control and
         a blueprint does not touch it. A blueprint with no leverage lands on
         the market's own default, the same landing the catalog card quotes. */
      if (key === "safety-buffer" && l.snapshot.lt !== null) {
        const target =
          l.leverage !== null
            ? snapToLeverageGrid(l.leverage)
            : landingLeverage(l.snapshot.lt, "standard", l.snapshot.loopLeverage ?? null);
        g = updateParam(g, id, "safety-buffer", "targetLeverage", target, ctx());
      }
      /* The composition the hand-authored row was PRICED at, from the template
         registry itself. Without it a collar seats the descriptor's +15% call,
         which at the modeled IV does not cover the put plus the roll, and the
         lane would model negative income under a card advertising the +10/-12
         figure the row actually carries. */
      for (const [f, v] of seatParams[key] ?? []) {
        g = updateParam(g, id, key, f, v, ctx());
      }
    }
  }

  if (p.loops.length >= 2) {
    const alloc: Record<LoopId, number> = {};
    loopIds.forEach((id, i) => {
      alloc[id] = p.allocationsBps[i];
    });
    g = setAllocations(g, alloc); // orchestrator already auto-enabled by addLoop
  }

  return { portfolio: g, nodeIds };
}

// ── THE COPILOT MAY NOT DISAGREE WITH THE RACK (P0-J, 2026-08-22) ─────────
//
// `buildPortfolioFromProposal` and `compileBodyFromProposal` describe ONE
// blueprint: the first builds the lane APPLY seats on the rack, the second
// builds the body the card is priced from. They must be the same machine, and
// they were not. The card carried four pinned literals while the rack read the
// descriptors, so the number on the card and the number on the lane the user
// pressed APPLY for were computed at different dials:
//
//   reserveFraction  0.10  against  RESERVE_MIN_FRACTION (0.15)
//   minActionUsd     $25   against  derivedMinActionUsd(refTvl) ($155)
//   hedgeLeverage    3     against  the descriptor's 3      (agreed, by luck)
//   targetLeverage   3     against  the descriptor's 3      (agreed, by luck)
//
// Measured on kHYPE: `f_b(3, 0.10) = 0.6977` against `f_b(3, 0.15) = 0.6742`,
// 3.49% relative, and `compoundDelta` at θ = $25 is 0.119pp low against the
// argmax θ* = √(2·gas·TVL). About 0.18pp of blueprint APY, all of it in the
// direction that flatters the card.
//
// Two of the four agreed only because the descriptor happens to hold the same
// number today, which is the worse half of the defect: a second owner that
// currently matches is a second owner that will silently stop matching the
// next time the first one moves. Both are read now, so there is one owner.
//
// ⚠ THE APPLIED SIDE HAS A PARAM CONTEXT NOW (recette v2, PO-2, 2026-09-02),
// AND THIS IS THE EDIT THAT GAVE IT ONE.
//
// The clause that stood here — "no param context, deliberately, narrowing here
// would re-open the same gap facing the other way" — read the asymmetry
// backwards. The rack narrows: every reducer dispatch carries
// `paramContextFor`, so a hand-composed lane seats the PLACED BOOK's defaults.
// This builder did not, so it seated the structural ones. Two builders, one
// market, two sets of published dials — measured on
// `morpho-blue-base wsteth-weth`, where the applied lane published a funding
// floor the product's own descriptor called inadmissible for that book. The
// gap was never closed by both sides being structural; it was closed by
// neither side having looked.
//
// So the context is passed IN (`ctxOf`), by the caller that holds the live
// payload, and it is re-read after every write because the bounds are a fact
// about the seated market. `compileBodyFromProposal` below still prices at the
// structural composition — it is the RAIL CHECK, its body is not a lane, and
// `proposalLoopComposition` is the single owner of that body either way.
//
// ⚠ THE TEMPLATE PATH STILL PASSES NOTHING. `templates.buildTemplatePortfolio`
// shares this builder, and narrowing there moves the `?template=` sha-256 pins
// in `template-regression.test.ts`. That re-pin is a founder call, not a fix
// wave's: the parameter is optional so the template path keeps its exact
// current output until the call is made.

/** The descriptor's own numeric default, structural, exactly as `addModule`
 *  seats it. Absent means a descriptor was deleted, which is a build defect
 *  and not something to paper over with a literal. */
function numDefault(key: ModuleKey, field: string): number {
  const d = defaultValueFor(key, field);
  if (typeof d !== "number" || !Number.isFinite(d)) {
    throw new Error(`no numeric default for ${key}.${field}`);
  }
  return d;
}

/**
 * The composition a blueprint loop is priced at: the descriptor's own
 * structural defaults, exactly as `addModule` seats them on APPLY (P0-J's "no
 * param context, deliberately"). ONE owner for the compile body's dials AND
 * the frame restatement in `proposalCompileState` below; a second copy of
 * these dials is precisely how the card came to be priced at one escrow while
 * the applied lane ran another.
 */
export function proposalLoopComposition(l: {
  hedge: boolean;
  compound: boolean;
}): LaneComposition {
  /* ONE OWNER, AND IT MOVED (S2, 2026-08-24). The body lives in
     `lane-frame.ts` as `seatedComposition`, because that is the module every
     copilot number comes out of and it must not be able to price a lane at a
     composition the lane does not seat. `laneEconomicsFor` defaulted to
     `CATALOG_COMPOSITION` while this function fed the card, so the context and
     the card disagreed by exactly the compounding delta on every lane. The
     shipped name stays here for the compile body and the replay. */
  return seatedComposition(l);
}

/**
 * THE RAIL CHECK, AND ONLY THE RAIL CHECK (D2, 2026-08-24).
 *
 * the compile route prices through `liveScan`, which supports the two
 * launchable Morpho venues and throws on everything else. It was never the
 * canvas's pricer and it is not the card's any more: the card's numbers ride on
 * the payload (`loops[i].lane`). What this body still asks for is the two
 * things only a live compile knows — the lane's launch violations and the block
 * it pinned — so it is sent for LAUNCHABLE VENUES ONLY.
 *
 * Null means there is nothing to check and no fetch is made. That is what
 * makes the string "live scan supports the launchable Morpho venues only"
 * unreachable from the copilot path: a funding, Aerodrome or options lane is
 * never sent, so it can never come back as a violation on a card.
 *
 * `orchestrator: null` always. The mirror is a shadow object with no rails; it
 * was only ever read here for a blended APY, and the blend is the payload's now.
 */
export function compileBodyFromProposal(p: ProposalPayload): PortfolioCompileRequestBody | null {
  const rail = p.loops
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => LAUNCHABLE_VENUES.has(l.snapshot.venue as CanvasVenueId));
  if (rail.length === 0) return null;
  return {
    loops: rail.map(({ l, i }) => {
      const comp = proposalLoopComposition(l);
      return {
        loopId: `prop_${i + 1}`,
        label: l.snapshot.pair,
        body: {
          venue: l.snapshot.venue,
          candidateId: l.candidateId,
          /* The lane's family, so the compile applies the same chain the rack
             does. A funding lane IS a loop-family lane with no leverage
             segment, which is why it maps to `loop` rather than to a fourth
             family that does not exist. */
          family: (l.strategy === "funding" ? "loop" : l.strategy) as LaneFamily,
          riskPreset: "standard" as const,
          targetLeverage: !l.leverageModule
            ? // No leverage module: the lane is the unlevered machine and
              // `pricingParamsFor` prices it at the product floor. The card's
              // body must land on the same number the rack holds.
              PRODUCT_MIN_LEVERAGE
            : l.snapshot.lt !== null
              ? l.leverage !== null
                ? snapToLeverageGrid(l.leverage)
                : landingLeverage(l.snapshot.lt, "standard", l.snapshot.loopLeverage ?? null)
              : // lt null: `buildPortfolioFromProposal` writes no leverage at
                // all, so the node keeps the descriptor's default. Read the same
                // owner rather than re-typing the number it happens to hold.
                numDefault("safety-buffer", "targetLeverage"),
          hedge: comp.hedge,
          compound: comp.compound,
        },
      };
    }),
    orchestrator: null,
  };
}

// ── THE CARD TAKES ITS NUMBERS FROM THE PAYLOAD (D2, 2026-08-24) ──────────
//
// `laneFrameApy` LIVED HERE AND IS DELETED. Its whole job was converting a
// scan-frame compile number (`F_B = 0.75`) into a lane-frame one at the dials
// `compileBodyFromProposal` sent — a real fix for a real chimera, measured on
// production as "Blended net APY, modeled: 6.9%" where the lane blend was
// 6.4%. But it repaired the second owner instead of removing it, and the
// second owner could only ever answer for two Morpho venues. There is no
// compile number to restate any more: `validateProposal` prices every lane
// server-side through `laneEconomicsFor`, in the PRODUCT frame, at the
// composition the replay seats.
//
// What the compile still contributes is `violations` and the block it pinned.
// `res` is null when no lane was on a launchable venue, which is the normal
// state of a funding, dn-LP or collar blueprint, and a null response means no
// violations rather than an error.

export function proposalCompileState(
  p: ProposalPayload,
  res: PortfolioCompiledView | null,
): Extract<ProposalCompileState, { status: "done" }> {
  const loops = res?.loops ?? [];
  const violations = [
    ...(res?.violations ?? []),
    ...loops.flatMap((l) => l.compiled.violations ?? []),
  ];
  const pct1 = (v: number | null) => (v === null ? null : Number((v * 100).toFixed(1)));
  const perLoopApy = p.loops.map((l) => l.lane.vaultApy);
  /* THE BLEND IS THE PAYLOAD'S OWN, at the payload's own allocations. No
     frame averaging is possible any more because there is one frame: every
     term in the sum came out of `composedTerms(...).published`. A single lane
     with no modeled number nulls the blend, and the APPLY gate above refuses
     that blueprint outright rather than showing a blank key. */
  const blended = perLoopApy.every((v) => v !== null)
    ? p.loops.reduce((s, l, i) => s + (l.lane.vaultApy as number) * (p.allocationsBps[i] ?? 0), 0) /
      10_000
    : null;
  return {
    status: "done",
    blendedApyPct: pct1(blended),
    violations,
    perLoopApyPct: perLoopApy.map(pct1),
  };
}
