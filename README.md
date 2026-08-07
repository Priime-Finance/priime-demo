# priime-demo

Monorepo for the **verifiable vaults** demo: *the vault that cannot lie about its NAV*.

Three independent operators re-execute a NAV computation, agree on identical
result hashes, reach quorum, and attest the number on-chain. Corrupt one
operator and its lie is rejected while the honest quorum settles the truth.

## Layout

```
components/
  hello-nav/          # operator component (wavs:operator@2.7.0), returns nav=42
  hello-aggregator/   # aggregator component (wavs:aggregator@2.7.0), submits to the handler
contracts/
  src/HelloNavHandler.sol   # service handler: validates operator sigs, records the attested NAV
deploy/
  deploy.sh           # one command: build -> deploy -> cron fires -> result on-chain
schema/
  journal.v1.schema.json    # frozen backend/frontend seam (JSON Schema 2020-12), source of truth
  samples/                  # honest + sabotage journal fixtures
crates/journal/       # Rust serde types for the journal (deny_unknown_fields)
packages/journal-schema/    # TypeScript types + re-exported schema
```

Each component has its own README explaining what it does and why.

## M1: hello-world through the full WAVS pipeline (on anvil)

A hello-world component through the whole pipeline: scaffold, build, deploy, a
cron trigger fires, and the result lands in a handler contract on-chain.

### Prerequisites

Two long-running services (separate terminals):

```bash
anvil --host 0.0.0.0 --block-time 1     # chainId 31337 on :8545 (0.0.0.0 so containers can reach it)
ipfs daemon                             # gateway :8080, api :5001
```

Also required: Foundry (`anvil`/`cast`/`forge`), Rust with the `wasm32-wasip2`
target (pinned in `rust-toolchain.toml`), and these Docker images:

```
ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15
ghcr.io/lay3rlabs/poa-middleware:1.0.1
```

### Run

```bash
bash deploy/deploy.sh
```

It builds both components, deploys the POA service manager + `HelloNavHandler`,
publishes the components + service to IPFS, assembles and deploys the service
(cron every 10s), registers the single operator, starts the WAVS node, and waits
for the first strike to land. Expected tail:

```
SUCCESS: strikeCount=1 latestNav=42
```

Inspect the running node with `docker logs wavs-m1`. The script is re-runnable
(fresh service manager + handler each run). It uses the well-known anvil test
mnemonic; local development only.

## The journal seam (schema)

Everything downstream is decoupled by one artifact: a JSON **journal**, one
record per NAV strike. The backend produces it (aggregator keyvalue + on-chain
attestation readback); the frontend consumes it. It is frozen so backend and
frontend can proceed in parallel.

- **Frontend / API (TS):** `import { type Journal, journalSchema } from "@priime-demo/journal-schema"` and validate with ajv against `journalSchema`.
- **Backend (Rust):** `priime_journal::Journal` (serde). `deny_unknown_fields` makes any drift from the frozen schema a test failure.

Verify all three representations agree:

```bash
cargo test -p priime-journal          # Rust types vs both samples (parse + round-trip + invariants)
npx ajv-cli@5 validate -s schema/journal.v1.schema.json \
  -d "schema/samples/*.json" --spec=draft2020 --strict=false   # JSON Schema vs samples
cd packages/journal-schema && npx -p typescript tsc --noEmit    # TS types compile
```

The schema is **frozen at v1**. Any change means a new `$id` (`journal.v2`) plus
a `schema_version` bump. See `schema/README.md`.
