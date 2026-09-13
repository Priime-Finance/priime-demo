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
  PauseGuardError,
  ReplayCache,
  ReplayedIntentError,
  isRecord,
  ServiceDocError,
  friendlyErrorMessage,
  StaleIntentError,
  UnauthorizedIntentError,
  ValidationError,
  makeChain,
  makeIpfs,
  makeJournalReader,
  INTENT_MAX_AGE_SECONDS,
  verifyLoopPause,
  verifyLoopPublish,
  type JournalReader,
  type LoopPauseIntent,
  type LoopPublishIntent,
  type LoopRecord,
} from "@priime-demo/loop-deploy";

import { readEnv } from "./env.ts";

const env = readEnv();
mkdirSync(dirname(env.dbPath), { recursive: true });

const registry = new LoopRegistry(env.dbPath);
const chain = makeChain({
  rpcUrl: env.rpcUrl,
  chainId: env.chainId,
  ownerKey: env.ownerKey,
  managerAddress: env.managerAddress,
  assetAddress: env.usdcAddress,
  factoryAddress: env.factoryAddress,
});
const deployer = new LoopDeployer({
  registry,
  chain,
  ipfs: makeIpfs({ apiUrl: env.ipfsApiUrl, gatewayUrl: env.ipfsGatewayUrl }),
  chainKey: env.chainKey,
  usdcAddress: env.usdcAddress,
  templateWorkflowId: env.templateWorkflowId,
});

/**
 * Re-emit `ServiceURIUpdated` on the manager without changing content.
 *
 * Each POST /loops already fires a `setServiceURI` with a NEW ipfs URI —
 * that first tx is what actually installs the new workflow. This helper
 * fires an idempotent SECOND tx with the same (post-publish) URI a few
 * seconds later so a WS subscription that has silently stopped shipping
 * matching logs (real Alchemy behaviour on long-idle subs — the socket
 * stays open but the sub goes cold) gets a second chance to deliver
 * the workflow install without the caller waiting on the periodic
 * heartbeat's next tick.
 *
 * Also runs on a 4-min cron: even when no publish is happening the sub
 * receives one `ServiceURIUpdated` per interval, which stays well under
 * Alchemy's observed idle window and keeps every future publish's real
 * event landing on a hot sub. Content-identical → operators' `change_service`
 * hashes the same doc and no-ops after the reload; no state churn.
 */
