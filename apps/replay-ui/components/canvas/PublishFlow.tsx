"use client";

/**
 * PublishFlow (founder brief 2026-08-20, item 7) — the tight Review and
 * Publish flow shared by BOTH canvases (/build loop rack and
 * /build?strategy=funding).
 *
 * Four phases, zero dead ends:
 *   review:      editable vault name, one-line summary, module chips,
 *                modeled APY, one primary key (~40 words).
 *   publishing:  three beats (Compose, Verify, Publish). The first two are
 *                paced; the third stands under the real POST for as long as
 *                loop-server takes to deploy.
 *   done:        the loop EXISTS on chain: loop-server returned an id and a
 *                handler address. One beat, then the router opens it.
 *   failed:      nothing was deployed, and the card says so in loop-server's
 *                own words.
 *
 * ── THE PUBLISH IS REAL (integration lane B, 2026-09-08) ───────────────────
 * This flow used to end at `publishVault()`, a localStorage write onto the ONE
 * hero record at `DEMO_SCOPE.liveSlug`. That was right while there was no
 * backend: every publish described the same attested vault because only one
 * vault existed. There is a backend now, so a publish is a DEPLOYMENT.
 * `publishLoopToServer` POSTs the composed candidate to loop-server, which
 * stands up a fresh PriimeVault and its workflow and hands back a loop id;
 * `liveLoopHref` is the one owner of where that id is read. Nothing local is
 * written at all. `lib/vaults/store.ts` still owns the draft's field
 * vocabulary (`PublishInput` below) and still owns the seeds and the hero
 * record; this sheet no longer publishes onto any of them.
 *
 * ONE LANE PER DEPLOY, AND THE CARD SAYS SO. loop-server's market catalog
 * (`packages/loop-deploy/src/catalog.ts`) holds exactly one market
 * (the USDe/USDC loop on Morpho Blue), and one POST carries one candidate. The
 * router composition is TWO lanes, so a two-lane publish deploys the loop and
 * leaves the Aave v3 USDC floor standing. `draft.undeployedLanes` names what
 * did not go, on the review card BEFORE the user commits and again on the
 * done card after. A green checkmark over a half-deployed composition is the
 * one lie this product cannot afford.
 *
 * Connect moment (founder addendum 2026-08-21): the nav no longer carries
 * Connect wallet — the workflow does. Disconnected, the Review card's
 * primary key reads "Connect wallet" and opens the connect sheet; when
 * isConnected flips the SAME key morphs in place to "Publish vault" (no
 * state loss, small crossfade, reduced-motion instant).
 *
 * ⚠ THE "Publish without connecting" GHOST LINK IS GONE, and its absence is
 * the point. It ran the localStorage path with no wallet, which was harmless
 * while nothing real happened. The connected address is now the STRATEGIST:
 * it holds the deployed vault's exit key, so there is no publish without one.
 * A key whose only possible outcome is a failure card is worse than no key,
 * so the sheet states the fact under the primary key instead.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { shortAddress, useAccount, useConnectModal } from "@/lib/wallet";
/* THE DRAFT'S FIELD VOCABULARY, STILL THE STORE'S. Nothing is written to the
   store any more (see the header), but `PublishDraft` is still spelled as the
   record's own input shape so the review card and any future record write
   cannot drift into two descriptions of one composition. */
import type { PublishInput } from "@/lib/vaults/store";
/* THE DEPLOY. `publish-loop` owns the POST body (cadence included) and
   re-exports loop-server's own validation error; `live-id` owns where a
   deployed loop is read. This file spells neither the route nor the path. */
import { LoopValidationError, publishLoopToServer } from "@/lib/vaults/publish-loop";
import { liveLoopHref } from "@/lib/vaults/live-id";
import { fmtCapacityUsd } from "@/lib/canvas/capacity";
// R5 grep: the published APY is the single most consequential number this
// product prints, and it was rendered here by a private
// `(x * 100).toFixed(1)` in two places — a seventh copy of `pct`, and one
// that emits an ASCII hyphen on a negative where the ratified glyph is U+2212.
import { pct } from "@/lib/canvas/format";
import { apyCaption, feeRows } from "@/lib/canvas/fees";
import { withParamKinds } from "@/lib/vaults/param-kind";

