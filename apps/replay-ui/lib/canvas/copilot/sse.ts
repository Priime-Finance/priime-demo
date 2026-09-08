/**
 * Copilot SSE protocol (IT4_COPILOT_SPEC §1.3 / §3.1).
 *
 * Server side: tiny encoder for `event: <name>\ndata: <one-line JSON>\n\n`.
 * Client side: parseCopilotEvents — a pure async generator over string
 * chunks that reassembles events across arbitrary chunk boundaries. Unknown
 * event names are skipped; malformed data lines yield an { event: "error" }
 * item instead of throwing.
 */

export type CopilotEventName =
  | "text"
  | "proposal"
  | "proposal_rejected"
  | "explain"
  | "compare"
  | "error"
  | "done";

export interface CopilotEvent {
  event: CopilotEventName;
  data: unknown;
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set([
  "text",
  "proposal",
  "proposal_rejected",
  "explain",
  "compare",
  "error",
  "done",
]);

/** Encode one SSE frame (server side). */
export function sseFrame(event: CopilotEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * The register line for an SSE `error` event (DL-11, 2026-09-01).
 *
 * The server's message names the failure class and HTTP status ("copilot
 * request failed: authentication_error 401"); the panel prints it verbatim
 * with the one consequence the user needs beside it — the canvas did not
 * change. The busy line and any other server phrasing pass through untouched,
 * and a payload with no usable message falls back to the generic line rather
 * than printing "undefined".
 */
export function copilotFailureLine(message: unknown): string {
  const msg =
    typeof message === "string" && message.trim().length > 0
      ? message.trim()
      : "copilot request failed";
  return msg.startsWith("copilot request failed") ? `${msg}, the canvas is unchanged` : msg;
}

/**
 * Parse a stream of raw SSE text chunks into copilot events. Chunk
 * boundaries are arbitrary (an event may span chunks; a chunk may carry
 * several events).
 */
export async function* parseCopilotEvents(
  chunks: AsyncIterable<string>,
): AsyncGenerator<CopilotEvent> {
  let buf = "";
  for await (const chunk of chunks) {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const parsed = parseFrame(frame);
      if (parsed) yield parsed;
    }
  }
  const tail = parseFrame(buf);
  if (tail) yield tail;
}

function parseFrame(frame: string): CopilotEvent | null {
  const lines = frame.split("\n");
  let event = "";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!event || !KNOWN_EVENTS.has(event)) return null;
  try {
    return { event: event as CopilotEventName, data: data ? JSON.parse(data) : null };
  } catch {
    return { event: "error", data: { message: "malformed event payload" } };
  }
}

/** Wrap a fetch Response body into the string chunks the parser consumes. */
export async function* responseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
