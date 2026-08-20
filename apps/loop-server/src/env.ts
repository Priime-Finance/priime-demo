/** Environment parsing for the loop server. Fails loudly on anything missing. */

export interface ServerEnv {
  port: number;
  /** Bearer token for every non-health route. */
  authToken: string;
  rpcUrl: string;
  chainId: number;
  /** ChainKey as WAVS spells it, e.g. "evm:31337". */
  chainKey: string;
  managerAddress: string;
  ownerKey: string;
  usdcAddress: string;
  ipfsApiUrl: string;
  ipfsGatewayUrl: string;
  artifactPath: string;
  dbPath: string;
  templateWorkflowId: string | undefined;
}

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`missing required env var ${name}`);
  return v;
}

export function readEnv(): ServerEnv {
  const chainId = Number(required("CHAIN_ID"));
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("CHAIN_ID must be a positive integer");
  const port = Number(process.env.PORT ?? "8090");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("PORT must be a valid port number");
  const authToken = required("LOOP_SERVER_TOKEN");
  if (authToken.length < 16) throw new Error("LOOP_SERVER_TOKEN must be at least 16 characters");

  return {
    port,
    authToken,
    rpcUrl: required("RPC_URL"),
    chainId,
    chainKey: process.env.CHAIN_KEY ?? `evm:${chainId}`,
    managerAddress: required("MANAGER_ADDRESS"),
    ownerKey: required("OWNER_PRIVATE_KEY"),
    usdcAddress: required("USDC_ADDRESS"),
    ipfsApiUrl: process.env.IPFS_API_URL ?? "http://127.0.0.1:5001",
    ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL ?? "http://127.0.0.1:8080",
    artifactPath: process.env.HANDLER_ARTIFACT_PATH ?? new URL("../../../contracts/out/PriimeVault.sol/PriimeVault.json", import.meta.url).pathname,
    dbPath: process.env.DB_PATH ?? new URL("../data/loops.db", import.meta.url).pathname,
    templateWorkflowId: process.env.TEMPLATE_WORKFLOW_ID,
  };
}
