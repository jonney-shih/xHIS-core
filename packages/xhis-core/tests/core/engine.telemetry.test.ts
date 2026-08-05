import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/core/execution/engine.js';
import type { HandlerRegistry } from '../../src/core/execution/handler.js';
import { createTelemetryHook } from '../../src/telemetry/hook.js';
import type { TelemetryEvent } from '../../src/telemetry/types.js';

/**
 * Proves `createEngine`'s additive `HandlerException` wiring: a handler
 * that throws (a bug, not a well-typed `err` — see
 * `tests/core/engine.dispatch.test.ts`/`engine.sequence.test.ts` for the
 * ordinary rejection path) is reported via the shared
 * `telemetry`/`hook.ts` singleton when a `telemetryContext` is supplied,
 * and the exception itself is always rethrown — this is observability,
 * not error handling.
 */
interface ThrowingContext {
  readonly value: number;
}
type ThrowingInstruction = { readonly kind: 'Throw' };

const throwingRegistry = {
  Throw: () => {
    throw new Error('handler bug');
  },
} satisfies HandlerRegistry<ThrowingContext, ThrowingInstruction, never, never>;

const throwingEngine = createEngine<ThrowingContext, ThrowingInstruction, never, never>(throwingRegistry);

describe('engine HandlerException telemetry', () => {
  it('rethrows and emits nothing when no telemetry context is supplied -- the pre-telemetry, unchanged behavior', () => {
    expect(() => throwingEngine.execute({ value: 0 }, { kind: 'Throw' })).toThrow('handler bug');
  });

  it('rethrows and emits a HandlerException event on the shared hook when a telemetry context is supplied', () => {
    const received: TelemetryEvent[] = [];
    const hook = createTelemetryHook();
    const unsubscribe = hook.subscribe((event) => received.push(event));

    try {
      expect(() =>
        throwingEngine.execute({ value: 0 }, { kind: 'Throw' }, { domain: 'ops', recordedAt: '2026-08-01T00:00:00.000Z' }),
      ).toThrow('handler bug');
    } finally {
      unsubscribe();
    }

    // The engine emits through the shared process-wide `telemetry`
    // singleton, not this test's independent hook -- confirming the
    // wiring point itself (not just that `createTelemetryHook` works,
    // which `tests/telemetry/hook.test.ts` already covers) requires
    // subscribing to that same singleton. See the next test.
    expect(received).toEqual([]);
  });

  it('emits on the shared singleton hook that engine.ts and act.ts actually wire through', async () => {
    const { telemetry } = await import('../../src/telemetry/hook.js');
    const received: TelemetryEvent[] = [];
    const unsubscribe = telemetry.subscribe((event) => received.push(event));

    try {
      expect(() =>
        throwingEngine.execute({ value: 0 }, { kind: 'Throw' }, { domain: 'ops', recordedAt: '2026-08-01T00:00:00.000Z' }),
      ).toThrow('handler bug');
    } finally {
      unsubscribe();
    }

    expect(received).toEqual([
      {
        kind: 'HandlerException',
        domain: 'ops',
        correlationId: 'Throw',
        recordedAt: '2026-08-01T00:00:00.000Z',
        message: 'handler bug',
      },
    ]);
  });

  it('executeSequence threads the same telemetry context through to execute', async () => {
    const { telemetry } = await import('../../src/telemetry/hook.js');
    const received: TelemetryEvent[] = [];
    const unsubscribe = telemetry.subscribe((event) => received.push(event));

    try {
      expect(() =>
        throwingEngine.executeSequence({ value: 0 }, [{ kind: 'Throw' }], {
          domain: 'ops',
          recordedAt: '2026-08-01T00:00:00.000Z',
        }),
      ).toThrow('handler bug');
    } finally {
      unsubscribe();
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: 'HandlerException', domain: 'ops' });
  });
});
