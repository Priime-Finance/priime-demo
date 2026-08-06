# priime-demo

Monorepo for the **verifiable vaults** demo: *the vault that cannot lie about its NAV*.

Three independent operators re-execute a NAV computation, agree on identical
result hashes, reach quorum, and attest the number on-chain. Corrupt one
operator and its lie is rejected while the honest quorum settles the truth.

## Task 1 (this commit): the frozen journal schema, the backend/frontend seam

Everything downstream is decoupled by one artifact: a JSON **journal**, one
record per NAV strike. The backend produces it (aggregator component's
accumulated keyvalue + on-chain attestation readback); the frontend consumes it
(replay UI first, then an identical-shape live-polling API). Freezing it now
lets backend and frontend proceed in parallel.

```
schema/
  journal.v1.schema.json     # THE frozen contract (JSON Schema 2020-12), source of truth
  samples/
    strike-settled.json      # honest 3/3 agree, quorum settles
    strike-sabotage.json     # 1 operator lies, rejected; honest 2-of-3 settles the truth
  README.md                  # field semantics, freeze policy, reproducibility recipe
packages/
  journal-schema/            # TypeScript types + re-exported schema (frontend / live API)
crates/
  journal/                   # Rust serde types (backend); tests round-trip the samples
```

## Consume it

- **Frontend / API (TS):** `import { type Journal, journalSchema } from "@priime-demo/journal-schema"` and validate with ajv against `journalSchema`.
- **Backend (Rust):** `priime_journal::Journal` (serde). `deny_unknown_fields` makes any drift from the frozen schema a test failure.

## Verify (all three representations agree)

```bash
cargo test -p priime-journal          # Rust types vs both samples (parse + round-trip + invariants)
npx ajv-cli@5 validate -s schema/journal.v1.schema.json \
  -d "schema/samples/*.json" --spec=draft2020 --strict=false   # JSON Schema vs samples
cd packages/journal-schema && npx typescript tsc --noEmit       # TS types compile
```

The schema is **frozen at v1**. Any change means a new `$id` (`journal.v2`) plus a `schema_version` bump. See `schema/README.md`.
