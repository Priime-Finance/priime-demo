/**
 * Chain port: handler deploys and service URI reads/writes against the
 * shared service manager, signed by the manager owner key.
 *
 * The owner key is hot by design: it controls the service definition
 * (setServiceURI) and pays handler deploy gas. It never touches user funds;
 * money sits behind per-loop handlers whose strategist is the user.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MANAGER_ABI = [
  {
    type: "function",
    name: "getServiceURI",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setServiceURI",
    inputs: [{ name: "serviceURI", type: "string" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const VAULT_ABI = [
  {
    type: "function",
    name: "totalPendingDepositAssets",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalPendingRedeemShares",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const POOL_ABI = [
  {
    // Uniswap V3 CLPool slot0() returns 7 words:
    //   sqrtPriceX96, tick, observationIndex, observationCardinality,
    //   observationCardinalityNext, feeProtocol, unlocked.
    // Aerodrome CL forks drop `feeProtocol` and return 6. Presence of the
    // uint8 feeProtocol slot is the sole shape check.
    type: "function",
    name: "slot0",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
  },
] as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "deployVault",
    inputs: [
      { name: "serviceManager", type: "address" },
      { name: "asset", type: "address" },
      { name: "strategist", type: "address" },
      {
        name: "strategy",
        type: "tuple",
        components: [
          { name: "collateralToken", type: "address" },
          { name: "morpho", type: "address" },
          { name: "morphoOracle", type: "address" },
          { name: "morphoIrm", type: "address" },
          { name: "morphoLltv", type: "uint256" },
          { name: "swapRouter", type: "address" },
          { name: "poolFee", type: "uint24" },
        ],
      },
    ],
    outputs: [{ type: "address" }],
    stateMutability: "nonpayable",
  },
] as const;

export interface StrategyConfig {
  collateralToken: string;
  morpho: string;
  morphoOracle: string;
  morphoIrm: string;
  morphoLltv: bigint;
  swapRouter: string;
  poolFee: number;
}

export interface VaultPendingBalances {
  /** USDC escrowed from unfulfilled `requestDeposit` calls; strandable across pause. */
  pendingDepositAssets: bigint;
  /** Vault shares escrowed from unfulfilled `requestRedeem` calls; strandable across pause. */
  pendingRedeemShares: bigint;
}

export interface ChainPort {
  /** Deploy a PriimeVault(serviceManager, asset, strategist, StrategyConfig). Returns the address. */
  deployHandler(strategist: string, strategy: StrategyConfig): Promise<string>;
  getServiceUri(): Promise<string>;
  /** Set the manager's service URI and wait for inclusion. Returns the tx hash. */
  setServiceUri(uri: string): Promise<string>;
  /** Read `totalPendingDepositAssets` + `totalPendingRedeemShares` off the vault. Used by the pause pre-flight so testers can't strand mid-flight deposits or redeems. */
  vaultPendingBalances(vaultAddress: string): Promise<VaultPendingBalances>;
  /** Read `slot0()` off the pool and verify it decodes into the 7-word Uniswap V3 shape vault-nav expects. Throws with a specific message on mismatch (e.g. Aerodrome CL, whose 6-word slot0 was the class of bug this preflight prevents). */
  verifyUniswapV3Pool(poolAddress: string): Promise<void>;
}

export interface ChainOptions {
  rpcUrl: string;
  chainId: number;
  /** Manager owner private key (0x hex). */
  ownerKey: string;
  managerAddress: string;
  /** PriimeVaultFactory address. Every deployed vault emits VaultCreated so the subgraph auto-indexes it. */
  factoryAddress: string;
  /** Vault asset (USDC) for handler constructor args. */
  assetAddress: string;
}

