import { describe, expect, it } from "vitest";

import { buildJournal, deriveServiceId, deriveStrikeId, type JournalBuildInput } from "../src/journal.ts";

const MANAGER = "0x7d222a90b9c473fb75b5bebad41ad63f1c3a4ed5";
const VAULT = "0xee942e9848af8d0129ad445b8c2eb6d694d7630a";
const CHAIN_KEY = "evm:31337";

function baseInput(overrides: Partial<JournalBuildInput> = {}): JournalBuildInput {
  return {
    chainId: 31337,
    chainKey: CHAIN_KEY,
    managerAddress: MANAGER,
    vaultAddress: VAULT,
    componentDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    navAsset: "USDC",
    navDecimals: 6,
    quorumThreshold: 2,
    quorumTotal: 3,
    eventId: "0x1a49ee4bc1cd6d0dab48596c589b00ad949f429d",
    inputsBlock: 49911495n,
    navFinal: 500_000_000n,
    payload: "0x00",
    resultHash: "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    acceptedSigners: [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
    ],
    signatures: [
      "0xaa",
      "0xbb",
      "0xcc",
    ],
    attestationTxHash: "0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a",
    attestationBlockNumber: 49911500n,
    attestationTimestamp: 1785600009,
    ...overrides,
  };
}

describe("deriveServiceId", () => {
  it("is stable, lowercase, 64-hex, and pinned across inputs", () => {
    const id = deriveServiceId(CHAIN_KEY, MANAGER);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).toBe(deriveServiceId(CHAIN_KEY, MANAGER.toUpperCase()));
    expect(id).not.toBe(deriveServiceId("evm:1", MANAGER));
    expect(id).not.toBe(deriveServiceId(CHAIN_KEY, VAULT));
  });

  it("rejects a malformed manager address", () => {
    expect(() => deriveServiceId(CHAIN_KEY, "0xabc")).toThrow(/bad manager address/);
  });
});

describe("deriveStrikeId", () => {
  it("joins service id and inputs block with a colon", () => {
    const service = deriveServiceId(CHAIN_KEY, MANAGER);
    expect(deriveStrikeId(service, 42n)).toBe(`${service}:42`);
    expect(deriveStrikeId(service, 42)).toBe(`${service}:42`);
  });
});

describe("buildJournal", () => {
  it("produces a journal that matches the v1 shape", () => {
    const j = buildJournal(baseInput());
    expect(j.schema_version).toBe("1.0.0");
    expect(j.status).toBe("settled");
    expect(j.service_id).toBe(deriveServiceId(CHAIN_KEY, MANAGER));
    expect(j.strike_id).toBe(`${j.service_id}:49911495`);
    expect(j.vault).toEqual({ chain_id: 31337, address: VAULT });
    expect(j.trigger).toEqual({ type: "cron", block: 49911495, tx_hash: null });
    expect(j.inputs_block).toBe(49911495);
    expect(j.nav_unit).toEqual({ asset: "USDC", decimals: 6 });
    expect(j.attestation).toEqual({
      tx_hash: "0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a",
      chain_id: 31337,
      block_number: 49911500,
      nav_final: "500000000",
      timestamp: 1785600009,
    });
  });

  it("emits one accepted operator per signer, in the given order", () => {
    const j = buildJournal(baseInput());
    expect(j.operators).toHaveLength(3);
    expect(j.operators.map((o) => o.id)).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
    ]);
    expect(j.operators.every((o) => o.accepted)).toBe(true);
    expect(j.operators.every((o) => o.nav === "500000000")).toBe(true);
    expect(j.operators.every((o) => o.result_hash === j.quorum.winning_result_hash)).toBe(true);
  });

  it("marks transitions as reached only from the threshold onward", () => {
    const j = buildJournal(baseInput({ quorumThreshold: 2, quorumTotal: 3 }));
    expect(j.quorum.threshold).toBe(2);
    expect(j.quorum.total).toBe(3);
    expect(j.quorum.reached).toBe(true);
    expect(j.quorum.transitions.map((t) => t.reached)).toEqual([false, true, true]);
    expect(j.quorum.transitions.map((t) => t.cumulative)).toEqual([1, 2, 3]);
  });

  it("throws on empty signers", () => {
    expect(() => buildJournal(baseInput({ acceptedSigners: [], signatures: [] }))).toThrow(/zero accepted signers/);
  });

  it("throws when signers and signatures disagree in length", () => {
    expect(() => buildJournal(baseInput({ signatures: ["0xaa"] }))).toThrow(/length mismatch/);
  });

  it("lowercases addresses and tx hash", () => {
    const j = buildJournal(
      baseInput({
        vaultAddress: VAULT.toUpperCase(),
        attestationTxHash: "0xAAAA000000000000000000000000000000000000000000000000000000000000",
        acceptedSigners: ["0xABCD00000000000000000000000000000000ABCD"],
        signatures: ["0x11"],
      }),
    );
    expect(j.vault.address).toBe(VAULT);
    expect(j.attestation.tx_hash).toBe("0xaaaa000000000000000000000000000000000000000000000000000000000000");
    expect(j.operators[0]!.id).toBe("0xabcd00000000000000000000000000000000abcd");
  });
});
