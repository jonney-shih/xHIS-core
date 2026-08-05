import { describe, expect, it } from 'vitest';
import { counterEngine } from './fixtures/counterEngine.js';

describe('createEngine().executeSequence', () => {
  it('applies every instruction and concatenates effects when the whole batch succeeds', () => {
    const result = counterEngine.executeSequence({ value: 0 }, [
      { kind: 'Increment', amount: 5 },
      { kind: 'Decrement', amount: 2 },
      { kind: 'Increment', amount: 1 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.context).toEqual({ value: 4 });
    expect(result.value.effects).toEqual([
      { kind: 'ValueChanged', value: 5 },
      { kind: 'ValueChanged', value: 3 },
      { kind: 'ValueChanged', value: 4 },
    ]);
  });

  it('short-circuits on the first failing instruction and does not apply the rest', () => {
    const result = counterEngine.executeSequence({ value: 3 }, [
      { kind: 'Decrement', amount: 1 }, // succeeds: value -> 2
      { kind: 'Decrement', amount: 5 }, // fails: would go negative
      { kind: 'Increment', amount: 100 }, // must never run
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.failedAtIndex).toBe(1);
    expect(result.error.error).toEqual({ kind: 'WouldGoNegative' });
  });

  it('exposes the pre-failure state only as a diagnostic, all-or-nothing contract', () => {
    const result = counterEngine.executeSequence({ value: 3 }, [
      { kind: 'Decrement', amount: 1 },
      { kind: 'Decrement', amount: 5 },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    // The successful first step is visible for diagnostics...
    expect(result.error.diagnosticPrefix.context).toEqual({ value: 2 });
    expect(result.error.diagnosticPrefix.effects).toEqual([{ kind: 'ValueChanged', value: 2 }]);
    // ...but the overall result is `err`: a caller that only branches on
    // `result.ok` before applying effects can never apply a partial batch.
    expect(result.ok).toBe(false);
  });
});
