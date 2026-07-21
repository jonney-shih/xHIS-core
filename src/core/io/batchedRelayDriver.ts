/**
 * The fix `tests/benchmarks/outboxRelayVolume.bench.test.ts` measured a
 * need for: `relayEffects` (`relay.ts`) reads and parses the *entire*
 * source commit log on every call, so relaying after every single new
 * source commit means paying that full-log cost once per event, and
 * that cost only grows as history accumulates. Batching doesn't change
 * `relayEffects` at all — it already processes however many new entries
 * exist since the cursor in one call. The fix is entirely about *when*
 * a caller invokes it: coalesce several new source commits into one
 * relay call instead of one call per commit, amortizing one full-log
 * read across many events instead of paying it per event.
 */
export interface BatchingPolicy {
  /** Trigger a relay once at least this many source commits have
   * accumulated since the last one, even if `maxWaitMs` hasn't
   * elapsed yet. */
  readonly maxPendingCount: number;
  /** Trigger a relay once this many milliseconds have passed since the
   * oldest still-pending commit, even if `maxPendingCount` hasn't been
   * reached — bounds staleness during low-volume periods, so events
   * don't sit unrelayed indefinitely just because volume never crosses
   * the count threshold. */
  readonly maxWaitMs: number;
}

/**
 * Pure — no I/O, no ambient time. `msSincePending` is supplied by the
 * caller (see `createBatchedRelayDriver`), not read from a clock here,
 * the same "time is an explicit argument" discipline every handler in
 * this codebase already follows.
 */
export function shouldFlushBatch(pendingCount: number, msSincePending: number, policy: BatchingPolicy): boolean {
  if (pendingCount === 0) {
    return false;
  }
  return pendingCount >= policy.maxPendingCount || msSincePending >= policy.maxWaitMs;
}

export interface BatchedRelayDriver<TResult> {
  /** Call once for every new source commit, e.g. immediately after the
   * shell that produced it durably commits. Returns the relay's result
   * if this commit crossed a threshold and triggered a call, or `null`
   * if it's still accumulating. */
  onCommit(nowMs: number): TResult | null;
  /** Forces a relay now if anything is pending, regardless of whether
   * either threshold has been crossed — e.g. on graceful shutdown, so
   * nothing accumulated is ever silently left unflushed. Returns `null`
   * if nothing was pending. Takes no timestamp — unlike `onCommit`,
   * there is no threshold decision here to make time-aware. */
  flush(): TResult | null;
}

/**
 * Wraps any `relay` callback (typically a closure over
 * `relayPatientEffectsToBed`/`relayPatientEffectsToLab` and their
 * fixed arguments) with the accumulate-then-flush decision — the
 * driver has no idea what domain `relay` actually touches, the same
 * domain-agnostic split `relayEffects` itself already draws.
 *
 * State lives entirely in this closure, in-process — deliberately not
 * durable. The count of pending commits is something the caller already
 * knows the instant it happens (it just committed one), so there is no
 * "how many are pending" question this driver needs to answer by
 * reading anything back off disk; recovering that count durably across
 * a restart isn't a problem this needs to solve, since a restarted
 * process can just resume accumulating from zero — worst case, one
 * batch's worth of relaying happens slightly earlier than it would
 * have otherwise, never later, and `relayEffects`'s own cursor is what
 * actually guarantees no source commit is ever skipped regardless of
 * how this driver batches calls to it.
 */
export function createBatchedRelayDriver<TResult>(
  policy: BatchingPolicy,
  relay: () => TResult,
): BatchedRelayDriver<TResult> {
  let pendingCount = 0;
  let oldestPendingAtMs: number | undefined;

  function reset(): void {
    pendingCount = 0;
    oldestPendingAtMs = undefined;
  }

  return {
    onCommit(nowMs) {
      if (pendingCount === 0) {
        oldestPendingAtMs = nowMs;
      }
      pendingCount += 1;

      const msSincePending = nowMs - (oldestPendingAtMs ?? nowMs);
      if (!shouldFlushBatch(pendingCount, msSincePending, policy)) {
        return null;
      }

      const result = relay();
      reset();
      return result;
    },
    flush() {
      if (pendingCount === 0) {
        return null;
      }
      const result = relay();
      reset();
      return result;
    },
  };
}
