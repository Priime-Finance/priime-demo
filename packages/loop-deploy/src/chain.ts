/**
 * Chain port: handler deploys and service URI reads/writes against the
 * shared service manager, signed by the manager owner key.
 *
 * The owner key is hot by design: it controls the service definition
 * (setServiceURI) and pays handler deploy gas. It never touches user funds;
 * money sits behind per-loop handlers whose strategist is the user.
 */

import { readFileSync } from "node:fs";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { isRecord } from "./guards.ts";

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

export interface ChainPort {
  /** Deploy a PriimeVault(serviceManager, asset, strategist). Returns the address. */
  deployHandler(strategist: string): Promise<string>;
  getServiceUri(): Promise<string>;
  /** Set the manager's service URI and wait for inclusion. Returns the tx hash. */
  setServiceUri(uri: string): Promise<string>;
}

export interface ChainOptions {
  rpcUrl: string;
  chainId: number;
  /** Manager owner private key (0x hex). */
  ownerKey: string;
  managerAddress: string;
  /** Vault asset (USDC) for handler constructor args. */
  assetAddress: string;
  /** Forge artifact for the handler contract (PriimeVault.json). */
  artifactPath: string;
}

interface HandlerArtifact {
  abi: Abi;
  bytecode: Hex;
}

/** Load abi + creation bytecode from a forge artifact. */
export function loadHandlerArtifact(path: string): HandlerArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `cannot read handler artifact at ${path} (run \`forge build\` in contracts/ first): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.abi) || !isRecord(parsed.bytecode) || typeof parsed.bytecode.object !== "string") {
    throw new Error(`handler artifact at ${path} is not a forge artifact (missing abi/bytecode.object)`);
  }
  // Forge artifact shapes are stable; abi/bytecode were checked above.
  return { abi: parsed.abi as Abi, bytecode: parsed.bytecode.object as Hex };
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
  const artifact = loadHandlerArtifact(options.artifactPath);

  return {
    async deployHandler(strategist: string): Promise<string> {
      const hash = await walletClient.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [manager, asset, strategist as Address],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || receipt.contractAddress === null || receipt.contractAddress === undefined) {
        throw new Error(`handler deploy reverted (tx ${hash})`);
      }
      return receipt.contractAddress.toLowerCase();
    },

    async getServiceUri(): Promise<string> {
      return await publicClient.readContract({
        address: manager,
        abi: MANAGER_ABI,
        functionName: "getServiceURI",
      });
    },

    async setServiceUri(uri: string): Promise<string> {
      const hash = await walletClient.writeContract({
        address: manager,
        abi: MANAGER_ABI,
        functionName: "setServiceURI",
        args: [uri],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`setServiceURI reverted (tx ${hash})`);
      return hash;
    },
  };
}
