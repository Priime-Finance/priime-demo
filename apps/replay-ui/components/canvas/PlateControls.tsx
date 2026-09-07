"use client";

/* eslint-disable eqeqeq --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * PlateControls (UX_ITERATION_3 §3) — the focused plate's hm-acts swap.
 * Safety-buffer and hedge carry no front-surface dials: their v2 controls live
 * intact behind an ADVANCED disclosure, pre-filled with the values the lane
 * already stores. Full v2 power is preserved — same descriptors, same clamps
 * in graph-ops. Auto-compound keeps its human controls on the surface.
 *
 * ══ THE ADVANCED-TOUCH NOTIFICATION IS GONE (2026-08-22) ═══════════════════
 *
 * `onAdvancedTouch` existed for exactly one thing: to flip a lane's risk dial
 * to "Custom" when a dial under here was dragged. That dial state was deleted
 * with the adjectives it named, and the control's position is now READ from
 * `targetLeverage` — so a drag moves the control by moving the value, and
 * there is nothing to notify.
 *
 * ══ THE ATTRIBUTE IS THE BOUND THE CONTROL ENFORCES (D3, 2026-08-24) ═══════
 *
 * This file read `getDef(moduleKey).params` — the STRUCTURAL envelope, the
 * widest bound any market could ever justify. `graph-ops.updateParam` clamps
 * against `descriptorsFor(key, ctx)`, the market's own. Two readings of one
 * bound, and on production they disagreed: the leverage slider published
 * `min="1" max="3.75" step="0.25"` on `morpho-blue-base cbETH/WETH` while the
 * reachable maximum there is 3.50. ArrowRight at 3.50 did nothing, a click at
 * the far right of the track landed on 3.50, and a native-setter write of 3.75
 * snapped back — a dead zone at the right end of the track, and a maximum
 * announced to screen readers and keyboard users that the control refuses to
 * honour. It also misled one investigation into writing "the shipped dial goes
 * to 3.75x".
 *
 * The fix is not a second clamp here. It is for the attribute and the clamp to
 * read the SAME producer with the SAME context: `descriptorsFor(moduleKey,
 * ctx)`, where `ctx` is the very `paramContextFor(...)` the reducer attaches to
 * every `param` dispatch. `getDef` survives for `def.name` only — a label, not
 * a bound.
 *
 * ══ "RISK PROFILE" IS GONE, INCLUDING FROM THE ACCESSIBILITY TREE ══════════
 *
 * The `riskPreset` descriptor's `friendlyLabel` was the exact phrase the vault
 * page was cleaned of, and `SegKeys` pipes `friendlyLabel` into `aria-label`,
 * so a screen reader heard "Risk profile, Std selected" on a surface that
 * publicly banned the phrase. Worse, the three shortLabels (Wider / Std /
 * Tighter) described the trim GAP and inverted the safety reading: the
 * conservative preset runs the WIDEST gap, so it lets the position deteriorate
 * FURTHEST before trimming. The cells now print the measured drift itself
 * (`liquidation.driftBeforeTrim`), which is exact, moves with the market and
 * the leverage, and fixes the inversion for free by simply stating the number.
 */

import { useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { NO_BORROW_BANDS_VALUE } from "@/lib/canvas/labels";
import type { ModuleKey, ParamDescriptor, ParamValue } from "@/lib/canvas/types";
import { descriptorsFor, getDef, type ParamContext } from "@/lib/canvas/modules";
import { lev, pct, ppMag } from "@/lib/canvas/format";
import { driftBeforeTrim, liquidationDistance } from "@/lib/canvas/liquidation";
import type { RiskPreset } from "@/lib/canvas/param-schema";
import { watchViewOf, type PostureStop } from "@/lib/canvas/exogenous";
import type { RepriceData } from "./types";

/**
 * THE ONE CHIP-ACTIVATION HANDLER (recette I10).
 *
 * Every chip on this canvas is a `div[role=button][tabIndex=0]`, and every
 * one of them had its own `if (e.key === "Enter" || e.key === " ")` with no
 * `preventDefault()`. Space's default action on a focused div is to scroll
 * its scroll container, so pressing Space on a dial preset both toggled the
 * preset AND scrolled the plate out from under the finger.
 *
 * `stopPropagation` is the second half: the plate root and the lane header
 * are role=button now too, and a key that activates a chip must not also
 * activate the surface behind it.
 */
function chipKeys(run: () => void) {
  return (e: ReactKeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    run();
  };
}

interface Props {
  moduleKey: ModuleKey;
  params: Record<string, ParamValue>;
  /**
   * The lane's market, as `paramContextFor(portfolio, oppData, loopId)` reads
   * it — the SAME object the reducer attaches to every `param` dispatch and
   * clamps with (D3).
   *
   * Optional so a caller with no market in hand still renders: `descriptorsFor`
   * returns the structural envelope unchanged for an empty context, which is
   * exactly the pre-pick state. It is NOT optional in spirit — a call site that
   * holds a lane and omits it draws a bound its own clamp will refuse.
   */
  ctx?: ParamContext;
  /** The lane's effective quote. Read for the market's own liquidation
   *  threshold and the leverage the model landed on — the two inputs the
   *  drift figure needs. Absent, the preset cells print their raw values
   *  rather than a drift they cannot prove. */
  reprice?: RepriceData | null;
  /** Whether the LANE runs the short leg. The watcher's cells print counts
   *  over the lane's DERIVED dependency set, and the margin crossing onto the
   *  perp venue is one of that set's members — so the same control prints
   *  `2 | 3 | 4` on an unhedged lane and `2 | 4 | 6` on a hedged one. Both
   *  homes of this component already hold the flag. */
  hasHedge?: boolean;
  onParam: (field: string, value: ParamValue) => void;
  onEject?: () => void;
}

/**
 * The dial's own reading of its value.
 *
 * R5 grep (2026-08-22), found by driving the keyboard path: this was a
 * private leverage formatter. `{v}{unit}` renders the raw slider number, so
 * a dial at 3 read `Target leverage 3x` four lines under the very same
 * plate's header reading `3.00x` — one plate, one quantity, two spellings,
 * and the `aria-valuetext` announced the wrong one of the two. Both `x`
 * params in the schema (`targetLeverage`, `hedgeLeverage`) are leverages, so
 * `format.lev` is exactly the owner for that unit. Every other unit keeps
 * the generic path — this is a dispatch, not a second `lev`.
 *
 * ══ THE RATE UNITS GO THROUGH `pct` (recette v2, DEF-01, 2026-09-02) ═══════
 *
 * `fundingFloorApr` and `reserveFraction` are stored as FRACTIONS, and the
 * publish record prints both through `format.pct` — `−5.0% APR`,
 * `15.0% of short`. The generic path renders the raw slider number, so the
 * dial would have read `-0.05 APR` and `0.15 of short` beside a record saying
 * something else: the same one-quantity-two-spellings defect the `lev` branch
 * above was opened for, with an ASCII hyphen where the house glyph is U+2212.
 * `pct` is the single owner of that spelling, so the branch reads it.
 */
function dialReading(v: number, desc: ParamDescriptor): string {
  if (desc.unit === "x") return lev(v);
  if (desc.unit === "APR") return `${pct(v)} APR`;
  if (desc.unit === "of short") return `${pct(v)} of short`;
  return desc.unit ? `${v} ${desc.unit}` : `${v}`;
}

function Dial({ desc, value, onChange }: { desc: ParamDescriptor; value: ParamValue; onChange: (v: number) => void }) {
  const v = typeof value === "number" ? value : Number(desc.default);
  const reading = dialReading(v, desc);
  /* I11 — the slider had no name and no description, so it announced as
     "slider, 2.5" with the label and the recommended band sitting beside it
     as decoration a screen reader never reached. The band is the one piece
     of guidance this control carries; it is now attached to it. */
  const bandId = useId();
  const hasBand = typeof desc.recommendedMin === "number";
  return (
    <div className="pc-dial">
      <div className="pc-dialrow">
        <span className="pc-lab">{desc.friendlyLabel}</span>
        <span className="pc-val">{reading}</span>
      </div>
      <input
        type="range"
        min={desc.min}
        max={desc.max}
        step={desc.step}
        value={v}
        aria-label={desc.friendlyLabel}
        aria-describedby={hasBand ? bandId : undefined}
        aria-valuetext={reading}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hasBand ? (
        <span className="pc-band" id={bandId}>
          recommended {desc.recommendedMin}–{desc.recommendedMax}
          {desc.unit === "x" ? "x" : ""}
        </span>
      ) : null}
    </div>
  );
}

