import { describe, expect, it } from 'vitest';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { telemetry } from '../../../src/telemetry/hook.js';
import type { TelemetryEvent } from '../../../src/telemetry/types.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';

/**
 * Proves `act()`'s additive telemetry wiring on its two failure paths
 * that have a corresponding `TelemetryEvent` variant (see `act.ts`'s own
 * doc comments on each `telemetry.emit` call): a failed dry run
 * (`HandlerException`) and a stale commit-time race
 * (`CommitConflict`). Both emit only when `telemetryTag` is supplied —
 * every pre-existing call site in `tests/agentic/shell/act.test.ts`
 * omits it and keeps behaving exactly as before.
 */
const admit: PatientInstruction = {
  kind: 'AdmitPatient',
  patientId: patientId('patient-1'),
  encounterId: encounterId('encounter-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

const proposal: PlanProposal<PatientInstruction> = {
  instructions: [admit],
  rationale: 'test proposal',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-19T00:00:00.000Z',
};

function newShell() {
  return createInMemoryShell<PatientContext, PatientInstruction, PatientEffect>();
}

function reexecute(ctx: PatientContext) {
  return patientEngine.executeSequence(ctx, proposal.instructions);
}

function collectTelemetry(): { received: TelemetryEvent[]; unsubscribe: () => void } {
  const received: TelemetryEvent[] = [];
  const unsubscribe = telemetry.subscribe((event) => received.push(event));
  return { received, unsubscribe };
}

describe('act telemetry', () => {
  it('emits nothing when telemetryTag is omitted, even on a failing path -- fully additive', () => {
    const { received, unsubscribe } = collectTelemetry();
    const shell = newShell();
    const alreadyAdmittedContext: PatientContext = {
      encounters: {
        'encounter-1': {
          encounterId: encounterId('encounter-1'),
          patientId: patientId('patient-1'),
          status: 'admitted',
          admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
        },
      },
    };
    const doOutcome = patientEngine.executeSequence(alreadyAdmittedContext, proposal.instructions);

    try {
      const outcome = act(shell, {
        proposal,
        doOutcome,
        decision: { kind: 'accept' },
        baselineContext: alreadyAdmittedContext,
        reexecute,
        recordedAt: '2026-07-19T00:00:01.000Z',
      });
      expect(outcome).toBe('rejected');
    } finally {
      unsubscribe();
    }

    expect(received).toEqual([]);
  });

  it('emits a HandlerException event when the dry run failed and a telemetryTag was supplied', () => {
    const { received, unsubscribe } = collectTelemetry();
    const shell = newShell();
    const alreadyAdmittedContext: PatientContext = {
      encounters: {
        'encounter-1': {
          encounterId: encounterId('encounter-1'),
          patientId: patientId('patient-1'),
          status: 'admitted',
          admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
        },
      },
    };
    const doOutcome = patientEngine.executeSequence(alreadyAdmittedContext, proposal.instructions);

    try {
      const outcome = act(shell, {
        proposal,
        doOutcome,
        decision: { kind: 'accept' },
        baselineContext: alreadyAdmittedContext,
        reexecute,
        recordedAt: '2026-07-19T00:00:01.000Z',
        telemetryTag: { domain: 'patient', correlationId: 'encounter-1' },
      });
      expect(outcome).toBe('rejected');
    } finally {
      unsubscribe();
    }

    expect(received).toEqual([
      {
        kind: 'HandlerException',
        domain: 'patient',
        correlationId: 'encounter-1',
        recordedAt: '2026-07-19T00:00:01.000Z',
        message: 'dry run failed at instruction 0',
      },
    ]);
  });

  it('emits a CommitConflict event on the stale-commit race when a telemetryTag was supplied', () => {
    const { received, unsubscribe } = collectTelemetry();
    const shell = newShell();
    const emptyContext: PatientContext = { encounters: {} };
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    // Simulate something else having already committed the same
    // encounter between Do and Act -- the exact race
    // `actStaleCommitRace.test.ts` proves `act()` closes.
    shell.commit(
      {
        encounters: {
          'encounter-1': {
            encounterId: encounterId('encounter-1'),
            patientId: patientId('patient-1'),
            status: 'admitted',
            admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
          },
        },
      },
      [],
    );

    try {
      const outcome = act(shell, {
        proposal,
        doOutcome,
        decision: { kind: 'accept' },
        baselineContext: emptyContext,
        reexecute,
        recordedAt: '2026-07-19T00:00:01.000Z',
        telemetryTag: { domain: 'patient', correlationId: 'encounter-1' },
      });
      expect(outcome).toBe('stale');
    } finally {
      unsubscribe();
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: 'CommitConflict', domain: 'patient', correlationId: 'encounter-1' });
  });
});
