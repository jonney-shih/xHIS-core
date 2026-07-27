import { describe, expect, it } from 'vitest';
import { counterEngine } from './fixtures/counterEngine.js';
import type { CounterInstruction } from './fixtures/counterEngine.js';

/**
 * Proves the two properties `docs/DETERMINISTIC_CORE_PATTERN.md`'s
 * "Resolved: replay determinism and bounded allocation, made explicit"
 * section claims, rather than leaving them as an inference from "nothing
 * in `src/core/execution` calls `Date.now()`":
 *
 * 1. Replay determinism — the same instruction log, run against a fresh
 *    context each time, produces byte-for-byte (deep-equal) identical
 *    output every time, on however many independent runs.
 * 2. Bounded allocation — the `effects` array `executeSequence` builds
 *    grows exactly linearly with the instruction count it was given
 *    (one effect per instruction here), never faster and never with
 *    duplication or drift, at sizes well beyond this fixture's other
 *    tests.
 */
describe('createEngine().executeSequence — replay and allocation bounds', () => {
  // Starting value large enough that no mix of decrements this fixture
  // generates (amount 1-5, at most every third instruction) can ever
  // drive the running total negative, at any length used below — a
  // spurious `WouldGoNegative` here would be a fixture bug, not a
  // finding about replay or allocation, so it's avoided by construction
  // rather than by asserting `result.ok` and hoping.
  const SAFE_STARTING_VALUE = 100_000;

  function buildLog(length: number): CounterInstruction[] {
    return Array.from({ length }, (_, index) => ({
      kind: index % 3 === 0 ? 'Decrement' : 'Increment',
      amount: (index % 5) + 1,
    }));
  }

  it('replays the same instruction log to an identical result across independent runs', () => {
    const log = buildLog(200);
    const runs = Array.from({ length: 5 }, () =>
      counterEngine.executeSequence({ value: SAFE_STARTING_VALUE }, log),
    );

    const first = runs[0]!;
    expect(first.ok).toBe(true);
    for (const run of runs.slice(1)) {
      expect(run).toEqual(first);
    }
  });

  it.each([1, 10, 100, 2000])(
    'allocates exactly one effect per instruction for a %i-instruction log — linear, not super-linear',
    (length) => {
      const log = buildLog(length);
      const result = counterEngine.executeSequence({ value: SAFE_STARTING_VALUE }, log);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.effects).toHaveLength(length);
    },
  );

  it('never leaks or duplicates effects across replays sharing the same engine instance', () => {
    const log = buildLog(50);
    const firstRun = counterEngine.executeSequence({ value: SAFE_STARTING_VALUE }, log);
    const secondRun = counterEngine.executeSequence({ value: SAFE_STARTING_VALUE }, log);

    expect(firstRun).toEqual(secondRun);
    if (!firstRun.ok || !secondRun.ok) throw new Error('expected ok');
    // Re-running against the same engine must not carry over state from
    // the previous call — `executeSequence` takes context fresh every
    // time, it never accumulates it across calls.
    expect(secondRun.value.effects).toHaveLength(log.length);
  });
});