export function makeChain(options: ChainOptions): ChainPort {
  const chain = defineChain({
    id: options.chainId,
    name: `chain-${options.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [options.rpcUrl] } },
  });
  const account = privateKeyToAccount(options.ownerKey as Hex);
  const publicClient = createPublicClient({ chain, transport: http(options.rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(options.rpcUrl), account });
  const manager = options.managerAddress as Address;
  const asset = options.assetAddress as Address;
  const factory = options.factoryAddress as Address;


  /**
   * Alchemy's load-balanced Base RPC pool sometimes routes the next tx from
   * the same key to a node that has not yet observed the previous tx. viem's
   * automatic nonce resolution then reads a stale pending-nonce and Alchemy
   * rejects the second tx as "replacement transaction underpriced". Poll
   * `getTransactionCount(pending)` on the wallet's account until it reaches
   * `expectedNonce` (or the deadline elapses), so downstream writes never
   * submit with a nonce the load-balancer might reject.
   */
  const waitForNonce = async (expectedNonce: number, deadlineMs: number): Promise<void> => {
    const stop = Date.now() + deadlineMs;
    while (Date.now() < stop) {
      const current = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      if (current >= expectedNonce) return;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 400);
      await promise;
    }
  };

  /** True when `err` names the load-balancer's stale-nonce refusal. */
  const isNonceRace = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes("replacement transaction underpriced")
      || msg.includes("nonce too low")
      || msg.includes("already known")
    );
  };

  return {
    async deployHandler(strategist: string, strategy: StrategyConfig): Promise<string> {
      // Every deploy goes through the factory so the subgraph auto-indexes
      // the new vault via its VaultCreated event + data-source template.
      const nonceBefore = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      const args = [
        manager,
        asset,
        strategist as Address,
        {
          collateralToken: strategy.collateralToken as Address,
          morpho: strategy.morpho as Address,
          morphoOracle: strategy.morphoOracle as Address,
          morphoIrm: strategy.morphoIrm as Address,
          morphoLltv: strategy.morphoLltv,
          swapRouter: strategy.swapRouter as Address,
          poolFee: strategy.poolFee,
        },
      ] as const;
      // Predict the vault address up-front so we do not need to parse
      // VaultCreated back out of the receipt.
      const predicted = await publicClient.readContract({
        address: factory,
        abi: FACTORY_ABI,
        functionName: "deployVault",
        args,
        account,
      });
      const hash = await walletClient.writeContract({
        address: factory,
        abi: FACTORY_ABI,
        functionName: "deployVault",
        args,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`factory.deployVault reverted (tx ${hash})`);
      }
      await waitForNonce(nonceBefore + 1, 10_000);
      return (predicted as Address).toLowerCase();
    },

    async getServiceUri(): Promise<string> {
      return await publicClient.readContract({
        address: manager,
        abi: MANAGER_ABI,
        functionName: "getServiceURI",
      });
    },

    async setServiceUri(uri: string): Promise<string> {
      // Retry the send on a nonce race: the write itself is idempotent (the
      // service URI is the same string on every attempt), so a second submit
      // through a caught-up node lands cleanly.
      const send = async (): Promise<Hex> =>
        walletClient.writeContract({
          address: manager,
          abi: MANAGER_ABI,
          functionName: "setServiceURI",
          args: [uri],
        });
      let hash: Hex;
      try {
        hash = await send();
      } catch (err) {
        if (!isNonceRace(err)) throw err;
        const pending = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });
        await waitForNonce(pending + 1, 8_000);
        hash = await send();
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`setServiceURI reverted (tx ${hash})`);
      return hash;
    },

    async vaultPendingBalances(vaultAddress: string): Promise<VaultPendingBalances> {
      const address = vaultAddress as Address;
      // The two reads are independent public storage; batch them onto one
      // multicall via Promise.all so pause pre-flight adds one round trip,
      // not two.
      const [pendingDepositAssets, pendingRedeemShares] = await Promise.all([
        publicClient.readContract({ address, abi: VAULT_ABI, functionName: "totalPendingDepositAssets" }),
        publicClient.readContract({ address, abi: VAULT_ABI, functionName: "totalPendingRedeemShares" }),
      ]);
      return { pendingDepositAssets, pendingRedeemShares };
    },

    async verifyUniswapV3Pool(poolAddress: string): Promise<void> {
      // One eth_call. If the returned data does not decode into the 7-word
      // Uniswap V3 shape (uint160,int24,uint16,uint16,uint16,uint8,bool),
      // viem throws a decode error; we rethrow with a specific message so
      // the loop-server surfaces "wrong pool" instead of an opaque revert.
      try {
        await publicClient.readContract({
          address: poolAddress as Address,
          abi: POOL_ABI,
          functionName: "slot0",
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `slot0() at ${poolAddress} did not decode into the 7-word Uniswap V3 shape vault-nav expects (Aerodrome CL forks return 6 words); reject the market config before publishing. Underlying: ${detail}`,
        );
      }
    },
  };
}
