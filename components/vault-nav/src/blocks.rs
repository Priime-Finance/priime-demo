//! Deterministic `inputs_block` selection from the cron trigger time.
//! Host-testable: no WIT, no RPC, the timestamp lookup is a caller-supplied
//! async closure.
//!
//! Conventions (must stay in lockstep with the aggregator's quorum rule):
//! - Quorum needs byte-identical payloads, and `inputs_block` is part of the
//!   signed payload. Deriving it from the operator's OWN chain head makes it
//!   the one nondeterministic input in the pipeline: two nodes a block apart
//!   sign different bytes and the aggregator drops the mismatches.
//! - Every operator in the quorum is handed the SAME cron `trigger-time`, so
//!   that is what the height is derived from:
//!   `inputs_block = (highest block with timestamp <= trigger_time) - lag`.
//!   Same trigger_time + same lag => same block for every operator, whatever
//!   their node's head happens to be.
//! - `lag` (workflow config `inputs_block_lag`) stays on top for reorg depth.
//! - An operator whose node has NOT yet reached `trigger_time` must fail the
//!   cycle. Falling back to its own head would sign a different block, which
//!   is strictly worse than not signing.
//!
//! Search shape: probe the head, walk back in doubling strides until a block
//! at or before `trigger_time` is bracketed, then binary search the bracket.
//! On a 2s chain with cron firing at ~now this costs 1-2 lookups; the
//! walk-back keeps the cost O(log(head - target)) rather than O(log head).

use core::future::Future;

/// Highest block whose header timestamp is at or before `target_secs`.
///
/// `timestamp_of` returns a block's header timestamp in whole seconds, or a
/// cycle-failing error. Errors if `head` has not reached `target_secs` (node
/// behind) or if even genesis is later than the target (chain too young).
pub async fn block_at_or_before<F, Fut>(
    head: u64,
    target_secs: u64,
    timestamp_of: F,
) -> Result<u64, String>
where
    F: Fn(u64) -> Fut,
    Fut: Future<Output = Result<u64, String>>,
{
    // A node that has not reached trigger_time cannot know the right block.
    // Fail the cycle rather than substitute its own (lower) head: an unsigned
    // cycle costs a beat, a differently-signed one silently misses quorum.
    let head_ts = timestamp_of(head).await?;
    if head_ts < target_secs {
        return Err(format!(
            "chain head {head} (timestamp {head_ts}) has not reached trigger_time \
             {target_secs}: node is behind, failing the cycle rather than pinning \
             a different block than the rest of the quorum"
        ));
    }
    if head_ts == target_secs {
        return Ok(head);
    }

    // Doubling walk-back for a bracket lower bound at or before the target.
    // Invariant on exit: timestamp(lo) <= target < timestamp(head).
    let mut lo = head;
    let mut stride = 1u64;
    loop {
        if lo == 0 {
            return Err(format!(
                "genesis block timestamp exceeds trigger_time {target_secs}"
            ));
        }
        lo = lo.saturating_sub(stride);
        stride = stride.saturating_mul(2);
        if timestamp_of(lo).await? <= target_secs {
            break;
        }
    }

    // Binary search (lo, head): `lo` is already a valid answer and `head` is
    // already known to be too late, so only the interior needs probing. Both
    // `mid + 1` and `mid - 1` are in range: lo < mid < head throughout.
    let mut best = lo;
    let (mut a, mut b) = (lo + 1, head - 1);
    while a <= b {
        let mid = a + (b - a) / 2;
        if timestamp_of(mid).await? <= target_secs {
            best = mid;
            a = mid + 1;
        } else {
            b = mid - 1;
        }
    }
    Ok(best)
}

