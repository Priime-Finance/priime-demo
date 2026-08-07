# Priime Demo Spec v1: "The Vault That Cannot Lie"

**Status:** Draft for roadmap meeting | **Owner:** Khaled | **Date:** 2026-08-05
**Target:** working demo in 1-2 weeks; live on Base as private beta seed by ETH Global (Sept 4)

## Concept

One vault, one strategy, one claim: **the vault that cannot lie about its NAV.** We do not pitch "verifiable compute infrastructure"; we show a lie being caught. The demo is real end to end. No mocked proofs: a mocked proof of a verification product is the disease we claim to cure.

Language: "verifiable vaults." Drop "trusted/trustless execution environment" everywhere.

## The market claim (sharpened, defensible)

For the ~$7B curator economy and vaults holding off-chain or cross-chain positions, NAV is produced by a single trusted party (EOA, multisig, or fund admin) and posted on-chain with no independent recomputation. Lagoon: valuation provider proposes, curator settles. Veda: trusted updater pushes the rate. Chainlink NAVLink / RedStone TSSO: relays of self-reported NAV. Nobody re-executes the computation. Villain story: Stream Finance, Nov 2025 ($93M loss, $285M contagion, hardcoded $1 oracles). Do NOT claim "all vaults are manual" (Enzyme, Morpho V2, Hyperliquid disprove it for on-chain-legible positions).

## The strategy

**USDe/USDC recursive loop on Morpho Blue, Base mainnet** (91.5% LLTV market, ~$308M collateral, positive carry ~+0.9%/turn, ~8% net at 5x). Note: the sUSDe Aave loop does NOT exist on Base (proposal unexecuted since Feb 2026). We run at ~80% LTV, ~$500 of our own capital. All loop logic is Priime code; Morpho is the venue underneath (we build the loop, not the venue). NAV = on-chain position value only; unclaimed Merkl rewards excluded (deterministic, conservative).

Pitch line: the attestation for $500 is byte-for-byte the same proof as for $50M.

## The three beats (~7 minutes)

1. **Deploy (30s).** Parameter form, not a canvas: target leverage, health-factor floor, min net-spread threshold. No strategy builder in v1.
2. **Validate.** Cron trigger fires a NAV strike. UI shows: 3 operator nodes computing independently, identical result hashes, quorum filling 2-of-3 then 3-of-3, attestation tx landing on Base, deep-linked to Basescan. Also surfaced: component sha256 digest, per-operator signatures over identical bytes, /p2p/status peers, on-chain operator registry.
3. **Sabotage (the money shot).** "Corrupt an operator" button. One node reports an inflated NAV (what Stream's manager effectively did). Its submission lands in a different quorum bucket, never reaches quorum; honest 2-of-3 settles the true number. UI shows the red mismatched hash rejected. **Requires 3 nodes / 2-of-3** (with 2 nodes a corrupt node stalls instead of being outvoted).

Optional beat 4 (fork track only): rate-inversion replay of the 2025 sUSDe deleveraging; net APY crosses zero, auto-delever fires while the "manual" line bleeds. Clearly labeled simulation.

## Two-track structure

- **Live track (the proof):** real position on Base, real NAV strikes, real sabotage rejection, real Basescan links. This is also the private beta seed and day one of the track record.
- **Fork track (the theater):** anvil fork of mainnet for development, rehearsal, and the scripted rate-inversion beat. All dev happens here first.

Frontend on Vercel replays **captured journals** with live explorer links; graduates to live polling if stable. Record real, replay beautifully: nothing faked, nothing can go down mid-meeting.

## Scope lines

**In (v1):** vault contract (deposit, share accounting, NAV-update handler verifying signature set against registry); loop entry as a deploy-time scripted tx sequence (3-4 turns, no flash loan needed at this size); NAV WASM component (reads Morpho state at trigger block only; no off-chain HTTP, ever); simple submit-on-quorum aggregator component; 3-node 2-of-3 setup; journal capture; Vercel replay UI.

**Out (v1):** strategy builder / canvas / wizard; quorum-driven fund movement (attested actions); envelope contract machinery; auto-compound; Merkl reward claiming; public depositors; audit. First v2 item: one attested action type, delever on health-factor breach.

## Milestone ladder (by risk, not feature)

| # | Milestone | Risk it retires | Owner |
|---|---|---|---|
| 1 | Hello-world component through full pipeline on anvil (scaffold → build → cron → on-chain handler), single node. Day 1-2. If this takes >2 days, scope alarm. | First-time WIT component authoring | Jakub |
| 2 | 3 nodes, mDNS P2P, POA registry, 2-of-3 quorum on identical result | Undocumented multi-node config | Jakub |
| 3 | Real strategy on mainnet fork: entry script, vault contract, Morpho NAV component | Integration + determinism | Jakub + Khaled |
| 4 | Sabotage run: tampered wasm on node 3, journal captures rejection | The money shot mechanics | Jakub |
| 5 | Frontend replay UI on Vercel (built in parallel against hand-written sample journal from day 1) | Frontend blocked on backend | Khaled + Antoni |
| 6 | Deploy to Base mainnet, ~$500, record the live journal | Deployment / key management | Jakub + Khaled |

## Journal schema (the seam; freeze day 1)

JSON per NAV strike: `{ strike_id, trigger: {type, block, tx?}, inputs_block, operators: [{id, result_hash, nav, signature, timestamp}], quorum: {threshold, reached, transitions[]}, attestation: {tx_hash, chain_id, nav_final}, component_digest }`. Frontend built against a hand-written sample; same shape becomes the live-polling API later.

## Honesty lines (say out loud, on-brand)

- "Three nodes independently re-execute; today we run them, tomorrow independent operators do."
- "Unaudited; our own capital only; the audit is what the round funds."
- "Attest-only today: the quorum attests the truth about the position; next it authorizes the actions."
- "The runtime is a fork of the best open-source AVS runtime; our IP is the layer above."
- Carry is largely incentive-paid; the claim is not "brilliant strategy," it is "the NAV cannot lie."

## Open questions

1. Where do the funded submitter key and 3 node keys live for the mainnet run?
2. Journal capture mechanism: aggregator component writes to KV (queryable) vs log scraping?
3. Do we show dollar P&L at all, or percentages + attestations only (recommended)?
4. Hackathon deliverables mapping: demo video narrates the three beats; "link to try" = Vercel replay + sabotage button?
