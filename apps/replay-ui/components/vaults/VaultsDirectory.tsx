"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * /vaults: the discovery floor. One live record, the attested USDe/USDC loop,
 * first whatever the sort; seven coming-soon cards behind it in the register
 * `lib/demo-scope.ts` owns (docs/plans/LATEST_UI_PORT_SPEC.md B.2, WP4.10);
 * the blank-canvas invite last. Filterable by strategy family, sortable by
 * modeled APY / TVL / age within the coming-soon partition.
 *
 * SSR contract: the server renders the seed catalog with filter=all,
 * sort=apy, both deterministic, so hydration never mismatches on structure.
 * localStorage-derived numerals carry suppressHydrationWarning and refresh on
 * the post-mount reload.
 *
 * DEPLOYED LOOPS (integration decision D2: one vault page). A loop
 * loop-server actually deployed is a record on this floor too, and it gets
 * Antoni's card, not a section of its own: the register is carried by what
 * the card SAYS, not by parking it below the grid under a different
 * stylesheet. Its headline is the strike cadence rather than an APY, because
 * a deployment publishes a cadence and does not publish an APY. It sorts
 * ahead of every seeded record under every key: a thing that is running
 * outranks a thing that was priced. The fetch is post-mount and its failure
 * is silent by design (a 502 is the expected state with loop-server down), so
 * the server render and the first client render are the seed catalog exactly
 * as they were before this lane.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { LoopRecord } from "@priime-demo/loop-deploy";
import { truncateAddress } from "@/lib/format";
import { fetchLoops } from "@/lib/vaults/live-source";
import { cadenceText, marketWords, readLoopConfig } from "./live-loop";
import { SEED_VAULTS } from "@/lib/vaults/seeds";
import { useBuildHref } from "@/lib/host";
import { COMING_SOON } from "@/lib/demo-scope";
import { automationCountFor } from "@/lib/vaults/hero";
import { heroNavPerShare, heroNavUsd, heroStrikes } from "@/lib/vaults/rows";
import { apyDisplayable, capacityReading, depositCeiling } from "./DepositRail";
import { collarForfeitForVault } from "./AutomationsSection";
import { collarForfeitLine } from "@/lib/canvas/templates";
import { isModeledBinding } from "@/lib/canvas/capacity";
import {
  fmtPct,
  fmtUsd,
  INCUBATING_FILTER_LABEL,
  loadUserVaults,
  recordVenueLine,
  VAULT_STAGE_LABEL,
  VAULTS_EVENT,
  vaultStage,
  vaultTvlUsd,
  type StrategyKind,
  type VaultRecord,
} from "@/lib/vaults/store";
import { useCountUp } from "./useCountUp";
import { useInView } from "./useInView";
import { MarketWord } from "./MarketWord";

/** `incubating` and `deployed` join the two non-strategy cohorts. Like `mine`,
 *  their chips are rendered only while at least one record is in them, so the
 *  bar never offers a filter that empties the grid. */
type DirFilter = "all" | "mine" | "incubating" | "deployed" | StrategyKind;
type DirSort = "apy" | "tvl" | "new";

/** Stable chip order for the known strategy kinds; the rendered chip list
 *  DERIVES from the catalog (union of strategyLabels), so a new kind (e.g.
 *  a published treasury collar) earns its chip the moment one exists. */
const STRATEGY_ORDER: StrategyKind[] = ["loop", "funding", "dnlp", "collar"];

const SORTS: { key: DirSort; label: string }[] = [
  { key: "apy", label: "Modeled APY" },
  { key: "tvl", label: "TVL" },
  { key: "new", label: "Newest" },
];

/**
 * THE REGISTER, per record. A record is live when it is the attested one
 * (`stage === "attested"`, the one slug the store publishes onto) or the
 * reader's own; every other record is coming soon (A.2).
 */
export function isLiveRecord(v: Pick<VaultRecord, "stage" | "register" | "mine">): boolean {
  return vaultStage(v) === "attested" || v.mine === true;
}

/**
 * The directory order: the live record first whatever the key, then the
 * coming-soon cards by the chosen key. Pure and exported so the partition is
 * pinned: no coming-soon card above the hero under any sort.
 */
export function partitionForDirectory(
  vaults: readonly VaultRecord[],
  by: (a: VaultRecord, b: VaultRecord) => number,
): VaultRecord[] {
  const live = vaults.filter(isLiveRecord).sort(by);
  const soon = vaults.filter((v) => !isLiveRecord(v)).sort(by);
  return [...live, ...soon];
}

