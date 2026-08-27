/**
 * Wiring tests for the journal source the engine hangs off. Kept small on
 * purpose — the substance is in replay.test.ts and format.test.ts.
 */
import { describe, expect, it } from "vitest";

import { strikeSabotage, strikeSettled } from "@/lib/journal";
import { STRIKE_IDS, StaticJournalSource, StrikeNotFoundError } from "@/lib/source";

describe("StaticJournalSource", () => {
  const source = new StaticJournalSource();

  it("lists both captures with status and label", async () => {
    const refs = await source.list();
    expect(refs.map((ref) => ref.strikeId)).toEqual([
      STRIKE_IDS.settled,
      STRIKE_IDS.sabotage,
    ]);
    expect(refs.every((ref) => ref.status === "settled")).toBe(true);
    expect(refs.every((ref) => ref.label.length > 0)).toBe(true);
  });

  it("gets each journal by strike_id", async () => {
    await expect(source.get(STRIKE_IDS.settled)).resolves.toBe(strikeSettled);
    await expect(source.get(STRIKE_IDS.sabotage)).resolves.toBe(strikeSabotage);
  });

  it("rejects an unknown strike_id", async () => {
    await expect(source.get("nope")).rejects.toBeInstanceOf(StrikeNotFoundError);
  });
});
