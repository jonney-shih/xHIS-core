import { describe, expect, it } from 'vitest';
import { prescribeMedicationHandler } from '../../../src/instructions/pharmacy/handlers/prescribeMedication.js';
import { encounterId, isoTimestamp, prescriptionId } from '../../../src/instructions/pharmacy/ids.js';
import type { PharmacyContext } from '../../../src/instructions/pharmacy/types.js';

const emptyContext: PharmacyContext = { prescriptions: {} };

describe('prescribeMedicationHandler', () => {
  it('records a new prescription and emits a MedicationPrescribed effect', () => {
    const result = prescribeMedicationHandler(emptyContext, {
      kind: 'PrescribeMedication',
      prescriptionId: prescriptionId('rx-1'),
      encounterId: encounterId('encounter-1'),
      medicationCode: 'AMOX-500',
      prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.prescriptions['rx-1']).toEqual({
      prescriptionId: 'rx-1',
      encounterId: 'encounter-1',
      medicationCode: 'AMOX-500',
      status: 'prescribed',
      prescribedAt: '2026-07-31T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'MedicationPrescribed', prescriptionId: 'rx-1', encounterId: 'encounter-1', medicationCode: 'AMOX-500', prescribedAt: '2026-07-31T00:00:00.000Z' },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(emptyContext);

    prescribeMedicationHandler(emptyContext, {
      kind: 'PrescribeMedication',
      prescriptionId: prescriptionId('rx-1'),
      encounterId: encounterId('encounter-1'),
      medicationCode: 'AMOX-500',
      prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z'),
    });

    expect(JSON.stringify(emptyContext)).toBe(before);
  });

  it('rejects prescribing under a prescriptionId that already exists', () => {
    const existingContext: PharmacyContext = {
      prescriptions: {
        'rx-1': {
          prescriptionId: prescriptionId('rx-1'),
          encounterId: encounterId('encounter-0'),
          medicationCode: 'AMOX-500',
          status: 'prescribed',
          prescribedAt: isoTimestamp('2026-07-30T00:00:00.000Z'),
        },
      },
    };

    const result = prescribeMedicationHandler(existingContext, {
      kind: 'PrescribeMedication',
      prescriptionId: prescriptionId('rx-1'),
      encounterId: encounterId('encounter-1'),
      medicationCode: 'AMOX-500',
      prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'PrescriptionAlreadyExists', prescriptionId: 'rx-1' } });
  });
});
