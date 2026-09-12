# hello-nav

Operator component for the M1 demo. Implements the `run` export of `priime:operator@3.0.0`'s `priime-world`.

## What it does

On each trigger it reads the `label` config var and returns an abi-encoded `(uint256 nav, uint256 blockNumber)` payload. `nav` is a constant `42` (hello world; real NAV logic lands in a later milestone). The operator set signs this payload and the aggregator submits it on-chain to `HelloNavHandler`.

## Why it exists

Retires M1's riskiest unknown: authoring a Priime component from scratch against the WIT world. It proves the full toolchain path (bindings generation, build to `wasm32-wasip2`, valid component exports) end to end.

## Build

```bash
cargo build --release --target wasm32-wasip2
# -> target/wasm32-wasip2/release/priime_hello_nav.wasm
```

Standalone cargo workspace (detached from the repo root) so a host-target build never tries to compile this `cdylib`. The WIT world is vendored under `wit/` (see the repo `.gitignore` for why `wit/deps` is committed rather than fetched).