function SegKeys({
  desc,
  value,
  onChange,
  labelFor,
  groupLabel,
}: {
  desc: ParamDescriptor;
  value: ParamValue;
  onChange: (v: string) => void;
  /** Per-option label override, for a control whose cells state a MEASURED
   *  quantity instead of a word. Returning null falls back to the
   *  descriptor's own short label. */
  labelFor?: (optionValue: string) => string | null;
  /** Group name override, so the a11y tree never inherits a banned phrase
   *  from a descriptor that other code still keys off. */
  groupLabel?: string;
}) {
  /* A one-of-many set of chips IS a radiogroup, and saying so is what lets a
     screen-reader user hear "3 of 4 selected" instead of four unrelated
     buttons. The group carries the parameter's name; each chip carries only
     its own value, which is how the control actually reads on screen. */
  return (
    <div className="hm-keys" role="radiogroup" aria-label={groupLabel ?? desc.friendlyLabel}>
      {desc.options?.map((o) => (
        <div
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          tabIndex={0}
          className={`hm-key${value === o.value ? " lit" : ""}`}
          data-key={o.value}
          onClick={(e) => {
            e.stopPropagation();
            onChange(o.value);
          }}
          onKeyDown={chipKeys(() => onChange(o.value))}
        >
          <span className="hm-led" />
          {labelFor?.(o.value) ?? o.shortLabel ?? o.label}
        </div>
      ))}
    </div>
  );
}

