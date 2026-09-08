"use client";

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-optional-chain --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * CopilotPanel (IT4_COPILOT_SPEC §3) — the left-panel AI copilot in the hm
 * dark-OLED register. Session-local transcript (no persistence). Streaming
 * over SSE; tool calls arrive as STRUCTURED events and render as cards; the
 * copilot NEVER mutates the canvas — the single APPLY key (double-confirmed
 * when a canvas exists) hands the validated blueprint to RackCanvas, which
 * replays it through the reducer. Offline (no API key) is a first-class
 * state: honest register line, input disabled, chips hidden, no fake typing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LoopId, PortfolioGraph } from "@/lib/canvas/types";
import { adverseMoveValue, liquidationDistance } from "@/lib/canvas/liquidation";
import type { ExplainPayload, ExplainRow, ProposalPayload } from "@/lib/canvas/copilot/tools";
import { proposalApplyGate, proposalCompileState } from "@/lib/canvas/copilot/apply";
import { cardPrintedPercents, proseAgreesWithCard } from "@/lib/canvas/copilot/card-prose";
import { copilotFailureLine, parseCopilotEvents, responseChunks } from "@/lib/canvas/copilot/sse";
import type { SlimReprice } from "@/lib/canvas/copilot/context";
import { fmtCapacityUsd } from "@/lib/canvas/capacity";
import { lev, pct } from "@/lib/canvas/format";
import { STRATEGY_LABEL } from "@/lib/canvas/graph-ops";
import { apyCaption } from "@/lib/canvas/fees";
import type { RepriceData } from "./types";
import { copilotSessionId, mintId, rotateCopilotSession } from "@/lib/canvas/copilot/client-session";

const MAX_SESSION_TURNS = 20;

/* The four chips (docs/plans/LATEST_UI_PORT_SPEC.md A.3 #25): every one names
   something the live loop can finish, or asks the register out loud. */
const STARTER_CHIPS = [
  "Build the USDe/USDC recursive loop",
  "Explain this market",
  "Set the loop to 3x leverage",
  "What is coming soon?",
];

type CompileState =
  | { status: "pending" }
  | {
      status: "done";
      blendedApyPct: number | null;
      violations: string[];
      perLoopApyPct: (number | null)[];
    }
  | { status: "error"; message: string };

interface ProposalState {
  payload: ProposalPayload;
  compile: CompileState;
  applied: boolean;
  confirming: boolean;
}

type ChatItem =
  | { kind: "user"; text: string }
  | {
      kind: "assistant";
      text: string;
      /* `turnId` is the client id minted per send until the done frame names
         the server's; `sessionId` is the session the turn was sent under. Both
         travel on the request headers the route may read. */
      turnId: string;
      sessionId: string;
      done?: boolean;
      proposal?: ProposalState;
      explain?: ExplainPayload;
      rejected?: { reason: string };
      register?: string; // terminal register line (truncated / declined)
    };

/**
 * R5 grep. This panel held a private `pct`, a private capacity magnitude and
 * a private `lev`. The capacity one was a live defect, not a stylistic
 * blemish: it ROUNDED (`Math.round(v / 1e3)`) where `fmtCapacityUsd` FLOORS,
 * so the copilot's market card could advertise $125K of room on the same book
 * Discover printed as $124K — and rounding a capacity UP promises space the
 * vault refuses. It also spelled the magnitude `k` against the product's `K`.
 *
 * ⚠ TWO SHAPES REACH THIS PANEL AND ONLY ONE OF THEM IS A PERCENTAGE.
 *
 * `proposalCompileState` publishes `blendedApyPct` ALREADY multiplied by 100
 * and already rounded to 1dp, so it is divided back before it reaches `pct`,
 * which owns the multiplication — that is `pctOf100` below.
 *
 * `LaneEconomics.marketApy` / `.vaultApy` / `.computeFee` are FRACTIONS
 * (0.0825), the same fractions the lane header, the review sheet and the
 * published record hand to `pct`. They go to `pct` UNTOUCHED. This is the A2
 * release gate: the card's `net` and the lane's `your lane as composed` are
 * one number through one formatter, so they cannot round apart. The retired
 * `headlineAprPct` carried the ×100 and is what made a second shape exist
 * here at all.
 */
