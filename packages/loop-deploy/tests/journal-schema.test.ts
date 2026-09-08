/**
 * Ajv round-trip: `buildJournal` must produce records that validate against
 * the frozen v1 JSON Schema. If the builder ever drifts from the schema (a
 * field renamed, a new required key added), this test breaks first.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { buildJournal } from "../src/journal.ts";

const schemaPath = fileURLToPath(new URL("../../../schema/journal.v1.schema.json", import.meta.url));
const journalSchema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(journalSchema);

// Schema requires ^0x[a-fA-F0-9]{130}$ (65 bytes) for signatures.
const SIG_STUB = "0x" + "ab".repeat(65);

describe("buildJournal vs journal.v1.schema.json", () => {
  it("validates a settled journal against the frozen schema", () => {
    const j = buildJournal({
      chainId: 31337,
      chainKey: "evm:31337",
      managerAddress: "0x7d222a90b9c473fb75b5bebad41ad63f1c3a4ed5",
      vaultAddress: "0xee942e9848af8d0129ad445b8c2eb6d694d7630a",
      componentDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      navAsset: "USDC",
      navDecimals: 6,
      quorumThreshold: 1,
      quorumTotal: 1,
      eventId: "0x1a49ee4bc1cd6d0dab48596c589b00ad949f429d",
      inputsBlock: 49911495n,
      navFinal: 500_000_000n,
      payload: "0x00",
      resultHash: "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
      acceptedSigners: ["0x1111111111111111111111111111111111111111"],
      signatures: [SIG_STUB],
      attestationTxHash: "0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a",
      attestationBlockNumber: 49911500n,
      attestationTimestamp: 1785600009,
    });

    const ok = validate(j);
    if (!ok) {
      throw new Error(`journal failed schema: ${JSON.stringify(validate.errors, null, 2)}`);
    }
    expect(ok).toBe(true);
  });
});
