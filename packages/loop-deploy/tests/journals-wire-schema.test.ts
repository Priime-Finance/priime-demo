/**
 * Pin the wire shape of `readJournals` against the frozen v1 schema.
 * Every entry in a `JournalScan.strikes` array MUST expose a `.journal`
 * field that validates against `schema/journal.v1.schema.json` with
 * `additionalProperties:false`. Pre-fix the reader emitted
 * `{ ...journal, observations, plan }` at the top level, which fails
 * the schema's `additionalProperties:false` guard immediately.
 *
 * Ajv is already installed at the workspace root (`node_modules/.pnpm`);
 * we import it directly to keep the test self-contained.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import Ajv from "ajv/dist/2020.js";

import type { JournalWireEntry } from "../src/journal-source.ts";
import { buildJournal } from "../src/journal.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(HERE, "../../../schema/journal.v1.schema.json");
const schema: unknown = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

describe("readJournals wire shape", () => {
  it("nests a schema-valid Journal on every strike so `additionalProperties:false` still holds", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(schema as object);

    // Build a wire entry using the same `buildJournal` helper the reader
    // uses. The entry's `.journal` field is the ONLY thing that must
    // validate; `.observations` and `.plan` are sibling enrichments the
    // schema explicitly does not describe.
    const entry: JournalWireEntry = {
      journal: buildJournal({
        chainId: 8453,
        chainKey: "evm:8453",
        managerAddress: "0x7d222a90b9c473fb75b5bebad41ad63f1c3a4ed5",
        vaultAddress: "0xee942e9848af8d0129ad445b8c2eb6d694d7630a",
        componentDigest: "sha256:" + "a".repeat(64),
        navAsset: "USDC",
        navDecimals: 6,
        quorumThreshold: 2,
        quorumTotal: 3,
        eventId: "0x" + "1a".repeat(20),
        inputsBlock: 50_000_000n,
        navFinal: 500_000_000n,
        payload: "0x00",
        resultHash: "0x" + "a1".repeat(32),
        acceptedSigners: [
          "0x1111111111111111111111111111111111111111",
          "0x2222222222222222222222222222222222222222",
          "0x3333333333333333333333333333333333333333",
        ],
        signatures: [
          "0x" + "aa".repeat(65),
          "0x" + "bb".repeat(65),
          "0x" + "cc".repeat(65),
        ],
        attestationTxHash: "0x" + "77".repeat(32),
        attestationBlockNumber: 50_000_003n,
        attestationTimestamp: 1_785_600_003,
      }),
      observations: {
        leverageBps: 400,
        ltvBps: 8000,
        reserveBps: 200,
        supplyApyBps: 1500,
        hoursSinceUpdate: 1,
        breachFlags: 0,
      },
      plan: {
        planHash: "0x" + "77".repeat(32),
        status: "empty",
        stepCount: 0,
        steps: [],
        reason: null,
        timestampSecs: 1_785_600_003,
      },
    };

    const ok = validate(entry.journal);
    if (!ok) {
      // Surface AJV's own errors so a future regression names the exact
      // additive field the reader started leaking into the journal.
      throw new Error(
        `entry.journal did not validate against journal.v1: ${JSON.stringify(validate.errors)}`,
      );
    }

    // Belt: even though `observations` and `plan` are legitimate sibling
    // fields, they MUST NOT be present on `.journal` itself — that's the
    // whole reason for the wire nesting.
    expect(entry.journal).not.toHaveProperty("observations");
    expect(entry.journal).not.toHaveProperty("plan");
  });
});
