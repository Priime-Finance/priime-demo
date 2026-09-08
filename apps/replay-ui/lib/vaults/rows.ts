/**
 * Resolution layer: turning the captured journals into the numbers the vault
 * page renders.
 *
 * One vault, one source of truth per register. The record comes from
 * `hero.ts` / `store.ts` and is modeled; the NAV, the share price and the
 * strike ledger come from the journals and are attested. `hero.ts` reads the
 * NAV from here, so this file imports nothing from it.
 * Journals are read through `lib/source.ts` only.
 */

import type { Journal } from "@priime-demo/journal-schema";

import { DEMO_JOURNALS } from "@/lib/source";

import { HERO_SHARES_OUTSTANDING, settlingStrike, strikeRows, type StrikeRow } from "./attested";

/** The captured strikes backing the vault, newest first. */
export function heroStrikes(): StrikeRow[] {
  return strikeRows(
    DEMO_JOURNALS.map((entry) => entry.journal),
    HERO_SHARES_OUTSTANDING,
  );
}

/** The attested NAV per share the vault currently reports, or null pre-settlement. */
export function heroNavPerShare(): number | null {
  return settlingStrike(heroStrikes())?.navPerShare ?? null;
}

/** The attested NAV the vault currently reports, or null pre-settlement. */
export function heroNavUsd(): number | null {
  return settlingStrike(heroStrikes())?.navUsd ?? null;
}

/**
 * The captured journal a deposit request settles against: the newest capture
 * that actually settled. Null when none has, in which case the UI must not
 * quote a price at all.
 */
export function heroSettlingJournal(): Journal | null {
  const settled = DEMO_JOURNALS.map((e) => e.journal)
    .filter((j) => j.status === "settled" && j.attestation.nav_final !== null)
    .sort((a, b) => b.trigger.block - a.trigger.block);
  return settled[0] ?? null;
}
