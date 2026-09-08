/**
 * The chain ledger the Activity section prints on the attested record.
 * Pins the shape the backend must keep when it replaces the capture with the
 * journal's own hashes: real 32-byte hashes, newest first, one slug only, and
 * a Basescan link for every row.
 */
import { describe, expect, it } from "vitest";
import { HERO_SLUG } from "@/lib/demo-scope";
import { explorerTxUrl } from "@/lib/format";
import {
  EXECUTION_CHAIN_ID,
  ONCHAIN_EXECUTIONS,
  OPERATOR_SIGNER,
  SERVICE_HANDLER,
  onchainExecutionsFor,
} from "@/lib/vaults/onchain-executions";
import { EXECUTION_ACTION, executionDetail } from "@/components/vaults/ActivitySection";

describe("on-chain executions", () => {
  it("every row is a real-shaped hash on Base with a block and a time", () => {
    expect(ONCHAIN_EXECUTIONS.length).toBeGreaterThan(0);
    for (const x of ONCHAIN_EXECUTIONS) {
      expect(x.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(Number.isInteger(x.blockNumber) && x.blockNumber > 0).toBe(true);
      expect(Number.isInteger(x.timestamp) && x.timestamp > 1_700_000_000).toBe(true);
    }
    expect(EXECUTION_CHAIN_ID).toBe(8453);
    expect(SERVICE_HANDLER).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(OPERATOR_SIGNER).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("is newest first and never repeats a transaction", () => {
    const hashes = new Set(ONCHAIN_EXECUTIONS.map((x) => x.txHash));
    expect(hashes.size).toBe(ONCHAIN_EXECUTIONS.length);
    for (let i = 1; i < ONCHAIN_EXECUTIONS.length; i += 1) {
      expect(ONCHAIN_EXECUTIONS[i - 1].timestamp).toBeGreaterThanOrEqual(ONCHAIN_EXECUTIONS[i].timestamp);
      expect(ONCHAIN_EXECUTIONS[i - 1].blockNumber).toBeGreaterThan(ONCHAIN_EXECUTIONS[i].blockNumber);
    }
  });

  it("only the attested record has a chain ledger", () => {
    expect(onchainExecutionsFor(HERO_SLUG)).toBe(ONCHAIN_EXECUTIONS);
    expect(onchainExecutionsFor("steady-eth-loop")).toEqual([]);
    expect(onchainExecutionsFor("")).toEqual([]);
  });

  it("every row links to its Basescan transaction page", () => {
    for (const x of ONCHAIN_EXECUTIONS) {
      expect(explorerTxUrl(EXECUTION_CHAIN_ID, x.txHash)).toBe(`https://basescan.org/tx/${x.txHash}`);
    }
  });

  it("carries the walkthrough's own transaction", () => {
    // The execution the backend walkthrough decoded on 2026-08-27.
    expect(ONCHAIN_EXECUTIONS.map((x) => x.txHash)).toContain(
      "0xab97ab68df4f7becb23640905d9c570918f69e69650bc0757edf72caaf981151",
    );
  });

  it("prints the ledger's vocabulary, not a hash", () => {
    expect(EXECUTION_ACTION).toBe("Execution landed");
    expect(executionDetail(50_208_131)).toBe("signed packet accepted · block 50,208,131");
  });
});
