# hello-aggregator

Aggregator component for the M1 demo. Implements `priime:aggregator@3.0.0`'s
`aggregator-world`.

## What it does

For each operator response it emits one EVM submit action per configured submit
chain, targeting the workflow's service-handler address (`HelloNavHandler`). No
timer batching and no gas oracle: submit immediately and let the node pay
default gas. This is the piece that turns a signed operator result into the
on-chain `handleSignedEnvelope` call.

## Why it exists

The Priime submit path routes operator results through an aggregator component,
and there is no off-the-shelf one to reuse here, so this is the minimal version.
`process-input` and `handle-timer-callback` return the submit action;
`handle-submit-callback` just propagates the transaction result.

## Build

```bash
cargo build --release --target wasm32-wasip2
# -> target/wasm32-wasip2/release/priime_hello_aggregator.wasm
```

Standalone cargo workspace, WIT vendored under `wit/` (same rationale as
`hello-nav`).