/* A missing number prints nothing. That is the house empty state (LanePanel
   drops its capacity row for a null; the tile grammar prints no glyph), and
   the em dash these two carried as a placeholder reached the screen (G7,
   2026-09-02). Callers that print a label beside the value hide the pair. */
const pctOf100 = (v: number | null | undefined) => (typeof v === "number" ? pct(v / 100) : "");
const capFmt = (v: number | null | undefined) => (typeof v === "number" ? fmtCapacityUsd(v) : "");

/**
 * THE TWO WORDS, DERIVED ONCE.
 *
 * The market card reads `kind` (the server already mapped it) and the
 * blueprint lane reads the snapshot's class letter, so without one owner the
 * panel held two mappings for one fact and a class letter stayed one careless
 * edit away from a user surface. `"N1"` is the product's ratified position for
 * a collar too: the option pair IS the protection there, so no perp leg
 * belongs on it and the row is authored `N1` on purpose.
 */
const KIND_WORD = { "delta-neutral": "Delta-neutral", unhedged: "Unhedged" } as const;
const kindOfCls = (cls: "A" | "N1"): keyof typeof KIND_WORD =>
  cls === "A" ? "delta-neutral" : "unhedged";

/** §3.4 — deterministic transcript re-encoding for the next request. */
function encodeTranscript(items: ChatItem[]): { role: "user" | "assistant"; content: string }[] {
  return items.map((it) => {
    if (it.kind === "user") return { role: "user" as const, content: it.text };
    let content = it.text;
    if (it.proposal) {
      const p = it.proposal.payload;
      const slim = {
        title: p.title,
        loops: p.loops.map((l) => ({
          candidateId: l.candidateId,
          leverage: l.leverage,
          hedge: l.hedge,
          compound: l.compound,
        })),
        allocationsBps: p.allocationsBps,
      };
      /* ⚠ THE HISTORY SAYS SO OF ITSELF THAT IT IS HISTORY (2026-08-24).
         Asked for the health band on a lane the user had re-dialled to 1.00x
         by hand, the model answered about the 2.75x it had proposed three
         turns earlier. The request payload was correct: the canvas block in
         that same request carried the 1.00x. What the transcript said was
         `(applied)`, which reads as a standing fact about the canvas, and a
         bare replay of the proposed dials sat right beside it. It now says
         what it actually is. This is a model-facing annotation on the
         transcript, never a rendered string, and the system prompt carries the
         same precedence in words. */
      content += `\n[propose_portfolio: ${JSON.stringify(slim)}] ${
        it.proposal.applied
          ? "(applied when it was offered; the user may have re-dialled any lane since, and the canvas context block is the current state)"
          : "(offered, not applied)"
      }`;
    }
    if (it.explain) content += `\n[explain_market: ${JSON.stringify({ candidateId: it.explain.row.id })}]`;
    if (it.rejected) content += `\n[rejected: ${it.rejected.reason}]`;
    return { role: "assistant" as const, content };
  });
}

function slimReprices(reprices: Record<LoopId, RepriceData | null>): Record<string, SlimReprice | null> {
  const out: Record<string, SlimReprice | null> = {};
  for (const [id, r] of Object.entries(reprices)) {
    if (!r || r.ok !== true) {
      out[id] = null;
      continue;
    }
    /* `netApyOnDepositApy` AND `eligible` WERE HERE AND ARE GONE (2026-08-24).
       The client used to ship the lane's APY up to the model. It was the scan
       frame — pre-fee, at the scan's dials — and `mock-quote.ts:511` names that
       exact field as the retired defect header. The context now derives the
       lane's number server-side from the pinned row through `laneEconomicsFor`,
       in the PRODUCT frame, so the model reads the number the lane header
       prints instead of the one the client happened to hold. `eligible` was a
       gate boolean that only ever fed a raw gate id to a user surface. */
    out[id] = {
      appliedLeverage: r.appliedLeverage,
      minDepositUsd: r.minDepositUsd,
      blockNumber: r.blockNumber,
      violations: r.violations.map((v) => `${v.invariant}: ${v.detail}`),
    };
  }
  return out;
}

