/**
 * ON-CHAIN EXECUTIONS OF THE LIVE LOOP, read off Base.
 *
 * Every run of the loop's Priime component that ends in an on-chain action
 * lands as one `handleSignedEnvelope` call on the service handler: the
 * operator signs the packet, the handler checks that signature against the
 * operator registry, and only then acts. The transaction is the proof a
 * depositor can open: the Basescan tx page, its input decoded, the
 * `signatureData` tuple at the end with the signer address and the
 * signature bytes.
 *
 * This list is a CAPTURE, not a feed. Each row below was read from Base on
 * 2026-09-07 through `eth_getTransactionByHash` / `eth_getTransactionReceipt`
 * / `eth_getBlockByNumber`: every hash resolved, every receipt succeeded,
 * every call went to the handler with selector `0xf969ff33`, and the
 * operator's address is present in every calldata. Nothing here is typed by
 * hand. The handler has 472 such calls at capture time; these are the eight
 * most recent plus the one the backend walkthrough cited on 2026-08-27.
 *
 * ⚠ THESE ROWS DO NOT BELONG TO THE HERO VAULT PAGE.
 *
 * The captures target the REAL Priime service handler at `SERVICE_HANDLER`
 * (a live Base contract with real strikes). The hero record's own
 * Attestation panel names a SYNTHETIC FIXTURE vault
 * (`0x21844Ad9343AC9Aac3d9bD951DD74e95dBcccb42`, from
 * `schema/samples/strike-settled.json`) — those are unrelated addresses.
 * Mixing both on one page produced a "Verify" click that landed a viewer
 * on real Base transactions for a contract the page never names.
 *
 * `onchainExecutionsFor` therefore returns `[]` on the hero slug: no
 * handler rows on the sample-attested page, no misleading Verify links.
 * The captured evidence is exposed as `handlerCaptureEvidence()` for a
 * future dedicated proof-of-mechanism surface (a `/proof` route or a
 * modal), where the two subjects — mechanism captures vs vault fixture
 * — cannot be confused.
 *
 * The live backend (loop-server, PR "Wire frontend to server") replaces
 * this capture with the journal's own `tx_hash` per execution. Real
 * published loops emit their own tx hashes and read them through the
 * SAME `OnchainExecution` shape; the renderer never knows the difference
 * once real capture data lands on a real (not-fixture) vault page.
 */

/** Base mainnet. The only chain the live loop settles on. */
export const EXECUTION_CHAIN_ID = 8453;

/** The Priime service handler every execution is sent to. */
export const SERVICE_HANDLER = "0xC3dc704425BCD9a33cEFC168a12129fB56c1B60f";

/** The operator whose signature the handler checked on every row below. */
export const OPERATOR_SIGNER = "0xDc01559a8F989dDfA09c7D0C5fB68A670D45FF71";

export interface OnchainExecution {
  /** The `handleSignedEnvelope` transaction. */
  txHash: string;
  /** Block it landed in. */
  blockNumber: number;
  /** Unix seconds of that block. */
  timestamp: number;
}

/** Newest first, as the ledger prints them. */
export const ONCHAIN_EXECUTIONS: readonly OnchainExecution[] = [
  {
    txHash: "0xdd35aa3b37a9a1c3d512e85514d80582d6717eb73128806abadf8a7a76df2a89",
    blockNumber: 50208131,
    timestamp: 1787205609, // 2026-08-20T06:00:09.000Z
  },
  {
    txHash: "0xa4a8af022faaa100887660d5ea76ea6709f99fe366ec4df74a0bd5bd2b3af5f4",
    blockNumber: 50193821,
    timestamp: 1787176989, // 2026-08-19T22:03:09.000Z
  },
  {
    txHash: "0x4ec7a7c9ccba69dbfcf642ed94e6240a4515da8388e64491518d566d9140e279",
    blockNumber: 50192081,
    timestamp: 1787173509, // 2026-08-19T21:05:09.000Z
  },
  {
    txHash: "0xa5ec3f63e76df2be32c467af240ae2518668311ee35cc182d80fa1a5bdee2da5",
    blockNumber: 50192021,
    timestamp: 1787173389, // 2026-08-19T21:03:09.000Z
  },
  {
    txHash: "0xa0dfc1e9de0048b8702af589f2f54ff1e10145cd8c6f93fcb700aa205e7bb773",
    blockNumber: 50191072,
    timestamp: 1787171491, // 2026-08-19T20:31:31.000Z
  },
  {
    txHash: "0xed7bdf5c097a639c882543f0ac8f48a9e14e44f2d08f9ceace37fa7b667b3e61",
    blockNumber: 50190131,
    timestamp: 1787169609, // 2026-08-19T20:00:09.000Z
  },
  {
    txHash: "0x3a4a14c20f35e3153cbb75cdc369f73872c67814878073c3f4dadefd4dc6596d",
    blockNumber: 50188331,
    timestamp: 1787166009, // 2026-08-19T19:00:09.000Z
  },
  {
    txHash: "0xbe183d190605b231cbc1bf17b258694ca51c09b91a57cc3089c71d30a4512fb1",
    blockNumber: 50186531,
    timestamp: 1787162409, // 2026-08-19T18:00:09.000Z
  },
  {
    txHash: "0xab97ab68df4f7becb23640905d9c570918f69e69650bc0757edf72caaf981151",
    blockNumber: 50087531,
    timestamp: 1786964409, // 2026-08-17T11:00:09.000Z
  },
];

/**
 * The executions a vault page may print.
 *
 * Returns `[]` on EVERY slug in this build — no vault currently has its
 * own capture. The hero page used to receive `ONCHAIN_EXECUTIONS` here,
 * but those rows target the real service handler (see the file's
 * warning block above), not the hero's fixture vault. A published real
 * loop will land its own capture through the live backend and get rows
 * that actually correspond to its own handler address.
 */
export function onchainExecutionsFor(_slug: string): readonly OnchainExecution[] {
  return [];
}

/**
 * The captured real-Base handler ledger, as evidence about the
 * mechanism (not any one vault). Consumers building a dedicated
 * proof-of-mechanism surface can read this directly; it MUST NOT be
 * co-located with any fixture-attested vault content.
 */
export function handlerCaptureEvidence(): readonly OnchainExecution[] {
  return ONCHAIN_EXECUTIONS;
}