/** How long the done card holds before the router opens the vault page. */
const DONE_BEAT_MS = 900;

export interface PublishDraft extends Omit<PublishInput, "name"> {
  defaultName: string;
  /**
   * ── THE DEPLOY PAYLOAD (integration lane B) ────────────────────────────
   * The two composer values loop-server needs, read off the ONE lane this
   * publish deploys and forwarded verbatim. `RackCanvas` picks that lane
   * (the loop family, which is the only family loop-server knows how to
   * run) and is the single owner of the choice; this file only sends them.
   *
   * An empty `candidateId` is deliberately NOT caught here. loop-server is
   * the authority on what it can deploy and answers 400 with per-field
   * issues; a guess made on this side would be a worse sentence than the
   * server's own, and would be wrong the day the catalog grows.
   */
  candidateId: string;
  targetLeverage: number;
  /**
   * The lanes this deploy does NOT carry, already named for a reader
   * ("Lane 2 · Aave v3 · Base"). Empty on a composition loop-server can
   * deploy whole, which is every single-lane loop. Rendered on the review
   * card before the commit and on the done card after it, because a
   * partially deployed composition that reports success is a lie.
   */
  undeployedLanes?: string[];
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
   * The lanes and the router the canvas composed, so the vault page's Capital
   * router instrument can read what the canvas showed rather than re-deriving
   * it from a canvas it cannot see. Present only on a multi-lane publish.
   *
   * ⚠ SEAM, NOT A LOCAL FIELD. `lib/vaults/store.ts` declares
   * `VaultRecord.lanes` and `.router` and admits both into `PublishInput`;
   * the canvas composes them through `lib/canvas/published-lanes.ts`, which
   * re-exports the store's own two shapes. `PublishDraft` inherits them from
   * `PublishInput` rather than declaring a second spelling of either.
   *
   * ⚠ NOT READ BY THIS FILE ANY MORE (lane B, 2026-09-08). The publish is a
   * deployment and writes no record, so nothing here spreads them anywhere.
   * They stay on the draft because the canvas is still their one composer and
   * the store is still their one shape; the surface that reads them again
   * will read them from here rather than re-inventing them.
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

/** What loop-server handed back. The done card's whole subject. */
interface Deployed {
  /** The name the deploy actually carried, not the input's current value. */
  name: string;
  /** loop-server's id, `loop-<8 hex>`. `liveLoopHref` turns it into a path. */
  loopId: string;
  /** The deployed handler contract. */
  handler: string;
}

/**
 * Why nothing was deployed. `issues` are loop-server's OWN per-field strings
 * (`LoopValidationError.issues`), never paraphrased: the server knows which
 * market it rejected and why, and this card is the only place the builder can
 * read it.
 */
interface Failure {
  message: string;
  issues: string[];
}

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
  const [deployed, setDeployed] = useState<Deployed | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /* THE DEPLOY OUTLIVES THE CARD. A publish is now a real chain deployment
     that can take tens of seconds, and the reader can leave (the nav, the
     back key) while it is in flight. The awaited continuation must not
     setState onto an unmounted card, and the card must not be the thing that
     decides whether the deploy happened: the loop is deployed either way,
     and the directory will show it. */
  const alive = useRef(true);
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
     never closes the review card underneath an open connect sheet.

     `address` IS THE STRATEGIST (lane B): loop-server writes it onto the
     deployed vault as the role that holds the exit key. That is what turned
     connecting from a courtesy into a precondition. */
  const { address, isConnected } = useAccount();
  /* THE VAULT PAGE IS WHERE A PUBLISH ENDS (founder, 2026-09-07: "publish it
     and arrive on the vault page automatically"). The done beat used to sit
     on the canvas behind a card with an "Open your vault" key, and closing
     that card left the builder on the canvas they had just published from,
     which read as being sent back there. Now the card shows its done state
     for one beat and the router carries the reader to the loop it deployed.
     The two links stay for a reader who moves before the beat lands. */
  const router = useRouter();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const connectOpenRef = useRef(connectModalOpen);
  connectOpenRef.current = connectModalOpen;

