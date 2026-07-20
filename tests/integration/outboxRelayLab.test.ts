import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { readCommits, createFileShell } from '../../src/agentic/shell/fileShell.js';
import { relayPatientEffectsToLab } from '../../src/integration/outboxRelayLab.js';
import { labEngine } from '../../src/instructions/lab/engine.js';
import { labOrderId, isoTimestamp as labIsoTimestamp } from '../../src/instructions/lab/ids.js';
import type { LabContext, LabEffect, LabInstruction } from '../../src/instructions/lab/types.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../src/instructions/patient/types.js';

let dir: string;
let patientCommitsFile: string;
let labCommitsFile: string;
let labAuditFile: string;
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-relay-lab-'));
  patientCommitsFile = join(dir, 'patient-commits.jsonl');
  labCommitsFile = join(dir, 'lab-commits.jsonl');
  labAuditFile = join(dir, 'lab-audit.jsonl');
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function labShell() {
  return createFileShell<LabContext, LabInstruction, LabEffect>({ commitsFile: labCommitsFile, auditFile: labAuditFile });
}

/** Mimics what a real caller of `act()` does for patient instructions —
 * same helper `outboxRelay.test.ts` uses for bed. */
function commitPatientInstructions(context: PatientContext, instructions: readonly PatientInstruction[]): PatientContext {
  const outcome = patientEngine.executeSequence(context, instructions);
  if (!outcome.ok) throw new Error('expected patient instructions to succeed in this test');

  createFileShell<PatientContext, PatientInstruction, PatientEffect>({
    commitsFile: patientCommitsFile,
    auditFile: join(dir, 'patient-audit.jsonl'),
  }).commit(outcome.value.context, outcome.value.effects);

  return outcome.value.context;
}

function labContextWithTwoPendingOrders(): LabContext {
  return {
    orders: {
      'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'ordered', orderedAt: labIsoTimestamp('2026-07-18T00:05:00.000Z') },
      'order-2': { orderId: labOrderId('order-2'), encounterId: encounterId('encounter-1'), testCode: 'BMP', status: 'ordered', orderedAt: labIsoTimestamp('2026-07-18T00:06:00.000Z') },
    },
  };
}

describe('relayPatientEffectsToLab', () => {
  it('processes a durably committed discharge and durably commits the cancellations', () => {
    let patientContext = commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
    ]);
    patientContext = commitPatientInstructions(patientContext, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-19T00:00:00.000Z') },
    ]);
    void patientContext;

    const result = relayPatientEffectsToLab(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      labShell(),
      labEngine,
      labContextWithTwoPendingOrders(),
      labIsoTimestamp('2026-07-19T00:01:00.000Z'),
    );

    expect(result.outcomes).toEqual([
      { kind: 'no-pending-orders', encounterId: 'encounter-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', orderId: 'order-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', orderId: 'order-2' },
    ]);
    expect(result.processedThroughIndex).toBe(2);
    expect(readCommits(labCommitsFile)).toHaveLength(1); // admission produced no lab commit; discharge produced one
  });

  it('running again with no new patient commits processes nothing new', () => {
    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
    ]);

    const cursor = createFileOutboxCursor(cursorFile);
    const first = relayPatientEffectsToLab(patientCommitsFile, cursor, labShell(), labEngine, { orders: {} }, labIsoTimestamp('2026-07-18T00:01:00.000Z'));

    const second = relayPatientEffectsToLab(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      labShell(),
      labEngine,
      first.context,
      labIsoTimestamp('2026-07-18T00:02:00.000Z'),
    );

    expect(second.outcomes).toEqual([]);
    expect(second.processedThroughIndex).toBe(1);
  });

  it('safely redelivers an already-processed discharge: a reset cursor finds nothing left to cancel', () => {
    let patientContext = commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
    ]);
    patientContext = commitPatientInstructions(patientContext, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-19T00:00:00.000Z') },
    ]);
    void patientContext;

    const shell = labShell();
    const first = relayPatientEffectsToLab(patientCommitsFile, createFileOutboxCursor(cursorFile), shell, labEngine, labContextWithTwoPendingOrders(), labIsoTimestamp('2026-07-19T00:01:00.000Z'));
    expect(first.outcomes).toContainEqual({ kind: 'cancelled', encounterId: 'encounter-1', orderId: 'order-1' });

    const resetCursor = createFileOutboxCursor(join(dir, 'cursor-reset.jsonl'));
    const redelivered = relayPatientEffectsToLab(
      patientCommitsFile,
      resetCursor,
      shell,
      labEngine,
      first.context,
      labIsoTimestamp('2026-07-19T00:02:00.000Z'),
    );

    expect(redelivered.outcomes).toEqual([
      { kind: 'no-pending-orders', encounterId: 'encounter-1' },
      { kind: 'no-pending-orders', encounterId: 'encounter-1' },
    ]);
    expect(redelivered.context.orders['order-1'].status).toBe('cancelled');
    expect(redelivered.context.orders['order-2'].status).toBe('cancelled');
  });
});
