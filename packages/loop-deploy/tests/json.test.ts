import { describe, expect, it } from "vitest";

import { parseLossless, stringifyLossless } from "../src/json.ts";

describe("lossless json", () => {
  it("round-trips nanosecond timestamps beyond 2^53 exactly", () => {
    const text = '{"start_time":1786611911000000001,"end_time":1786615511000000003}';
    const doc = parseLossless(text);
    expect(stringifyLossless(doc)).toBe(text);
  });

  it("parses unsafe integers to BigInt and safe ones to number", () => {
    const doc = parseLossless('{"big":1786611911000000001,"small":42,"fuel":1000000000000}');
    const record = doc as { big: unknown; small: unknown; fuel: unknown };
    expect(record.big).toBe(1786611911000000001n);
    expect(record.small).toBe(42);
    expect(record.fuel).toBe(1000000000000);
  });

  it("leaves floats and strings alone", () => {
    const text = '{"pi":3.14,"s":"1786611911000000001"}';
    expect(stringifyLossless(parseLossless(text))).toBe(text);
  });

  it("stringifies injected BigInt values as raw integers", () => {
    expect(stringifyLossless({ t: 123n })).toBe('{"t":123}');
  });
});
