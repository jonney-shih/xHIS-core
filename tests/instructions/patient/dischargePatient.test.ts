import { describe, expect, it } from 'vitest';
import { dischargePatientHandler } from '../../../src/instructions/patient/handlers/dischargePatient.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext } from '../../../src/instructions/patient/types.js';

function admittedContext(): PatientContext {
  return {
    encounters: {
      'encounter-1': {
        encounterId: encounterId('encounter-1'),
        patientId: patientId('patient-1'),
        status: 'admitted',
        admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
      },
    },
  };
}

describe('dischargePatientHandler', () => {
  it('discharges an admitted encounter and emits an EncounterDischarged effect', () => {
    const result = dischargePatientHandler(admittedContext(), {
      kind: 'DischargePatient',
      encounterId: encounterId('encounter-1'),
      dischargedAt: isoTimestamp('2026-07-18T08:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.encounters['encounter-1']).toEqual({
      encounterId: 'encounter-1',
      patientId: 'patient-1',
      status: 'discharged',
      admittedAt: '2026-07-18T00:00:00.000Z',
      dischargedAt: '2026-07-18T08:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'EncounterDischarged', encounterId: 'encounter-1', dischargedAt: '2026-07-18T08:00:00.000Z' },
    ]);
  });

  it('rejects discharging an unknown encounter', () => {
    const result = dischargePatientHandler(
      { encounters: {} },
      {
        kind: 'DischargePatient',
        encounterId: encounterId('missing'),
        dischargedAt: isoTimestamp('2026-07-18T08:00:00.000Z'),
      },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'EncounterNotFound', encounterId: 'missing' } });
  });

  it('rejects discharging an already-discharged encounter', () => {
    const context = admittedContext();
    const first = dischargePatientHandler(context, {
      kind: 'DischargePatient',
      encounterId: encounterId('encounter-1'),
      dischargedAt: isoTimestamp('2026-07-18T08:00:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first discharge to succeed');

    const second = dischargePatientHandler(first.value.context, {
      kind: 'DischargePatient',
      encounterId: encounterId('encounter-1'),
      dischargedAt: isoTimestamp('2026-07-18T09:00:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'EncounterNotAdmitted', encounterId: 'encounter-1' } });
  });
});
