/**
 * The copilot route, thin (docs/plans/LATEST_UI_PORT_SPEC.md D.4, D.5).
 *
 * GET  probes the panel's online state: { ok, online } with no SDK import.
 * POST runs one model turn over SSE. Tools are TERMINAL: validated server-side
 * and surfaced as structured frames, never executed and fed back. The context
 * is server-authoritative: the market list is `liveVenues()` from the same
 * loader the opportunities route reads, so it holds exactly one row and the
 * validators refuse everything else.
 *
 * Ported from build.priime.finance eb6d33a `app/api/canvas/copilot/route.ts`
 * (`:65-135, 160-236, 256-288, 305-474`) with the capture layer, the prompt
 * registry, the metrics and the `compare` tool cut. The prompt and the tool
 * list come from `lib/canvas/copilot/scope.ts`, and the unknown-id refusal is
 * mapped to the coming-soon sentence before it reaches the wire.
 *
 * The key is read at request time only, never logged, never echoed. Request
 * bodies are never logged. Without ANTHROPIC_API_KEY the route answers 503
 * offline before the SDK is ever imported (D.5).
 */

import { NextResponse } from "next/server";

import { liveVenues } from "@/lib/canvas/catalog-server";
import {
  buildContext,
  type BuildContextInput,
  type ChatMessage,
  type SlimReprice,
} from "@/lib/canvas/copilot/context";
import { sanitizeModelProse } from "@/lib/canvas/copilot/prose-lint";
import { takeToken, type Bucket } from "@/lib/canvas/copilot/rate-limit";
import {
  DEMO_COPILOT_SYSTEM_PROMPT,
  mapRejectReason,
  scopedLiveRows,
  scopedTools,
} from "@/lib/canvas/copilot/scope";
import { sseFrame } from "@/lib/canvas/copilot/sse";
import { validateExplain, validateProposal } from "@/lib/canvas/copilot/tools";
import type { PortfolioGraph } from "@/lib/canvas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 200 * 1024;
const MAX_SESSION_TURNS = 20;

const buckets = new Map<string, Bucket>();

interface CopilotRequestBody {
  messages: ChatMessage[];
  canvas: {
    portfolio: PortfolioGraph;
    reprices: Record<string, SlimReprice | null>;
  };
}

/**
 * Structural guard for the client-supplied canvas (D2, 2026-09-01).
 *
 * `buildContext` and `validatePortfolio` run OUTSIDE the SSE try/catch and
 * dereference exactly these paths (`orchestrator.enabled`, `orchestrator.
 * params`, `loop.nodes[].data.params`, ...) with no shape guard of their own,
 * so a body that parsed as JSON but missed one of them threw past the handler
 * and 500ed. The reason names the first missing path so a client bug reports
 * itself in the 400 body.
 */
function malformedCanvasReason(portfolio: unknown, reprices: unknown): string | null {
  if (!portfolio || typeof portfolio !== "object") return "portfolio is not an object";
  const graph = portfolio as { loops?: unknown; orchestrator?: unknown };
  if (!Array.isArray(graph.loops)) return "portfolio.loops is not an array";
  for (let i = 0; i < graph.loops.length; i++) {
    const at = `portfolio.loops[${i}]`;
    const loop = graph.loops[i] as { id?: unknown; nodes?: unknown; edges?: unknown } | null;
    if (!loop || typeof loop !== "object") return `${at} is not an object`;
    if (typeof loop.id !== "string") return `${at}.id is not a string`;
    if (!Array.isArray(loop.nodes)) return `${at}.nodes is not an array`;
    if (!Array.isArray(loop.edges)) return `${at}.edges is not an array`;
    for (let j = 0; j < loop.nodes.length; j++) {
      const node = loop.nodes[j] as { data?: { defKey?: unknown; params?: unknown } } | null;
      if (!node || typeof node !== "object" || !node.data || typeof node.data !== "object") {
        return `${at}.nodes[${j}].data is not an object`;
      }
      if (typeof node.data.defKey !== "string") return `${at}.nodes[${j}].data.defKey is not a string`;
      if (!node.data.params || typeof node.data.params !== "object") {
        return `${at}.nodes[${j}].data.params is not an object`;
      }
    }
    for (let j = 0; j < loop.edges.length; j++) {
      const edge: unknown = loop.edges[j];
      if (!edge || typeof edge !== "object") return `${at}.edges[${j}] is not an object`;
    }
  }
  const orch = graph.orchestrator as
    | { enabled?: unknown; params?: unknown; allocationsBps?: unknown }
    | undefined;
  if (!orch || typeof orch !== "object") return "portfolio.orchestrator is not an object";
  if (typeof orch.enabled !== "boolean") return "portfolio.orchestrator.enabled is not a boolean";
  if (!orch.params || typeof orch.params !== "object") {
    return "portfolio.orchestrator.params is not an object";
  }
  if (!orch.allocationsBps || typeof orch.allocationsBps !== "object") {
    return "portfolio.orchestrator.allocationsBps is not an object";
  }
  if (reprices !== undefined && reprices !== null && typeof reprices !== "object") {
    return "canvas.reprices is not an object";
  }
  return null;
}

