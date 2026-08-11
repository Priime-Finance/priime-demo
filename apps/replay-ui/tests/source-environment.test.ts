/**
 * Wiring tests for the pieces the engine hangs off: the journal source and the
 * environment sidecar. Kept small on purpose — the substance is in
 * replay.test.ts and format.test.ts.
 */
import { describe, expect, it } from "vitest";

import { componentDigestMatches, demoEnvironment, peerStatusFor, registryEntryFor } from "@/lib/environment";
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

describe("environment fixture", () => {
  it("is versioned and flags its placeholder registry address", () => {
    expect(demoEnvironment.fixture_version).toBe("1.0.0");
    expect(demoEnvironment.registry.contract_address_is_placeholder).toBe(true);
    expect(demoEnvironment._fixture).toMatch(/NOT PART OF THE FROZEN JOURNAL SCHEMA/);
  });

  it("registers all three operators from the captures, weight 1 each", () => {
    for (const operator of strikeSabotage.operators) {
      const entry = registryEntryFor(operator.id);
      expect(entry).not.toBeNull();
      expect(entry!.weight).toBe(1);
      expect(entry!.registered_block).toBeLessThan(strikeSabotage.inputs_block);
    }
    expect(demoEnvironment.registry.operators).toHaveLength(3);
  });

  it("gives every node an mDNS peer id connected to the other two", () => {
    expect(demoEnvironment.p2p.discovery).toBe("mdns");
    for (const operator of strikeSettled.operators) {
      const peer = peerStatusFor(operator.id);
      expect(peer).not.toBeNull();
      expect(peer!.connected_peers).toHaveLength(2);
      expect(peer!.connected_peers).not.toContain(peer!.peer_id);
    }
  });

  it("cross-checks the component digest against both captures", () => {
    expect(componentDigestMatches(strikeSettled)).toBe(true);
    expect(componentDigestMatches(strikeSabotage)).toBe(true);
    expect(
      componentDigestMatches({ ...strikeSettled, component_digest: "sha256:deadbeef" }),
    ).toBe(false);
  });
});
