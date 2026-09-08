/**
 * Journal source: where the replay UI gets its NAV strikes from.
 *
 * One interface, two eventual implementations. `StaticJournalSource` (here)
 * serves the two frozen captures in `schema/samples/`; a future
 * `PollingJournalSource` will `fetch` the same shapes from the live
 * aggregator API. Both are async and snapshot-based, so no consumer changes
 * when the second one lands — see the contract notes on `JournalSource`.
 */
import type { Journal, Status } from "@priime-demo/journal-schema";

import { strikeSabotage, strikeSettled } from "@/lib/journal";

/** Lightweight strike descriptor for pickers/lists; no operator detail. */
interface StrikeRef {
  /** `Journal.strike_id`; the key `JournalSource.get` takes. */
  strikeId: string;
  /** Lifecycle at the time `list()` was called (a live source may advance it). */
  status: Status;
  /** Human label for a selector ("Validate — honest 3-of-3"). */
  label: string;
}

/**
 * Read-only access to NAV-strike journals.
 *
 * Contract every implementation must honour (so the polling source is a
 * drop-in):
 * - Both methods are async and may hit the network.
 * - Returned values are **immutable snapshots**. A live strike is still
 *   growing (operators arrive, quorum fills, attestation lands), so callers
 *   must re-`get()` to see progress rather than cache and mutate.
 * - `get()` may return a `pending`/`stalled` journal with null attestation
 *   fields and an unreached quorum. The replay engine handles that.
 * - `list()` may return more refs over time and a ref's `status` may change.
 * - `get()` rejects with `StrikeNotFoundError` for an unknown id.
 */
interface JournalSource {
  /** All strikes this source knows about, newest-relevant order preserved. */
  list(): Promise<readonly StrikeRef[]>;
  /** Fetch one strike snapshot by `strike_id`. */
  get(strikeId: string): Promise<Journal>;
}

/** Thrown by `JournalSource.get` when the id is not known to the source. */
export class StrikeNotFoundError extends Error {
  /** The `strike_id` that was not found. */
  readonly strikeId: string;

  /** @param strikeId the unknown `strike_id`. */
  constructor(strikeId: string) {
    super(`Unknown strike_id: ${strikeId}`);
    this.name = "StrikeNotFoundError";
    this.strikeId = strikeId;
  }
}

/** A journal plus the selector label to show for it. */
interface StaticJournalEntry {
  /** The captured journal. */
  journal: Journal;
  /** Selector label; falls back to the strike id when omitted. */
  label: string;
}

/**
 * The two captured runs that back the demo, in demo order.
 *
 * Both are **real captures**: the sabotage run is a recording of a node that
 * actually reported a divergent NAV, not a client-side mutation of the
 * settled run.
 */
export const DEMO_JOURNALS: readonly StaticJournalEntry[] = [
  { journal: strikeSettled, label: "Validate, honest 3-of-3" },
  { journal: strikeSabotage, label: "Sabotage, operator 3 diverges" },
];

/** Strike ids of the two demo captures, for deep links into `/debug` and tests. */
export const STRIKE_IDS = {
  /** The honest run: three identical hashes, quorum fills to 3-of-3. */
  settled: strikeSettled.strike_id,
  /** The corrupted-operator run: honest 2-of-3 settles, node 3 rejected. */
  sabotage: strikeSabotage.strike_id,
} as const;

/**
 * `JournalSource` over a fixed set of captured journals (the Vercel replay
 * path: "record real, replay beautifully"). Async purely to match the
 * interface; it never touches the network.
 */
export class StaticJournalSource implements JournalSource {
  readonly #entries: readonly StaticJournalEntry[];

  /** @param entries journals to serve, in list order. Defaults to `DEMO_JOURNALS`. */
  constructor(entries: readonly StaticJournalEntry[] = DEMO_JOURNALS) {
    this.#entries = entries;
  }

  /** @inheritdoc */
  // Async with nothing to await, deliberately: the interface is async so a
  // polling source can implement it, and `async` also turns the throw in
  // `get` into a rejected promise rather than a synchronous one. Dropping it
  // would change what callers have to catch.
  // eslint-disable-next-line @typescript-eslint/require-await
  async list(): Promise<readonly StrikeRef[]> {
    return this.#entries.map((entry) => ({
      strikeId: entry.journal.strike_id,
      status: entry.journal.status,
      label: entry.label,
    }));
  }

  /** @inheritdoc */
  // eslint-disable-next-line @typescript-eslint/require-await -- see `list`
  async get(strikeId: string): Promise<Journal> {
    const entry = this.#entries.find((e) => e.journal.strike_id === strikeId);
    if (entry === undefined) throw new StrikeNotFoundError(strikeId);
    return entry.journal;
  }
}
