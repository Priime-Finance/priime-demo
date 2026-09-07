/**
 * THE FORMAT CONTRACT (COMPOSE_PANEL_SPEC §4.8) — one module, one rounding
 * law, one set of glyphs.
 *
 * `pct()` used to be redefined with an identical body in five files
 * (DiscoverPanel, ModulePanel, PlateScreen, DockReadouts, tips). Six surfaces
 * printing the same number from six private formatters is exactly how three
 * of them ended up disagreeing about the same lane. Everything that prints a
 * number in the canvas imports from here.
 *
 * THE UNIT LAW (hedge spec R2, 2026-08-22) — the one that was missing.
 * `%` means a RATE. `pp` means a rate DIFFERENCE. No exceptions, no surface,
 * no tooltip. `pct()` is the only function that may emit `%` and `pp()` is
 * the only function that may emit `pp`, so the discrimination cannot be
 * lost by a caller. It was lost: `tips.ts:203` defined `pp` with a `%`
 * glyph, so a card could print `The hedge costs 7.7% here` above a body
 * quoting an actual 8.7% funding rate, and the two numbers wore the same
 * unit while measuring different things. Never both units in one mono run.
 *
 * THE LAWS
 *  · APY / net APY .......... 1 dp — `6.1%`
 *  · pp deltas .............. 1 dp, ALWAYS signed — `+2.2pp`
 *  · carry spread ........... 2 dp — `+0.71pp`. The only 2-dp figure in the
 *    product, because it is a PER-TURN quantity multiplied by L: 0.05pp of
 *    spread is 0.2pp of APY at 4x, so the third digit is decision-relevant
 *    here and nowhere else.
 *  · leverage ............... 2 dp, lowercase x, no space — `4.10x`
 *  · funding ................ 1 dp with the earns/costs verb
 *  · capacity ............... lib/canvas/capacity.ts `fmtCapacityUsd`
 *
 * THE SELF-CONSISTENCY LAW (`deltaTriple`): compute from unrounded values,
 * then print `round1(to) − round1(from)`, NEVER `round1(to − from)`. A lane
 * moving 3.049% → 5.151% otherwise prints `+2.1pp · 3.0% → 5.2%` and fails
 * third-grade arithmetic on the one surface whose entire premise is that the
 * numbers reconcile.
 *
 * GLYPHS: U+2212 MINUS SIGN (a hyphen misaligns against mono tabular digits),
 * U+2192 RIGHTWARDS ARROW, and the word `at` — never `@`, which is a handle
 * glyph. No em dashes anywhere.
 */

/** U+2212 MINUS SIGN. Never a hyphen in a numeric column. */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

export const MINUS = "−";
/** U+2192 RIGHTWARDS ARROW. The counterfactual's only legal form. */
export const ARROW = "→";

/**
 * THE MATERIALITY FLOOR — one constant, so the panel and the tip layer are
 * structurally incapable of disagreeing about whether a delta is worth
 * mentioning.
 *
 * RECONCILIATION (2026-08-22): the spec text names "0.05pp" but cites
 * tips.ts:421's `Math.abs(value) >= 0.005` as the gate it is matching, and
 * 0.005 as a rate fraction is 0.5pp, not 0.05pp. The binding requirement is
 * "panel and tip cannot disagree", and the shipped surfaces already agree on
 * half a point (tips.ts:421 and the capacity work's Composition delta at
 * LanePanel `Math.abs(deltaPts) >= 0.5`). So the constant takes the LIVE
 * value and every surface reads it from here.
 */
export const MATERIAL_DELTA = 0.005;

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Replace an ASCII hyphen-minus with U+2212 in an already-formatted run. */
function fixMinus(s: string): string {
  return s.startsWith("-") ? `${MINUS}${s.slice(1)}` : s;
}

/** APY / net APY: 1 dp. `6.1%`. The em-dash-free null is a bare `—`? No:
 *  an unpriced number renders as the mute glyph the callers already use. */
export function pct(v: number | null | undefined, dp = 1): string {
  if (!finite(v)) return "—";
  /* NO SIGNED ZERO. `(-0.0004 * 100).toFixed(1)` is `"-0.0"`, and a card that
     prints `−0.0%` tells a builder the market loses money when the model says
     it is flat. The sign is an artifact of rounding, not a fact about the
     market. */
  const n = (v as number) * 100;
  const rounded = Number(n.toFixed(dp));
  return fixMinus(`${(rounded === 0 ? 0 : n).toFixed(dp)}%`);
}

