import { describe, expect, it } from 'vitest';
import { admitPatientHandler } from '../../../src/instructions/patient/handlers/admitPatient.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext } from '../../../src/instructions/patient/types.js';

const emptyContext: PatientContext = { encounters: {} };

describe('admitPatientHandler', () => {
  it('adds an admitted encounter and emits an EncounterAdmitted effect', () => {
    const result = admitPatientHandler(emptyContext, {
      kind: 'AdmitPatient',
      patientId: patientId('patient-1'),
      encounterId: encounterId('encounter-1'),
      admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.encounters['encounter-1']).toEqual({
      encounterId: 'encounter-1',
      patientId: 'patient-1',
      status: 'admitted',
      admittedAt: '2026-07-18T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      {
        kind: 'EncounterAdmitted',
        encounterId: 'encounter-1',
        patientId: 'patient-1',
        admittedAt: '2026-07-18T00:00:00.000Z',
      },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(emptyContext);

    admitPatientHandler(emptyContext, {
      kind: 'AdmitPatient',
      patientId: patientId('patient-1'),
      encounterId: encounterId('encounter-1'),
      admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    });

    expect(JSON.stringify(emptyContext)).toBe(before);
  });

  it('rejects admitting the same encounter twice', () => {
    const context: PatientContext = {
      encounters: {
        'encounter-1': {
          encounterId: encounterId('encounter-1'),
          patientId: patientId('patient-1'),
          status: 'admitted',
          admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
        },
      },
    };

    const result = admitPatientHandler(context, {
      kind: 'AdmitPatient',
      patientId: patientId('patient-1'),
      encounterId: encounterId('encounter-1'),
      admittedAt: isoTimestamp('2026-07-18T01:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'EncounterAlreadyExists', encounterId: 'encounter-1' } });
  });
});
