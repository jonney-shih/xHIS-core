import { describe, expect, it } from 'vitest';
import { createBatchedRelayDriver, shouldFlushBatch } from '../../../src/core/io/batchedRelayDriver.js';
import type { BatchingPolicy } from '../../../src/core/io/batchedRelayDriver.js';

const policy: BatchingPolicy = { maxPendingCount: 3, maxWaitMs: 1000 };

describe('shouldFlushBatch', () => {
  it('never flushes an empty batch, regardless of elapsed time', () => {
    expect(shouldFlushBatch(0, 10_000, policy)).toBe(false);
  });

  it('does not flush below both thresholds', () => {
    expect(shouldFlushBatch(1, 100, policy)).toBe(false);
  });

  it('flushes once pendingCount reaches maxPendingCount', () => {
    expect(shouldFlushBatch(3, 0, policy)).toBe(true);
  });

  it('flushes once msSincePending reaches maxWaitMs, even with only one pending', () => {
    expect(shouldFlushBatch(1, 1000, policy)).toBe(true);
  });
});

function makeCountingRelay() {
  let calls = 0;
  return { relay: () => { calls += 1; return calls; }, callCount: () => calls };
}

describe('createBatchedRelayDriver', () => {
  it('does not call relay until the count threshold is reached', () => {
    const { relay, callCount } = makeCountingRelay();
    const driver = createBatchedRelayDriver(policy, relay);

    expect(driver.onCommit(0)).toBeNull();
    expect(driver.onCommit(10)).toBeNull();
    expect(callCount()).toBe(0);
  });

  it('calls relay exactly once when the count threshold is crossed, and resets afterward', () => {
    const { relay, callCount } = makeCountingRelay();
    const driver = createBatchedRelayDriver(policy, relay);

    expect(driver.onCommit(0)).toBeNull();
    expect(driver.onCommit(10)).toBeNull();
    expect(driver.onCommit(20)).toBe(1); // 3rd commit crosses maxPendingCount
    expect(callCount()).toBe(1);

    // A fresh batch starts accumulating — not still "2 over the limit".
    expect(driver.onCommit(30)).toBeNull();
    expect(callCount()).toBe(1);
  });

  it('triggers on elapsed time even when the count threshold is never reached', () => {
    const { relay, callCount } = makeCountingRelay();
    const driver = createBatchedRelayDriver(policy, relay);

    expect(driver.onCommit(0)).toBeNull(); // pending since t=0
    expect(driver.onCommit(500)).toBeNull(); // still under maxWaitMs
    expect(driver.onCommit(1000)).toBe(1); // 1000ms since the oldest pending commit
    expect(callCount()).toBe(1);
  });

  it('does not let elapsed time leak across batches: a fresh batch gets a fresh clock', () => {
    const { relay, callCount } = makeCountingRelay();
    const driver = createBatchedRelayDriver(policy, relay);

    driver.onCommit(0);
    driver.onCommit(500);
    driver.onCommit(1000); // triggers on elapsed time, resets
    expect(callCount()).toBe(1);

    // If the old oldestPendingAtMs (0) had leaked forward, this would
    // immediately trigger again — it must not.
    expect(driver.onCommit(1001)).toBeNull();
    expect(callCount()).toBe(1);
  });

  it('flush() triggers a relay immediately regardless of thresholds', () => {
    const { relay, callCount } = makeCountingRelay();
    const driver = createBatchedRelayDriver(policy, relay);

    driver.onCommit(0); // just one pending, nowhere near either threshold
    expect(driver.flush()).toBe(1);
    expect(callCount()).toBe(1);
  });

  it('flush() is a no-op when nothing is pending', () => {
    const { relay, callCount } = makeCountingRelay();
    const driver = createBatchedRelayDriver(policy, relay);

    expect(driver.flush()).toBeNull();
    expect(callCount()).toBe(0);
  });

  it('flush() after a threshold-triggered relay finds nothing left pending', () => {
    const { relay, callCount } = makeCountingRelay();
    const driver = createBatchedRelayDriver(policy, relay);

    driver.onCommit(0);
    driver.onCommit(10);
    driver.onCommit(20); // triggers
    expect(callCount()).toBe(1);

    expect(driver.flush()).toBeNull();
    expect(callCount()).toBe(1);
  });
});
