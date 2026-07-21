import { describe, expect, it } from 'vitest';
import { imagingEngine } from '../../src/instructions/imaging/engine.js';
import { studyId, isoTimestamp as imagingIsoTimestamp } from '../../src/instructions/imaging/ids.js';
import type { ImagingContext, ImagingError } from '../../src/instructions/imaging/types.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect } from '../../src/instructions/patient/types.js';
import { reactToPatientEffect, reactToPatientEffectsForImaging } from '../../src/integration/patientToImaging.js';
import type { ImagingEngineLike } from '../../src/integration/patientToImaging.js';

const twoPendingStudiesForEncounter1: ImagingContext = {
  studies: {
    'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: imagingIsoTimestamp('2026-07-21T00:00:00.000Z') },
    'study-2': { studyId: studyId('study-2'), encounterId: encounterId('encounter-1'), modality: 'MR', status: 'ordered', orderedAt: imagingIsoTimestamp('2026-07-21T00:01:00.000Z') },
  },
};

const admitted: PatientEffect = {
  kind: 'EncounterAdmitted',
  encounterId: encounterId('encounter-1'),
  patientId: patientId('patient-1'),
  admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z'),
};

const discharged: PatientEffect = {
  kind: 'EncounterDischarged',
  encounterId: encounterId('encounter-1'),
  dischargedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
};

describe('reactToPatientEffect', () => {
  it('reports no-pending-studies for EncounterAdmitted — admission never implies an imaging order', () => {
    const reaction = reactToPatientEffect(admitted, twoPendingStudiesForEncounter1, imagingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-studies', encounterId: 'encounter-1' });
  });

  it('produces one CancelStudy instruction per still-pending study for EncounterDischarged', () => {
    const reaction = reactToPatientEffect(discharged, twoPendingStudiesForEncounter1, imagingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(reaction).toEqual({
      kind: 'cancel-pending',
      instructions: [
        { kind: 'CancelStudy', studyId: 'study-1', cancelledAt: '2026-07-22T00:00:00.000Z' },
        { kind: 'CancelStudy', studyId: 'study-2', cancelledAt: '2026-07-22T00:00:00.000Z' },
      ],
    });
  });

  it('reports no-pending-studies for EncounterDischarged when nothing is pending', () => {
    const reaction = reactToPatientEffect(discharged, { studies: {} }, imagingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-studies', encounterId: 'encounter-1' });
  });

  it('ignores studies already performed, and studies belonging to a different encounter', () => {
    const mixedContext: ImagingContext = {
      studies: {
        'study-1': {
          studyId: studyId('study-1'),
          encounterId: encounterId('encounter-1'),
          modality: 'CT',
          status: 'performed',
          orderedAt: imagingIsoTimestamp('2026-07-21T00:00:00.000Z'),
          performedAt: imagingIsoTimestamp('2026-07-21T00:30:00.000Z'),
          storageRef: 's3://pacs-bucket/study-1',
        },
        'study-2': {
          studyId: studyId('study-2'),
          encounterId: encounterId('encounter-2'),
          modality: 'MR',
          status: 'ordered',
          orderedAt: imagingIsoTimestamp('2026-07-21T00:01:00.000Z'),
        },
      },
    };

    const reaction = reactToPatientEffect(discharged, mixedContext, imagingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-studies', encounterId: 'encounter-1' });
  });
});

describe('reactToPatientEffectsForImaging', () => {
  it('cancels every pending study for a discharged encounter, redelivery-safe: a second run finds nothing left to cancel', () => {
    const first = reactToPatientEffectsForImaging(imagingEngine, twoPendingStudiesForEncounter1, [discharged], imagingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(first.outcomes).toEqual([
      { kind: 'cancelled', encounterId: 'encounter-1', studyId: 'study-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', studyId: 'study-2' },
    ]);
    expect(first.context.studies['study-1'].status).toBe('cancelled');
    expect(first.context.studies['study-2'].status).toBe('cancelled');

    const redelivered = reactToPatientEffectsForImaging(imagingEngine, first.context, [discharged], imagingIsoTimestamp('2026-07-22T00:01:00.000Z'));

    expect(redelivered.outcomes).toEqual([{ kind: 'no-pending-studies', encounterId: 'encounter-1' }]);
    expect(redelivered.effects).toEqual([]);
  });

  it('reports reaction-failed for one study without blocking cancellation of the rest', () => {
    const failingEngine: ImagingEngineLike = {
      execute: (context, instruction) => {
        if (instruction.kind === 'CancelStudy' && instruction.studyId === studyId('study-1')) {
          return { ok: false, error: { kind: 'StudyNotFound', studyId: studyId('study-1') } satisfies ImagingError };
        }
        return imagingEngine.execute(context, instruction);
      },
    };

    const result = reactToPatientEffectsForImaging(failingEngine, twoPendingStudiesForEncounter1, [discharged], imagingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(result.outcomes).toEqual([
      { kind: 'reaction-failed', encounterId: 'encounter-1', studyId: 'study-1', error: { kind: 'StudyNotFound', studyId: 'study-1' } },
      { kind: 'cancelled', encounterId: 'encounter-1', studyId: 'study-2' },
    ]);
  });
});

describe('patient discharge -> imaging study cancellation, end to end', () => {
  it('admits a patient, orders two studies, discharges the patient, and cancels both still-pending studies', () => {
    const emptyPatientContext: PatientContext = { encounters: {} };

    const admissionOutcome = patientEngine.executeSequence(emptyPatientContext, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z') },
    ]);
    expect(admissionOutcome.ok).toBe(true);
    if (!admissionOutcome.ok) throw new Error('expected ok');

    const orderOutcome = imagingEngine.executeSequence(
      { studies: {} },
      [
        { kind: 'OrderStudy', studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', orderedAt: imagingIsoTimestamp('2026-07-21T00:05:00.000Z') },
        { kind: 'OrderStudy', studyId: studyId('study-2'), encounterId: encounterId('encounter-1'), modality: 'MR', orderedAt: imagingIsoTimestamp('2026-07-21T00:06:00.000Z') },
      ],
    );
    expect(orderOutcome.ok).toBe(true);
    if (!orderOutcome.ok) throw new Error('expected ok');

    const dischargeOutcome = patientEngine.executeSequence(admissionOutcome.value.context, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-22T00:00:00.000Z') },
    ]);
    expect(dischargeOutcome.ok).toBe(true);
    if (!dischargeOutcome.ok) throw new Error('expected ok');

    const afterDischarge = reactToPatientEffectsForImaging(
      imagingEngine,
      orderOutcome.value.context,
      dischargeOutcome.value.effects,
      imagingIsoTimestamp('2026-07-22T00:01:00.000Z'),
    );

    expect(afterDischarge.outcomes).toEqual([
      { kind: 'cancelled', encounterId: 'encounter-1', studyId: 'study-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', studyId: 'study-2' },
    ]);
    expect(afterDischarge.context.studies['study-1'].status).toBe('cancelled');
    expect(afterDischarge.context.studies['study-2'].status).toBe('cancelled');
  });
});
