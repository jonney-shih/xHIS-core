import { describe, expect, it } from 'vitest';
import { counterEngine } from './fixtures/counterEngine.js';

describe('createEngine().execute', () => {
  it('routes to the Increment handler', () => {
    const result = counterEngine.execute({ value: 10 }, { kind: 'Increment', amount: 5 });

    expect(result).toEqual({
      ok: true,
      value: { context: { value: 15 }, effects: [{ kind: 'ValueChanged', value: 15 }] },
    });
  });

  it('routes to the Decrement handler', () => {
    const result = counterEngine.execute({ value: 10 }, { kind: 'Decrement', amount: 3 });

    expect(result).toEqual({
      ok: true,
      value: { context: { value: 7 }, effects: [{ kind: 'ValueChanged', value: 7 }] },
    });
  });

  it('surfaces a handler-returned error without throwing', () => {
    const result = counterEngine.execute({ value: 1 }, { kind: 'Decrement', amount: 5 });

    expect(result).toEqual({ ok: false, error: { kind: 'WouldGoNegative' } });
  });
});
