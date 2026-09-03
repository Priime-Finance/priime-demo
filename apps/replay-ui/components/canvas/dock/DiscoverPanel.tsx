"use client";

/**
 * DiscoverPanel (IT4_DOCK_SPEC §3, mockup register 2026-08-20) — the market
 * catalog in the 360px context dock. The dock lists ALL scanned
 * opportunities as-is: no economics floor, no launchability fences, no
 * stale-scan wall-of-warnings. Hedged and unhedged stay separate sections
 * (ECON-M) and each card carries its class as a simple informational tag.
 * Every row is pickable; one serif status line carries the register.
 */

import { useMemo, useState } from "react";
import {
  type CanvasVenueId,
  selectionState,
  VENUE_LABELS,
} from "@/lib/canvas/opportunities";
import {
  buildUnifiedList,
  type ClassFilter,
  type UnifiedRow,
} from "@/lib/canvas/unified-list";
import type { ParamValue } from "@/lib/canvas/types";
import type { DiscoverReason } from "@/lib/canvas/dock-state";
import type { OpportunitiesPayload } from "../types";

const pct = (v: number | null | undefined) =>
  typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—";
const cap = (v: number | null | undefined) =>
  typeof v === "number" ? (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`) : "—";

/* DEMO SCOPE: one venue, so the filter row is a single chip beside "All". */
const VENUE_ORDER: CanvasVenueId[] = ["morpho-blue-base"];

export function discoverKicker(reason: DiscoverReason, laneLabel: string | null): string {
  if (reason === "empty") return "Pick your first market";
  if (reason === "add") return `Pick a market${laneLabel ? ` · ${laneLabel}` : ""}`;
  if (reason === "swap") return `Swap market${laneLabel ? ` · ${laneLabel}` : ""}`;
  return "Markets";
}

export default function DiscoverPanel({
  params,
  data,
  error,
  onSelect,
}: {
  /** The target lane's liquidity-source params (selection pin state). */
  params: Record<string, ParamValue>;
  data: OpportunitiesPayload | null;
  error: string | null;
  onSelect: (fields: Record<string, string>, row: UnifiedRow) => void;
}) {
  const [venueSet, setVenueSet] = useState<Set<CanvasVenueId> | null>(null); // null = all
  const [classFilter, setClassFilter] = useState<ClassFilter>("both");

  const venues = useMemo(() => data?.venues ?? [], [data]);

  const list = useMemo(
    () =>
      buildUnifiedList(venues, {
        venueFilter: venueSet ?? "all",
        classFilter,
      }),
    [venues, venueSet, classFilter],
  );

  // Selection pin against the SELECTED venue's doc — used only to highlight
  // the picked row; never to warn.
  const selDoc = useMemo(() => {
    const v = String(params.venue ?? "");
    return venues.find((d) => d.venue === v) ?? null;
  }, [venues, params]);
  const sel = useMemo(() => selectionState(params, selDoc), [params, selDoc]);
  const selectedId = sel.kind === "valid" || sel.kind === "doc-changed" ? sel.candidate.id : "";

  const toggleVenue = (v: CanvasVenueId) => {
    setVenueSet((prev) => {
      if (prev === null) return new Set([v]);
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next.size === 0 ? null : next;
    });
  };

  const toggleClass = (c: Exclude<ClassFilter, "both">) => {
    setClassFilter((prev) => (prev === c ? "both" : c));
  };

  const pick = (c: UnifiedRow) => {
    onSelect(
      {
        venue: c.venue,
        candidateId: c.id,
        pairLabel: c.pair,
        contentHash: c.contentHash,
        cls: c.cls,
        hlCoin: c.hlCoin ?? "",
      },
      c,
    );
  };

  const section = (title: string, rows: UnifiedRow[]) => (
    <div>
      <div className="mt-sec-h">{title}</div>
      {rows.map((c) => (
        <button
          key={c.id}
          className={`mt-card${selectedId === c.id ? " sel" : ""}`}
          onClick={() => pick(c)}
        >
          <span className="mt-pair">{c.pair}</span>
          <span className="mt-apy">{pct(c.headlineApr)}</span>
          <span className="mt-meta">
            <i className="mt-venuechip">{c.venueLabel}</i>
            <i className="mt-venuechip">{c.cls === "N1" ? "unhedged" : "hedged"}</i>
            <span>{cap(c.economics?.capacityUsd)} capacity</span>
          </span>
        </button>
      ))}
      {rows.length === 0 ? <div className="mt-empty">no markets in this section</div> : null}
    </div>
  );

  return (
    <div className="dock-discover" onClick={(e) => e.stopPropagation()}>
      <div className="mt-filters">
        <div
          role="button"
          tabIndex={0}
          className={`hm-key${venueSet === null ? " lit" : ""}`}
          data-key="all"
          onClick={() => setVenueSet(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setVenueSet(null);
          }}
        >
          <span className="hm-led" />
          All markets
        </div>
        {VENUE_ORDER.map((v) => (
          <div
            key={v}
            role="button"
            tabIndex={0}
            className={`hm-key${venueSet?.has(v) ? " lit" : ""}`}
            data-key={v}
            onClick={() => toggleVenue(v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") toggleVenue(v);
            }}
          >
            <span className="hm-led" />
            {VENUE_LABELS[v]}
          </div>
        ))}
      </div>
      <div className="mt-filters mt-filters--class">
        <div
          role="button"
          tabIndex={0}
          className={`hm-key${classFilter === "hedged" ? " lit" : ""}`}
          data-key="hedged"
          onClick={() => toggleClass("hedged")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") toggleClass("hedged");
          }}
        >
          <span className="hm-led" />
          Hedged
        </div>
        <div
          role="button"
          tabIndex={0}
          className={`hm-key${classFilter === "unhedged" ? " lit" : ""}`}
          data-key="unhedged"
          onClick={() => toggleClass("unhedged")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") toggleClass("unhedged");
          }}
        >
          <span className="hm-led" />
          Unhedged
        </div>
      </div>

      <div className="mt-status">Every number modeled from the latest scan.</div>

      {error ? <div className="mt-empty">{error}</div> : null}
      {!data && !error ? <div className="mt-empty">loading markets…</div> : null}

      {data ? (
        <div className="mt-body">
          {classFilter !== "unhedged" ? section("Hedged (delta-neutral)", list.hedged) : null}
          {classFilter !== "hedged" ? section("Unhedged", list.unhedged) : null}
        </div>
      ) : null}
    </div>
  );
}