/// The block a cron cycle pins its reads to: the block at `trigger_time_secs`,
/// then `lag` blocks back for reorg depth.
pub async fn resolve_inputs_block<F, Fut>(
    head: u64,
    trigger_time_secs: u64,
    lag: u64,
    timestamp_of: F,
) -> Result<u64, String>
where
    F: Fn(u64) -> Fut,
    Fut: Future<Output = Result<u64, String>>,
{
    let at_trigger = block_at_or_before(head, trigger_time_secs, timestamp_of).await?;
    at_trigger.checked_sub(lag).ok_or_else(|| {
        format!(
            "block {at_trigger} at trigger_time {trigger_time_secs} is shallower \
             than inputs_block_lag {lag}"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::Cell;
    use core::pin::pin;
    use core::task::{Context, Poll, Waker};

    /// Drive an immediately-ready future to completion. Every future in these
    /// tests resolves on the first poll (the timestamp lookups are table
    /// reads), so no reactor is needed.
    fn ready<F: Future>(fut: F) -> F::Output {
        let mut fut = pin!(fut);
        match fut.as_mut().poll(&mut Context::from_waker(Waker::noop())) {
            Poll::Ready(v) => v,
            Poll::Pending => panic!("test future must be immediately ready"),
        }
    }

    /// A synthetic chain: block `n` has timestamp `genesis + n * spacing`.
    /// Counts lookups so the search's probe budget stays visible.
    struct Chain {
        genesis: u64,
        spacing: u64,
        probes: Cell<u32>,
    }

    impl Chain {
        fn new(genesis: u64, spacing: u64) -> Self {
            Chain { genesis, spacing, probes: Cell::new(0) }
        }
        fn at(&self, n: u64) -> impl Future<Output = Result<u64, String>> + '_ {
            self.probes.set(self.probes.get() + 1);
            let ts = self.genesis + n * self.spacing;
            async move { Ok(ts) }
        }
    }

    // --- block at trigger time ---------------------------------------------

    #[test]
    fn picks_the_block_whose_timestamp_equals_trigger_time() {
        // 2s blocks from t=1000: block 500 is at t=2000.
        let c = Chain::new(1000, 2);
        let b = ready(block_at_or_before(600, 2000, |n| c.at(n))).unwrap();
        assert_eq!(b, 500);
    }

    #[test]
    fn picks_the_highest_block_at_or_before_never_after() {
        // trigger_time 2001 falls between block 500 (t=2000) and 501 (t=2002).
        let c = Chain::new(1000, 2);
        let b = ready(block_at_or_before(600, 2001, |n| c.at(n))).unwrap();
        assert_eq!(b, 500);
    }

    #[test]
    fn head_exactly_at_trigger_time_is_the_answer() {
        let c = Chain::new(1000, 2);
        let b = ready(block_at_or_before(500, 2000, |n| c.at(n))).unwrap();
        assert_eq!(b, 500);
        // One lookup: the head answered it outright.
        assert_eq!(c.probes.get(), 1);
    }

    #[test]
    fn two_operators_one_block_apart_resolve_the_same_block() {
        // The whole point: differing heads, identical answer.
        let a = Chain::new(1000, 2);
        let b = Chain::new(1000, 2);
        let from_a = ready(block_at_or_before(600, 2001, |n| a.at(n))).unwrap();
        let from_b = ready(block_at_or_before(637, 2001, |n| b.at(n))).unwrap();
        assert_eq!(from_a, from_b);
    }

    #[test]
    fn head_behind_trigger_time_fails_the_cycle() {
        // Node's head is at t=1998, cron fired at t=2000: it cannot know the
        // right block, so it must not sign at all.
        let c = Chain::new(1000, 2);
        let e = ready(block_at_or_before(499, 2000, |n| c.at(n))).unwrap_err();
        assert!(e.contains("trigger_time"), "{e}");
    }

    #[test]
    fn trigger_time_before_genesis_fails_the_cycle() {
        let c = Chain::new(1000, 2);
        assert!(ready(block_at_or_before(600, 999, |n| c.at(n))).is_err());
    }

    #[test]
    fn genesis_is_answerable() {
        let c = Chain::new(1000, 2);
        assert_eq!(ready(block_at_or_before(600, 1001, |n| c.at(n))).unwrap(), 0);
    }

    #[test]
    fn irregular_block_spacing_still_resolves() {
        // Explicit timestamp table with a stall between blocks 3 and 4.
        let table = [100u64, 110, 120, 130, 400, 410, 420];
        let lookup = |n: u64| {
            let ts = table[n as usize];
            async move { Ok(ts) }
        };
        assert_eq!(ready(block_at_or_before(6, 130, lookup)).unwrap(), 3);
        assert_eq!(ready(block_at_or_before(6, 399, lookup)).unwrap(), 3);
        assert_eq!(ready(block_at_or_before(6, 400, lookup)).unwrap(), 4);
    }

    #[test]
    fn probe_budget_is_logarithmic_in_the_gap_not_the_height() {
        // Head 50M blocks in, trigger_time only ~10 blocks back: the doubling
        // walk-back must bracket locally instead of bisecting from genesis
        // (which would cost ~26 RPC round trips every cycle).
        let c = Chain::new(0, 2);
        let head = 50_000_000u64;
        let b = ready(block_at_or_before(head, (head - 10) * 2, |n| c.at(n))).unwrap();
        assert_eq!(b, head - 10);
        assert!(c.probes.get() <= 12, "took {} probes", c.probes.get());
    }

    #[test]
    fn lookup_failure_fails_the_cycle() {
        let lookup = |_n: u64| async move { Err::<u64, String>("rpc down".to_string()) };
        assert!(ready(block_at_or_before(600, 2000, lookup)).is_err());
    }

    // --- lag application ----------------------------------------------------

    #[test]
    fn lag_is_applied_on_top_of_the_trigger_time_block() {
        let c = Chain::new(1000, 2);
        let b = ready(resolve_inputs_block(600, 2000, 2, |n| c.at(n))).unwrap();
        assert_eq!(b, 498);
    }

    #[test]
    fn zero_lag_pins_the_trigger_time_block_itself() {
        let c = Chain::new(1000, 2);
        assert_eq!(ready(resolve_inputs_block(600, 2000, 0, |n| c.at(n))).unwrap(), 500);
    }

    #[test]
    fn lag_deeper_than_the_chain_fails_the_cycle() {
        let c = Chain::new(1000, 2);
        assert!(ready(resolve_inputs_block(600, 1001, 5, |n| c.at(n))).is_err());
    }
}