async function nudgeServiceUri(reason: string): Promise<void> {
  try {
    const uri = await chain.getServiceUri();
    await chain.setServiceUri(uri);
    console.log(`[loop-server] nudge (${reason}) re-emitted ServiceURIUpdated for ${uri}`);
  } catch (err) {
    console.error(
      `[loop-server] nudge (${reason}) failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

const HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000;
const heartbeatTimer = setInterval(() => {
  void nudgeServiceUri("heartbeat");
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();

const journalReader: JournalReader = makeJournalReader({
  rpcUrl: env.rpcUrl,
  chainId: env.chainId,
  chainKey: env.chainKey,
  managerAddress: env.managerAddress,
  componentDigest: env.componentDigest,
  fallbackQuorumThreshold: env.quorumThreshold,
  fallbackQuorumTotal: env.quorumTotal,
  fromBlock: env.journalFromBlock,
});

/** Serialize a loop record for the API. BigInts and dates never appear here,
 *  so this is a pass-through today. Kept as a seam for when we enrich. */
function serializeLoop(loop: LoopRecord): Record<string, unknown> {
  return { ...loop };
}

/**
 * Convenience: derive the last attested strike PLUS a "why is the strike
 * feed empty" hint. The window used to hide a stall that had run for
 * more than 9_999 blocks — the vault sat quiet in the API but was very
 * much broken. Every consumer needs `chainStrikeCount` to distinguish
 * "vault has never attested" (0) from "vault stalled somewhere past
 * our lookback window" (>0 with empty strikes).
 */
async function latestAttested(loop: LoopRecord): Promise<
  | {
      nav: string; inputsBlock: number; txHash: string; timestamp: number;
      chainStrikeCount: string; windowFromBlock: string; windowToBlock: string;
      chainQuorum: { threshold: number; total: number; source: "chain" | "fallback" };
    }
  | {
      nav: null;
      chainStrikeCount: string; windowFromBlock: string; windowToBlock: string;
      chainQuorum: { threshold: number; total: number; source: "chain" | "fallback" };
    }
  | null
> {
  if (loop.handlerAddress === null) return null;
  try {
    const scan = await journalReader.readJournals(loop.handlerAddress, 1);
    const meta = {
      chainStrikeCount: scan.chainStrikeCount.toString(),
      windowFromBlock: scan.windowFromBlock.toString(),
      windowToBlock: scan.windowToBlock.toString(),
      chainQuorum: scan.chainQuorum,
    };
    const [latest] = scan.strikes;
    if (latest === undefined) return { nav: null, ...meta };
    const { nav_final, tx_hash, timestamp } = latest.journal.attestation;
    if (nav_final === null || tx_hash === null || timestamp === null) {
      return { nav: null, ...meta };
    }
    return { nav: nav_final, inputsBlock: latest.journal.inputs_block, txHash: tx_hash, timestamp, ...meta };
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

/** The EIP-712 domain the mutating routes verify against. Chain-scoped to
 *  this deployment's service manager so a signature from one deployment
 *  cannot be replayed on another. */
const authDomain = { chainId: env.chainId, verifyingContract: env.managerAddress as `0x${string}` };

/** Single-use guard for the signatures the mutating routes accept. Bounded in memory: entries evict once past the same freshness window `verifyLoop*` refuses on its own, so the map never outgrows one TTL of traffic. */
const replayCache = new ReplayCache(INTENT_MAX_AGE_SECONDS);

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Extract a `0x`-prefixed hex string from an untyped source, raising a
 *  `ValidationError` on any shape drift. */
function expectHex(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new ValidationError([`${label} must be a 0x-prefixed hex string`]);
  }
  return value as `0x${string}`;
}

/** Extract a strict `LoopPublishIntent` from the request body. Every field
 *  the strategist signed must be present, in the right shape, on the wire
 *  the server verifies against. Missing or malformed fields → 400. */
function extractPublishIntent(body: Record<string, unknown>): LoopPublishIntent {
  const strategist = body.strategist;
  const name = body.name;
  const candidateId = body.candidateId;
  const cronSeconds = body.cronSeconds;
  const targetLeverage = body.targetLeverage;
  const signedAt = body.signedAt;
  const issues: string[] = [];
  if (typeof strategist !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(strategist)) {
    issues.push("strategist must be a 0x-prefixed 20-byte hex address");
  }
  if (typeof name !== "string" || name.length === 0) {
    issues.push("name must be a non-empty string");
  }
  if (typeof candidateId !== "string" || candidateId.length === 0) {
    issues.push("candidateId must be a non-empty string");
  }
  if (!Number.isInteger(cronSeconds) || (cronSeconds as number) <= 0) {
    issues.push("cronSeconds must be a positive integer");
  }
  if (typeof targetLeverage !== "number" || !Number.isFinite(targetLeverage) || targetLeverage <= 0) {
    issues.push("targetLeverage must be a positive finite number");
  }
  if (!Number.isInteger(signedAt) || (signedAt as number) <= 0) {
    issues.push("signedAt must be a positive integer (unix seconds)");
  }
  if (issues.length > 0) throw new ValidationError(issues);
  return {
    strategist: strategist as `0x${string}`,
    name: name as string,
    candidateId: candidateId as string,
    cronSeconds: cronSeconds as number,
    targetLeverage: targetLeverage as number,
    signedAt: signedAt as number,
  };
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
    if (!isRecord(body)) {
      throw new ValidationError(["request body must be a JSON object"]);
    }
    const signature = expectHex(body.signature, "signature");
    const intent = extractPublishIntent(body);
    await verifyLoopPublish(intent, signature, authDomain, nowSeconds());
    replayCache.observe(signature, nowSeconds());
    // Body sans-signature is the LoopConfigInput createLoop already validates.
    const configInput: Record<string, unknown> = { ...body };
    delete configInput.signature;
    delete configInput.signedAt;
    const loop = await deployer.createLoop(configInput);
    // Immediate defence-in-depth against a cold WS sub: re-emit the same
    // URI ~4 s after the workflow install landed so a stalled subscription
    // gets a second chance without the user waiting on the 4-min cron.
    setTimeout(() => { void nudgeServiceUri("post-publish"); }, 4_000).unref();
    sendJson(res, 201, { loop: serializeLoop(loop) });
    return;
  }

  const journalsMatch = /^\/loops\/([a-z0-9-]+)\/journals$/.exec(path);
  if (journalsMatch !== null && req.method === "GET") {
    const loop = registry.get(journalsMatch[1]!);
    if (loop === null) throw new LoopNotFoundError(journalsMatch[1]!);
    if (loop.handlerAddress === null) {
      sendJson(res, 200, {
        journals: [],
        chainStrikeCount: null,
        windowFromBlock: null,
        windowToBlock: null,
        chainQuorum: null,
      });
      return;
    }
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw === null ? 20 : Math.min(200, Math.max(1, Number.parseInt(limitRaw, 10) || 20));
    const scan = await journalReader.readJournals(loop.handlerAddress, limit);
    sendJson(res, 200, {
      journals: scan.strikes,
      chainStrikeCount: scan.chainStrikeCount.toString(),
      windowFromBlock: scan.windowFromBlock.toString(),
      windowToBlock: scan.windowToBlock.toString(),
      chainQuorum: scan.chainQuorum,
    });
    return;
  }

  const resumeMatch = /^\/loops\/([a-z0-9-]+)\/resume$/.exec(path);
  if (resumeMatch !== null && req.method === "POST") {
    const loop = await deployer.resumeLoop(resumeMatch[1]!);
    setTimeout(() => { void nudgeServiceUri("post-resume"); }, 4_000).unref();
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
      const signature = expectHex(url.searchParams.get("signature"), "signature");
      const signedAtStr = url.searchParams.get("signedAt");
      if (signedAtStr === null || !/^\d+$/.test(signedAtStr)) {
        throw new ValidationError(["signedAt query parameter is required (unix seconds)"]);
      }
      const intent: LoopPauseIntent = { loopId: id, signedAt: Number.parseInt(signedAtStr, 10) };
      const record = registry.get(id);
      if (record === null) throw new LoopNotFoundError(id);
      const recovered = await verifyLoopPause(intent, signature, authDomain, nowSeconds());
      replayCache.observe(signature, nowSeconds());
      if (recovered.toLowerCase() !== record.strategist.toLowerCase()) {
        throw new UnauthorizedIntentError(record.strategist as `0x${string}`, recovered);
      }
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
    } else if (err instanceof StaleIntentError) {
      sendJson(res, 401, { error: err.message, signedAt: err.signedAt, nowSeconds: err.nowSeconds });
    } else if (err instanceof UnauthorizedIntentError) {
      sendJson(res, 403, { error: err.message, expected: err.expected, recovered: err.recovered });
    } else if (err instanceof ReplayedIntentError) {
      // 409 Conflict: a legitimate signature that had already been consumed.
      // Caller re-signs with a fresh signedAt and retries.
      sendJson(res, 409, { error: err.message });
    } else if (err instanceof PauseGuardError) {
      // 409 Conflict: pause refused because the on-chain vault has escrow
      // mid-flight. Ship the raw base-unit balances so the caller can render
      // "N.NN USDC pending, M.MM shares pending" without guessing units.
      sendJson(res, 409, {
        error: err.message,
        pendingDepositAssets: err.pendingDepositAssets.toString(),
        pendingRedeemShares: err.pendingRedeemShares.toString(),
      });
    } else if (err instanceof ServiceDocError) {
      sendJson(res, 409, { error: err.message });
    } else {
      const message = friendlyErrorMessage(err);
      // Log the RAW message locally so an operator debugging on the host
      // still sees the transport URL and any keyed detail. Only the
      // outbound response is scrubbed.
      console.error(`[loop-server] ${req.method} ${req.url} failed:`, err instanceof Error ? err.message : String(err));
      sendJson(res, 500, { error: message });
    }
  });
});

server.listen(env.port, "127.0.0.1", () => {
  console.log(`[loop-server] listening on 127.0.0.1:${env.port} (manager ${env.managerAddress}, chain ${env.chainKey})`);
});