/** Mono count riding a filter chip; one-shot pulse when the number moves. */
function CountBadge({ n }: { n: number }) {
  const prev = useRef(n);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (prev.current !== n) {
      prev.current = n;
      setPulse((p) => p + 1);
    }
  }, [n]);
  return (
    <span key={pulse} className={`vx-chip-n${pulse > 0 ? " vx-chip-n--pulse" : ""}`}>
      {n}
    </span>
  );
}

/** Per-strategy watermark: loop spiral / funding sine / DN-LP bell /
 *  collar channel (price wave held between cap and floor rails). */
function StrategyGlyph({ kind }: { kind: StrategyKind }) {
  const d =
    kind === "loop"
      ? "M12 14a2 2 0 0 1 4 0a4 4 0 0 1-8 0a6 6 0 0 1 12 0a8 8 0 0 1-16 0a10 10 0 0 1 20 0"
      : kind === "funding"
        ? "M3 14c3.7-9 7.3-9 11 0s7.3 9 11 0"
        : kind === "collar"
          ? "M3 7.5h22M3 20.5h22M3 14c3.7-4.5 7.3 3.5 11 0s7.3-3.5 11 .5"
          : "M3 21.5c6 0 7.2-14.5 11-14.5s5 14.5 11 14.5";
  return (
    <svg className="vx-card-glyph" viewBox="0 0 28 28" width="28" height="28" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke="#141414"
        strokeOpacity="0.14"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The strip's honest day-zero state (recette DL-3), and the coming-soon
 * card's slot (F.3): the slot states the fact in the caption register in
 * place of a curve. Exported for /portfolio's position strip, which shares
 * the treatment.
 */
export function SparkInception({ note }: { note: string }) {
  return (
    <span className="vx-ds-none">
      <i>{note}</i>
    </span>
  );
}

/**
 * The hero numeral. Server + first client render show the target (no
 * mismatch, no 0.0% below the fold); once hydrated and first in view it
 * counts up from zero. Reduced motion lands on the target immediately
 * (useCountUp handles it). The modeled APY is the only number on the live
 * card that counts.
 *
 * Sign- and validity-aware: a modelled loss is never dressed as a yield
 * (the register changes with the sign), and a record that never priced
 * prints no number at all rather than a confident wrong one.
 */
function ApyHero({ apy, ok, live, inView }: { apy: number; ok: boolean; live: boolean; inView: boolean }) {
  const counted = useCountUp(inView && ok ? apy : 0, 850);
  const shown = live && inView ? counted : apy;
  if (!ok) {
    return (
      <div className="vx-card-apy">
        <b>—</b>
        <i>not modeled</i>
      </div>
    );
  }
  return (
    <div className="vx-card-apy">
      <b>{fmtPct(shown)}</b>
      <i>{apy < 0 ? "modeled annual change" : "modeled APY"}</i>
    </div>
  );
}

/**
 * A coming-soon card (B.2): a group, not a link; name and market line at .62
 * through the one CSS owner, the tag de-blued, the APY de-greened with its
 * `modeled APY` caption, no sparkline, no capacity bar, no TVL or share
 * value cell; `Automations` only; `Curated by` + the tag in the chip slot.
 * The entrance cascade stays; only the response to the hand is withheld.
 */
function ComingSoonCard({ v, i }: { v: VaultRecord; i: number }) {
  const apyOk = apyDisplayable(v);
  return (
    <div
      role="group"
      data-soon
      tabIndex={-1}
      aria-disabled="true"
      aria-label={`${v.name}, ${COMING_SOON.prose}`}
      className="vx-card vx-card--dir"
      style={{ "--i": Math.min(i, 11) } as CSSProperties}
    >
      <StrategyGlyph kind={v.strategy} />
      <div className="vx-card-top">
        <span className="vx-card-name">{v.name}</span>
        <span className="vx-tag" data-soon-chip>
          {v.strategyLabel}
        </span>
      </div>
      <span className="vx-card-mkt">
        <MarketWord market={v.market} /> · {recordVenueLine(v)}
      </span>
      {apyOk ? (
        <div className="vx-card-apy">
          <b data-soon-num>{fmtPct(v.modeledApy)}</b>
          <i>{v.modeledApy < 0 ? "modeled annual change" : "modeled APY"}</i>
        </div>
      ) : (
        <div className="vx-card-apy">
          <b>—</b>
          <i>not modeled</i>
        </div>
      )}
      <div className="vx-ds-slot">
        <SparkInception note={COMING_SOON.prose} />
      </div>
      <div className="vx-card-rows">
        <span className="vx-cell">
          <i>Automations</i>
          <b>{v.automations ? [v.automations.leverage, v.automations.hedge, v.automations.compound].filter(Boolean).length : 0}</b>
        </span>
      </div>
      <div className="vx-card-cur">
        <span>
          Curated by <b>{v.curator}</b>
        </span>
        <span className="soon-tag">{COMING_SOON.label}</span>
      </div>
    </div>
  );
}

/**
 * The live card: the full live anatomy over the attested cells. NAV and
 * share value are read off the journal through `lib/vaults/rows.ts`, never
 * counted; the strip states the strikes instead of drawing a modeled walk.
 */
function LiveCard({ v, i, live }: { v: VaultRecord; i: number; live: boolean }) {
  const { ref, inView } = useInView<HTMLAnchorElement>();
  const apyOk = apyDisplayable(v);
  /* QNT-3: the collar's headline never prints without the upside it was
     paid for: the ledger's ruling, at this record's own dials. Null off the
     collar family, so every other card is byte for byte what it was. */
  const forfeit = apyOk && v.strategy === "collar" ? collarForfeitForVault(v) : null;
  // Read through the same ceiling the deposit rail is held to: the card
  // never advertises a vault that cannot take a deposit.
  const tvl = vaultTvlUsd(v);
  const ceiling = depositCeiling(v, tvl);
  // The same reading the vault page's headline bar prints, so a full vault is
  // legible here before the click and the two surfaces cannot disagree.
  const cap = capacityReading(ceiling, tvl);
  const stage = vaultStage(v);
  const navUsd = heroNavUsd();
  const navPerShare = heroNavPerShare();
  const strikes = heroStrikes().filter((s) => s.navPerShare !== null).length;
  return (
    <a
      ref={ref}
      className={`vx-card vx-card--dir${v.mine ? " vx-card--mine" : ""}`}
      href={`/vaults/${v.slug}`}
      style={{ "--i": Math.min(i, 11) } as CSSProperties}
    >
      <StrategyGlyph kind={v.strategy} />
      <div className="vx-card-top">
        <span className="vx-card-name">{v.name}</span>
        <span className={`vx-tag${v.mine ? " vx-tag--mine" : ""}`}>{v.strategyLabel}</span>
      </div>
      <span className="vx-card-mkt">
        <MarketWord market={v.market} /> · {recordVenueLine(v)}
      </span>
      <ApyHero apy={v.modeledApy} ok={apyOk} live={live} inView={inView} />
      {forfeit ? <span className="vx-card-forfeit">{collarForfeitLine(forfeit)}</span> : null}
      <div className="vx-ds-slot">
        <SparkInception
          note={
            navPerShare === null
              ? "awaiting strike"
              : `${strikes} attested ${strikes === 1 ? "strike" : "strikes"} at ${navPerShare.toFixed(4)}`
          }
        />
      </div>
      {/* Glance capacity: same reading, 4px instrument. No draw-in. Absent
          (not zeroed) when the record carries no reconciled capacity. */}
      {cap ? (
        <div className={`vxcap vxcap--mini${cap.full ? " vxcap--full" : ""}`}>
          <div className="vxcap-head">
            <i suppressHydrationWarning>{cap.head}</i>
            <span className="vxcap-bind" suppressHydrationWarning>
              {cap.pct} of {cap.totalUsd}
              {isModeledBinding(v.capacityBinding) ? " modeled" : ""}
            </span>
          </div>
          <div
            className="vxcap-track"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(cap.frac * 100)}
            aria-valuetext={`${cap.pct} of ${cap.totalUsd} capacity used`}
            suppressHydrationWarning
          >
            <span
              className="vxcap-fill"
              style={{ width: `max(2px, ${(cap.frac * 100).toFixed(2)}%)` }}
              suppressHydrationWarning
              aria-hidden
            />
          </div>
        </div>
      ) : null}
      <div className="vx-card-rows">
        <span className="vx-cell">
          <i>NAV, attested</i>
          <b>{navUsd === null ? "awaiting strike" : fmtUsd(navUsd)}</b>
        </span>
        <span className="vx-cell">
          <i>Share value, derived</i>
          <b>{navPerShare === null ? "awaiting strike" : navPerShare.toFixed(4)}</b>
        </span>
        <span className="vx-cell">
          <i>Automations</i>
          <b>{automationCountFor(v)}</b>
        </span>
      </div>
      <div className="vx-card-cur">
        <span>
          Curated by <b>{v.curator}</b>
        </span>
        {/* The chip is the stage's own string, from the one declaration the
            record header reads (`VAULT_STAGE_LABEL`), in `.vx-status`. */}
        {stage === "attested" ? (
          <span className="vx-status">{VAULT_STAGE_LABEL.attested}</span>
        ) : stage === "incubating" ? (
          <span className="vx-card-stage">{VAULT_STAGE_LABEL.incubating}</span>
        ) : ceiling.full ? (
          <span suppressHydrationWarning>At capacity</span>
        ) : (
          <span className="vx-card-live">Live</span>
        )}
      </div>
    </a>
  );
}

function VaultCard({ v, i, live }: { v: VaultRecord; i: number; live: boolean }) {
  if (!isLiveRecord(v)) return <ComingSoonCard v={v} i={i} />;
  return <LiveCard v={v} i={i} live={live} />;
}

/**
 * A DEPLOYED loop's card: the same anatomy, filled only with facts
 * loop-server stored.
 *
 * The headline slot holds the STRIKE CADENCE. The slot is the card's biggest
 * number and on every other card it holds a modeled APY; a deployment has no
 * modeled APY, and the honest options were to leave the slot empty or to give
 * it the loudest thing the server does know. The cadence is that thing, and
 * its caption names it, so the slot never reads as a yield.
 *
 * NO NAV ON THE CARD, on purpose. The NAV is attested and would be the better
 * headline, but it lives in the journal feed, one request per loop; a
 * directory that fanned out N journal requests to fill N cards would make the
 * floor's load time a function of how many loops exist. The NAV is one click
 * away on the loop's own page, where a single feed answers for it.
 *
 * The strip slot states what it is NOT drawing. A blank there would read as a
 * curve that has not loaded.
 */
function DeployedLoopCard({ loop, i }: { loop: LoopRecord; i: number }) {
  const config = readLoopConfig(loop.configJson);
  const candidateId = config?.candidateId ?? null;
  const market = candidateId === null ? null : marketWords(candidateId);
  const cronSeconds = config?.cronSeconds ?? null;
  const cadence = cronSeconds === null ? null : cadenceText(cronSeconds);
  return (
    <a
      className="vx-card vx-card--dir"
      href={`/vaults/${loop.id}`}
      style={{ "--i": Math.min(i, 11) } as CSSProperties}
    >
      <StrategyGlyph kind="loop" />
      <div className="vx-card-top">
        <span className="vx-card-name">{loop.name}</span>
        <span className="vx-tag">Deployed</span>
      </div>
      <span className="vx-card-mkt">
        {market === null ? (
          "market as configured"
        ) : (
          <>
            <MarketWord market={market.pair} /> · {market.venue}
          </>
        )}
      </span>
      {/* Absent, not zeroed, on the one shape that cannot happen through the
          server's own validator: a stored config with no cadence in it. */}
      {cadence === null ? null : (
        <div className="vx-card-apy">
          <b>{cadence}</b>
          <i>strike cadence</i>
        </div>
      )}
      <div className="vx-ds-slot">
        <SparkInception note="attested on chain, no modeled curve" />
      </div>
      <div className="vx-card-rows">
        <span className="vx-cell">
          <i>Loop id</i>
          <b>{loop.id}</b>
        </span>
        <span className="vx-cell">
          <i>Handler</i>
          <b>{loop.handlerAddress === null ? "pending" : truncateAddress(loop.handlerAddress)}</b>
        </span>
        <span className="vx-cell">
          <i>Status</i>
          <b>{loop.status}</b>
        </span>
      </div>
      <div className="vx-card-cur">
        <span>
          Strategist <b>{truncateAddress(loop.strategist)}</b>
        </span>
        {/* The green heartbeat is granted to `active` only. A deploy still
            walking its steps, or one that failed, says which in the neutral
            stage pill rather than borrowing the live chip. */}
        {loop.status === "active" ? (
          <span className="vx-card-live">Live</span>
        ) : (
          <span className="vx-card-stage">{loop.status}</span>
        )}
      </div>
    </a>
  );
}

export default function VaultsDirectory() {
  const buildHref = useBuildHref();
  const [vaults, setVaults] = useState<VaultRecord[]>(SEED_VAULTS);
  /* Deployed loops, newest first. Empty on the server render and until the
     first fetch answers, which is also the resting state when loop-server is
     down: the floor is the seed catalog, exactly as it was. */
  const [loops, setLoops] = useState<LoopRecord[]>([]);
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState<DirFilter>("all");
  const [sort, setSort] = useState<DirSort>("apy");
  const [interacted, setInteracted] = useState(false);

  useEffect(() => {
    // The published record writes onto the live slug: it REPLACES the seed
    // at that slug rather than sitting beside it.
    const load = () => {
      const mine = loadUserVaults();
      const taken = new Set(mine.map((v) => v.slug));
      setVaults([...mine, ...SEED_VAULTS.filter((v) => !taken.has(v.slug))]);
    };
    load();
    setLive(true);
    window.addEventListener(VAULTS_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(VAULTS_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  /* The deployed loops, once. A 502 is the EXPECTED answer with loop-server
     paused, so the failure is silent: the floor keeps the seed catalog rather
     than showing a reader an error about a backend they did not ask about.
     Sorted newest first, which is the order a builder who just published
     wants: their loop is the first card on the page. */
  useEffect(() => {
    let alive = true;
    fetchLoops()
      .then((r) => {
        if (alive) setLoops([...r.loops].sort((a, b) => b.createdAt - a.createdAt));
      })
      .catch(() => {
        if (alive) setLoops([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: vaults.length + loops.length,
      mine: 0,
      incubating: 0,
      deployed: loops.length,
    };
    for (const v of vaults) {
      c[v.strategy] = (c[v.strategy] ?? 0) + 1;
      if (v.mine) c.mine += 1;
      if (vaultStage(v) === "incubating") c.incubating += 1;
    }
    return c;
  }, [vaults, loops]);

  // Chips derive from the catalog: All + one chip per strategy kind that
  // actually exists, labeled by the kind's own strategyLabel. Strategy chips
  // count coming-soon cards too; no `Live` chip is added (B.2).
  const filters = useMemo(() => {
    const labels = new Map<StrategyKind, string>();
    for (const v of vaults) if (!labels.has(v.strategy)) labels.set(v.strategy, v.strategyLabel);
    return [
      { key: "all" as const, label: "All" },
      ...STRATEGY_ORDER.filter((k) => labels.has(k)).map((k) => ({ key: k, label: labels.get(k)! })),
    ];
  }, [vaults]);

  const shown = useMemo(() => {
    const filtered =
      filter === "all"
        ? vaults
        : filter === "mine"
          ? vaults.filter((v) => v.mine)
          : filter === "incubating"
            ? vaults.filter((v) => vaultStage(v) === "incubating")
            : filter === "deployed"
              ? []
              : vaults.filter((v) => v.strategy === filter);
    const by: Record<DirSort, (a: VaultRecord, b: VaultRecord) => number> = {
      apy: (a, b) => b.modeledApy - a.modeledApy,
      tvl: (a, b) => vaultTvlUsd(b) - vaultTvlUsd(a),
      new: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    };
    return partitionForDirectory(filtered, by[sort]);
  }, [vaults, filter, sort]);

  /* THE DEPLOYED LOOPS ARE NOT SORTED WITH THE CATALOG, and cannot be: every
     sort key here reads a modeled field (`modeledApy`, `vaultTvlUsd`) that a
     deployment does not have, and a record with no APY sorted by APY lands
     wherever `undefined` lands. They keep their own order, newest first, and
     they lead. A `deployed` filter shows them alone; a strategy filter is a
     question about a composition and shows none of them. */
  const shownLoops = filter === "all" || filter === "deployed" ? loops : [];

  // The count line, each number from its owner: live records from the stage,
  // the NAV from the journal, coming soon from the register.
  const liveCount = useMemo(() => vaults.filter(isLiveRecord).length, [vaults]);
  const soonCount = vaults.length - liveCount;
  const navUsd = heroNavUsd();

  const pickFilter = (f: DirFilter) => {
    setFilter(f);
    setInteracted(true);
  };
  const pickSort = (s: DirSort) => {
    setSort(s);
    setInteracted(true);
  };

  return (
    <div className="vx-root">
      <div className="vx-head">
        <div>
          <span className="vx-kicker">Built with Priime</span>
          <h1 className="vx-title">Vaults</h1>
          <p className="vx-sub">
            Every vault composed and published with Priime Build. All performance numbers are modeled. The
            NAV and share value are attested off the journal.
          </p>
          <p className="vx-dir-stats" suppressHydrationWarning>
            {/* A sentence with three figures in it: the words are the sans and
                each figure claims `.num` back. */}
            <b className="num">{liveCount}</b> live {liveCount === 1 ? "vault" : "vaults"} ·{" "}
            {navUsd === null ? (
              "awaiting strike"
            ) : (
              <>
                <b className="num">{fmtUsd(navUsd)}</b> attested NAV
              </>
            )}{" "}
            · <b className="num">{soonCount}</b> {COMING_SOON.prose}
            {/* The deployed clause joins the sentence only once a deployment
                exists, so the line is unchanged with loop-server down. It is
                its own clause rather than folded into the live count: those
                are attested captures, these are running deployments, and one
                figure cannot answer for both. */}
            {loops.length > 0 ? (
              <>
                {" "}
                · <b className="num">{loops.length}</b> deployed{" "}
                {loops.length === 1 ? "loop" : "loops"}
              </>
            ) : null}
          </p>
        </div>
        <a className="vx-cta" href={buildHref}>
          Create vault
        </a>
      </div>

      <div className="vx-dir-bar">
        <div className="vx-dir-chips" role="group" aria-label="Filter by strategy">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`vx-chip${filter === f.key ? " on" : ""}`}
              aria-pressed={filter === f.key}
              onClick={() => pickFilter(f.key)}
            >
              {f.label}
              <CountBadge n={counts[f.key] ?? 0} />
            </button>
          ))}
          {counts.mine > 0 ? (
            <button
              type="button"
              className={`vx-chip${filter === "mine" ? " on" : ""}`}
              aria-pressed={filter === "mine"}
              onClick={() => pickFilter("mine")}
            >
              Yours
              <CountBadge n={counts.mine} />
            </button>
          ) : null}
          {counts.incubating > 0 ? (
            <button
              type="button"
              className={`vx-chip${filter === "incubating" ? " on" : ""}`}
              aria-pressed={filter === "incubating"}
              onClick={() => pickFilter("incubating")}
            >
              {INCUBATING_FILTER_LABEL}
              <CountBadge n={counts.incubating} />
            </button>
          ) : null}
          {/* Same idiom as Yours and the incubating chip: rendered only while
              the cohort has something in it, so the bar never offers a filter
              that empties the grid. With loop-server down it is not there. */}
          {counts.deployed > 0 ? (
            <button
              type="button"
              className={`vx-chip${filter === "deployed" ? " on" : ""}`}
              aria-pressed={filter === "deployed"}
              onClick={() => pickFilter("deployed")}
            >
              Deployed
              <CountBadge n={counts.deployed} />
            </button>
          ) : null}
        </div>
        <div className="vx-dir-sort">
          <i className="vx-dir-sort-k">sort</i>
          <div className="vx-seg" role="group" aria-label="Sort vaults">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={sort === s.key ? "on" : ""}
                aria-pressed={sort === s.key}
                onClick={() => pickSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Keyed on the active view so a filter/sort change remounts the
          cards and the cascade re-runs (faster on re-entry via
          .vx-grid--re; the mine bloom stays first-load-only). */}
      <div key={`${filter}-${sort}`} className={`vx-grid${interacted ? " vx-grid--re" : ""}`}>
        {/* Deployed loops lead the grid: the cascade index continues into the
            catalog below so the entrance reads as one wave, not two. */}
        {shownLoops.map((loop, i) => (
          <DeployedLoopCard key={loop.id} loop={loop} i={i} />
        ))}
        {shown.length === 0 && shownLoops.length === 0 ? (
          <div className="vx-dir-empty">
            <i>Nothing here yet.</i>
            <button type="button" className="vx-chip" onClick={() => pickFilter("all")}>
              Show all
            </button>
          </div>
        ) : (
          shown.map((v, i) => (
            <VaultCard key={v.slug} v={v} i={i + shownLoops.length} live={live} />
          ))
        )}
        {/* The blank-canvas invite: always last, excluded from counts. */}
        <a
          className="vx-card vx-card--new"
          href={buildHref}
          style={{ "--i": Math.min(shown.length + shownLoops.length, 11) } as CSSProperties}
        >
          <i>Your strategy belongs here</i>
          <span className="vx-cta">Compose a vault</span>
        </a>
      </div>
    </div>
  );
}
