import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { readCommits, createFileShell } from '../../src/agentic/shell/fileShell.js';
import { relayPatientEffectsToScheduling } from '../../src/integration/outboxRelayScheduling.js';
import { schedulingEngine } from '../../src/instructions/scheduling/engine.js';
import { bookingId, resourceId, isoTimestamp as schedulingIsoTimestamp } from '../../src/instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingEffect, SchedulingInstruction } from '../../src/instructions/scheduling/types.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../src/instructions/patient/types.js';

let dir: string;
let patientCommitsFile: string;
let schedulingCommitsFile: string;
let schedulingAuditFile: string;
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-relay-scheduling-'));
  patientCommitsFile = join(dir, 'patient-commits.jsonl');
  schedulingCommitsFile = join(dir, 'scheduling-commits.jsonl');
  schedulingAuditFile = join(dir, 'scheduling-audit.jsonl');
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function schedulingShell() {
  return createFileShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>({
    commitsFile: schedulingCommitsFile,
    auditFile: schedulingAuditFile,
  });
}

/** Mimics what a real caller of `act()` does for patient instructions —
 * same helper `outboxRelay.test.ts`/`outboxRelayLab.test.ts`/
 * `outboxRelayImaging.test.ts` use. */
function commitPatientInstructions(context: PatientContext, instructions: readonly PatientInstruction[]): PatientContext {
  const outcome = patientEngine.executeSequence(context, instructions);
  if (!outcome.ok) throw new Error('expected patient instructions to succeed in this test');

  createFileShell<PatientContext, PatientInstruction, PatientEffect>({
    commitsFile: patientCommitsFile,
    auditFile: join(dir, 'patient-audit.jsonl'),
  }).commit(outcome.value.context, outcome.value.effects);

  return outcome.value.context;
}

function schedulingContextWithTwoPendingBookings(): SchedulingContext {
  return {
    bookings: {
      'booking-1': {
        bookingId: bookingId('booking-1'),
        resourceId: resourceId('or-1'),
        subjectId: 'encounter-1',
        startAt: schedulingIsoTimestamp('2026-07-21T09:00:00.000Z'),
        endAt: schedulingIsoTimestamp('2026-07-21T10:00:00.000Z'),
        status: 'scheduled',
      },
      'booking-2': {
        bookingId: bookingId('booking-2'),
        resourceId: resourceId('ct-1'),
        subjectId: 'encounter-1',
        startAt: schedulingIsoTimestamp('2026-07-21T11:00:00.000Z'),
        endAt: schedulingIsoTimestamp('2026-07-21T11:30:00.000Z'),
        status: 'scheduled',
      },
    },
  };
}

describe('relayPatientEffectsToScheduling', () => {
  it('processes a durably committed discharge and durably commits the cancellations', () => {
    let patientContext = commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z') },
    ]);
    patientContext = commitPatientInstructions(patientContext, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-22T00:00:00.000Z') },
    ]);
    void patientContext;

    const result = relayPatientEffectsToScheduling(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      schedulingShell(),
      schedulingEngine,
      schedulingContextWithTwoPendingBookings(),
      schedulingIsoTimestamp('2026-07-22T00:01:00.000Z'),
    );

    expect(result.outcomes).toEqual([
      { kind: 'no-pending-bookings', encounterId: 'encounter-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', bookingId: 'booking-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', bookingId: 'booking-2' },
    ]);
    expect(result.processedThroughIndex).toBe(2);
    expect(readCommits(schedulingCommitsFile)).toHaveLength(1); // admission produced no scheduling commit; discharge produced one
  });

  it('running again with no new patient commits processes nothing new', () => {
    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z') },
    ]);

    const cursor = createFileOutboxCursor(cursorFile);
    const first = relayPatientEffectsToScheduling(
      patientCommitsFile,
      cursor,
      schedulingShell(),
      schedulingEngine,
      { bookings: {} },
      schedulingIsoTimestamp('2026-07-21T00:01:00.000Z'),
    );

    const second = relayPatientEffectsToScheduling(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      schedulingShell(),
      schedulingEngine,
      first.context,
      schedulingIsoTimestamp('2026-07-21T00:02:00.000Z'),
    );

    expect(second.outcomes).toEqual([]);
    expect(second.processedThroughIndex).toBe(1);
  });

  it('safely redelivers an already-processed discharge: a reset cursor finds nothing left to cancel', () => {
    let patientContext = commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z') },
    ]);
    patientContext = commitPatientInstructions(patientContext, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-22T00:00:00.000Z') },
    ]);
    void patientContext;

    const shell = schedulingShell();
    const first = relayPatientEffectsToScheduling(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      shell,
      schedulingEngine,
      schedulingContextWithTwoPendingBookings(),
      schedulingIsoTimestamp('2026-07-22T00:01:00.000Z'),
    );
    expect(first.outcomes).toContainEqual({ kind: 'cancelled', encounterId: 'encounter-1', bookingId: 'booking-1' });

    const resetCursor = createFileOutboxCursor(join(dir, 'cursor-reset.jsonl'));
    const redelivered = relayPatientEffectsToScheduling(
      patientCommitsFile,
      resetCursor,
      shell,
      schedulingEngine,
      first.context,
      schedulingIsoTimestamp('2026-07-22T00:02:00.000Z'),
    );

    expect(redelivered.outcomes).toEqual([
      { kind: 'no-pending-bookings', encounterId: 'encounter-1' },
      { kind: 'no-pending-bookings', encounterId: 'encounter-1' },
    ]);
    expect(redelivered.context.bookings['booking-1'].status).toBe('cancelled');
    expect(redelivered.context.bookings['booking-2'].status).toBe('cancelled');
  });

  it('never touches a booking whose subjectId is not this encounter, even when relayed durably', () => {
    let patientContext = commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z') },
    ]);
    patientContext = commitPatientInstructions(patientContext, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-22T00:00:00.000Z') },
    ]);
    void patientContext;

    const maintenanceContext: SchedulingContext = {
      bookings: {
        'booking-maintenance': {
          bookingId: bookingId('booking-maintenance'),
          resourceId: resourceId('mri-1'),
          subjectId: 'quarterly-maintenance',
          startAt: schedulingIsoTimestamp('2026-07-21T09:00:00.000Z'),
          endAt: schedulingIsoTimestamp('2026-07-21T12:00:00.000Z'),
          status: 'scheduled',
        },
      },
    };

    const result = relayPatientEffectsToScheduling(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      schedulingShell(),
      schedulingEngine,
      maintenanceContext,
      schedulingIsoTimestamp('2026-07-22T00:01:00.000Z'),
    );

    expect(result.outcomes).toEqual([
      { kind: 'no-pending-bookings', encounterId: 'encounter-1' },
      { kind: 'no-pending-bookings', encounterId: 'encounter-1' },
    ]);
    expect(result.context.bookings['booking-maintenance']!.status).toBe('scheduled');
  });
});
