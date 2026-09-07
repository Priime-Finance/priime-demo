"use client";

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * TipStack (TIP_SPEC §D/§E) — presentation ONLY.
 *
 * The board's right edge is one advisory gutter: guidance at the top,
 * navigation at the bottom, composition to the left. That reads as an
 * instrument, not a toast corner.
 *
 * The card is a NOTE that is SEATED and GROUNDED (R2): paper stock, hairline,
 * an inset top highlight (the seat) and a contact-shadow `::after` (the
 * ground), with a drop shadow at ~40% of the plate's throw. It deliberately
 * does NOT wear `.hm-body`'s 22px bezel: plates are `zoom`-scaled .62/.86
 * inside the viewport and the tip lives OUTSIDE that transform at 1.0, so a
 * fixed-scale bezel would mismatch at every zoom level.
 *
 * Severity is the left rule plus the presence of the dismiss control. `block`
 * renders NO cross — not disabled, not greyed, ABSENT. That absence is the
 * strongest severity expression available here and it costs zero colour.
 *
 * Motion (§E): the entrance is solved by ORDERING, not by a fancier
 * animation. The TARGET ticks first, the card unfolds 140ms later from its
 * own top-right origin (never a slide from the right edge — that is toast
 * grammar), the rule draws on the canvas's own wire-draw curve, contents fade
 * with NO translate. Accept dispatches ON PRESS, always; the card collapses
 * into a 28px receipt strip carrying Undo, and the beat goes to the plate.
 *
 * Reduced motion is a SUBSTITUTION TABLE, not a stripped mode (E7): the FLIP
 * hook bails on its FIRST LINE (its inline transforms would otherwise persist
 * as a permanent resting offset), the dart is never mounted and the target
 * gets a static ring instead, the dismiss still fades (an instant vanish
 * under the cursor reads as a crash), and the receipt hold extends to 3200ms
 * because with no collapse animation nothing else says the strip is leaving.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { revealForm, type Tip } from "@/lib/canvas/tips";
import TipDart, { type DartShot } from "./TipDart";

const RECEIPT_MS = 2400;
const RECEIPT_MS_REDUCED = 3200;
const EXIT_MS = 260;
/** Order freezes under the cursor and thaws this long after it leaves (D8). */
const THAW_MS = 400;

export interface TipStackProps {
  tips: Tip[];
  /** True-but-gated candidates: drives the "+N more" control. */
  overflowCount: number;
  expanded: boolean;
  onExpand: (v: boolean) => void;
  /** Fires ON PRESS, synchronously, before any animation. */
  onAccept: (tip: Tip) => void;
  onDismiss: (tip: Tip) => void;
  onUndo: (tip: Tip) => void;
  boardRef: React.RefObject<HTMLDivElement | null>;
  reduce: boolean;
  claimBeat: (kind: "entrance" | "accept") => number;
  /** Board is narrower than 1100px: the column becomes a chip (D3). */
  pill: boolean;
  /** Viewport <= 960: full-bleed sheet, one card (D8). */
  mobile: boolean;
  debug?: { candidates: Tip[]; reasons: Record<string, string> } | null;
}

