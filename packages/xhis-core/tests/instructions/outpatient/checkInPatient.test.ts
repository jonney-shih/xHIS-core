import { describe, expect, it } from 'vitest';
import { checkInPatientHandler } from '../../../src/instructions/outpatient/handlers/checkInPatient.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/outpatient/ids.js';
import type { OutpatientContext } from '../../../src/instructions/outpatient/types.js';

const emptyContext: OutpatientContext = { encounters: {}, soapNotes: {}, cpoeOrders: {} };

describe('checkInPatientHandler', () => {
  it('checks in a new encounter and emits a PatientCheckedIn effect', () => {
    const result = checkInPatientHandler(emptyContext, {
      kind: 'CheckInPatient',
      encounterId: encounterId('encounter-1'),
      patientId: patientId('patient-1'),
      checkedInAt: isoTimestamp('2026-10-17T09:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.encounters['encounter-1']).toEqual({
      encounterId: 'encounter-1',
      patientId: 'patient-1',
      status: 'checked-in',
      checkedInAt: '2026-10-17T09:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'PatientCheckedIn', encounterId: 'encounter-1', patientId: 'patient-1', checkedInAt: '2026-10-17T09:00:00.000Z' },
    ]);
  });

  it('rejects checking in an encounter id that already exists', () => {
    const first = checkInPatientHandler(emptyContext, {
      kind: 'CheckInPatient',
      encounterId: encounterId('encounter-1'),
      patientId: patientId('patient-1'),
      checkedInAt: isoTimestamp('2026-10-17T09:00:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first check-in to succeed');

    const second = checkInPatientHandler(first.value.context, {
      kind: 'CheckInPatient',
      encounterId: encounterId('encounter-1'),
      patientId: patientId('patient-2'),
      checkedInAt: isoTimestamp('2026-10-17T09:05:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'EncounterAlreadyExists', encounterId: 'encounter-1' } });
  });
});