/** A pp delta, ALWAYS signed, 1 dp. `+2.2pp` / `−12.6pp`. */
export function pp(v: number | null | undefined, dp = 1): string {
  if (!finite(v)) return "—";
  const x = v * 100;
  /* ── NO SIGNED ZERO (QNT-R2-1 fallout, 2026-09-02) ──────────────────────
     `pct` twenty lines up has carried this guard since it shipped, with the
     reason stated: "a card that prints −0.0% tells a builder the market loses
     money when the model says it is flat. The sign is an artifact of
     rounding, not a fact about the market." `pp` never got it, and the two
     live where the claim is sharpest — a signed pp figure is a HERO on both
     auto-compound plates, and `hedge-econ.ts EVEN_FLOOR` states the same law
     a third time: a pp figure that rounds to zero "reads as a measurement"
     and must not be printed as one.

     FOUND BY THE LIVE SWEEP, not by reasoning: moving the funding plate's
     hero onto its signed figure put the Hyperliquid BTC book at −0.00005pp,
     which the old spelling rendered `−0.00pp` — a loss claim about a module
     the model scores flat to the printed resolution.

     THE MAGNITUDE DECIDES THE SIGN, so both come from ONE rounding and can
     never disagree at the boundary. Swept over ±20pp at 1/2/4 dp (12,000,003
     values): the ONLY outputs that move are `−0.0pp` → `+0.0pp` and its 2 dp
     and 4 dp forms. Every other string is byte-identical, and no `?template=`
     hash can move — `templates.ts` imports `pct`, never this. */
  const rounded = Number(x.toFixed(dp));
  const sign = rounded < 0 ? MINUS : "+";
  return `${sign}${Math.abs(rounded).toFixed(dp)}pp`;
}

/**
 * A pp MAGNITUDE, unsigned. `2.20pp`.
 *
 * The after-a-verb form: where a word already states the direction ("costs",
 * "more", "before it trims"), the numeral states only the size. It is `pp`
 * with the sign glyph removed, so the DIGITS can never drift from the signed
 * ledger's. `Lane.tsx` held a private copy of exactly this (`magnitude`),
 * which is the shape single-owner.test.ts exists to refuse.
 */
export function ppMag(v: number | null | undefined, dp = 1): string {
  if (!finite(v)) return "—";
  return `${Math.abs(v * 100).toFixed(dp)}pp`;
}

/**
 * The carry spread `cy − bo`, 2 dp, signed. `+0.71pp`.
 *
 * The single most decision-relevant quantity absent from the catalog today:
 * it explains all three cbETH/WETH rows at once, and it is what makes the
 * counterintuitive Aave case legible (the HIGHER-LLTV row pays LESS, because
 * a negative carry is multiplied by more leverage).
 */
export function carry(cy: number | null | undefined, bo: number | null | undefined): string | null {
  if (!finite(cy) || !finite(bo)) return null;
  return pp(cy - bo, 2);
}

/** Leverage: 2 dp, lowercase x, no space. `4.10x`. */
export function lev(v: number | null | undefined): string {
  if (!finite(v) || v <= 0) return "—";
  return `${v.toFixed(2)}x`;
}

/**
 * Whole dollars, grouped. `$1,250` / `−$310`.
 *
 * The fourth formatter in the collapse (tips.ts:204 held the last private
 * copy). Whole dollars because every USD figure the canvas prints is a
 * deposit, a capacity or a minimum, and cents on a capacity bound is a
 * precision claim the scan cannot support. Capacity keeps its own
 * abbreviating formatter (`capacity.ts` `fmtCapacityUsd`) — that one is a
 * MAGNITUDE (`$2.5M`), a different job, and it is not folded in here.
 *
 * The sign leads the `$`, and it is U+2212, for the same reason as `pp`:
 * these land in mono tabular columns beside the pp ledger.
 */
export function usd(v: number | null | undefined): string {
  if (!finite(v)) return "—";
  const whole = Math.round(Math.abs(v));
  const body = `$${whole.toLocaleString("en-US")}`;
  return v < 0 && whole !== 0 ? `${MINUS}${body}` : body;
}

/**
 * THE AS-OF STAMP. `block 41,563,811`.
 *
 * ⚠ IT IS A PROVENANCE, NOT A QUANTITY, and that distinction is why it lives
 * here rather than in a value formatter. Every measured figure on a record
 * inherits the block its payload was pinned at (`RegisterEvidence.blockNumber`
 * has carried it since the register shipped) and NO surface printed it, so a
 * number and its vintage were never on screen together — the standing quant
 * law broken with the fix already in hand.
 *
 * Digits grouped, matching the Parameters panel's own `Read at` row
 * (`seeds.ts` `chain · block 49,174,196`), because a raw `49174196` beside a
 * `$535K` reads as a fifth kind of measurement rather than as a timestamp.
 */
export function blockStamp(v: number | null | undefined): string | null {
  if (!finite(v) || v <= 0) return null;
  return `block ${Math.round(v).toLocaleString("en-US")}`;
}

/**
 * A SYMMETRIC BAND, `±4.0%`. U+00B1, never `+/-`.
 *
 * The delta band is the one dial in the product whose value is a HALF-WIDTH,
 * so printing it as a bare `4.0%` states twice the exposure the vault runs on
 * one side and none on the other. The glyph is the unit.
 */
