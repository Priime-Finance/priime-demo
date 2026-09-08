"use client";

/**
 * PublishFlow (founder brief 2026-08-20, item 7) — the tight Review and
 * Publish flow shared by BOTH canvases (/build loop rack and
 * /build?strategy=funding).
 *
 * Three phases, zero dead ends, no wallet gating:
 *   review     — editable vault name, one-line summary, module chips,
 *                modeled APY, one primary key: Publish vault (~40 words).
 *   publishing — three beats (Compose, Verify, Publish), ~1.8s, mock.
 *   done       — the vault EXISTS: persisted to localStorage with a slug,
 *                $25k seed TVL, share value 1.0000; links open the vault
 *                page and the directory.
 *
 * Connect moment (founder addendum 2026-08-21): the nav no longer carries
 * Connect wallet — the workflow does. Disconnected, the Review card's
 * primary key reads "Connect wallet" and opens the connect sheet; when
 * isConnected flips the SAME key morphs in place to "Publish vault" (no
 * state loss, small crossfade, reduced-motion instant). Beneath it a quiet
 * ghost link "Publish without connecting" runs the existing publish path
 * unchanged, so the mockup's no-blocking rule stays intact.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnectModal } from "@/lib/wallet";
import {
  deriveAutomations,
  publishVault,
  vaultStage,
  VAULT_STAGE_NOUN,
  type PublishInput,
  type VaultRecord,
} from "@/lib/vaults/store";
import { fmtCapacityUsd } from "@/lib/canvas/capacity";
// R5 grep: the published APY is the single most consequential number this
// product prints, and it was rendered here by a private
// `(x * 100).toFixed(1)` in two places — a seventh copy of `pct`, and one
// that emits an ASCII hyphen on a negative where the ratified glyph is U+2212.
import { pct } from "@/lib/canvas/format";
import { apyCaption, feeRows } from "@/lib/canvas/fees";
import { withParamKinds } from "@/lib/vaults/param-kind";
import { SEED_SLUGS } from "@/lib/vaults/seeds";
import { heroNavUsd } from "@/lib/vaults/rows";
import { DEMO_SCOPE } from "@/lib/demo-scope";

/** How long the done card holds before the router opens the vault page. */
const DONE_BEAT_MS = 900;

export interface PublishDraft extends Omit<PublishInput, "name"> {
  defaultName: string;
  /** How many lanes composed this vault. Review lists them when above one. */
  laneCount?: number;
  /**
   * The eyes-open venue verdict (funding launch rail, 2026-08-24): one string,
   * shown on this card and persisted by the caller as the `Launch rail` param
   * row, so the review sheet and the record state one fact. Review-card state,
   * peeled before the record is written.
   */
  railVerdict?: string | null;
  /**
   * Render the params table on a SINGLE-lane review too — the funding sheet's
   * rows (both legs, window, escrow, capacity noun). Off by default so every
   * existing single-lane review is byte-identical. Review-card state, peeled.
   */
  reviewParams?: boolean;
  /**
   * QNT-3 (quant ledger, 2026-08-27) — the companion fact a family's ruling
   * pins to its modeled figure: the collar's forgone upside above the strike.
   * Printed directly under the APY caption, review and done phases both.
   * Review-card state, peeled; the record carries it as a param row instead.
   */
  apyCompanion?: string | null;
  /**
   * ── THE TWO-LANE RECORD (router lane plan R5, seam 1) ──────────────────
   * The lanes and the router this publish writes ONTO the record, so the
   * vault page's Capital router instrument reads what the canvas showed
   * rather than re-deriving it from a canvas it cannot see. Present only on a
   * multi-lane publish; absent, the record written is byte for byte the one
   * this flow has always written.
   *
   * ⚠ SEAM, NOT A LOCAL FIELD. `lib/vaults/store.ts` declares
   * `VaultRecord.lanes` and `.router` and admits both into `PublishInput`;
   * the canvas composes them through `lib/canvas/published-lanes.ts`, which
   * re-exports the store's own two shapes. They are NOT peeled below: they
   * belong to the record, and `PublishDraft` inherits them from
   * `PublishInput` rather than declaring a second spelling of either.
   */
  /**
   * The catalog ids of the lanes this vault publishes (copilot loop B-1).
   * Carried by the publish-success beacon so the funnel's strict tier can
   * intersect them with the ids a copilot proposal applied; the record
   * never stores them. Review-card state, peeled.
   */
  publishedMarketIds?: string[];
}

const BEATS = ["Compose", "Verify", "Publish"] as const;

