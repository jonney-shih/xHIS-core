import { isoTimestamp } from '@xhis/core';
import type { TelemetryEvent } from '@xhis/core';
import { describe, expect, it } from 'vitest';
import { createOpsPlanner } from '../../../src/agentic/planning/opsPlanner.js';

const sandboxTimeout: TelemetryEvent = {
  kind: 'SandboxTimeout',
  domain: 'ops',
  correlationId: 'sandbox-1',
  recordedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
  unresponsiveForMs: 30_000,
};

const handlerException: TelemetryEvent = {
  kind: 'HandlerException',
  domain: 'patient',
  correlationId: 'AdmitPatient',
  recordedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
  message: 'boom',
};

describe('ops planner', () => {
  it('maps a SandboxTimeout event to a raw ReprovisionSandbox candidate', async () => {
    const planner = createOpsPlanner();

    const result = await planner.plan(
      { description: 'self-heal from telemetry' },
      { events: [sandboxTimeout] },
      '2026-08-01T00:00:01.000Z',
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'ReprovisionSandbox', sandboxId: 'sandbox-1', requestedAt: '2026-08-01T00:00:01.000Z' },
    ]);
  });

  it('does not propose anything for event kinds it has no remediation rule for yet', async () => {
    const planner = createOpsPlanner();

    const result = await planner.plan(
      { description: 'self-heal from telemetry' },
      { events: [handlerException] },
      '2026-08-01T00:00:01.000Z',
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('handles a mixed batch, only proposing for the events it has a rule for', async () => {
    const planner = createOpsPlanner();

    const result = await planner.plan(
      { description: 'self-heal from telemetry' },
      { events: [handlerException, sandboxTimeout] },
      '2026-08-01T00:00:01.000Z',
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toHaveLength(1);
    expect(result.value.instructions[0]).toMatchObject({ kind: 'ReprovisionSandbox', sandboxId: 'sandbox-1' });
  });
});
