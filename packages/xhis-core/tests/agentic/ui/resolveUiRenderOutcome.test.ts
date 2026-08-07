import { describe, expect, it } from 'vitest';
import { resolveUiRenderOutcome } from '../../../src/agentic/ui/resolveUiRenderOutcome.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import type { RawUiRenderOutput } from '../../../src/agentic/ui/toUiRenderProposal.js';
import { exampleComponentPropsValidators } from './fixtures/exampleComponents.js';

function rawOutput(component: unknown): RawUiRenderOutput {
  return { component, rationale: 'test rationale', modelVersion: 'stub-v0', promptVersion: 'stub-v0' };
}

describe('resolveUiRenderOutcome', () => {
  it('resolves to render for a valid proposal, and records it in telemetry', () => {
    const telemetryLog = createInMemoryUiProposalTelemetryLog();

    const outcome = resolveUiRenderOutcome({
      registry: exampleComponentPropsValidators,
      raw: rawOutput({ component: 'PatientSummaryCard', props: { encounterId: 'encounter-1', summaryText: 'stable, afebrile' } }),
      proposedAt: '2026-07-30T00:00:00.000Z',
      telemetryLog,
      recordedAt: '2026-07-30T00:00:01.000Z',
    });

    expect(outcome).toEqual({
      kind: 'render',
      component: { component: 'PatientSummaryCard', props: { encounterId: 'encounter-1', summaryText: 'stable, afebrile' } },
    });
    expect(telemetryLog.entries).toEqual([
      { component: 'PatientSummaryCard', outcome: 'rendered', reasons: [], recordedAt: '2026-07-30T00:00:01.000Z' },
    ]);
  });

  it('resolves to fallback for an invalid proposal, never a silent render, and records the attempted component and reasons', () => {
    const telemetryLog = createInMemoryUiProposalTelemetryLog();

    const outcome = resolveUiRenderOutcome({
      registry: exampleComponentPropsValidators,
      raw: rawOutput({ component: 'PatientSummaryCard', props: { encounterId: 'encounter-1' } }), // missing summaryText
      proposedAt: '2026-07-30T00:00:00.000Z',
      telemetryLog,
      recordedAt: '2026-07-30T00:00:01.000Z',
    });

    expect(outcome).toEqual({ kind: 'fallback', reasons: ["'props.summaryText' must be a non-empty string"] });
    expect(telemetryLog.entries).toEqual([
      {
        component: 'PatientSummaryCard',
        outcome: 'fallback',
        reasons: ["'props.summaryText' must be a non-empty string"],
        recordedAt: '2026-07-30T00:00:01.000Z',
      },
    ]);
  });

  it('still records a fallback entry, with component "unknown", when the candidate has no readable component field at all', () => {
    const telemetryLog = createInMemoryUiProposalTelemetryLog();

    const outcome = resolveUiRenderOutcome({
      registry: exampleComponentPropsValidators,
      raw: rawOutput('not even an object'),
      proposedAt: '2026-07-30T00:00:00.000Z',
      telemetryLog,
      recordedAt: '2026-07-30T00:00:01.000Z',
    });

    expect(outcome.kind).toBe('fallback');
    expect(telemetryLog.entries[0]).toMatchObject({ component: 'unknown', outcome: 'fallback' });
  });

  it('never renders a hallucinated component kind the registry has no validator for', () => {
    const telemetryLog = createInMemoryUiProposalTelemetryLog();

    const outcome = resolveUiRenderOutcome({
      registry: exampleComponentPropsValidators,
      raw: rawOutput({ component: 'DeleteAllPatientRecordsPanel', props: {} }),
      proposedAt: '2026-07-30T00:00:00.000Z',
      telemetryLog,
      recordedAt: '2026-07-30T00:00:01.000Z',
    });

    expect(outcome).toEqual({ kind: 'fallback', reasons: ["unknown component 'DeleteAllPatientRecordsPanel'"] });
  });
});
