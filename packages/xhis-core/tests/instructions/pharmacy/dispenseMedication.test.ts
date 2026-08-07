import { describe, expect, it } from 'vitest';
import { dispenseMedicationHandler } from '../../../src/instructions/pharmacy/handlers/dispenseMedication.js';
import { encounterId, isoTimestamp, prescriptionId } from '../../../src/instructions/pharmacy/ids.js';
import type { PharmacyContext } from '../../../src/instructions/pharmacy/types.js';

const contextWithPrescribedRx: PharmacyContext = {
  prescriptions: {
    'rx-1': {
      prescriptionId: prescriptionId('rx-1'),
      encounterId: encounterId('encounter-1'),
      medicationCode: 'AMOX-500',
      status: 'prescribed',
      prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z'),
    },
  },
};

describe('dispenseMedicationHandler', () => {
  it("dispenses a prescribed medication and emits a MedicationDispensed effect citing the prescription's own recorded encounter", () => {
    const result = dispenseMedicationHandler(contextWithPrescribedRx, {
      kind: 'DispenseMedication',
      prescriptionId: prescriptionId('rx-1'),
      dispensedAt: isoTimestamp('2026-07-31T01:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.prescriptions['rx-1']).toEqual({
      prescriptionId: 'rx-1',
      encounterId: 'encounter-1',
      medicationCode: 'AMOX-500',
      status: 'dispensed',
      prescribedAt: '2026-07-31T00:00:00.000Z',
      dispensedAt: '2026-07-31T01:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'MedicationDispensed', prescriptionId: 'rx-1', encounterId: 'encounter-1', dispensedAt: '2026-07-31T01:00:00.000Z' },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(contextWithPrescribedRx);

    dispenseMedicationHandler(contextWithPrescribedRx, {
      kind: 'DispenseMedication',
      prescriptionId: prescriptionId('rx-1'),
      dispensedAt: isoTimestamp('2026-07-31T01:00:00.000Z'),
    });

    expect(JSON.stringify(contextWithPrescribedRx)).toBe(before);
  });

  it('rejects dispensing a prescriptionId that is not tracked at all', () => {
    const result = dispenseMedicationHandler(
      { prescriptions: {} },
      { kind: 'DispenseMedication', prescriptionId: prescriptionId('rx-1'), dispensedAt: isoTimestamp('2026-07-31T01:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'PrescriptionNotFound', prescriptionId: 'rx-1' } });
  });

  it('rejects dispensing a prescription that has already been dispensed', () => {
    const dispensedContext: PharmacyContext = {
      prescriptions: {
        'rx-1': {
          prescriptionId: prescriptionId('rx-1'),
          encounterId: encounterId('encounter-1'),
          medicationCode: 'AMOX-500',
          status: 'dispensed',
          prescribedAt: isoTimestamp('2026-07-30T00:00:00.000Z'),
          dispensedAt: isoTimestamp('2026-07-30T01:00:00.000Z'),
        },
      },
    };

    const result = dispenseMedicationHandler(dispensedContext, {
      kind: 'DispenseMedication',
      prescriptionId: prescriptionId('rx-1'),
      dispensedAt: isoTimestamp('2026-07-31T01:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'PrescriptionNotPending', prescriptionId: 'rx-1' } });
  });
});
