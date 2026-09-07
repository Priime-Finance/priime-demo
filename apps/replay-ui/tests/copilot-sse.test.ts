/**
 * parseCopilotEvents (IT4_COPILOT_SPEC §6 test 23) + copilotFailureLine (DL-11).
 * Ported from build.priime.finance eb6d33a `lib/canvas/__tests__/copilot-sse.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { copilotFailureLine, parseCopilotEvents, sseFrame, type CopilotEvent } from "@/lib/canvas/copilot/sse";

async function* chunksOf(...parts: string[]): AsyncGenerator<string> {
  for (const p of parts) yield await Promise.resolve(p);
}

async function collect(chunks: AsyncIterable<string>): Promise<CopilotEvent[]> {
  const out: CopilotEvent[] = [];
  for await (const ev of parseCopilotEvents(chunks)) out.push(ev);
  return out;
}

describe("parseCopilotEvents", () => {
  it("reassembles events across arbitrary chunk boundaries", async () => {
    const wire =
      sseFrame("text", { delta: "hel" }) + sseFrame("text", { delta: "lo" }) + sseFrame("done", { stopReason: "end_turn" });
    // split mid-frame, mid-json, mid-name
    const cut1 = wire.slice(0, 9);
    const cut2 = wire.slice(9, 31);
    const cut3 = wire.slice(31);
    const events = await collect(chunksOf(cut1, cut2, cut3));
    expect(events).toEqual([
      { event: "text", data: { delta: "hel" } },
      { event: "text", data: { delta: "lo" } },
      { event: "done", data: { stopReason: "end_turn" } },
    ]);
  });

  it("one chunk may carry several events", async () => {
    const wire = sseFrame("text", { delta: "a" }) + sseFrame("done", { stopReason: "end_turn" });
    const events = await collect(chunksOf(wire));
    expect(events.map((e) => e.event)).toEqual(["text", "done"]);
  });

  it("skips unknown event names", async () => {
    const wire = "event: mystery\ndata: {}\n\n" + sseFrame("done", { stopReason: "end_turn" });
    const events = await collect(chunksOf(wire));
    expect(events.map((e) => e.event)).toEqual(["done"]);
  });

  it("malformed data lines produce an error item, not a throw", async () => {
    const wire = "event: text\ndata: {not json\n\n" + sseFrame("done", { stopReason: "end_turn" });
    const events = await collect(chunksOf(wire));
    expect(events[0]).toEqual({ event: "error", data: { message: "malformed event payload" } });
    expect(events[1]!.event).toBe("done");
  });
});

describe("copilotFailureLine (DL-11)", () => {
  it("keeps the server's class + status and appends the consequence", () => {
    expect(copilotFailureLine("copilot request failed: authentication_error 401")).toBe(
      "copilot request failed: authentication_error 401, the canvas is unchanged",
    );
  });

  it("passes the busy line through untouched", () => {
    expect(copilotFailureLine("copilot is busy, retry shortly")).toBe(
      "copilot is busy, retry shortly",
    );
  });

  it("a missing or empty message falls back to the generic line, never 'undefined'", () => {
    expect(copilotFailureLine(undefined)).toBe("copilot request failed, the canvas is unchanged");
    expect(copilotFailureLine("")).toBe("copilot request failed, the canvas is unchanged");
    expect(copilotFailureLine(7)).toBe("copilot request failed, the canvas is unchanged");
  });
});
