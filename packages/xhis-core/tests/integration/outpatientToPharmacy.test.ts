import { describe, expect, it } from 'vitest';
import { outpatientEngine } from '../../src/instructions/outpatient/engine.js';
import { cpoeOrderId, encounterId, isoTimestamp, patientId } from '../../src/instructions/outpatient/ids.js';
import type { OutpatientContext, OutpatientEffect } from '../../src/instructions/outpatient/types.js';
import { pharmacyEngine } from '../../src/instructions/pharmacy/engine.js';
import { prescriptionId } from '../../src/instructions/pharmacy/ids.js';
import type { PharmacyError } from '../../src/instructions/pharmacy/types.js';
import { reactToOutpatientEffect, reactToOutpatientEffectsForPharmacy } from '../../src/integration/outpatientToPharmacy.js';
import type { PharmacyEngineLike } from '../../src/integration/outpatientToPharmacy.js';

const pharmacyOrderPlaced: OutpatientEffect = {
  kind: 'CpoeOrderPlaced',
  orderId: cpoeOrderId('order-1'),
  encounterId: encounterId('encounter-1'),
  detail: { orderType: 'pharmacy', medicationCode: 'AMOX500' },
  placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
};

const labOrderPlaced: OutpatientEffect = {
  kind: 'CpoeOrderPlaced',
  orderId: cpoeOrderId('order-2'),
  encounterId: encounterId('encounter-1'),
  detail: { orderType: 'lab', testCode: 'CBC' },
  placedAt: isoTimestamp('2026-10-18T09:16:00.000Z'),
};

describe('reactToOutpatientEffect (pharmacy)', () => {
  it('reacts to a pharmacy-typed CpoeOrderPlaced with a PrescribeMedication instruction, reusing the same orderId', () => {
    const reaction = reactToOutpatientEffect(pharmacyOrderPlaced);

    expect(reaction).toEqual({
      kind: 'prescribe-medication',
      instruction: { kind: 'PrescribeMedication', prescriptionId: 'order-1', encounterId: 'encounter-1', medicationCode: 'AMOX500', prescribedAt: '2026-10-18T09:15:00.000Z' },
    });
  });

  it('is not-applicable for a CpoeOrderPlaced targeting a different domain', () => {
    expect(reactToOutpatientEffect(labOrderPlaced)).toEqual({ kind: 'not-applicable', sourceEffectKind: 'CpoeOrderPlaced' });
  });
});

describe('reactToOutpatientEffectsForPharmacy', () => {
  it('prescribes a medication, and is redelivery-safe: a second delivery reports already-prescribed, not a duplicate prescription', () => {
    const first = reactToOutpatientEffectsForPharmacy(pharmacyEngine, { prescriptions: {} }, [pharmacyOrderPlaced]);

    expect(first.outcomes).toEqual([{ kind: 'prescribed', prescriptionId: 'order-1', encounterId: 'encounter-1' }]);
    expect(first.context.prescriptions['order-1']).toMatchObject({ medicationCode: 'AMOX500', status: 'prescribed' });

    const redelivered = reactToOutpatientEffectsForPharmacy(pharmacyEngine, first.context, [pharmacyOrderPlaced]);

    expect(redelivered.outcomes).toEqual([{ kind: 'already-prescribed', prescriptionId: 'order-1' }]);
    expect(redelivered.effects).toEqual([]);
  });

  it('reports reaction-failed (not already-prescribed) for a genuine handler error', () => {
    const failingEngine: PharmacyEngineLike = {
      execute: (_context, instruction) => {
        if (instruction.kind === 'PrescribeMedication') {
          return { ok: false, error: { kind: 'PrescriptionNotFound', prescriptionId: prescriptionId('order-1') } satisfies PharmacyError };
        }
        throw new Error('unexpected instruction in this test');
      },
    };

    const result = reactToOutpatientEffectsForPharmacy(failingEngine, { prescriptions: {} }, [pharmacyOrderPlaced]);

    expect(result.outcomes).toEqual([
      { kind: 'reaction-failed', prescriptionId: 'order-1', error: { kind: 'PrescriptionNotFound', prescriptionId: 'order-1' } },
    ]);
  });
});

describe('outpatient check-in + CPOE order -> prescription, end to end', () => {
  it('checks in a patient, places a pharmacy CPOE order, and the relay reaction produces a real PrescribeMedication commit', () => {
    const emptyOutpatientContext: OutpatientContext = { encounters: {}, soapNotes: {}, cpoeOrders: {} };

    const checkInOutcome = outpatientEngine.executeSequence(emptyOutpatientContext, [
      { kind: 'CheckInPatient', encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), checkedInAt: isoTimestamp('2026-10-18T09:00:00.000Z') },
    ]);
    expect(checkInOutcome.ok).toBe(true);
    if (!checkInOutcome.ok) throw new Error('expected ok');

    const orderOutcome = outpatientEngine.executeSequence(checkInOutcome.value.context, [
      {
        kind: 'PlaceCpoeOrder',
        orderId: cpoeOrderId('order-1'),
        encounterId: encounterId('encounter-1'),
        detail: { orderType: 'pharmacy', medicationCode: 'AMOX500' },
        placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
      },
    ]);
    expect(orderOutcome.ok).toBe(true);
    if (!orderOutcome.ok) throw new Error('expected ok');

    const relayed = reactToOutpatientEffectsForPharmacy(pharmacyEngine, { prescriptions: {} }, orderOutcome.value.effects);

    expect(relayed.outcomes).toEqual([{ kind: 'prescribed', prescriptionId: 'order-1', encounterId: 'encounter-1' }]);
    expect(relayed.context.prescriptions['order-1']).toMatchObject({ medicationCode: 'AMOX500', status: 'prescribed', prescribedAt: '2026-10-18T09:15:00.000Z' });
  });
});