/**
 * The failure class the SSE error line carries (D1, 2026-09-01): the SDK
 * error's `type` (the API body's error type, e.g. "authentication_error"),
 * else its `name`, plus the HTTP status. Class and status ONLY: no key
 * material, no request echo, no upstream message text reach the wire.
 */
function errorClassFrom(e: unknown): string {
  const err = (e ?? {}) as { name?: unknown; status?: unknown; type?: unknown };
  const cls =
    typeof err.type === "string" && err.type
      ? err.type
      : typeof err.name === "string" && err.name
        ? err.name
        : "unknown_error";
  const status = typeof err.status === "number" ? ` ${err.status}` : "";
  return `${cls}${status}`;
}

export function GET() {
  return NextResponse.json({ ok: true, online: Boolean(process.env.ANTHROPIC_API_KEY) });
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";

  // 1. Size guard
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "request too large" }, { status: 413 });
  }

  // 2. Offline guard, before any SDK import (D.5)
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, offline: true }, { status: 503 });
  }

  // 3. Rate limit (first hop of x-forwarded-for, else "local")
  const take = takeToken(buckets, ip, Date.now());
  if (!take.ok) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retryAfterMs: take.retryAfterMs },
      { status: 429 },
    );
  }

  // 4. Shape guard
  let body: CopilotRequestBody;
  try {
    body = JSON.parse(raw) as CopilotRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (
    !messages ||
    messages.length === 0 ||
    messages.some((m) => (m?.role !== "user" && m?.role !== "assistant") || typeof m?.content !== "string") ||
    messages[messages.length - 1].role !== "user"
  ) {
    return NextResponse.json({ ok: false, error: "malformed messages" }, { status: 400 });
  }
  const userTurns = messages.filter((m) => m.role === "user").length;
  if (!body.canvas || typeof body.canvas !== "object" || !body.canvas.portfolio) {
    return NextResponse.json({ ok: false, error: "missing canvas" }, { status: 400 });
  }
  const canvasReason = malformedCanvasReason(body.canvas.portfolio, body.canvas.reprices);
  if (canvasReason) {
    return NextResponse.json(
      { ok: false, code: "malformed-canvas", error: `malformed canvas: ${canvasReason}` },
      { status: 400 },
    );
  }

  // 5. Turn cap
  if (userTurns > MAX_SESSION_TURNS) {
    return NextResponse.json(
      { ok: false, code: "turn-limit", error: "session turn limit reached, start a new session" },
      { status: 400 },
    );
  }

  // Server-authoritative data: the one-row live list, validation recomputed
  // in buildContext. Client-supplied opportunity rows are never trusted.
  const { venues, degraded } = liveVenues(Date.now());
  const contextInput: BuildContextInput = {
    messages,
    portfolio: body.canvas.portfolio,
    reprices: body.canvas.reprices ?? {},
    venues,
    degraded,
  };
  const { contextBlock, history } = buildContext(contextInput);
  const liveRows = scopedLiveRows(venues);

  // SDK loaded only on an online POST (GET/offline never touch it).
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // Identity-linked API keys (the console's newer key type) require the
  // workspace id on every request; workspace-scoped keys need nothing. Passing
  // it only when set keeps both key types working.
  const client = new Anthropic(
    process.env.ANTHROPIC_WORKSPACE_ID
      ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } }
      : {},
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /* A client that went away makes enqueue throw; nothing after that is
         worth sending, and the stream still closes cleanly. */
      let disconnected = false;
      const emit = (event: Parameters<typeof sseFrame>[0], data: unknown) => {
        if (disconnected) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          disconnected = true;
        }
      };
      let stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" = "end_turn";
      try {
        const msgStream = client.messages.stream({
          model: "claude-sonnet-5",
          max_tokens: 4096,
          // thinking omitted: Sonnet 5 runs adaptive by default.
          output_config: { effort: "low" },
          system: [
            {
              type: "text",
              text: DEMO_COPILOT_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: scopedTools() as unknown as import("@anthropic-ai/sdk/resources/messages").ToolUnion[],
          tool_choice: { type: "auto", disable_parallel_tool_use: true },
          messages: [{ role: "user" as const, content: contextBlock }, ...history],
        });

        for await (const event of msgStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            emit("text", { delta: event.delta.text });
          }
        }

        const final = await msgStream.finalMessage();
        const sr = final.stop_reason;
        stopReason =
          sr === "tool_use" || sr === "max_tokens" || sr === "refusal" ? sr : "end_turn";

        if (sr === "tool_use") {
          const block = final.content.find(
            (b): b is Extract<(typeof final.content)[number], { type: "tool_use" }> =>
              b.type === "tool_use",
          );
          if (block) {
            const input = (block.input ?? {}) as Record<string, unknown>;
            if (block.name === "propose_portfolio") {
              const v = validateProposal(input, liveRows);
              // THE CARD'S PROSE IS THE MODEL'S, THE RULES ARE THE PRODUCT'S
              // (2026-08-24). `title` and `rationale` are the only two strings
              // on the blueprint card the model writes free-hand, and they are
              // rendered as-is. Everything else on the card is a formatted
              // number or a verbatim owner string. The house rules (no em
              // dash, "Priime" never "Prime", no risk adjective, no raw gate
              // id, no class letter, U+2212 for a signed value) are enforced
              // here rather than asked for in the prompt, because an
              // instruction is a hope and a filter is a fact. A title with a
              // hit falls back to the neutral one; a rationale with a hit
              // falls back to nothing, and the card still carries every
              // number it had.
              if (v.ok) {
                emit("proposal", {
                  ...v.payload,
                  title: sanitizeModelProse(v.payload.title, "Portfolio blueprint"),
                  rationale: sanitizeModelProse(v.payload.rationale, ""),
                });
              } else {
                emit("proposal_rejected", { reason: mapRejectReason(v.reason), unknownIds: v.unknownIds });
              }
            } else if (block.name === "explain_market") {
              const v = validateExplain(input, liveRows);
              if (v.ok) {
                emit("explain", v.payload);
              } else {
                emit("proposal_rejected", { reason: mapRejectReason(v.reason), unknownIds: v.unknownIds });
              }
            }
          }
        }
      } catch (e) {
        /* THE CLASS SURVIVES THE CATCH (D1, 2026-09-01). The SDK's APIError
           carries `type` (the API body's error type, e.g. "authentication_
           error") and `status`; both go server-side in full and onto the SSE
           line as class + status ONLY: no key material, no request echo, no
           upstream message text. */
        const err = (e ?? {}) as { name?: string; status?: number; type?: string; message?: string };
        console.error(
          `[copilot] model call failed: name=${err.name ?? "unknown"} status=${err.status ?? "none"} message=${err.message ?? String(e)}`,
        );
        if (err.name === "RateLimitError") {
          emit("error", { message: "copilot is busy, retry shortly" });
        } else {
          emit("error", { message: `copilot request failed: ${errorClassFrom(e)}` });
        }
      } finally {
        emit("done", { stopReason });
        try {
          controller.close();
        } catch {
          /* already closed by a disconnect */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
