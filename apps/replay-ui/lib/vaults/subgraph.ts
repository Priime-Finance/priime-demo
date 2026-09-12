/**
 * The Graph client: queries the `priime-demo` subgraph on Subgraph Studio for the vault's indexed history.
 *
 * Not a heavy client — a single POST per query. The subgraph endpoint URL comes from `NEXT_PUBLIC_SUBGRAPH_URL` at build time; `null` means the demo is running without the subgraph and the panel gracefully renders empty.
 */

const ENDPOINT: string | null = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? null;

export interface SubgraphVault {
  id: string;
  lastNav: string;
  lastInputsBlock: string;
  updateCount: string;
  totalDepositFulfilled: string;
  totalRedeemFulfilled: string;
  totalShares: string;
  breachFlags: number;
}

export interface SubgraphStrike {
  id: string;
  eventId: string;
  nav: string;
  inputsBlock: string;
  updateCount: string;
  configHash: string;
  leverageBps: number;
  ltvBps: number;
  reserveBps: number;
  supplyApyBps: number;
  hoursSinceUpdate: number;
  breachFlags: number;
  block: string;
  timestamp: string;
  tx: string;
}

export interface SubgraphDailyMetric {
  id: string;
  day: string;
  strikeCount: number;
  navEnd: string;
  navMin: string;
  navMax: string;
  depositRequests: number;
  redeemRequests: number;
  depositsFulfilled: string;
  redeemsFulfilled: string;
  planExecuted: number;
  planRejected: number;
}

export interface SubgraphMeta {
  block: number;
  hasIndexingErrors: boolean;
}

export interface SubgraphSnapshot {
  vault: SubgraphVault | null;
  strikes: readonly SubgraphStrike[];
  dailyMetrics: readonly SubgraphDailyMetric[];
  meta: SubgraphMeta | null;
}

export const SUBGRAPH_ENDPOINT: string | null = ENDPOINT;

const SNAPSHOT_QUERY = `query VaultSnapshot($id: Bytes!, $strikeLimit: Int!, $dailyLimit: Int!) {
  vault(id: $id) {
    id
    lastNav
    lastInputsBlock
    updateCount
    totalDepositFulfilled
    totalRedeemFulfilled
    totalShares
    breachFlags
  }
  strikes(where: { vault: $id }, orderBy: block, orderDirection: desc, first: $strikeLimit) {
    id
    eventId
    nav
    inputsBlock
    updateCount
    configHash
    leverageBps
    ltvBps
    reserveBps
    supplyApyBps
    hoursSinceUpdate
    breachFlags
    block
    timestamp
    tx
  }
  vaultDailyMetrics(where: { vault: $id }, orderBy: day, orderDirection: desc, first: $dailyLimit) {
    id
    day
    strikeCount
    navEnd
    navMin
    navMax
    depositRequests
    redeemRequests
    depositsFulfilled
    redeemsFulfilled
    planExecuted
    planRejected
  }
  _meta {
    block { number }
    hasIndexingErrors
  }
}`;

interface RawSnapshotResponse {
  data?: {
    vault: SubgraphVault | null;
    strikes: SubgraphStrike[];
    vaultDailyMetrics: SubgraphDailyMetric[];
    _meta: { block: { number: number }; hasIndexingErrors: boolean } | null;
  };
  errors?: { message: string }[];
}

/**
 * Fetch a snapshot of the vault + recent strikes + recent daily metrics in one round trip. Returns `null` when the subgraph endpoint isn't configured.
 */
export async function fetchSubgraphSnapshot(
  vaultAddress: string,
  strikeLimit = 20,
  dailyLimit = 30,
): Promise<SubgraphSnapshot | null> {
  if (ENDPOINT === null) return null;
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: SNAPSHOT_QUERY,
      variables: { id: vaultAddress.toLowerCase(), strikeLimit, dailyLimit },
    }),
  });
  if (!response.ok) throw new Error(`subgraph HTTP ${String(response.status)}`);
  const payload = (await response.json()) as RawSnapshotResponse;
  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw new Error(`subgraph error: ${payload.errors.map((e) => e.message).join(", ")}`);
  }
  const data = payload.data;
  if (data === undefined) throw new Error("subgraph returned no data");
  return {
    vault: data.vault,
    strikes: data.strikes,
    dailyMetrics: data.vaultDailyMetrics,
    meta:
      data._meta === null
        ? null
        : { block: data._meta.block.number, hasIndexingErrors: data._meta.hasIndexingErrors },
  };
}
