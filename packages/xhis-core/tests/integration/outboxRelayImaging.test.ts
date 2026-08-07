import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { readCommits, createFileShell } from '../../src/agentic/shell/fileShell.js';
import { relayPatientEffectsToImaging } from '../../src/integration/outboxRelayImaging.js';
import { imagingEngine } from '../../src/instructions/imaging/engine.js';
import { studyId, isoTimestamp as imagingIsoTimestamp } from '../../src/instructions/imaging/ids.js';
import type { ImagingContext, ImagingEffect, ImagingInstruction } from '../../src/instructions/imaging/types.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../src/instructions/patient/types.js';

let dir: string;
let patientCommitsFile: string;
let imagingCommitsFile: string;
let imagingAuditFile: string;
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-relay-imaging-'));
  patientCommitsFile = join(dir, 'patient-commits.jsonl');
  imagingCommitsFile = join(dir, 'imaging-commits.jsonl');
  imagingAuditFile = join(dir, 'imaging-audit.jsonl');
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function imagingShell() {
  return createFileShell<ImagingContext, ImagingInstruction, ImagingEffect>({ commitsFile: imagingCommitsFile, auditFile: imagingAuditFile });
}

/** Mimics what a real caller of `act()` does for patient instructions —
 * same helper `outboxRelay.test.ts`/`outboxRelayLab.test.ts` use. */
function commitPatientInstructions(context: PatientContext, instructions: readonly PatientInstruction[]): PatientContext {
  const outcome = patientEngine.executeSequence(context, instructions);
  if (!outcome.ok) throw new Error('expected patient instructions to succeed in this test');

  createFileShell<PatientContext, PatientInstruction, PatientEffect>({
    commitsFile: patientCommitsFile,
    auditFile: join(dir, 'patient-audit.jsonl'),
  }).commit(outcome.value.context, outcome.value.effects);

  return outcome.value.context;
}

function imagingContextWithTwoPendingStudies(): ImagingContext {
  return {
    studies: {
      'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: imagingIsoTimestamp('2026-07-21T00:05:00.000Z') },
      'study-2': { studyId: studyId('study-2'), encounterId: encounterId('encounter-1'), modality: 'MR', status: 'ordered', orderedAt: imagingIsoTimestamp('2026-07-21T00:06:00.000Z') },
    },
  };
}

describe('relayPatientEffectsToImaging', () => {
  it('processes a durably committed discharge and durably commits the cancellations', () => {
    let patientContext = commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z') },
    ]);
    patientContext = commitPatientInstructions(patientContext, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-22T00:00:00.000Z') },
    ]);
    void patientContext;

    const result = relayPatientEffectsToImaging(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      imagingShell(),
      imagingEngine,
      imagingContextWithTwoPendingStudies(),
      imagingIsoTimestamp('2026-07-22T00:01:00.000Z'),
    );

    expect(result.outcomes).toEqual([
      { kind: 'no-pending-studies', encounterId: 'encounter-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', studyId: 'study-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', studyId: 'study-2' },
    ]);
    expect(result.processedThroughIndex).toBe(2);
    expect(readCommits(imagingCommitsFile)).toHaveLength(1); // admission produced no imaging commit; discharge produced one
  });

  it('running again with no new patient commits processes nothing new', () => {
    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z') },
    ]);

    const cursor = createFileOutboxCursor(cursorFile);
    const first = relayPatientEffectsToImaging(patientCommitsFile, cursor, imagingShell(), imagingEngine, { studies: {} }, imagingIsoTimestamp('2026-07-21T00:01:00.000Z'));

    const second = relayPatientEffectsToImaging(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      imagingShell(),
      imagingEngine,
      first.context,
      imagingIsoTimestamp('2026-07-21T00:02:00.000Z'),
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

    const shell = imagingShell();
    const first = relayPatientEffectsToImaging(patientCommitsFile, createFileOutboxCursor(cursorFile), shell, imagingEngine, imagingContextWithTwoPendingStudies(), imagingIsoTimestamp('2026-07-22T00:01:00.000Z'));
    expect(first.outcomes).toContainEqual({ kind: 'cancelled', encounterId: 'encounter-1', studyId: 'study-1' });

    const resetCursor = createFileOutboxCursor(join(dir, 'cursor-reset.jsonl'));
    const redelivered = relayPatientEffectsToImaging(
      patientCommitsFile,
      resetCursor,
      shell,
      imagingEngine,
      first.context,
      imagingIsoTimestamp('2026-07-22T00:02:00.000Z'),
    );

    expect(redelivered.outcomes).toEqual([
      { kind: 'no-pending-studies', encounterId: 'encounter-1' },
      { kind: 'no-pending-studies', encounterId: 'encounter-1' },
    ]);
    expect(redelivered.context.studies['study-1'].status).toBe('cancelled');
    expect(redelivered.context.studies['study-2'].status).toBe('cancelled');
  });
});
