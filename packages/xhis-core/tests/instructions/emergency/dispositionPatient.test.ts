import { describe, expect, it } from 'vitest';
import { dispositionPatientHandler } from '../../../src/instructions/emergency/handlers/dispositionPatient.js';
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

function triagedContext(): EmergencyContext {
  return {
    visits: {
      'visit-1': { ...registeredContext().visits['visit-1']!, status: 'triaged', esiLevel: 2, triagedAt: isoTimestamp('2026-10-18T14:05:00.000Z') },
    },
  };
}

describe('dispositionPatientHandler', () => {
  it('dispositions a triaged visit and emits a PatientDispositioned effect carrying the encounterId', () => {
    const result = dispositionPatientHandler(triagedContext(), {
      kind: 'DispositionPatient',
      visitId: emergencyVisitId('visit-1'),
      disposition: 'discharged',
      dispositionedAt: isoTimestamp('2026-10-18T15:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.visits['visit-1']).toMatchObject({
      status: 'dispositioned',
      disposition: 'discharged',
      dispositionedAt: '2026-10-18T15:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'PatientDispositioned', visitId: 'visit-1', encounterId: 'encounter-1', disposition: 'discharged', dispositionedAt: '2026-10-18T15:00:00.000Z' },
    ]);
  });

  it('rejects dispositioning an unknown visit', () => {
    const result = dispositionPatientHandler(
      { visits: {} },
      { kind: 'DispositionPatient', visitId: emergencyVisitId('missing'), disposition: 'discharged', dispositionedAt: isoTimestamp('2026-10-18T15:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'EdVisitNotFound', visitId: 'missing' } });
  });

  it('the gating invariant this domain exists to prove: rejects dispositioning a visit that has never been triaged', () => {
    const result = dispositionPatientHandler(registeredContext(), {
      kind: 'DispositionPatient',
      visitId: emergencyVisitId('visit-1'),
      disposition: 'left-without-being-seen',
      dispositionedAt: isoTimestamp('2026-10-18T14:30:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'EdVisitNotTriaged', visitId: 'visit-1' } });
  });

  it('rejects dispositioning an already-dispositioned visit', () => {
    const context = triagedContext();
    const first = dispositionPatientHandler(context, {
      kind: 'DispositionPatient',
      visitId: emergencyVisitId('visit-1'),
      disposition: 'discharged',
      dispositionedAt: isoTimestamp('2026-10-18T15:00:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first disposition to succeed');

    const second = dispositionPatientHandler(first.value.context, {
      kind: 'DispositionPatient',
      visitId: emergencyVisitId('visit-1'),
      disposition: 'admitted',
      dispositionedAt: isoTimestamp('2026-10-18T15:05:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'EdVisitAlreadyDispositioned', visitId: 'visit-1' } });
  });
});
