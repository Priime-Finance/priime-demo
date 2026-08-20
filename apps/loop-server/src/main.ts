/**
 * Loop server: authenticated HTTP control plane for Option A.
 *
 * Routes (Bearer auth except /healthz):
 *   GET    /healthz            liveness, no auth
 *   GET    /loops              list loops
 *   POST   /loops              create + deploy a loop (LoopConfig body)
 *   GET    /loops/:id          one loop
 *   POST   /loops/:id/resume   resume a failed deployment
 *   DELETE /loops/:id          remove the loop's workflow from the service
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
    artifactPath: env.artifactPath,
  }),
  ipfs: makeIpfs({ apiUrl: env.ipfsApiUrl, gatewayUrl: env.ipfsGatewayUrl }),
  chainKey: env.chainKey,
  usdcAddress: env.usdcAddress,
  templateWorkflowId: env.templateWorkflowId,
});

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
    sendJson(res, 200, { loops: registry.list() });
    return;
  }

  if (req.method === "POST" && path === "/loops") {
    const body = await readJsonBody(req);
    const loop = await deployer.createLoop(body);
    sendJson(res, 201, { loop });
    return;
  }

  const loopMatch = /^\/loops\/([a-z0-9-]+)$/.exec(path);
  if (loopMatch !== null) {
    const id = loopMatch[1];
    if (req.method === "GET") {
      const loop = registry.get(id);
      if (loop === null) throw new LoopNotFoundError(id);
      sendJson(res, 200, { loop });
      return;
    }
    if (req.method === "DELETE") {
      const loop = await deployer.deactivateLoop(id);
      sendJson(res, 200, { loop });
      return;
    }
  }

  const resumeMatch = /^\/loops\/([a-z0-9-]+)\/resume$/.exec(path);
  if (resumeMatch !== null && req.method === "POST") {
    const loop = await deployer.resumeLoop(resumeMatch[1]);
    sendJson(res, 200, { loop });
    return;
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
