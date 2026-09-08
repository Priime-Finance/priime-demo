/**
 * The copilot's anonymous session id, client side (BUILD_PLAN A2, 2026-09-01).
 *
 * Minted with crypto.randomUUID on the first send of a tab, held in
 * sessionStorage under `priime:copilot-session`, sent on the `x-copilot-session`
 * header the capture layer reads (lib/canvas/copilot/capture.ts SESSION_HEADER)
 * and echoed in every outcome beacon. It is the join key between a turn record
 * and its thumbs, nothing else: no wallet, no email, no IP is ever stored
 * beside it, which is what makes the disclosure line true.
 *
 * Rotation is the QUANT session boundary: a fresh id after 30 minutes idle
 * (the server force-splits anything longer than 6h on its own). The panel's
 * "New session" key rotates explicitly. Storage that throws (private mode)
 * degrades to a per-tab in-memory id; the beacon still carries a valid uuid.
 *
 * `resolveSession` is the pure rule so the test pins it without a DOM.
 */

export const COPILOT_SESSION_KEY = "priime:copilot-session";
export const COPILOT_SESSION_TS_KEY = "priime:copilot-session-ts";
export const SESSION_IDLE_MS = 30 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

/** crypto.randomUUID where it exists, else a v4 from getRandomValues. */
export function mintId(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  try {
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    /* fall through to the manual v4 */
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface StoredSession {
  id: string | null;
  /** ms of the last send under this id; 0 when unknown. */
  ts: number;
}

/**
 * The pure rotation rule. Keeps a well-formed id whose last activity is
 * within the idle window; mints otherwise (missing, malformed, or idle).
 */
export function resolveSession(
  stored: StoredSession | null,
  now: number,
  mint: () => string = mintId,
): { id: string; rotated: boolean } {
  const id = stored?.id ?? null;
  const ts = stored && Number.isFinite(stored.ts) ? stored.ts : 0;
  if (!isUuid(id)) return { id: mint(), rotated: true };
  if (ts > 0 && now - ts > SESSION_IDLE_MS) return { id: mint(), rotated: true };
  return { id, rotated: false };
}

let memory: StoredSession = { id: null, ts: 0 };

function readStored(): StoredSession {
  try {
    const id = window.sessionStorage.getItem(COPILOT_SESSION_KEY);
    const ts = Number(window.sessionStorage.getItem(COPILOT_SESSION_TS_KEY) ?? 0);
    return { id, ts: Number.isFinite(ts) ? ts : 0 };
  } catch {
    return memory;
  }
}

function writeStored(id: string, now: number): void {
  memory = { id, ts: now };
  try {
    window.sessionStorage.setItem(COPILOT_SESSION_KEY, id);
    window.sessionStorage.setItem(COPILOT_SESSION_TS_KEY, String(now));
  } catch {
    /* storage unavailable: the in-memory copy carries the tab */
  }
}

/** The id to send on this send; touches the activity stamp. */
export function copilotSessionId(now: number = Date.now()): string {
  const { id } = resolveSession(readStored(), now);
  writeStored(id, now);
  return id;
}

/** "New session": a fresh id regardless of idle time. */
export function rotateCopilotSession(now: number = Date.now()): string {
  const id = mintId();
  writeStored(id, now);
  return id;
}