export default function PublishFlow({
  draft,
  onClose,
  onComposeAnother,
}: {
  draft: PublishDraft;
  onClose: () => void;
  /** I6 — clear the canvas and start a second vault. Absent on surfaces that
   *  have no canvas to clear (the flow is shared with /build?strategy=…). */
  onComposeAnother?: () => void;
}) {
  const [name, setName] = useState(draft.defaultName);
  const [phase, setPhase] = useState<"review" | "publishing" | "done" | "failed">("review");
  const [beat, setBeat] = useState(0);
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  /* DS-3 (recette v2, 2026-09-02) — THE COMMITMENT MOMENT MUST CARRY ITS KEY.
     The card is `max-height:88vh; overflow-y:auto`, so a sheet taller than the
     cap simply ran off the bottom: on the funding family at 1440x900 the sheet
     wanted 973px against a 792px cap, and BOTH keys (`Connect wallet` and
     `Publish without connecting`) sat 118px below the card's own edge, with the
     capacity figure sliced through its glyphs by the corner radius and no
     scrollbar, fade or seam to say anything was under it. Measured on every
     family: funding overflows at 900, and all four overflow at 700, so this is
     a viewport property, not a funding property.
     The card now scrolls its MIDDLE and pins its head and its action row, so
     the keys are on screen at every height and the reader is never asked to
     find a control they cannot see. `edge` drives the two fades: each one
     exists only while there is ink on that side of the cut, so a sheet that
     fits looks exactly as it did before. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ above: false, below: false });
  useEffect(() => {
    if (phase !== "review") {
      /* Leaving review takes the flags with it: `.pf-acts` does not exist in
         the other three phases, so a stale `pf--below` would be inert class
         soup on the published card rather than a bug you can see. Inert is
         not a reason to leave it. */
      setEdge((e) => (e.above || e.below ? { above: false, below: false } : e));
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const read = () => {
      const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
      const above = el.scrollTop > 1;
      const below = gap > 1;
      /* IDENTITY-STABLE (2026-09-02, with the inline run). The observer fires
         continuously through the run panel's 280ms expand — roughly sixty
         times — and a fresh `{above, below}` object each time re-renders the
         whole sheet on every frame of a transition whose only real output is
         two booleans that barely change. Same guard the phase-cleanup branch
         above already uses. */
      setEdge((e) => (e.above === above && e.below === below ? e : { above, below }));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    /* Both boxes: the scroller changes with the viewport, its content changes
       when the webfonts land and when the connect state morphs the sheet. */
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => {
      el.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, [phase]);

  /* The connect moment. The modal only ever mounts client-side (opened by a
     user gesture on the canvas), so isConnected is safe to branch on
     directly. connectModalOpen is mirrored into a ref so the Escape handler
     never closes the review card underneath an open connect sheet. */
  const { isConnected } = useAccount();
  /* THE VAULT PAGE IS WHERE A PUBLISH ENDS (founder, 2026-09-07: "publish it
     and arrive on the vault page automatically"). The done beat used to sit
     on the canvas behind a card with an "Open your vault" key, and closing
     that card left the builder on the canvas they had just published from,
     which read as being sent back there. Now the card shows its done state
     for one beat and the router carries the reader to the record it wrote.
     The two links stay for a reader who moves before the beat lands. */
  const router = useRouter();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const connectOpenRef = useRef(connectModalOpen);
  connectOpenRef.current = connectModalOpen;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /* §4.3 — Review is already gated on every lane being priced, so a null
     capacity on the loop rack is unreachable; it is a computation bug, not a
     UI state. Assert in dev, render nothing in prod.

     TIGHTENED 2026-08-24 (funding launch rail, WI-3): the exemption used to
     be the whole funding strategy, and that blanket now covers a real bug —
     a RACK-published funding record's capacity is `vaultCapacity` over a
     measured book and is never null. Only the FUNDING CANVAS deliberately
     passes null (§4.6, an unscanned book), and its drafts are the ones that
     carry no `laneCount`; rack drafts always do. */
  useEffect(() => {
    const fundingCanvasDraft = draft.strategy === "funding" && draft.laneCount === undefined;
    if (process.env.NODE_ENV !== "production" && !fundingCanvasDraft && draft.capacityUsd === null) {
      console.warn("[PublishFlow] review reached with a null vault capacity", draft.market);
    }
  }, [draft]);

  // The default name is one keystroke to replace.
  useEffect(() => {
    nameRef.current?.select();
  }, []);

  const close = () => {
    onClose();
  };
  const closeCbRef = useRef(close);
  closeCbRef.current = close;

  // Escape closes (guarded against the publishing phase and against an
  // open connect sheet, which owns Escape while it is up).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phaseRef.current !== "publishing" && !connectOpenRef.current) closeCbRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const publish = () => {
    if (phase !== "review" && phase !== "failed") return;
    setPhase("publishing");
    setBeat(0);
    timers.current.push(setTimeout(() => setBeat(1), 620));
    timers.current.push(setTimeout(() => setBeat(2), 1240));
    timers.current.push(
      setTimeout(() => {
        // Automation instrument parameters are fixed here, at publish time,
        // from the composed graph: the hedge instrument exists iff a hedge
        // module was installed on the canvas. The vault page renders these
        // stored parameters, never re-derives them.
        //
        // `defaultName` and `laneCount` are review-card state, not vault
        // state, so they are peeled off rather than spread into the record.
        const {
          defaultName: _defaultName,
          laneCount: _laneCount,
          railVerdict: _railVerdict, // persisted by the caller as a param row
          reviewParams: _reviewParams,
          apyCompanion: _apyCompanion, // persisted as the Upside forfeited row
          publishedMarketIds: _publishedMarketIds, // beacon payload, never a record field
          ...record
        } = draft;
        /* THE RECORD. `lanes` and `router` ride inside `...record` under the
           names `PublishInput` itself declares (store.ts), so this site
           states no shape of its own: a field added to the record's router
           block is written here the moment the store admits it, and a field
           the store drops stops compiling here rather than being written
           into a record nothing reads. */
        const input: PublishInput = {
          ...record,
          name: name.trim() || draft.defaultName,
          automations: deriveAutomations(draft),
        };
        const rec = publishVault(input, SEED_SLUGS);
        // G2: `write()` returns false when the record did not land (private
        // mode, quota, a disabled store). Reporting success there is how the
        // flow came to offer "Open your vault" for a vault that does not
        // exist. A publish that did not happen says so.
        if (!rec) {
          setPhase("failed");
          return;
        }
        setVault(rec);
        setPhase("done");
        timers.current.push(
          setTimeout(() => router.push(`/vaults/${rec.slug}`), DONE_BEAT_MS),
        );
      }, 1860),
    );
  };

  /* The primary key's action follows its label: connect first when
     disconnected, publish once connected. The ghost link beneath always
     runs publish() directly. */
  const primaryAction = () => {
    if (!isConnected) openConnectModal?.();
    else publish();
  };

  return (
    <div className="bcrev-backdrop" onClick={phase === "publishing" ? undefined : close}>
      <div
        className={`pf${phase === "done" ? " pf--done" : ""}${
          phase === "review" ? " pf--review" : ""
        }${edge.above ? " pf--above" : ""}${edge.below ? " pf--below" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {phase === "review" ? (
          <>
            {/* PINNED: the head stays because Close is a control, and a
                control that scrolls out of a scrolling sheet is the same
                defect as a key below the cut. */}
            <div className="pf-head">
              <span className="pf-kicker">Review</span>
              <button type="button" className="pf-close" onClick={close}>
                Close
              </button>
            </div>
            {/* THE SCROLLING MIDDLE. Everything the reader reads; nothing the
                reader presses. */}
            <div className="pf-scroll" ref={scrollRef}>
              <div className="pf-scroll-in" ref={contentRef}>
                <label className="pf-name-k" htmlFor="pf-name-input">
                  Name your vault
                </label>
                <input
                  id="pf-name-input"
                  ref={nameRef}
                  autoFocus
                  className="pf-name"
                  value={name}
                  maxLength={48}
                  aria-label="Vault name"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") primaryAction();
                  }}
                />
                <div className="pf-summary">{draft.summary}</div>
                <div className="pf-chips">
                  {draft.modules.map((m) => (
                    <span key={m} className="pf-chip">
                      {m}
                    </span>
                  ))}
                </div>
                {/* THE LANES, on a vault that has more than one (recette item 8).
                    A portfolio card that shows one blended APY and one module
                    strip says nothing about WHICH markets the deposit lands in
                    or at what weight, and that is the whole decision on a
                    multi-lane vault. One row per lane: pair, venue, weight,
                    modelled APY. A single-lane vault already says all four in
                    the summary above, so it gets no table. */}
                {/* … and the FUNDING SHEET renders them on a single lane too
                    (`reviewParams`): both legs with their chains, the funding
                    window, the escrow split and the capacity noun are the review,
                    and a summary line alone cannot carry them. */}
                {((draft.laneCount ?? 1) > 1 || draft.reviewParams) && draft.params.length > 0 ? (
                  <div className="pf-lanes" style={{ display: "grid", gap: 6, marginBottom: 16 }}>
                    {withParamKinds(draft.params).map((p) => (
                      <div
                        key={p.label}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          fontSize: 11,
                          color: "#B8D9FF",
                        }}
                      >
                        <span style={{ color: "#8B94C4" }}>{p.label}</span>
                        <span
                          data-kind={p.kind}
                          style={{
                            textAlign: "right",
                            fontFamily: p.kind === "reading" ? "var(--fm)" : undefined,
                          }}
                        >
                          {p.value}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* THE FEE SCHEDULE, ON THE SHEET THE DEPOSITOR APPROVES (S1,
                    2026-08-24, walks W1.1 and W1.2). It rendered on the record
                    only, appended downstream by `VaultDetail.withFeeRows`, so the
                    four rows a depositor is bound by were first seen AFTER
                    publishing. `feeRows()` is the single owner of the strings and
                    both surfaces call it, so the sheet and the record are two
                    copies of one list rather than two descriptions of it —
                    which is what makes "byte-identical" checkable.
                    UNCONDITIONAL: the schedule does not depend on lane count,
                    strategy or whether the params table above rendered. */}
                {/* THE RECORD THIS SHEET PUBLISHES ONTO is the one live record
                    (`DEMO_SCOPE.liveSlug`), so the schedule is read for it:
                    the withdrawal row prices the exit that record has. */}
                <div className="pf-fees" style={{ display: "grid", gap: 6, marginBottom: 16 }}>
                  {withParamKinds(feeRows({ slug: DEMO_SCOPE.liveSlug })).map((f) => (
                    <div
                      key={f.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        fontSize: 11,
                        color: "#B8D9FF",
                      }}
                    >
                      <span style={{ color: "#8B94C4" }}>{f.label}</span>
                      <span
                        data-kind={f.kind}
                        style={{
                          textAlign: "right",
                          fontFamily: f.kind === "reading" ? "var(--fm)" : undefined,
                        }}
                      >
                        {f.value}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pf-apy">
                  <b>{pct(draft.modeledApy)}</b>
                  <i>modeled net APY</i>
                </div>
                {/* THE CAPTION THE RECORD CARRIES, FROM THE SAME CALL (S1,
                    2026-08-24, walk W1.1). The sheet stated `modeled net APY` and
                    stopped, so a depositor approved a number without being told
                    the house's own cut was already inside it — and then met a
                    different sentence on the record. One owner, `fees.apyCaption`,
                    so the two cannot be paraphrases of each other. */}
                <div className="pf-apy-cap">{apyCaption()}</div>
                {/* QNT-3 — the collar's cash flow never prints without the upside
                    it was paid for. `.pf-cap-bind`'s register: a fact under the
                    numbers, never a warning.
                    ONE COMPANION PER FRAME (recette, 2026-09-02). With the run
                    open, this line and the panel's own copy of it sat 280px
                    apart on one screen, byte-identical, and a reader does not
                    see a rule being honoured — they see the sheet repeat
                    itself. So the fact moves to whichever block is carrying
                    the figures: this one holds the modeled rate while the run
                    is closed, and the run's block holds it, beside the dollar
                    figure, while it is open. The rule is never suspended, only
                    the duplicate is. */}
                {draft.apyCompanion ? (
                  <div className="pf-apy-companion">{draft.apyCompanion}</div>
                ) : null}
                {/* CAPACITY_SPEC §4.1 — the same grammar at half amplitude. One
                    layout for one loop and for many: the grouped formula
                    degenerates, so only the sub-register differs. The
                    `shared by N loops` clause is load-bearing — it is the
                    one-line answer to why the vault's capacity is not the sum.
                    It gets no emphasis and no colour; making it loud would turn
                    an explanation into a warning. */}
                {typeof draft.capacityUsd === "number" ? (
                  <>
                    <div className="pf-cap">
                      <b>{fmtCapacityUsd(draft.capacityUsd)}</b>
                      <i>deposit capacity</i>
                    </div>
                    {draft.capacityBindingLabel ? (
                      <div className="pf-cap-bind">{draft.capacityBindingLabel}</div>
                    ) : null}
                  </>
                ) : null}
                {/* The eyes-open venue verdict, in the same quiet register as the
                    capacity binding: a fact under the numbers, never a warning. */}
                {draft.railVerdict ? <div className="pf-cap-bind">{draft.railVerdict}</div> : null}
              </div>
            </div>
            {/* PINNED: every key the review offers, always on screen. */}
            <div className="pf-acts">
              <button type="button" className="pf-publish" onClick={primaryAction}>
                {/* Keyed span: remounts when isConnected flips, so the label
                    crossfades in place exactly once per morph. */}
                <span key={isConnected ? "publish" : "connect"} className="pf-key-label">
                  {isConnected ? "Publish vault" : "Connect wallet"}
                </span>
              </button>
              {!isConnected && (
                <button type="button" className="pf-ghostlink pf-ghost-skip" onClick={publish}>
                  Publish without connecting
                </button>
              )}
            </div>
          </>
        ) : phase === "publishing" ? (
          <div className="pf-beats">
            {BEATS.map((b, i) => (
              <div key={b} className={`pf-beat${i < beat ? " done" : i === beat ? " now" : ""}`}>
                <span className="pf-beat-dot" />
                {b}
              </div>
            ))}
          </div>
        ) : phase === "failed" ? (
          /* G2 — THE HONEST FAILURE. There is no vault, so there is no link
             to one, no slug, no seed TVL and no celebration. The card says
             what did not happen, why it can happen, and offers the one
             action that can still work. The composition is untouched on the
             canvas behind this card. */
          <>
            <div className="pf-head">
              <span className="pf-kicker">Not published</span>
              <button type="button" className="pf-close" onClick={close}>
                Close
              </button>
            </div>
            <div className="pf-done-name">{name.trim() || draft.defaultName}</div>
            <div className="pf-summary">
              This browser would not store the vault, so nothing was published. Site storage is
              unavailable in private windows and when the browser is out of space. Your composition
              is still on the canvas.
            </div>
            <div className="pf-done-acts">
              <button type="button" className="pf-publish" onClick={publish}>
                Try again
              </button>
              <button type="button" className="pf-ghostlink" onClick={close}>
                Back to the canvas
              </button>
            </div>
          </>
        ) : vault ? (
          <>
            <div className="pf-done-k">Published</div>
            <div className="pf-done-name">{vault.name}</div>
            {/* The record's own seed, not a hardcoded $25K: `publishVault`
                clamps the seed inside the record's stated capacity (gate
                catch 2026-08-24), so the toast reads the number it wrote.

                ⚠ THE STAGE WORD IS READ, NOT ASSERTED (S2 Wave 2 seam,
                2026-08-24). This sentence opened by calling the record LIVE while
                the very next screen — the record this button opens — chips
                `Incubating · modeled` and states `No capital, no armed
                automation.` One lifecycle, two claims, one click apart, and
                the toast was the one that was wrong: `publishVault` writes
                `stage: "incubating"` unconditionally. It now reads
                `vaultStage(vault)` through `VAULT_STAGE_NOUN`, the noun
                declared beside the chip, so the two surfaces move together.

                And the TVL is labelled `modeled`, which is what it is: a
                seeded mock number on a record that holds no capital. Unlabelled
                it read as money in the vault, three words after a stage that
                says there is none. */}
            {/* THE NAV IS ATTESTED, NOT MODELED (docs/plans/LATEST_UI_PORT_SPEC.md
                A.3 #29): the composition landed on the one record whose NAV is
                read off the captured journal, so the sentence reads that number
                from its owner (`heroNavUsd`) and the stage noun from its own. */}
            <div className="pf-summary">
              In the directory, {VAULT_STAGE_NOUN[vaultStage(vault)]}
              {heroNavUsd() !== null ? <>, with {fmtCapacityUsd(heroNavUsd())} attested NAV</> : null}.
            </div>
            <div className="pf-apy">
              <b>{pct(draft.modeledApy)}</b>
              <i>modeled net APY</i>
            </div>
            {/* QNT-3 — the done card prints the figure again, so the
                companion prints again. One fact, both phases. */}
            {draft.apyCompanion ? <div className="pf-apy-companion">{draft.apyCompanion}</div> : null}
            <div className="pf-done-acts">
              <Link className="pf-publish" href={`/vaults/${vault.slug}`}>
                Open your vault
              </Link>
              <Link className="pf-ghostlink" href="/vaults">
                All vaults
              </Link>
            </div>
            {/* I6 — THE THIRD DOOR. Both links above leave the canvas, and
                coming back to it landed on the composition that had just
                been published: "Create vault" re-opened the finished vault.
                This is the only path from a published vault to an empty
                canvas, so it lives at the moment the user is most likely to
                want one. It is on the undo stack like everything else. */}
            {onComposeAnother ? (
              <button
                type="button"
                className="pf-ghostlink pf-compose-another"
                onClick={() => {
                  onComposeAnother();
                  close();
                }}
              >
                Compose another
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
