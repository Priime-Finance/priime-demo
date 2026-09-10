import { describe, expect, it } from "vitest";

import { friendlyErrorMessage } from "../lib/errors";

/**
 * viem's `BaseError` stacks each layer's `shortMessage` on a `cause` chain
 * and joins every layer's URL, hex request body, response headers, docs
 * link and version stamp into one `.message`. The regression this pins is
 * that we surface `shortMessage`, not `.message`, so the "the vault that
 * cannot lie" flow never renders its own RPC URL or request calldata to
 * the user.
 */

/** Rough shape of a viem error: `shortMessage` + `message` + `cause`. */
class FakeViemError extends Error {
  shortMessage: string;
  constructor(shortMessage: string, longMessage: string, cause?: unknown) {
    super(longMessage);
    this.name = "FakeViemError";
    this.shortMessage = shortMessage;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

describe("friendlyErrorMessage", () => {
  it("returns a plain Error's message unchanged when short", () => {
    expect(friendlyErrorMessage(new Error("nope"))).toBe("nope");
  });

  it("returns the shortMessage of a viem-shaped error, not its full message", () => {
    const err = new FakeViemError(
      "Execution reverted with reason: EscrowFloorBreached.",
      [
        "Execution reverted with reason: EscrowFloorBreached.",
        "",
        "Request Arguments:",
        "  from:  0x0000000000000000000000000000000000000000",
        "  to:    0xdeadbeef00000000000000000000000000000000",
        "  data:  0xabcdef0123",
        "",
        "URL: http://127.0.0.1:3000/api/rpc/8453",
        "Request body: {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[…]}",
        "",
        "Version: viem@2.28.0",
      ].join("\n"),
    );
    expect(friendlyErrorMessage(err)).toBe(
      "Execution reverted with reason: EscrowFloorBreached.",
    );
    // The whole request body / URL / version block is never on the surface.
    expect(friendlyErrorMessage(err)).not.toContain("URL:");
    expect(friendlyErrorMessage(err)).not.toContain("Request body");
    expect(friendlyErrorMessage(err)).not.toContain("viem@");
  });

  it("walks the cause chain and returns the deepest shortMessage", () => {
    // viem chains: outer wrapper -> RPC error -> contract revert. The user
    // wants to see the DEEPEST reason (the revert), not the outer wrapper.
    const revert = new FakeViemError(
      "Vault reverted: VaultBreached(1).",
      "Vault reverted: VaultBreached(1). URL: http://... Version: viem@2.28.0",
    );
    const rpc = new FakeViemError(
      "The RPC HTTP request failed.",
      "The RPC HTTP request failed. URL: http://...",
      revert,
    );
    const outer = new FakeViemError(
      "Contract call failed.",
      "Contract call failed. Version: viem@2.28.0",
      rpc,
    );
    expect(friendlyErrorMessage(outer)).toBe("Vault reverted: VaultBreached(1).");
  });

  it("survives a self-referential cause chain without hanging", () => {
    /* Two-phase construction: the inner error carries the shortMessage; a
       misbehaving library then wraps it in a cycle. Cause is a real Error
       field (native since ES2022), no cast needed. */
    const inner = new FakeViemError("first-line", "first-line\nurl: http://leak");
    inner.cause = inner;
    expect(friendlyErrorMessage(inner)).toBe("first-line");
  });

  it("falls back to the first non-blank line of a plain Error's multi-line message", () => {
    const err = new Error(
      [
        "Something went wrong",
        "",
        "URL: http://leak",
        "Version: viem@2.28.0",
      ].join("\n"),
    );
    expect(friendlyErrorMessage(err)).toBe("Something went wrong");
  });

  it("falls back to String(err) for non-Error values", () => {
    expect(friendlyErrorMessage("plain string")).toBe("plain string");
    expect(friendlyErrorMessage(42)).toBe("42");
    expect(friendlyErrorMessage(null)).toBe("null");
  });

  it("never returns an empty string", () => {
    expect(friendlyErrorMessage(new Error(""))).toBe("unknown error");
    expect(friendlyErrorMessage("")).toBe("unknown error");
    expect(friendlyErrorMessage(undefined)).toBe("undefined");
  });
});