function EjectKey({ onEject, what }: { onEject: () => void; what: string }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Eject ${what}`}
      className="hm-key pc-eject"
      data-key="eject"
      onClick={(e) => {
        e.stopPropagation();
        onEject();
      }}
      onKeyDown={chipKeys(onEject)}
    >
      <span className="hm-led" />
      Eject
    </div>
  );
}

function AdvancedKey({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      className={`hm-key${open ? " lit" : ""}`}
      data-key="advanced"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={chipKeys(onToggle)}
    >
      <span className="hm-led" />
      Advanced
    </div>
  );
}

/** The head the `riskPreset` cells sit under, and the group name a screen
 *  reader hears. It names what the control SETS. */
const DRIFT_LABEL = "Drift before it trims";

/** The head the watcher's cells sit under, and the group name a screen reader
 *  hears. ONE VERB across the whole module: `answered` is the control label,
 *  the axis id, the published param row and the effect of a hold. Two words
 *  for one idea is the defect. An answer is WRITTEN; a response HAPPENS — and
 *  that single word is what keeps this surface inside the register our own
 *  published pages already hold. */
const ANSWERED_LABEL = "Answered";

export default function PlateControls({ moduleKey, params, ctx, reprice, hasHedge, onParam, onEject }: Props) {
  const def = getDef(moduleKey);
  /* ONE PRODUCER, ONE CONTEXT (D3). `descriptorsFor` is what `updateParam`
     clamps against; reading anything else here is how `max="3.75"` came to sit
     on a control that enforces 3.50. `def` is kept for `def.name` — the eject
     key's label — and for nothing that is a bound. */
  const descs = descriptorsFor(moduleKey, ctx);
  const desc = (field: string) => descs.find((p) => p.field === field)!;
  const [advOpen, setAdvOpen] = useState(false);
  const minHintId = useId();
  const touch = (field: string, value: ParamValue) => {
    onParam(field, value);
  };

  if (moduleKey === "safety-buffer") {
    const ok = reprice?.ok === true ? reprice : null;
    const liqLtv = ok?.candidate?.lt ?? null;
    /* The leverage the MODEL used, never the dial's request: the same field
       the plate screen, the dock readouts and the compose row all print. */
    const appliedLeverage =
      ok?.candidate?.economics?.loopLeverage ??
      ok?.appliedLeverage ??
      (typeof params.targetLeverage === "number" ? params.targetLeverage : null);
    /* 2 dp, following `PlateScreen`'s own precedent and for its reason: the
       live drifts run from 0.04pp to 5.12pp, and at 1 dp the smallest of them
       prints 0.1pp — a large overstatement of the one number whose job is to
       be visibly small. */
    const driftLabel = (option: string): string | null => {
      const v = driftBeforeTrim(option as RiskPreset, appliedLeverage, liqLtv);
      return v === null ? null : ppMag(v, 2);
    };
    /* ⚠ NO DEBT, NO DRIFT TO CHOOSE (G7 nit, 2026-08-24). At 1.00x
       `driftBeforeTrim` is null on every preset, and `SegKeys` then fell
       back to the preset shortLabels — quantity labels degrading to the
       adjective-shaped words the drift labels were installed to remove. The
       same `liquidationDistance` the plate face, the dock and the compose
       control read gates the row: where nothing is borrowed the control
       states so in the dock's grammar instead of offering three words. */
    const spotOnly =
      ok?.candidate != null && (ok.candidate.lt == null || !ok.candidate.debtSymbol);
    const unlevered = spotOnly || liquidationDistance(liqLtv, appliedLeverage)?.unlevered === true;
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        {advOpen ? (
          <>
            <Dial desc={desc("targetLeverage")} value={params.targetLeverage} onChange={(v) => touch("targetLeverage", v)} />
            <div className="pc-dialrow">
              <span className="pc-lab">{DRIFT_LABEL}</span>
            </div>
            {unlevered ? (
              <div className="pc-auto">{NO_BORROW_BANDS_VALUE}</div>
            ) : (
              <SegKeys
                desc={desc("riskPreset")}
                value={params.riskPreset}
                groupLabel={DRIFT_LABEL}
                labelFor={driftLabel}
                onChange={(v) => touch("riskPreset", v)}
              />
            )}
          </>
        ) : (
          // The closed line named a control that no longer exists: the lane
          // risk dial was deleted, so the sentence pointed at nothing. What is
          // true is on the plate three inches up: the band is DERIVED from the
          // leverage, and the leverage is the dial behind this key.
          <div className="pc-auto">Levers and trims on its own. The band derives from the leverage under Advanced.</div>
        )}
        <div className="hm-keys">
          <AdvancedKey open={advOpen} onToggle={() => setAdvOpen((v) => !v)} />
        </div>
      </div>
    );
  }

  if (moduleKey === "hedge") {
    /* ⚠ THE FUNDING GUARD IS RENDERED HERE NOW (recette v2, DEF-01 / QNT-R2-2
       / PO-2, 2026-09-02).
       ---------------------------------------------------------------------
       This branch drew two of the hedge's four params. The other two —
       `fundingFloorApr` and `fundingWindowEpochs` — are PUBLISHED: they ride
       `pricingParamsFor(...).hedge` into the model record and print on the
       vault page as `Funding floor … APR` and `Funding window … epochs`. So a
       builder was shipping a guard they could not read, could not move, and
       could not reconcile — which is exactly how three different floors
       (−2% module-first, −5% template, −7% funding lane) reached three
       records for one book without anybody seeing two of them at once.
       A control that publishes into the record must be reachable by the
       builder who publishes it, and reading `desc(...)` here means the
       rendered bound is the same `descriptorsFor(key, ctx)` the clamp
       enforces — the D3 rule, on the two dials it had not reached. */
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        {advOpen ? (
          <>
            <Dial desc={desc("hedgeLeverage")} value={params.hedgeLeverage} onChange={(v) => touch("hedgeLeverage", v)} />
            <Dial desc={desc("reserveFraction")} value={params.reserveFraction} onChange={(v) => touch("reserveFraction", v)} />
            <Dial
              desc={desc("fundingFloorApr")}
              value={params.fundingFloorApr}
              onChange={(v) => touch("fundingFloorApr", v)}
            />
            <div className="pc-dialrow">
              <span className="pc-lab">{desc("fundingWindowEpochs").friendlyLabel}</span>
            </div>
            <SegKeys
              desc={desc("fundingWindowEpochs")}
              value={String(params.fundingWindowEpochs ?? desc("fundingWindowEpochs").default ?? "")}
              onChange={(v) => touch("fundingWindowEpochs", v)}
            />
          </>
        ) : (
          <div className="pc-auto">delta-neutral · margin auto-managed</div>
        )}
        <div className="hm-keys">
          <AdvancedKey open={advOpen} onToggle={() => setAdvOpen((v) => !v)} />
          {onEject ? <EjectKey onEject={onEject} what={def.name} /> : null}
        </div>
      </div>
    );
  }

  if (moduleKey === "auto-center") {
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        <SegKeys desc={desc("rangePct")} value={params.rangePct} onChange={(v) => onParam("rangePct", v)} />
        <div className="hm-keys">{onEject ? <EjectKey onEject={onEject} what={def.name} /> : null}</div>
      </div>
    );
  }

  if (moduleKey === "covered-call") {
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        <SegKeys desc={desc("strikePct")} value={params.strikePct} onChange={(v) => onParam("strikePct", v)} />
        <SegKeys desc={desc("rollDays")} value={params.rollDays} onChange={(v) => onParam("rollDays", v)} />
        <div className="hm-keys">{onEject ? <EjectKey onEject={onEject} what={def.name} /> : null}</div>
      </div>
    );
  }

  if (moduleKey === "protective-put") {
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        <SegKeys desc={desc("floorPct")} value={params.floorPct} onChange={(v) => onParam("floorPct", v)} />
        <div className="hm-keys">{onEject ? <EjectKey onEject={onEject} what={def.name} /> : null}</div>
      </div>
    );
  }

  if (moduleKey === "exogenous-risk") {
    /* ONE ORDERED CONTROL, AND ITS CELLS PRINT COUNTS.
       ---------------------------------------------------------------------
       `Low | Medium | High` is the ratified adjective ban wearing a new coat.
       What the stop actually does is threshold the lane's own derived set on
       the EVIDENCE this lane holds about each party, so the cells can print
       the integer the choice produces — `2 | 3 | 6` on the leveraged-loop
       template, `0 | 2 | 5` on the delta-neutral LP — which is the property an
       adjective can never have and the reason a depositor can check it.
       Same `labelFor` mechanism the drift cells use, and for the same reason:
       a cell that states a measured quantity beats a cell that states a word.

       ⚠ THE CELLS ARE NOT THIRDS ANY MORE (recette fix, 2026-08-27), and the
       narrow cell CAN read `0`. That is the modeled templates telling the
       truth: a hand-authored row was never scanned, so this lane holds a full
       reading of nobody and a stop that answers only what we read answers
       nobody. It used to print `2` there. The zero is the finding.

       ⚠ THIS DIAL DOES NOT MOVE THE SKIP BAR, AND MUST NOT. `skipBarLabel`
       counts what the vault does not MEASURE; this control chooses where a
       written RESPONSE stops. What we measured may not depend on where the
       builder put that line, so no stop moves a party between `measured` and
       `blind` and the bar is byte-identical at all three. What the dial DOES
       move is the lamp strip twenty pixels above (`data-answered`), the ACT
       lines in the panel, and the `reaction` slot on every promoted register
       row.

       BARE INTEGERS, NOT `4 of 6`. The denominator is the visible lamp count
       twenty pixels above, and a cell reading `6 of 6` invites exactly the
       completeness misread the honesty line forbids. The quantity is named
       once, in the label above the row. */
    const ok = reprice?.ok === true ? reprice : null;
    const view = watchViewOf({
      candidate: ok?.candidate ?? null,
      placed: hasHedge ? ["hedge", "exogenous-risk"] : ["exogenous-risk"],
      params: { "exogenous-risk": params },
    });
    const stopCount = (v: string): string | null => {
      const n = view.stopCounts[v as PostureStop];
      return typeof n === "number" ? String(n) : null;
    };
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        <div className="pc-dialrow">
          <span className="pc-lab">{ANSWERED_LABEL}</span>
        </div>
        {view.named === 0 ? (
          /* No market, no route, therefore no parties: the control states the
             absence in the dock's own grammar rather than offering three
             cells over an empty set. */
          <div className="pc-auto">Pick a market and this lane names what it depends on.</div>
        ) : (
          <SegKeys
            desc={desc("posture")}
            value={params.posture}
            groupLabel={ANSWERED_LABEL}
            labelFor={stopCount}
            onChange={(v) => touch("posture", v)}
          />
        )}
        <div className="hm-keys">{onEject ? <EjectKey onEject={onEject} what={def.name} /> : null}</div>
      </div>
    );
  }

  if (moduleKey === "auto-compound") {
    const min = desc("minActionUsd");
    const v = typeof params.minActionUsd === "number" ? params.minActionUsd : Number(min.default);
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        <SegKeys desc={desc("cadence")} value={params.cadence} onChange={(x) => onParam("cadence", x)} />
        <div className="pc-num">
          <span className="pc-lab">{min.friendlyLabel}</span>
          <input
            type="number"
            min={min.min}
            max={min.max}
            step={min.step}
            value={v}
            aria-label={min.friendlyLabel}
            aria-describedby={minHintId}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onParam("minActionUsd", Number(e.target.value))}
          />
          <span id={minHintId} className="rk-sr">
            {`US dollars, between ${min.min} and ${min.max}.`}
          </span>
          {onEject ? <EjectKey onEject={onEject} what={def.name} /> : null}
        </div>
      </div>
    );
  }

  if (moduleKey === "redemption-route") {
    /* THE ONE CONTROL ON THIS MODULE, and the reason it needs a branch at all:
       without one, `PlateControls` returned null while `HwPlate` still printed
       "Tune" over the empty area, so the plate advertised a control it did not
       have.

       The descriptor is the DERIVED one, so the cells are the routes the
       PICKED issuer actually publishes, under that issuer's labels. Two of the
       six issuers publish exactly one route; `modules.ts` hides the control
       there, because a one-option segmented control is a dead control, and
       this branch honours that by stating the fact instead of drawing a cell
       nobody can move. */
    const d = desc("exitPath");
    const days = typeof params.settlementDays === "number" ? params.settlementDays : 0;
    const wait = days === 1 ? "1 day" : `${days} days`;
    return (
      <div className="pc" onClick={(e) => e.stopPropagation()}>
        <div className="pc-dialrow">
          <span className="pc-lab">Exit route</span>
        </div>
        {d.hidden ? (
          <div className="pc-auto">This issuer publishes one route, so there is nothing to choose.</div>
        ) : (
          <SegKeys
            desc={d}
            value={params.exitPath}
            groupLabel="Exit route"
            onChange={(v) => touch("exitPath", v)}
          />
        )}
        <div className="pc-auto">{`${wait} from request to cash, as the issuer publishes it.`}</div>
        <div className="hm-keys">{onEject ? <EjectKey onEject={onEject} what={def.name} /> : null}</div>
      </div>
    );
  }

  return null;
}