  useEffect(() => {
    /* SET ON THE WAY IN, NOT ONLY ON THE WAY OUT. StrictMode runs mount →
       cleanup → mount in development, so a flag that is only ever cleared
       would leave the second mount permanently marked dead and every deploy
       would land on a card that refuses to render its own result. */
    alive.current = true;
    /* The ARRAY is captured here, not read from the ref at cleanup time. The
       ref's identity is stable for this mount, so the two are the same list
       today, but reading `timers.current` inside the cleanup asks for
       whatever the ref points at when the card unmounts, which is the wrong
       question and the one react-hooks warns about. */
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach(clearTimeout);
    };
  }, []);

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

  /**
   * THE DEPLOY.
   *
   * The three beats are no longer a 1.86s animation with a localStorage
   * write at the end of it. `Compose` and `Verify` are still paced, because
   * they are the two things the canvas already did; `Publish` is the last
   * beat and it stands, pulsing, for exactly as long as loop-server takes to
   * put a vault and a workflow on chain. The card leaves the publishing
   * phase when the network answers and not one moment earlier, in either
   * direction. No fake success on a failed deploy, and no fake wait on a
   * fast one.
   */
  const publish = () => {
    if (phase !== "review" && phase !== "failed") return;
    /* NO STRATEGIST, NO DEPLOY. This is unreachable from the primary key,
       which reads `Connect wallet` and opens the sheet while disconnected,
       but Enter in the name field runs the same action, and a wallet can
       disconnect between the key's render and the press. Stated as a
       failure rather than a silent return so the card always says why. */
    if (!isConnected || !address) {
      setFailure({
        message:
          "Connect a wallet before publishing. The connected address becomes the strategist and holds this vault's exit key, so a deploy without one has no way out.",
        issues: [],
      });
      setPhase("failed");
      return;
    }
    const finalName = name.trim() || draft.defaultName;
    setFailure(null);
    setPhase("publishing");
    setBeat(0);
    timers.current.push(setTimeout(() => setBeat(1), 620));
    timers.current.push(setTimeout(() => setBeat(2), 1240));
    void (async () => {
      try {
        /* `publish-loop.ts` owns the body: it adds the strike cadence and
           states which composer field each value came from. This site adds
           the name and the strategist and nothing else.
           strategyParams gathers every other knob the composer captured
           (health-factor bands, auto-compound cadence + threshold, hedge
           dials when present, exit route, ...) and forwards them as a flat
           string map so loop-server merges them verbatim into the workflow's
           componentConfig on IPFS. Names use snake_case to match how the
           WASM component reads them; values are strings because the wire
           protocol is strings all the way down.
           `emit` is inlined rather than a helper because the closure over
           `sp` reads better than a `(k,v)=>` mutator at every call site. */
        const sp: Record<string, string> = {};
        const emit = (k: string, v: unknown) => {
          if (v === undefined || v === null) return;
          if (typeof v === "number" && !Number.isFinite(v)) return;
          // The composer's draft values are strings or finite numbers; guard
          // against a future object slipping through so a silent
          // `[object Object]` never rides the wire.
          if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return;
          sp[k] = String(v);
        };
        // Composer's HF fields are HF-ratio-in-bps (10_000 = 1.0x HF); the
        // vault-nav component reads `hf_floor_bps` as "bps below LLTV" and
        // errors on any value >10_000. Convention drift; strip the HF
        // triplet from the wire until the two sides are reconciled.
        // Position invariants stay covered by `applied_leverage` below.
        emit("applied_leverage", draft.appliedLeverage);
        emit("compound_cadence_hours", draft.compoundCadenceHours);
        emit("compound_threshold_usd", draft.thresholdUsd);
        emit("hedge_leverage", draft.hedgeLeverage);
        emit("reserve_fraction", draft.reserveFraction);
        emit("delta_band_pct", draft.deltaBandPct);
        emit("margin_trim_pct", draft.marginTrimPct);
        emit("margin_restore_pct", draft.marginRestorePct);
        emit("funding_floor_apr", draft.fundingFloorApr);
        emit("collateral_yield_apy", draft.collateralYieldApy);
        emit("exit_route_id", draft.exitRouteId);
        emit("exit_settlement_days", draft.exitSettlementDays);
        emit("hl_coin", draft.hlCoin);
        emit("capacity_binding", draft.capacityBinding);
        const { loopId, handler } = await publishLoopToServer({
          name: finalName,
          strategist: address,
          candidateId: draft.candidateId,
          targetLeverage: draft.targetLeverage,
          strategyParams: sp,
        });
        if (!alive.current) return;
        setDeployed({ name: finalName, loopId, handler });
        setPhase("done");
        /* THE VAULT PAGE IS WHERE A PUBLISH ENDS, and `liveLoopHref` is the
           one owner of that path; `VaultDetail` reads the same module to
           tell a live loop from a seed, so the two cannot drift. */
        timers.current.push(setTimeout(() => router.push(liveLoopHref(loopId)), DONE_BEAT_MS));
      } catch (err) {
        if (!alive.current) return;
        /* LOOP-SERVER'S OWN WORDS. A 400 carries per-field issues (an
           unknown candidate id, a leverage outside the market's band); they
           are rendered verbatim because the server is the only party that
           knows which market it holds. Everything else is a plain Error
           (the proxy down, the deployer reverting), and carries its message. */
        if (err instanceof LoopValidationError) {
          setFailure({ message: "loop-server rejected this composition.", issues: err.issues });
        } else {
          setFailure({
            message: err instanceof Error ? err.message : String(err),
            issues: [],
          });
        }
        setPhase("failed");
      }
    })();
  };

  /* THE MODELED FIGURE MEASURES THE COMPOSITION, NOT THE DEPLOY (lane B).
     On a composition loop-server cannot deploy whole, the blended APY is what
     the canvas priced ACROSS EVERY LANE and only some of those lanes are
     going to exist. The figure still belongs on both cards (it is the number the
     builder reviewed, and hiding it would be its own dishonesty), but the
     caption has to name which thing it measures. One expression, read by the
     review card and the done card, so the two cannot caption one number two
     ways. `undeployedLanes` is `RackCanvas`'s single owner of the fact. */
  const undeployedText = (draft.undeployedLanes ?? []).join("; ");
  const partialDeploy = undeployedText.length > 0;
  const apyNoun = partialDeploy ? "modeled net APY, whole composition" : "modeled net APY";

  /** loop-server's own reasons, or none. Read twice below; derived once. */
  const failIssues = failure?.issues ?? [];

  /* The primary key's action follows its label: connect first when
     disconnected, publish once connected. It is the ONLY way into `publish()`
     from a pointer now; the skip link that used to sit beneath it published
     without a wallet, which a real deploy cannot do (see the header). Enter in
     the name field is the other way in, and `publish()` re-checks the wallet
     for exactly that reason. */
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
                {/* WHICH RECORD'S SCHEDULE (lane B, 2026-09-08). This read
                    `{ slug: DEMO_SCOPE.liveSlug }` back when the sheet
                    published onto that one hero record. It does not any more:
                    it deploys a fresh vault. The stage is what the withdrawal
                    row actually turns on (`fees.isAttestedRecord`), and a
                    deployed vault redeems at the attested share value with the
                    strategist holding the exit key, so the schedule is read
                    for what this sheet stands up rather than for a slug it no
                    longer writes. Same four strings; a true citation. */}
                <div className="pf-fees" style={{ display: "grid", gap: 6, marginBottom: 16 }}>
                  {withParamKinds(feeRows({ stage: "attested" })).map((f) => (
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
                  <i>{apyNoun}</i>
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
            {/* PINNED: every key the review offers, always on screen, and
                with it the two facts that decide what pressing it does. They
                are pinned for the same reason the key is (DS-3): a sheet that
                overflows must not put the sentence "one of your two lanes is
                not deployed" below the cut, under the key that deploys it. */}
            <div className="pf-acts">
              {/* WHAT THIS DEPLOY LEAVES BEHIND, BEFORE THE COMMIT. One POST
                  carries one market, and the router composition is two lanes,
                  so a two-lane publish stands up the loop and leaves the floor
                  where it is. `.pf-cap-bind`'s register: a fact under the
                  numbers, never a warning; the composition is not wrong, it
                  is simply larger than what can be deployed today. */}
              {partialDeploy ? (
                <div className="pf-cap-bind pf-cap-bind--wide pf-cap-bind--above">
                  Deploys one lane. Not deployed: {undeployedText}. It stays on the canvas and holds
                  no capital.
                </div>
              ) : null}
              <button type="button" className="pf-publish" onClick={primaryAction}>
                {/* Keyed span: remounts when isConnected flips, so the label
                    crossfades in place exactly once per morph. */}
                <span key={isConnected ? "publish" : "connect"} className="pf-key-label">
                  {isConnected ? "Publish vault" : "Connect wallet"}
                </span>
              </button>
              {/* WHERE "Publish without connecting" USED TO BE. The ghost link
                  ran the localStorage path with no wallet; the publish is a
                  real deployment now and the connected address is its exit
                  key, so the skip cannot exist. The line says which address is
                  about to be handed that key, and morphs with the key above
                  it rather than appearing and disappearing beneath it. */}
              <div className="pf-cap-bind pf-cap-bind--wide pf-cap-bind--below">
                {isConnected && address
                  ? `Strategist ${shortAddress(address)}, which holds this vault's exit key.`
                  : "The connected address becomes the strategist and holds this vault's exit key."}
              </div>
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
          /* G2, THE HONEST FAILURE. Nothing was deployed, so there is no
             vault, no link to one, no id and no celebration. The card says
             what did not happen and, where loop-server said why, prints the
             server's own reasons rather than a paraphrase of them. The
             composition is untouched on the canvas behind this card.

             REASONS, NOT A REASON (lane B). The message used to name the one
             way the flow could fail: a browser that would not write to
             localStorage. A deploy fails for reasons this client cannot
             enumerate (a market the catalog does not hold, a leverage outside its
             band, a deployer that reverted, a server that is not up), and
             `LoopValidationError.issues` is loop-server telling the
             builder which. */
          <>
            <div className="pf-head">
              <span className="pf-kicker">Not deployed</span>
              <button type="button" className="pf-close" onClick={close}>
                Close
              </button>
            </div>
            <div className="pf-done-name">{name.trim() || draft.defaultName}</div>
            <div className="pf-summary">
              {failure?.message ?? "The deploy did not complete."} Nothing was deployed and your
              composition is still on the canvas.
            </div>
            {failIssues.length > 0 ? (
              <ul className="pf-fail-issues">
                {failIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
            <div className="pf-done-acts">
              <button type="button" className="pf-publish" onClick={publish}>
                Try again
              </button>
              <button type="button" className="pf-ghostlink" onClick={close}>
                Back to the canvas
              </button>
            </div>
          </>
        ) : deployed ? (
          <>
            <div className="pf-done-k">Deployed</div>
            <div className="pf-done-name">{deployed.name}</div>
            {/* ⚠ THE STAGE WORD IS READ, NOT ASSERTED (S2 Wave 2 seam,
                2026-08-24). This sentence once opened by calling the record
                LIVE while the very next screen chipped `Incubating · modeled`:
                one lifecycle, two claims, one click apart. The rule survives
                the rewrite, and this card now has the strongest possible way
                of honouring it: it states only what loop-server actually
                returned. A deployed handler address is a fact; a NAV, a TVL
                and a stage on a vault that is seconds old are not this card's
                to claim, and the page the router is about to open reads all
                three off the chain.

                No seed TVL either. `publishVault`'s $25K seed belonged to a
                record with no backend behind it. This vault holds exactly the
                capital that has been deposited into it, which is none. */}
            <div className="pf-summary">
              Handler{" "}
              <b>{shortAddress(deployed.handler)}</b>
              . First strike lands within a cadence.
            </div>
            {/* WHAT DID NOT GO, RESTATED AFTER THE FACT. The review card said
                it before the commit; a reader who pressed through deserves to
                be told again on the card that says the deploy worked, not to
                discover it on the vault page. */}
            {partialDeploy ? (
              <div className="pf-cap-bind pf-cap-bind--wide pf-cap-bind--flush">
                One lane deployed. Not deployed: {undeployedText}.
              </div>
            ) : null}
            <div className="pf-apy">
              <b>{pct(draft.modeledApy)}</b>
              <i>{apyNoun}</i>
            </div>
            {/* QNT-3 — the done card prints the figure again, so the
                companion prints again. One fact, both phases. */}
            {draft.apyCompanion ? <div className="pf-apy-companion">{draft.apyCompanion}</div> : null}
            <div className="pf-done-acts">
              {/* The same destination the router is already on its way to
                  (`liveLoopHref`), for a reader who moves before the beat
                  lands. Spelled once, in `live-id.ts`. */}
              <Link className="pf-publish" href={liveLoopHref(deployed.loopId)}>
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
