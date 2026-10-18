import { describe, expect, it } from 'vitest';
import { labEngine } from '../../src/instructions/lab/engine.js';
import { labOrderId } from '../../src/instructions/lab/ids.js';
import type { LabContext, LabError } from '../../src/instructions/lab/types.js';
import { outpatientEngine } from '../../src/instructions/outpatient/engine.js';
import { cpoeOrderId, encounterId, isoTimestamp, patientId } from '../../src/instructions/outpatient/ids.js';
import type { OutpatientContext, OutpatientEffect } from '../../src/instructions/outpatient/types.js';
import { reactToOutpatientEffect, reactToOutpatientEffectsForLab } from '../../src/integration/outpatientToLab.js';
import type { LabEngineLike } from '../../src/integration/outpatientToLab.js';

const labOrderPlaced: OutpatientEffect = {
  kind: 'CpoeOrderPlaced',
  orderId: cpoeOrderId('order-1'),
  encounterId: encounterId('encounter-1'),
  detail: { orderType: 'lab', testCode: 'CBC' },
  placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
};

const imagingOrderPlaced: OutpatientEffect = {
  kind: 'CpoeOrderPlaced',
  orderId: cpoeOrderId('order-2'),
  encounterId: encounterId('encounter-1'),
  detail: { orderType: 'imaging', modality: 'CT' },
  placedAt: isoTimestamp('2026-10-18T09:16:00.000Z'),
};

const checkedIn: OutpatientEffect = {
  kind: 'PatientCheckedIn',
  encounterId: encounterId('encounter-1'),
  patientId: patientId('patient-1'),
  checkedInAt: isoTimestamp('2026-10-18T09:00:00.000Z'),
};

describe('reactToOutpatientEffect (lab)', () => {
  it('reacts to a lab-typed CpoeOrderPlaced with an OrderLabTest instruction, reusing the same orderId', () => {
    const reaction = reactToOutpatientEffect(labOrderPlaced);

    expect(reaction).toEqual({
      kind: 'order-lab-test',
      instruction: { kind: 'OrderLabTest', orderId: 'order-1', encounterId: 'encounter-1', testCode: 'CBC', orderedAt: '2026-10-18T09:15:00.000Z' },
    });
  });

  it('is not-applicable for a CpoeOrderPlaced targeting a different domain', () => {
    expect(reactToOutpatientEffect(imagingOrderPlaced)).toEqual({ kind: 'not-applicable', sourceEffectKind: 'CpoeOrderPlaced' });
  });

  it('is not-applicable for any other outpatient effect kind', () => {
    expect(reactToOutpatientEffect(checkedIn)).toEqual({ kind: 'not-applicable', sourceEffectKind: 'PatientCheckedIn' });
  });
});

describe('reactToOutpatientEffectsForLab', () => {
  it('orders a lab test, ignores unrelated effects, and is redelivery-safe: a second delivery of the same effect reports already-ordered, not a duplicate order', () => {
    const first = reactToOutpatientEffectsForLab(labEngine, { orders: {} }, [checkedIn, labOrderPlaced, imagingOrderPlaced]);

    expect(first.outcomes).toEqual([
      { kind: 'not-applicable', sourceEffectKind: 'PatientCheckedIn' },
      { kind: 'ordered', orderId: 'order-1', encounterId: 'encounter-1' },
      { kind: 'not-applicable', sourceEffectKind: 'CpoeOrderPlaced' },
    ]);
    expect(first.context.orders['order-1']).toMatchObject({ testCode: 'CBC', status: 'ordered' });

    const redelivered = reactToOutpatientEffectsForLab(labEngine, first.context, [labOrderPlaced]);

    expect(redelivered.outcomes).toEqual([{ kind: 'already-ordered', orderId: 'order-1' }]);
    expect(redelivered.effects).toEqual([]);
  });

  it('reports reaction-failed (not already-ordered) for a genuine handler error', () => {
    const failingEngine: LabEngineLike = {
      execute: (_context, instruction) => {
        if (instruction.kind === 'OrderLabTest') {
          return { ok: false, error: { kind: 'LabOrderNotFound', orderId: labOrderId('order-1') } satisfies LabError };
        }
        throw new Error('unexpected instruction in this test');
      },
    };

    const result = reactToOutpatientEffectsForLab(failingEngine, { orders: {} }, [labOrderPlaced]);

    expect(result.outcomes).toEqual([{ kind: 'reaction-failed', orderId: 'order-1', error: { kind: 'LabOrderNotFound', orderId: 'order-1' } }]);
  });
});

describe('outpatient check-in + CPOE order -> lab order, end to end', () => {
  it('checks in a patient, places a lab CPOE order, and the relay reaction produces a real OrderLabTest commit', () => {
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
        detail: { orderType: 'lab', testCode: 'CBC' },
        placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
      },
    ]);
    expect(orderOutcome.ok).toBe(true);
    if (!orderOutcome.ok) throw new Error('expected ok');

    const relayed = reactToOutpatientEffectsForLab(labEngine, { orders: {} }, orderOutcome.value.effects);

    expect(relayed.outcomes).toEqual([{ kind: 'ordered', orderId: 'order-1', encounterId: 'encounter-1' }]);
    expect(relayed.context.orders['order-1']).toMatchObject({ testCode: 'CBC', status: 'ordered', orderedAt: '2026-10-18T09:15:00.000Z' });
  });
});
