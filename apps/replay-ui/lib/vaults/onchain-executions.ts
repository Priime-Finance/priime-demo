/**
 * ON-CHAIN EXECUTIONS OF THE LIVE LOOP, read off Base.
 *
 * Every run of the loop's WAVS component that ends in an on-chain action lands
 * as one `handleSignedEnvelope` call on the service handler: the operator
 * signs the packet, the handler checks that signature against the operator
 * registry, and only then acts. The transaction is the proof a depositor can
 * open: the Basescan tx page, its input decoded, the `signatureData` tuple at
 * the end with the signer address and the signature bytes.
 *
 * This list is a CAPTURE, not a feed. Each row below was read from Base on
 * 2026-09-07 through `eth_getTransactionByHash` / `eth_getTransactionReceipt`
 * / `eth_getBlockByNumber`: every hash resolved, every receipt succeeded,
 * every call went to the handler with selector `0xf969ff33`, and the
 * operator's address is present in every calldata. Nothing here is typed by
 * hand. The handler has 472 such calls at capture time; these are the eight
 * most recent plus the one the backend walkthrough cited on 2026-08-27.
 *
 * The live backend (loop-server, PR "Wire frontend to server") replaces this
 * capture with the journal's own `tx_hash` per execution. The renderer never
 * knows the difference: it reads `OnchainExecution` rows and prints a link.
 */

import { HERO_SLUG } from "@/lib/demo-scope";

/** Base mainnet. The only chain the live loop settles on. */
export const EXECUTION_CHAIN_ID = 8453;

/** The WAVS service handler every execution is sent to. */
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
 * The executions a vault page may print. Only the attested record has any:
 * a published composition lands on that one record, so its ledger is the
 * handler's, and no other slug on this build has ever sent a packet.
 */
export function onchainExecutionsFor(slug: string): readonly OnchainExecution[] {
  return slug === HERO_SLUG ? ONCHAIN_EXECUTIONS : [];
}
