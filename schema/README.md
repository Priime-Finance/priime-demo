# NAV Strike Journal, frozen v1

The seam between backend and frontend. One JSON record per NAV strike.
`journal.v1.schema.json` (JSON Schema draft 2020-12) is the **source of truth**;
the Rust (`crates/journal`) and TypeScript (`packages/journal-schema`) types are
faithful transcriptions, and the two samples validate against all three.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | `"1.0.0"` | Frozen version marker. |
| `strike_id` | string | Unique per strike. Convention: `"<service_id>:<trigger.block>"`. Primary key for replay + live API. |
| `status` | `pending` \| `settled` \| `stalled` \| `rejected` | Lifecycle (see below). |
| `service_id` | string (hex) | WAVS service id, the vault's operator set. |
| `vault` | `{chain_id, address}` | The vault whose NAV is attested. |
| `component_digest` | `sha256:<64hex>` | Digest of the NAV wasm every operator ran. |
| `trigger` | `{type, block, tx_hash?}` | What fired the strike (`cron` for NAV strikes; `tx_hash` null for cron/block). |
| `inputs_block` | integer | Determinism anchor: the block state was pinned to. All operators read this, so honest ones produce identical `result_hash`. |
| `nav_unit` | `{asset, decimals}` | Denomination + base-unit decimals for every `nav`. |
| `operators[]` | see below | One entry per submitting operator. |
| `quorum` | see below | Threshold, total, whether reached, the winning hash, and the fill transitions. |
| `attestation` | `{tx_hash, chain_id, block_number, nav_final, timestamp}` | The on-chain settle; nullable fields until `settled`. |

**`operators[]`**: `{ id (signer addr), result_hash (keccak256 of result_payload), nav (int string, base units), signature (secp256k1/eip191), timestamp (unix s), accepted (bool), result_payload? (abi-encoded bytes) }`. Honest operators share `result_hash`; a saboteur has a different one and `accepted:false`.

**`quorum`**: `{ threshold, total, reached, winning_result_hash, transitions[] }`. Each transition is `{cumulative, operator_id, result_hash, reached, timestamp}`, the running weight over the **winning** group as each accepted operator arrives (drives the 2-of-3 to 3-of-3 animation). The saboteur is *not* in `transitions` (it never joined the winning group), but *is* in `operators[]` with `accepted:false`, which is how the UI renders the red, rejected hash.

## Status semantics

- `settled`: quorum reached, attestation landed. A **sabotage strike is `settled`** (the honest 2-of-3 won) with a rejected operator inside `operators[]`.
- `pending`: strike open, quorum not yet reached.
- `stalled`: quorum unreachable (e.g. too few honest operators; the reason 2-of-3 needs 3 nodes, not 2).
- `rejected`: reserved for a strike that failed to settle a valid number.

## The reproducibility recipe (the thesis, made checkable)

`component_digest` + `inputs_block` + `vault` is the full recipe: **re-run that exact component against that block and you must get `result_hash`.** `result_payload` lets anyone recompute `keccak256` and decode `nav` without even re-running. This is the "verify it yourself" affordance, the opposite of a self-reported NAV.

## Freeze policy

**Frozen at v1.** Within v1: no field renames, no type changes, no removals.
Any change ships as a new `$id` (`journal.v2.schema.json`) and a `schema_version`
bump; consumers switch on `schema_version`. `deny_unknown_fields` (Rust) +
`additionalProperties:false` (schema) mean drift fails CI, not production.

## Decisions made here, confirm or veto before we build on it

1. **Quorum as weight, not just a count.** `threshold`/`total`/`cumulative` are weights (== operator count in the equal-weight demo, so `2`/`3`). Matches the on-chain `serviceManager.validate` (signerWeight/thresholdWeight/totalWeight); lets non-equal stake work later without a schema change.
2. **Added beyond your field list:** `status`, per-operator `accepted`, `quorum.winning_result_hash`, and optional `result_payload`. These are what the sabotage UI actually needs (group by hash, mark the outlier) and what makes the journal self-verifying. Easy to drop if unwanted.
3. **`nav` is an integer string in base units, never a float** (scale from `nav_unit.decimals`). Required for byte-identical hashes and JS-safe big numbers.
4. **Timestamps are unix seconds (UTC), integers.** Block/observation times are unix; the frontend formats.
5. **Sample crypto is illustrative.** The samples use well-formed but placeholder hashes/signatures (correct lengths/patterns, not real keccak/secp256k1); they exist to freeze the *shape*. Real values come from the live run.