/**
 * One market card (§6.4).
 *
 * ⚠ THE `headline (modeled)` ROW ANSWERED TWO QUESTIONS WITH ONE NUMBER.
 * It was the venue fact, correctly, and it was the only number on the card —
 * so when a user asked "what would I actually earn", the model had nothing
 * else to answer with and handed back a pre-fee figure as earnings. The row
 * did not need repairing, it needed a SIBLING: `this market, at {lev}` is what
 * the venue pays, `as a vault` is what a depositor gets with the compute fee
 * already inside it. Both come from one `LaneEconomics` block, at one
 * leverage, at one composition, so the two rows cannot describe two machines.
 *
 * ⚠ `row.cls` NO LONGER RENDERS. The class letter reaching a user surface is
 * the source of the "all class A" leak; `row.kind` is already the two words
 * the product prints. The `gates` row is gone with it: `firstFailedGate` was a
 * raw internal id printed to a user, and a market that cannot be built now
 * states its MEASURED reason through `absenceReason` instead.
 */
function ExplainCard({ row }: { row: ExplainRow }) {
  const l = row.lane;
  /* The verbatim lines, in the spec's order, each rendered only when the owner
     produced one. Never re-worded and never re-arithmetic'd: every one of
     these is a ratified string from the surface that owns the quantity. */
  const lines = [
    /* QNT-R2-3 — THE COLLAR'S FIGURE NEVER PRINTS ALONE, AND THE COPILOT WAS
       THE SIXTH SURFACE (G7, 2026-09-02). `l.vaultApy` under `as a vault` is
       `terms.published`, and on a collar that number is bought with the upside
       sold above the strike: under the flat-IV table the premium and the
       forgone upside are ONE number, so a figure printed without its companion
       is a sign error and not a rounding. The lane header, the Compose ladder,
       the Discover row, the directory card and the review sheet all carry the
       line; this panel is the one that also GENERATES PROSE, which made it the
       worst place to leave the omission. FIRST in the list so it sits against
       the figure it belongs to, and quoted whole from `collarForfeitLine`
       through `lane-frame` — this file spells no part of it. */
    l.upsideForfeitLine,
    l.marketLeverageLine,
    l.fundingLine,
    l.railVerdict,
    l.absenceReason,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
  /* An unmeasured capacity hides its label with it; nothing prints a glyph for it. */
  const capacity = capFmt(l.capacityUsd);
  return (
    <div className="cop-card">
      <div className="cop-card-h">
        <b>{row.pair}</b>
        <i className="mt-venuechip">{row.venueLabel}</i>
        {/* A neutral hairline chip (docs/plans/LATEST_UI_PORT_SPEC.md A.3 #26):
            `unhedged` on a stable/stable loop is its kind, not a warning. */}
        <span className="cop-cls">{KIND_WORD[row.kind]}</span>
        <span className="cop-strat">{STRATEGY_LABEL[l.strategy]}</span>
      </div>
      <div className="cop-card-rows">
        <span>this market, at {lev(l.seatedLeverage)}</span>
        <b>{pct(l.marketApy)}</b>
        <span>as a vault</span>
        <b>{pct(l.vaultApy)}</b>
        {capacity ? (
          <>
            <span>capacity</span>
            <b>{capacity}</b>
          </>
        ) : null}
      </div>
      {lines.length > 0 ? (
        <div className="cop-card-lines">
          {lines.map((s, i) => (
            <div key={i}>{s}</div>
          ))}
        </div>
      ) : null}
      <div className="cop-card-foot">modeled net APY · {apyCaption()}</div>
    </div>
  );
}

export default function CopilotPanel({
  portfolio,
  reprices,
  canvasHasMarket,
  collapsed,
  visibleIds,
  onApply,
  onToggleCollapse,
}: {
  portfolio: PortfolioGraph;
  reprices: Record<LoopId, RepriceData | null>;
  canvasHasMarket: boolean;
  /** Panel collapsed to the 44px rail — drives the unread-reply LED. */
  collapsed: boolean;
  /** Ids in the visible discovery universe; null while the catalog loads. */
  visibleIds: Set<string> | null;
  onApply: (p: ProposalPayload) => void;
  onToggleCollapse: () => void;
}) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** IT4C §3: a reply that lands while the panel is collapsed lights the
   *  rail LED; opening the panel clears it. */
  const [unread, setUnread] = useState(false);
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef({ portfolio, reprices });
  liveRef.current = { portfolio, reprices };

  // Boot probe — once on mount; re-probes only on remount.
  useEffect(() => {
    let alive = true;
    fetch("/api/canvas/copilot")
      .then((r) => r.json())
      .then((b) => alive && setOnline(!!b?.online))
      .catch(() => alive && setOnline(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  // Unread-reply LED: a send that completes while collapsed = unread.
  useEffect(() => {
    if (busyRef.current && !busy && collapsed) setUnread(true);
    busyRef.current = busy;
  }, [busy, collapsed]);
  useEffect(() => {
    if (!collapsed) setUnread(false);
  }, [collapsed]);

  const userTurns = useMemo(() => items.filter((i) => i.kind === "user").length, [items]);
  const atLimit = userTurns >= MAX_SESSION_TURNS;

  const patchLast = useCallback((f: (a: Extract<ChatItem, { kind: "assistant" }>) => ChatItem) => {
    setItems((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].kind === "assistant") {
          next[i] = f(next[i] as Extract<ChatItem, { kind: "assistant" }>);
          break;
        }
      }
      return next;
    });
  }, []);


  /* THE CARD NEVER ASKS THE NETWORK FOR ITS PRICE (docs/plans/LATEST_UI_PORT_SPEC.md
     2.10, D.3). There is no compile route on this build, and the numbers were
     never in that response anyway: they are on `loops[i].lane`, priced by the
     route at the composition APPLY seats. `proposalCompileState(p, null)`
     reads them off the payload, and the APPLY gate locks only on a null lane
     number. */
  const compileProposal = useCallback(
    (p: ProposalPayload) => {
      patchLast((a) =>
        a.proposal?.payload.proposalId === p.proposalId
          ? { ...a, proposal: { ...a.proposal, compile: proposalCompileState(p, null) } }
          : a,
      );
    },
    [patchLast],
  );

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || busy || !online || atLimit) return;
      setInput("");
      setBusy(true);
      const userItem: ChatItem = { kind: "user", text: t };
      const transcript = [...encodeTranscript(items), { role: "user" as const, content: t }];
      /* A2: the anonymous session id (sessionStorage, rotated after 30 min
         idle) and a client turn id per send, on the headers the capture
         layer reads and in the body. The done frame answers with the server
         ULID the turn was stored under. */
      const sessionId = copilotSessionId();
      const clientTurnId = mintId();
      setItems((prev) => [...prev, userItem, { kind: "assistant", text: "", turnId: clientTurnId, sessionId }]);
      try {
        const live = liveRef.current;
        const res = await fetch("/api/canvas/copilot", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-copilot-session": sessionId,
            "x-copilot-turn": clientTurnId,
          },
          body: JSON.stringify({
            sessionId,
            turnId: clientTurnId,
            messages: transcript,
            canvas: {
              portfolio: live.portfolio,
              reprices: slimReprices(live.reprices),
            },
          }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => null);
          patchLast((a) => ({
            ...a,
            register:
              res.status === 503
                ? "Copilot offline: no API key configured"
                : res.status === 429
                  ? "rate limited, retry shortly"
                  : String(err?.error ?? "copilot request failed"),
          }));
          if (res.status === 503) setOnline(false);
          return;
        }
        for await (const ev of parseCopilotEvents(responseChunks(res.body))) {
          if (ev.event === "text") {
            const delta = String((ev.data as { delta?: string })?.delta ?? "");
            patchLast((a) => ({ ...a, text: a.text + delta }));
          } else if (ev.event === "proposal") {
            const payload = ev.data as ProposalPayload;
            patchLast((a) => ({
              ...a,
              proposal: { payload, compile: { status: "pending" }, applied: false, confirming: false },
            }));
            compileProposal(payload);
          } else if (ev.event === "proposal_rejected") {
            const d = ev.data as { reason?: string };
            patchLast((a) => ({ ...a, rejected: { reason: String(d?.reason ?? "rejected") } }));
          } else if (ev.event === "explain") {
            patchLast((a) => ({ ...a, explain: ev.data as ExplainPayload }));
          } else if (ev.event === "error") {
            /* DL-11: the failure state is the server's own specific line
               (class + status), not a generic one, rendered in the same
               register the other terminal lines use. */
            const d = ev.data as { message?: string };
            patchLast((a) => ({ ...a, register: copilotFailureLine(d?.message) }));
          } else if (ev.event === "done") {
            const d = ev.data as { stopReason?: string; turnId?: string };
            if (d?.stopReason === "max_tokens") patchLast((a) => ({ ...a, register: "response truncated" }));
            if (d?.stopReason === "refusal")
              patchLast((a) => ({ ...a, register: "the copilot declined this request" }));
            const serverTurnId = typeof d?.turnId === "string" && d.turnId.length > 0 ? d.turnId : clientTurnId;
            patchLast((a) => ({
              ...a,
              done: true,
              turnId: serverTurnId,
            }));
          }
        }
      } catch {
        patchLast((a) => ({ ...a, register: "copilot unreachable" }));
      } finally {
        setBusy(false);
      }
    },
    [busy, online, atLimit, items, patchLast, compileProposal],
  );

  const applyProposal = useCallback(
    (a: ProposalState) => {
      if (a.applied) return;
      if (canvasHasMarket && !a.confirming) {
        patchLast((it) =>
          it.proposal?.payload.proposalId === a.payload.proposalId
            ? { ...it, proposal: { ...it.proposal, confirming: true } }
            : it,
        );
        return;
      }
      onApply(a.payload);
      patchLast((it) =>
        it.proposal?.payload.proposalId === a.payload.proposalId
          ? { ...it, proposal: { ...it.proposal, applied: true, confirming: false } }
          : it,
      );
    },
    [canvasHasMarket, onApply, patchLast],
  );

  const renderProposal = (p: ProposalState) => {
    const pay = p.payload;
    const single = pay.loops.length === 1;
    /* THE QUARANTINE now reads the PAYLOAD as well as the compile state
       (§6.3). A lane with no modeled number, or one carrying a measured
       absence, locks the key regardless of what the rail check said — the
       funding defect walked straight through the old one-argument gate, which
       could only see a compile response that had never been able to price the
       lane. A RAIL VERDICT still never locks: eyes-open pinning is the shipped
       behaviour and the verdict is printed, not enforced. */
    const gate = proposalApplyGate(p.compile, pay);
    /* THE CARD'S OWN PERCENTAGES, gathered from the strings it is about to
       render rather than from the numbers behind them, because rounding
       happens on the way to the screen and the screen is what the reader
       compares. Every source below is a line that actually appears on this
       card at this moment: the lane's product number, the three verbatim
       lines, the capacity binding, the adverse move, the allocation splits (on
       a multi-lane card only), the blend, the fee caption, the notes and the
       violations. */
    const printed = cardPrintedPercents([
      ...pay.loops.flatMap((l) => [
        l.lane.vaultApy !== null ? pct(l.lane.vaultApy) : null,
        l.lane.marketLeverageLine,
        l.lane.fundingLine,
        l.lane.railVerdict,
        l.lane.capacityBinding,
        l.leverageModule && l.leverage !== null
          ? adverseMoveValue(liquidationDistance(l.snapshot.lt, l.leverage))
          : null,
      ]),
      ...(single ? [] : pay.allocationsBps.map((b) => pct(b / 10000, 0))),
      p.compile.status === "done" && p.compile.blendedApyPct !== null
        ? pctOf100(p.compile.blendedApyPct)
        : null,
      apyCaption(),
      ...pay.notes,
      ...(p.compile.status === "done" ? p.compile.violations : []),
    ]);
    /* ⚠ THE MODEL'S TWO FREE-HAND STRINGS, HELD TO THE CARD'S OWN NUMBERS.
       On the production walk a rationale claimed one lane "models 5.75% vault
       APY" directly above a lane line printing `net 6.3% modeled` — the 5.75
       belonged to a different market on a different venue — and four other
       turns quoted the pre-compound figure over a card priced with
       compounding. A percentage in this prose that the card does not itself
       print is, by construction, a second number for a lane that already has
       one, so the sentence is withheld rather than rendered beside it. There
       is no correct value to substitute: which lane a stray figure was meant
       for is not recoverable from the string, and rewriting it would invent a
       second author for the model's judgment. The title falls back to the
       route's own fallback so the card is never headed by an empty line; the
       rationale is optional already and simply does not render. */
    const title = proseAgreesWithCard(pay.title, printed) ? pay.title : "Portfolio blueprint";
    const rationale = proseAgreesWithCard(pay.rationale, printed) ? pay.rationale : "";
    return (
      <div className="cop-blueprint">
        <div className="cop-bp-head">
          <span className="cop-bp-k">Blueprint</span>
          <b>{title}</b>
        </div>
        {rationale ? <div className="cop-bp-rationale">{rationale}</div> : null}
        {pay.loops.map((l, i) => (
          <div key={l.candidateId} className="cop-bp-lane">
            <div className="cop-bp-lane-h">
              <b>{l.snapshot.pair}</b>
              <i className="mt-venuechip">{l.snapshot.venueLabel}</i>
              {/* The two WORDS, off the lane's own kind. `snapshot.cls` still
                  travels because the replay writes it into the liquidity
                  source param exactly as a hand pick does, but a class letter
                  never renders: the card says what the product says. */}
              <span className="cop-cls">{KIND_WORD[kindOfCls(l.snapshot.cls)]}</span>
              {/* Which of the four strategies this lane is, from the label
                  owner. Before this the card described every lane as a loop
                  because the replay seated the loop chain unconditionally. */}
              <span className="cop-strat">{STRATEGY_LABEL[l.lane.strategy]}</span>
            </div>
            <div className="cop-bp-lane-m">
              {/* ⚠ THE ADJECTIVE DIED HERE TOO (2026-08-22). This
                  title-cased a risk stop id and printed it as the lane's
                  risk — the same word the vault page was cleaned of, on the
                  card that composes the vault. The lane's risk is its
                  leverage and the adverse pair move that leverage survives,
                  through `liquidation.ts`, the one owner. A blueprint that
                  named no leverage prints none rather than an invented one. */}
              {!l.leverageModule ? (
                /* THE MODULE RULING on the card (2026-08-23): a lane the
                   validator left unlevered holds no leverage module, so the
                   card prints the cushion word the lane actually has rather
                   than `1.00x` beside a dial APPLY will not seat. */
                <span>no debt</span>
              ) : l.leverage !== null ? (
                <span>
                  {[lev(l.leverage), adverseMoveValue(liquidationDistance(l.snapshot.lt, l.leverage))]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
              {l.hedge ? <span>Hedge</span> : null}
              {l.compound ? <span>Compound</span> : null}
              {/* ⚠ THE A2 RELEASE GATE. This used to read
                  `p.compile.perLoopApyPct[i]` — a number from a route that can
                  only price two Morpho venues, so a funding lane printed
                  nothing at all while the key stayed live. It now reads the
                  lane's own PRODUCT number, the same fraction through the same
                  `pct` the lane header uses, so the card and the rack cannot
                  round apart. It also renders while the rail check is still in
                  flight, because the price never depended on that fetch. */}
              {l.lane.vaultApy !== null ? <span>net {pct(l.lane.vaultApy)} modeled</span> : null}
            </div>
            {/* The verbatim lines, in the spec's order. A rail verdict prints
                here and does NOT lock the key: a measured, rail-less market
                pins, composes, reviews and publishes as a modeled design.
                The collar's forgone-upside line leads them (QNT-R2-3): it is
                the companion to the `net … modeled` figure directly above, not
                a note about the market, so it sits against that figure. */}
            {[
              l.lane.upsideForfeitLine,
              l.lane.marketLeverageLine,
              l.lane.fundingLine,
              l.lane.railVerdict,
            ]
              .filter((s): s is string => typeof s === "string" && s.length > 0)
              .map((s, k) => (
                <div key={k} className="cop-bp-lane-line">
                  {s}
                </div>
              ))}
            {l.lane.capacityUsd !== null ? (
              <div className="cop-bp-lane-cap">
                {[capFmt(l.lane.capacityUsd), l.lane.capacityBinding].filter(Boolean).join(" · ")}
              </div>
            ) : null}
            {visibleIds && !visibleIds.has(l.candidateId) ? (
              <span className="mt-flag">not in the visible market list right now</span>
            ) : null}
            {!single ? (
              <div className="cop-bp-alloc">
                <span className="cop-bp-bar">
                  <i style={{ width: `${pay.allocationsBps[i] / 100}%` }} />
                </span>
                <b>{pct(pay.allocationsBps[i] / 10000, 0)}</b>
              </div>
            ) : null}
          </div>
        ))}
        <div className="cop-bp-blend">
          {p.compile.status === "pending"
            ? "Modeling…"
            : p.compile.status === "error"
              ? "Model unavailable"
              : p.compile.blendedApyPct !== null
                ? `Blended net APY, modeled: ${pctOf100(p.compile.blendedApyPct)}`
                : "Model unavailable"}
        </div>
        {/* THE ONE FEE CAPTION, byte-identical with the review sheet and the
            published record because all three call `apyCaption()`. Every
            number above it is the PRODUCT number with the compute fee already
            inside, and the card now says so on its own face rather than
            leaving the model to be asked. */}
        <div className="cop-bp-foot">modeled net APY · {apyCaption()}</div>
        {p.compile.status === "done" && p.compile.violations.length > 0 ? (
          <div className="cop-bp-violations">
            {p.compile.violations.map((v, i) => (
              <div key={i} className="cop-bp-violation">
                {v}
              </div>
            ))}
          </div>
        ) : null}
        {pay.notes.length > 0 ? (
          <div className="cop-bp-notes">
            {pay.notes.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        ) : null}
        {p.confirming && !p.applied ? (
          <div className="cop-bp-confirm">Replaces your current canvas · confirm apply</div>
        ) : null}
        {!gate.ok && !p.applied ? <div className="cop-bp-gate">{gate.reason}</div> : null}
        <button
          type="button"
          className={`cop-apply${p.applied ? " applied" : ""}${!gate.ok ? " gated" : ""}`}
          disabled={p.applied || !gate.ok}
          title={!gate.ok && gate.reason ? gate.reason : undefined}
          onClick={() => applyProposal(p)}
        >
          {p.applied ? "Applied" : !gate.ok ? "Apply locked" : p.confirming ? "Confirm apply" : "Apply"}
        </button>
      </div>
    );
  };

  return (
    <aside className="cp" onClick={(e) => e.stopPropagation()}>
      <div className="cp-head">
        <span className="cp-kicker">Copilot</span>
        <button
          type="button"
          className="hm-key panel-key"
          data-key="collapse"
          aria-label="Collapse copilot"
          onClick={onToggleCollapse}
        >
          ⟨
        </button>
      </div>

      <div className="cop-chat" ref={scrollRef}>
        {online === false ? (
          <div className="cop-offline">Copilot offline: no API key configured</div>
        ) : null}
        {online !== false && items.length === 0 ? (
          <div className="cop-hello">
            <div>
              Ask for a blueprint of the live loop or an explanation of its market. Proposals
              apply only when you press Apply.
            </div>
          </div>
        ) : null}
        {items.map((it, i) =>
          it.kind === "user" ? (
            <div key={i} className="cop-msg cop-msg--user">
              {it.text}
            </div>
          ) : (
            <div key={i} className="cop-msg cop-msg--assistant">
              {it.text ? <div className="cop-msg-text">{it.text}</div> : null}
              {it.proposal ? renderProposal(it.proposal) : null}
              {it.explain ? <ExplainCard row={it.explain.row} /> : null}
              {it.rejected ? <div className="cop-rejected">{it.rejected.reason}</div> : null}
              {it.register ? <div className="cop-register">{it.register}</div> : null}
            </div>
          ),
        )}
        {busy ? <div className="cop-register">…</div> : null}
      </div>

      {online && !atLimit && items.length === 0 ? (
        <div className="cop-chips">
          {STARTER_CHIPS.map((c) => (
            <button key={c} type="button" className="cop-chip" onClick={() => void send(c)}>
              {c}
            </button>
          ))}
        </div>
      ) : null}

      {atLimit ? (
        <div className="cop-limit">
          Session limit reached ·{" "}
          <button
            type="button"
            className="cop-chip"
            onClick={() => {
              rotateCopilotSession();
              setItems([]);
            }}
          >
            New session
          </button>
        </div>
      ) : null}

      <div className="cop-inputrow">
        <input
          type="text"
          className="cop-input"
          placeholder={online === false ? "copilot offline" : "ask the copilot"}
          value={input}
          disabled={!online || atLimit || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send(input);
          }}
        />
        <button
          type="button"
          className="cop-send"
          disabled={!online || atLimit || busy || !input.trim()}
          onClick={() => void send(input)}
        >
          Send
        </button>
      </div>

      <button
        type="button"
        className="panel-rail"
        onClick={onToggleCollapse}
        aria-label="Open copilot"
        title="Open copilot ( [ )"
      >
        <i className="panel-rail-icon" aria-hidden>
          ✳
        </i>
        <span>
          {unread ? <i className="hm-led lit" /> : null}
          Copilot
        </span>
        <span className="panel-rail-tip" aria-hidden>
          Open copilot ( [ )
        </span>
      </button>
    </aside>
  );
}
