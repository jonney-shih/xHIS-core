import { describe, expect, it } from 'vitest';
import { registerEdVisitHandler } from '../../../src/instructions/emergency/handlers/registerEdVisit.js';
import { emergencyVisitId, encounterId, isoTimestamp, patientId } from '../../../src/instructions/emergency/ids.js';
import type { EmergencyContext } from '../../../src/instructions/emergency/types.js';

const emptyContext: EmergencyContext = { visits: {} };

describe('registerEdVisitHandler', () => {
  it('registers a new ED visit and emits an EdVisitRegistered effect', () => {
    const result = registerEdVisitHandler(emptyContext, {
      kind: 'RegisterEdVisit',
      visitId: emergencyVisitId('visit-1'),
      encounterId: encounterId('encounter-1'),
      patientId: patientId('patient-1'),
      chiefComplaint: 'Chest pain',
      registeredAt: isoTimestamp('2026-10-18T14:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.visits['visit-1']).toEqual({
      visitId: 'visit-1',
      encounterId: 'encounter-1',
      patientId: 'patient-1',
      chiefComplaint: 'Chest pain',
      status: 'registered',
      registeredAt: '2026-10-18T14:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'EdVisitRegistered', visitId: 'visit-1', encounterId: 'encounter-1', patientId: 'patient-1', chiefComplaint: 'Chest pain', registeredAt: '2026-10-18T14:00:00.000Z' },
    ]);
  });

  it('rejects a visit id that already exists', () => {
    const first = registerEdVisitHandler(emptyContext, {
      kind: 'RegisterEdVisit',
      visitId: emergencyVisitId('visit-1'),
      encounterId: encounterId('encounter-1'),
      patientId: patientId('patient-1'),
      chiefComplaint: 'Chest pain',
      registeredAt: isoTimestamp('2026-10-18T14:00:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first registration to succeed');

    const second = registerEdVisitHandler(first.value.context, {
      kind: 'RegisterEdVisit',
      visitId: emergencyVisitId('visit-1'),
      encounterId: encounterId('encounter-2'),
      patientId: patientId('patient-2'),
      chiefComplaint: 'Fall',
      registeredAt: isoTimestamp('2026-10-18T14:05:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'EdVisitAlreadyExists', visitId: 'visit-1' } });
  });
});
