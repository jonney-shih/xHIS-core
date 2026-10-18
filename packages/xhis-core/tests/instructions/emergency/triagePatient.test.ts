import { describe, expect, it } from 'vitest';
import { triagePatientHandler } from '../../../src/instructions/emergency/handlers/triagePatient.js';
import { emergencyVisitId, encounterId, isoTimestamp, patientId } from '../../../src/instructions/emergency/ids.js';
import type { EmergencyContext } from '../../../src/instructions/emergency/types.js';

function registeredContext(): EmergencyContext {
  return {
    visits: {
      'visit-1': {
        visitId: emergencyVisitId('visit-1'),
        encounterId: encounterId('encounter-1'),
        patientId: patientId('patient-1'),
        chiefComplaint: 'Chest pain',
        status: 'registered',
        registeredAt: isoTimestamp('2026-10-18T14:00:00.000Z'),
      },
    },
  };
}

describe('triagePatientHandler', () => {
  it('triages a registered visit and emits a PatientTriaged effect', () => {
    const result = triagePatientHandler(registeredContext(), {
      kind: 'TriagePatient',
      visitId: emergencyVisitId('visit-1'),
      esiLevel: 2,
      triagedAt: isoTimestamp('2026-10-18T14:05:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.visits['visit-1']).toMatchObject({ status: 'triaged', esiLevel: 2, triagedAt: '2026-10-18T14:05:00.000Z' });
    expect(result.value.effects).toEqual([{ kind: 'PatientTriaged', visitId: 'visit-1', esiLevel: 2, triagedAt: '2026-10-18T14:05:00.000Z' }]);
  });

  it('rejects triaging an unknown visit', () => {
    const result = triagePatientHandler(
      { visits: {} },
      { kind: 'TriagePatient', visitId: emergencyVisitId('missing'), esiLevel: 3, triagedAt: isoTimestamp('2026-10-18T14:05:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'EdVisitNotFound', visitId: 'missing' } });
  });

  it('rejects re-triaging an already-triaged visit', () => {
    const context = registeredContext();
    const first = triagePatientHandler(context, {
      kind: 'TriagePatient',
      visitId: emergencyVisitId('visit-1'),
      esiLevel: 2,
      triagedAt: isoTimestamp('2026-10-18T14:05:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first triage to succeed');

    const second = triagePatientHandler(first.value.context, {
      kind: 'TriagePatient',
      visitId: emergencyVisitId('visit-1'),
      esiLevel: 1,
      triagedAt: isoTimestamp('2026-10-18T14:10:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'EdVisitAlreadyTriaged', visitId: 'visit-1' } });
  });
});