/** Backticks wrap a mono tabular numeral; the unit lives inside the token. */
function rich(s: string): React.ReactNode[] {
  return s.split("`").map((part, i) =>
    i % 2 === 1 ? (
      <b className="rk-tip-n" key={i}>
        {part}
      </b>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function Cross() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden focusable="false">
      <path d="M1 1L8 8M8 1L1 8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="rk-tip-chev" width="9" height="9" viewBox="0 0 9 9" aria-hidden focusable="false">
      <path d="M3 1L6.5 4.5L3 8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

export default function TipStack(props: TipStackProps) {
  const { tips, boardRef, reduce, mobile } = props;
  const listRef = useRef<HTMLUListElement | null>(null);
  const posRef = useRef<Map<string, number>>(new Map());
  const ringRef = useRef<HTMLElement | null>(null);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [receipt, setReceipt] = useState<{ tip: Tip; key: number } | null>(null);
  const [dart, setDart] = useState<DartShot | null>(null);
  const [pillOpen, setPillOpen] = useState(false);
  const shotRef = useRef(0);

  // ── D8 order freeze: a card must never reshuffle under a moving cursor —
  //    that is how a user accepts the wrong thing. ──
  const [frozen, setFrozen] = useState<Tip[] | null>(null);
  const thawTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEnterColumn = useCallback(() => {
    if (thawTimer.current) clearTimeout(thawTimer.current);
    setFrozen((f) => f ?? tips);
  }, [tips]);
  const onLeaveColumn = useCallback(() => {
    if (thawTimer.current) clearTimeout(thawTimer.current);
    thawTimer.current = setTimeout(() => setFrozen(null), THAW_MS);
  }, []);
  useEffect(
    () => () => {
      if (thawTimer.current) clearTimeout(thawTimer.current);
    },
    [],
  );

  const shown = useMemo(() => {
    if (!frozen) return tips;
    // Keep the frozen order; a tip whose condition went false still leaves.
    const live = new Map(tips.map((t) => [t.id, t]));
    const kept = frozen.map((t) => live.get(t.id)).filter((t): t is Tip => !!t);
    const keptIds = new Set(kept.map((t) => t.id));
    return [...kept, ...tips.filter((t) => !keptIds.has(t.id))];
  }, [frozen, tips]);

  // ── E2 hover binding: the tip and the thing it will touch become one
  //    object. Under reduce the RING STAYS and only the transition drops, so
  //    this must NOT live inside a no-preference block: with the dart
  //    suppressed it is the only thing linking a tip to its target. ──
  const resolveTarget = useCallback(
    (tip: Tip): HTMLElement | null => {
      const board = boardRef.current;
      if (!board || !tip.targetSel) return null;
      const direct = board.querySelector<HTMLElement>(tip.targetSel);
      if (direct) return direct;
      if (tip.loopId) {
        const lane = board.querySelector<HTMLElement>(`[data-loop-id="${tip.loopId}"]`);
        // The plate does not exist yet: point at the socket it will land in.
        return lane?.querySelector<HTMLElement>(".rk-slot") ?? lane ?? null;
      }
      return null;
    },
    [boardRef],
  );

  const setRing = useCallback(
    (tip: Tip | null) => {
      if (ringRef.current) {
        ringRef.current.classList.remove("rk-tgt");
        ringRef.current = null;
      }
      if (!tip) return;
      const el = resolveTarget(tip);
      if (el) {
        el.classList.add("rk-tgt");
        ringRef.current = el;
      }
    },
    [resolveTarget],
  );
  // Clean up on unmount AND when the tip retires, or a stale ring survives
  // its owner.
  useEffect(() => () => setRing(null), [setRing]);
  useEffect(() => {
    if (ringRef.current && !shown.some((t) => resolveTarget(t) === ringRef.current)) setRing(null);
  }, [shown, resolveTarget, setRing]);

  // ── E1 entrance ordering: the TARGET NOTICES FIRST. Sub-perceptual alone,
  //    decisive in sequence — the card is understood as a consequence of
  //    something on the canvas, not an interruption of it. ──
  const tickedRef = useRef<Set<string>>(new Set());
  const claimBeat = props.claimBeat;
  useEffect(() => {
    if (reduce) return;
    for (const tip of shown) {
      if (tickedRef.current.has(tip.id)) continue;
      tickedRef.current.add(tip.id);
      // §E governor: beyond queue depth 3 an ENTRANCE drops to its resting
      // state (the tip simply exists, unanimated). Accepts are never dropped.
      const delay = claimBeat("entrance");
      if (delay < 0) continue;
      const el = resolveTarget(tip);
      if (!el) continue;
      setTimeout(() => {
        el.classList.add("rk-tgt--tick");
        setTimeout(() => el.classList.remove("rk-tgt--tick"), 340);
      }, delay);
    }
    for (const id of [...tickedRef.current]) {
      if (!shown.some((t) => t.id === id)) tickedRef.current.delete(id);
    }
  }, [shown, reduce, resolveTarget, claimBeat]);

  // ── E4 REFLOW: real FLIP. Plain CSS cannot do this — the leaving node
  //    unmounts and the rest teleport for one frame. Newly arrived tips (no
  //    prior position) are EXCLUDED so entrance and reflow never fight for
  //    the same transform. ──
  useLayoutEffect(() => {
    if (reduce) {
      posRef.current.clear();
      return;
    }
    const list = listRef.current;
    if (!list) return;
    const nodes = Array.from(list.querySelectorAll<HTMLElement>("[data-tip-id]"));
    const next = new Map<string, number>();
    nodes.forEach((el, i) => {
      const id = el.dataset.tipId ?? "";
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const prev = posRef.current.get(id);
      if (prev === undefined) return; // newly arrived: the entrance owns it
      const dy = prev - top;
      if (Math.abs(dy) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      void el.offsetHeight; // force reflow before the play
      el.style.transition = `transform 260ms ${i * 18}ms cubic-bezier(.3,1,.4,1)`;
      el.style.transform = "";
    });
    posRef.current = next;
  });

  // ── E5 ACCEPT: the reward beat. Pressing accept must produce the SAME
  //    physical event on the canvas as doing the thing by hand. ──
  const accept = useCallback(
    (tip: Tip) => {
      // DISPATCH FIRES ON PRESS. Always. Never make correctness depend on an
      // animation clock: a user can double-press or the state can change
      // underneath.
      props.onAccept(tip);
      if (tip.action?.mode === "reveal") return; // the receipt lives in the surface that opened
      claimBeat("accept");

      const board = boardRef.current;
      const card = listRef.current?.querySelector<HTMLElement>(`[data-tip-id="${CSS.escape(tip.id)}"]`);
      if (reduce) {
        // The dart is NEVER MOUNTED under reduce, so nothing rests invisible.
        const el = resolveTarget(tip);
        if (el) {
          el.classList.add("rk-tgt--land");
          setTimeout(() => el.classList.remove("rk-tgt--land"), 700);
        }
      } else if (board && card) {
        const rule = card.querySelector<HTMLElement>(".rk-tip-rule") ?? card;
        const target = resolveTarget(tip);
        const b = board.getBoundingClientRect();
        const r = rule.getBoundingClientRect();
        if (target) {
          const t = target.getBoundingClientRect();
          const to = { x: t.left + t.width / 2 - b.left, y: t.top + t.height / 2 - b.top };
          // Never dart to something the user cannot see: it would exit the
          // overflow:hidden board and read as a glitch.
          if (to.x > 0 && to.y > 0 && to.x < b.width && to.y < b.height) {
            shotRef.current += 1;
            setDart({
              key: shotRef.current,
              from: { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top },
              to,
              compact: mobile,
            });
          }
        }
      }
      setExiting((s) => new Set(s).add(tip.id));
      setReceipt({ tip, key: shotRef.current });
    },
    [props, boardRef, reduce, resolveTarget, mobile, claimBeat],
  );

  // Receipt hold. 2400ms comfortably outlives installDefaults' 480ms stagger
  // plus a 280ms snapin, so the strip is still readable when the last plate
  // lands; 3200 under reduce, where no motion cue says it is leaving.
  useEffect(() => {
    if (!receipt) return;
    const t = setTimeout(() => setReceipt(null), reduce ? RECEIPT_MS_REDUCED : RECEIPT_MS);
    return () => clearTimeout(t);
  }, [receipt, reduce]);

  // ── E4 DISMISS: the rule DRAINS first — the card loses power before it
  //    moves, the hardware grammar already on this canvas. ──
  const dismiss = useCallback(
    (tip: Tip) => {
      setExiting((s) => new Set(s).add(tip.id));
      setTimeout(() => {
        props.onDismiss(tip);
        setExiting((s) => {
          const n = new Set(s);
          n.delete(tip.id);
          return n;
        });
      }, reduce ? 110 : EXIT_MS);
    },
    [props, reduce],
  );

  // D9 keyboard: Esc dismisses the focused card ONLY when focus is inside the
  // stack. A global Esc would collide with the dock and the review modal, and
  // would let a user destroy guidance they never looked at.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = (e.target as HTMLElement).closest("[data-tip-id]") as HTMLElement | null;
      const id = el?.dataset.tipId;
      const tip = shown.find((t) => t.id === id);
      if (!tip || tip.kind === "block") return;
      e.stopPropagation();
      dismiss(tip);
    },
    [shown, dismiss],
  );

  const cards = mobile ? shown.slice(0, 1) : shown;
  const hiddenCount = props.overflowCount + (mobile ? Math.max(0, shown.length - 1) : 0);
  const empty = cards.length === 0 && !receipt;

  // ── D3 PILL regime: a 1280 desktop with BOTH panels open leaves ~400px of
  //    board, where a 296px column would eat the composition surface it
  //    exists to serve. Click expands the full column overlaid — the ONE case
  //    where tips may cover the board, and only because the user asked. ──
  if (props.pill && !mobile && !empty && !pillOpen) {
    const top = cards[0];
    if (!top) return null;
    const label = top.title.replace(/`/g, "");
    return (
      <>
      <div className="rk-tips rk-tips--pill" role="region" aria-label="Canvas suggestions">
        <button
          type="button"
          className={`rk-tippill${top.kind === "block" ? " rk-tippill--block" : ""}`}
          onClick={() => setPillOpen(true)}
          aria-expanded={false}
        >
          {label.length > 22 ? `${label.slice(0, 21)}…` : label}
          {cards.length + hiddenCount > 1 ? (
            <b className="rk-tip-n">+{cards.length + hiddenCount - 1}</b>
          ) : null}
        </button>
      </div>
      {props.debug ? <TipDebug {...props.debug} /> : null}
      </>
    );
  }

  if (empty) {
    return (
      <>
        {dart && !reduce ? <TipDart shot={dart} /> : null}
        {props.debug ? <TipDebug {...props.debug} /> : null}
      </>
    );
  }

  return (
    <>
      <div
        className={`rk-tips${props.pill && pillOpen ? " rk-tips--over" : ""}`}
        role="region"
        aria-label="Canvas suggestions"
        onPointerEnter={onEnterColumn}
        onPointerLeave={onLeaveColumn}
        onKeyDown={onKeyDown}
        // D2(i): without the pointerdown stop, pressing Accept starts a board
        // pan and a 3px hand tremor flips didPanRef. Without the click stop,
        // every accept also clears discoverTarget and focus, visibly undoing
        // the highlight on the very lane the tip just modified.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <ul ref={listRef} className="rk-tips-list" id="rk-tips-list" aria-live="polite" aria-atomic="false">
          {receipt ? (
            <li className="rk-tip-receipt" key={`receipt-${receipt.key}`}>
              <span className="rk-tip-receipt-led" />
              <i>{receipt.tip.action?.receipt}</i>
              <button
                type="button"
                className="rk-tip-undo"
                onClick={() => {
                  props.onUndo(receipt.tip);
                  setReceipt(null);
                }}
              >
                Undo
              </button>
            </li>
          ) : null}
          {cards.map((tip, i) => {
            const isBlock = tip.kind === "block";
            // The SECOND card is quieted by omitting its BODY, never by
            // opacity: .55 is already the canvas's dimmed-sibling-plate
            // treatment and would read as disabled.
            const stacked = i >= 1 && !receipt;
            // ── P0 (2026-08-22): THE STACKED KEY, DOWNGRADED ──────────────
            //
            // Omitting the body while rendering the action key unconditionally
            // is fine on a tip whose body merely explains. It is NOT fine on a
            // tip whose body is the PRICE of the key: B7's remove branch reads
            // "Ejecting leaves you 1.0x long BERA", and stacked, the card
            // offered that trade with the exposure rendered nowhere on screen.
            // Stacking is the default for a rank-200 tune the moment any block
            // is also true, so this was the common case, not a corner.
            //
            // The fix is not to un-hide the body (the quieting is what makes a
            // stack readable) and not to hide the card (a true block would
            // lose its slot for no reason). It is to downgrade the KEY to a
            // reveal onto the module, where the same disclosure is permanent
            // and the user acts next to it. `revealForm` owns that copy.
            const downgraded = stacked && tip.consequential ? revealForm(tip) : null;
            const act = downgraded ?? tip.action;
            return (
              <li
                key={tip.id}
                data-tip-id={tip.id}
                data-exiting={exiting.has(tip.id) ? "1" : undefined}
                data-stacked={stacked ? "1" : undefined}
                className={`rk-tip rk-tip--${tip.kind}${
                  hiddenCount > 0 && i === cards.length - 1 ? " rk-tip--deck" : ""
                }`}
                onPointerEnter={() => setRing(tip)}
                onPointerLeave={() => setRing(null)}
                onFocus={() => setRing(tip)}
                onBlur={() => setRing(null)}
              >
                <span className="rk-tip-rule" aria-hidden />
                {/* DOM order puts ACCEPT before the cross: visual order serves
                    the mouse, DOM order serves the keyboard, and both put the
                    primary path first for their own device. */}
                {act ? (
                  <button
                    type="button"
                    className={`hm-key rk-tip-yes${act.mode === "reveal" ? " rk-tip-yes--reveal" : ""}${
                      i === 0 && !reduce ? " rk-tip-yes--flare" : ""
                    }`}
                    onClick={() =>
                      act.mode === "reveal"
                        ? // The downgraded key dispatches through the SAME
                          // handler with the SAME tip id — only the action is
                          // swapped — so dedupe, dismissal and the undo
                          // snapshot all keep working off `tip.id`.
                          props.onAccept(downgraded ? { ...tip, action: downgraded } : tip)
                        : accept(tip)
                    }
                  >
                    {act.mode === "apply" ? <span className="hm-led" /> : <Chevron />}
                    {rich(act.label)}
                  </button>
                ) : null}
                {isBlock ? null : (
                  <button
                    type="button"
                    className="rk-tip-no"
                    aria-label={`Dismiss tip: ${tip.title.replace(/`/g, "")}`}
                    onClick={() => dismiss(tip)}
                  >
                    <Cross />
                  </button>
                )}
                {tip.kicker ? (
                  <span className="rk-tip-k" title={tip.kickerFull}>
                    {tip.kicker}
                  </span>
                ) : null}
                <h3 className="rk-tip-h">{rich(tip.title)}</h3>
                {stacked ? null : <p className="rk-tip-b">{rich(tip.body)}</p>}
                {stacked || !tip.stamp ? null : <span className="rk-tip-stamp">{rich(tip.stamp)}</span>}
              </li>
            );
          })}
        </ul>
        {hiddenCount > 0 || props.expanded ? (
          <button
            type="button"
            className="rk-tips-more"
            aria-expanded={props.expanded}
            aria-controls="rk-tips-list"
            onClick={() => props.onExpand(!props.expanded)}
          >
            {props.expanded ? (
              "Fewer"
            ) : (
              <>
                ＋
                <b className="rk-tip-n" key={hiddenCount}>
                  {hiddenCount}
                </b>{" "}
                more
              </>
            )}
          </button>
        ) : null}
        {props.pill && pillOpen ? (
          <button type="button" className="rk-tips-more" onClick={() => setPillOpen(false)}>
            Close
          </button>
        ) : null}
      </div>
      {dart && !reduce ? <TipDart shot={dart} /> : null}
      {props.debug ? <TipDebug {...props.debug} /> : null}
    </>
  );
}

/**
 * `?tips=debug` (C16). No analytics: build.priime.finance stays untracked, so
 * without visibility into why a tip did NOT appear the system is
 * undebuggable, and it costs one component.
 */
function TipDebug({ candidates, reasons }: { candidates: Tip[]; reasons: Record<string, string> }) {
  return (
    <div className="rk-tipdebug">
      <b>deriveTips · {candidates.length}</b>
      {candidates.map((c) => (
        <div key={c.id}>
          <i>{c.rank}</i> {c.id} <em>{reasons[c.id] ?? "visible"}</em>
        </div>
      ))}
    </div>
  );
}