export const PLUS_MINUS = "\u00b1";

export function band(v: number | null | undefined, dp = 1): string {
  if (!finite(v)) return "—";
  return `${PLUS_MINUS}${pct(Math.abs(v), dp)}`;
}

/** Funding, with its verb. `earns 4.2%` / `costs 1.1%`. */
export function funding(v: number | null | undefined): string | null {
  if (!finite(v)) return null;
  return `${v >= 0 ? "earns" : "costs"} ${pct(Math.abs(v))}`;
}

export interface DeltaTriple {
  /** `+2.2pp` — the claim. */
  delta: string;
  /** `3.0%` — where the lane is now. */
  from: string;
  /** `5.2%` — where the action would put it. */
  to: string;
  /** Signed, for the caller's copy branch (`Add anyway` / border colour). */
  value: number;
}

/**
 * FRAME C, the only legal shape of a counterfactual: a claim and its receipt,
 * neither readable without the other.
 *
 * The subtraction happens on the ROUNDED endpoints (the self-consistency
 * law), so `+2.2pp · 3.0% → 5.2%` always reconciles on screen even when the
 * unrounded arithmetic does not land on a tenth.
 *
 * Returns null below the materiality floor: a floating `+0.0pp` beside a
 * module name is the orphan-number class this workstream exists to kill.
 */
export function deltaTriple(
  from: number | null | undefined,
  to: number | null | undefined,
): DeltaTriple | null {
  if (!finite(from) || !finite(to)) return null;
  const raw = to - from;
  if (Math.abs(raw) < MATERIAL_DELTA) return null;
  const f1 = Number((from * 100).toFixed(1));
  const t1 = Number((to * 100).toFixed(1));
  const d = t1 - f1;
  return {
    delta: pp(d / 100),
    from: pct(from),
    to: pct(to),
    value: raw,
  };
}

/** `+2.2pp modeled · 3.0% → 5.2%` — the consequence slot, in one string. */
export function tripleSentence(t: DeltaTriple): string {
  return `${t.delta} modeled · ${t.from} ${ARROW} ${t.to}`;
}

/**
 * FRAME M, the market at its own leverage. Never alone, never in a value
 * slot: the leverage is WELDED to the number it qualifies, which is what
 * makes the plate's sub-line recognisable as the same object as the catalog
 * row's headline.
 */
export function scanRef(
  apr: number | null | undefined,
  leverage: number | null | undefined,
): string | null {
  if (!finite(apr)) return null;
  if (!finite(leverage) || leverage <= 0) return pct(apr);
  return `${pct(apr)} at ${lev(leverage)}`;
}

/**
 * The ONE usd-magnitude formatter in the feature. Always FLOORS, so the
 * printed figure never exceeds the modeled one. Three digits, because the
 * inputs are a book-depth snapshot and a borrow-liquidity read that move
 * minute to minute and nothing past three digits is real — but two
 * significant figures is too blunt ($8K vs $8.4K is the difference between a
 * market being assessable and not). Uppercase K/M/B, matching every other
 * money string on the canvas.
 *
 * HANDOFF — CLOSED (2026-08-22). The two component-side copies this note
 * named both rounded UPWARD, printing a capacity larger than the one the
 * model will honour. Both are now thin dispatches onto this export and hold
 * no arithmetic of their own:
 *   · `components/canvas/CopilotPanel.tsx` (`capFmt`) — null-guard only.
 *   · `components/vaults/PortfolioView.tsx` (`chartUsd`) — magnitude bands
 *     here, exact sub-$100K to `store.ts` `fmtUsdFull`.
 * With `store.ts` `fmtUsd` and `funding-demo.ts` `fmtUsd` being aliases of
 * this same function object, this is the ONLY usd-magnitude arithmetic in
 * the codebase. Keep it that way: a second one always disagrees, and on a
 * capacity it disagrees in the direction that promises room we do not have.
 */
export function fmtCapacityUsd(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  /* SIGNED VALUES GO THROUGH THE U+2212 OWNER (cleanup 2026-08-24). This is
     `fmtUsd` for the whole vault surface, and a negative handed to it (a
     modeled loss, a transient countup value) fell through every magnitude
     band into the bottom template and printed "$-2467" — an ASCII hyphen
     inside the one money run, the exact glyph the format contract bans.
     The ratified minus leads the `$`, mirroring `fmtUsdFull`/`format.usd`;
     a magnitude that floors to zero carries no sign. */
  if (v < 0) {
    const body = fmtCapacityUsd(-v);
    return body === "$0" ? body : `${MINUS}${body}`;
  }
  const f = (n: number, u: string) => `$${n >= 100 ? Math.floor(n) : Math.floor(n * 10) / 10}${u}`;
  if (v >= 1e9) return f(v / 1e9, "B");
  if (v >= 1e6) return f(v / 1e6, "M");
  if (v >= 1e3) return f(v / 1e3, "K");
  return `$${Math.floor(v)}`;
}
