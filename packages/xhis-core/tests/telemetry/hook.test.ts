import { describe, expect, it } from 'vitest';
import { createTelemetryHook } from '../../src/telemetry/hook.js';
import { isoTimestamp } from '../../src/core/temporal.js';
import type { TelemetryEvent } from '../../src/telemetry/types.js';

const EXAMPLE_EVENT: TelemetryEvent = {
  kind: 'SandboxTimeout',
  domain: 'ops',
  correlationId: 'sandbox-1',
  recordedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
  unresponsiveForMs: 30_000,
};

describe('telemetry hook', () => {
  it('delivers an emitted event to every subscribed listener', () => {
    const hook = createTelemetryHook();
    const receivedByFirst: TelemetryEvent[] = [];
    const receivedBySecond: TelemetryEvent[] = [];

    hook.subscribe((event) => receivedByFirst.push(event));
    hook.subscribe((event) => receivedBySecond.push(event));

    hook.emit(EXAMPLE_EVENT);

    expect(receivedByFirst).toEqual([EXAMPLE_EVENT]);
    expect(receivedBySecond).toEqual([EXAMPLE_EVENT]);
  });

  it('is a no-op with no subscribers -- emitting never throws or does anything observable', () => {
    const hook = createTelemetryHook();
    expect(() => hook.emit(EXAMPLE_EVENT)).not.toThrow();
  });

  it('subscribe returns an unsubscribe function that stops further delivery', () => {
    const hook = createTelemetryHook();
    const received: TelemetryEvent[] = [];
    const unsubscribe = hook.subscribe((event) => received.push(event));

    hook.emit(EXAMPLE_EVENT);
    unsubscribe();
    hook.emit(EXAMPLE_EVENT);

    expect(received).toEqual([EXAMPLE_EVENT]);
  });

  it('a listener unsubscribing itself mid-emit does not perturb delivery to the others', () => {
    const hook = createTelemetryHook();
    const received: TelemetryEvent[] = [];
    let unsubscribeSelf: () => void;

    unsubscribeSelf = hook.subscribe(() => {
      unsubscribeSelf();
    });
    hook.subscribe((event) => received.push(event));

    expect(() => hook.emit(EXAMPLE_EVENT)).not.toThrow();
    expect(received).toEqual([EXAMPLE_EVENT]);
  });

  it('independently constructed hooks do not share listeners', () => {
    const hookA = createTelemetryHook();
    const hookB = createTelemetryHook();
    const receivedByA: TelemetryEvent[] = [];

    hookA.subscribe((event) => receivedByA.push(event));
    hookB.emit(EXAMPLE_EVENT);

    expect(receivedByA).toEqual([]);
  });
});
