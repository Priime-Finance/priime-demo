/**
 * Loop server: authenticated HTTP control plane for Option A.
 *
 * Routes (Bearer auth except /healthz):
 *   GET    /healthz                 liveness, no auth
 *   GET    /loops                   list loops
 *   POST   /loops                   create + deploy a loop (LoopConfig body)
 *   GET    /loops/:id               one loop + latest attested facts
 *   POST   /loops/:id/resume        resume a failed deployment
 *   DELETE /loops/:id               remove the loop's workflow from the service
 *   GET    /loops/:id/journals      recent Journal[] for this loop's handler
 *
 * nginx terminates TLS in front (deploy/nginx.conf); this listens on
 * loopback only.
 */

import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";

import {
  LoopDeployer,
  LoopNotFoundError,
  LoopRegistry,
  ServiceDocError,
  ValidationError,
  makeChain,
  makeIpfs,
  makeJournalReader,
  type JournalReader,
  type LoopRecord,
} from "@priime-demo/loop-deploy";

import { readEnv } from "./env.ts";

const env = readEnv();
mkdirSync(dirname(env.dbPath), { recursive: true });

const registry = new LoopRegistry(env.dbPath);
const deployer = new LoopDeployer({
  registry,
  chain: makeChain({
    rpcUrl: env.rpcUrl,
    chainId: env.chainId,
    ownerKey: env.ownerKey,
    managerAddress: env.managerAddress,
    assetAddress: env.usdcAddress,
    factoryAddress: env.factoryAddress,
  }),
  ipfs: makeIpfs({ apiUrl: env.ipfsApiUrl, gatewayUrl: env.ipfsGatewayUrl }),
  chainKey: env.chainKey,
  usdcAddress: env.usdcAddress,
  templateWorkflowId: env.templateWorkflowId,
});

const journalReader: JournalReader = makeJournalReader({
  rpcUrl: env.rpcUrl,
  chainId: env.chainId,
  chainKey: env.chainKey,
  managerAddress: env.managerAddress,
  componentDigest: env.componentDigest,
  quorumThreshold: env.quorumThreshold,
  quorumTotal: env.quorumTotal,
  fromBlock: env.journalFromBlock,
});

/** Serialize a loop record for the API. BigInts and dates never appear here,
 *  so this is a pass-through today. Kept as a seam for when we enrich. */
function serializeLoop(loop: LoopRecord): Record<string, unknown> {
  return { ...loop };
}

/** Convenience: derive `{ nav, inputsBlock, txHash, timestamp }` from the
 *  most recent NavUpdated log on this loop's handler, or null when no strike
 *  has landed yet. Non-fatal on RPC errors: the detail endpoint returns the
 *  loop record without the attested block. */
async function latestAttested(loop: LoopRecord): Promise<{ nav: string; inputsBlock: number; txHash: string; timestamp: number } | null> {
  if (loop.handlerAddress === null) return null;
  try {
    const [latest] = await journalReader.readJournals(loop.handlerAddress, 1);
    if (latest === undefined) return null;
    const { nav_final, tx_hash, timestamp } = latest.attestation;
    if (nav_final === null || tx_hash === null || timestamp === null) return null;
    return { nav: nav_final, inputsBlock: latest.inputs_block, txHash: tx_hash, timestamp };
  } catch {
    return null;
  }
}

const MAX_BODY_BYTES = 64 * 1024;

function isAuthorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(env.authToken);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new ValidationError([`request body exceeds ${MAX_BODY_BYTES} bytes`]);
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) throw new ValidationError(["request body is empty"]);
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError(["request body is not valid JSON"]);
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && path === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (req.method === "GET" && path === "/loops") {
    // Optional address filter — validated as 40-hex before it hits SQLite.
    // Anything malformed is 400 so a client can't silently get every loop
    // when its address contained a typo.
    const strategistParam = url.searchParams.get("strategist");
    if (strategistParam !== null && !/^0x[0-9a-fA-F]{40}$/.test(strategistParam)) {
      throw new ValidationError(["strategist must be a 0x-prefixed 20-byte hex address"]);
    }
    const filter = strategistParam === null ? undefined : { strategist: strategistParam };
    sendJson(res, 200, { loops: registry.list(filter).map(serializeLoop) });
    return;
  }

  if (req.method === "POST" && path === "/loops") {
    const body = await readJsonBody(req);
    const loop = await deployer.createLoop(body);
    sendJson(res, 201, { loop: serializeLoop(loop) });
    return;
  }

  const journalsMatch = /^\/loops\/([a-z0-9-]+)\/journals$/.exec(path);
  if (journalsMatch !== null && req.method === "GET") {
    const loop = registry.get(journalsMatch[1]!);
    if (loop === null) throw new LoopNotFoundError(journalsMatch[1]!);
    if (loop.handlerAddress === null) {
      sendJson(res, 200, { journals: [] });
      return;
    }
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw === null ? 20 : Math.min(200, Math.max(1, Number.parseInt(limitRaw, 10) || 20));
    const journals = await journalReader.readJournals(loop.handlerAddress, limit);
    sendJson(res, 200, { journals });
    return;
  }

  const resumeMatch = /^\/loops\/([a-z0-9-]+)\/resume$/.exec(path);
  if (resumeMatch !== null && req.method === "POST") {
    const loop = await deployer.resumeLoop(resumeMatch[1]!);
    sendJson(res, 200, { loop: serializeLoop(loop) });
    return;
  }

  const loopMatch = /^\/loops\/([a-z0-9-]+)$/.exec(path);
  if (loopMatch !== null) {
    const id = loopMatch[1]!;
    if (req.method === "GET") {
      const loop = registry.get(id);
      if (loop === null) throw new LoopNotFoundError(id);
      const attested = await latestAttested(loop);
      sendJson(res, 200, { loop: serializeLoop(loop), attested });
      return;
    }
    if (req.method === "DELETE") {
      const loop = await deployer.deactivateLoop(id);
      sendJson(res, 200, { loop: serializeLoop(loop) });
      return;
    }
  }

  sendJson(res, 404, { error: "not found" });
}

const server = createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    if (err instanceof ValidationError) {
      sendJson(res, 400, { error: "invalid config", issues: err.issues });
    } else if (err instanceof LoopNotFoundError) {
      sendJson(res, 404, { error: err.message });
    } else if (err instanceof ServiceDocError) {
      sendJson(res, 409, { error: err.message });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[loop-server] ${req.method} ${req.url} failed:`, message);
      sendJson(res, 500, { error: message });
    }
  });
});

server.listen(env.port, "127.0.0.1", () => {
  console.log(`[loop-server] listening on 127.0.0.1:${env.port} (manager ${env.managerAddress}, chain ${env.chainKey})`);
});
