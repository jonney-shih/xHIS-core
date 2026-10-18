import { describe, expect, it } from 'vitest';
import { imagingEngine } from '../../src/instructions/imaging/engine.js';
import { studyId } from '../../src/instructions/imaging/ids.js';
import type { ImagingError } from '../../src/instructions/imaging/types.js';
import { outpatientEngine } from '../../src/instructions/outpatient/engine.js';
import { cpoeOrderId, encounterId, isoTimestamp, patientId } from '../../src/instructions/outpatient/ids.js';
import type { OutpatientContext, OutpatientEffect } from '../../src/instructions/outpatient/types.js';
import { reactToOutpatientEffect, reactToOutpatientEffectsForImaging } from '../../src/integration/outpatientToImaging.js';
import type { ImagingEngineLike } from '../../src/integration/outpatientToImaging.js';

const imagingOrderPlaced: OutpatientEffect = {
  kind: 'CpoeOrderPlaced',
  orderId: cpoeOrderId('order-1'),
  encounterId: encounterId('encounter-1'),
  detail: { orderType: 'imaging', modality: 'CT' },
  placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
};

const labOrderPlaced: OutpatientEffect = {
  kind: 'CpoeOrderPlaced',
  orderId: cpoeOrderId('order-2'),
  encounterId: encounterId('encounter-1'),
  detail: { orderType: 'lab', testCode: 'CBC' },
  placedAt: isoTimestamp('2026-10-18T09:16:00.000Z'),
};

describe('reactToOutpatientEffect (imaging)', () => {
  it('reacts to an imaging-typed CpoeOrderPlaced with an OrderStudy instruction, reusing the same orderId', () => {
    const reaction = reactToOutpatientEffect(imagingOrderPlaced);

    expect(reaction).toEqual({
      kind: 'order-study',
      instruction: { kind: 'OrderStudy', studyId: 'order-1', encounterId: 'encounter-1', modality: 'CT', orderedAt: '2026-10-18T09:15:00.000Z' },
    });
  });

  it('is not-applicable for a CpoeOrderPlaced targeting a different domain', () => {
    expect(reactToOutpatientEffect(labOrderPlaced)).toEqual({ kind: 'not-applicable', sourceEffectKind: 'CpoeOrderPlaced' });
  });
});

describe('reactToOutpatientEffectsForImaging', () => {
  it('orders a study, and is redelivery-safe: a second delivery reports already-ordered, not a duplicate study', () => {
    const first = reactToOutpatientEffectsForImaging(imagingEngine, { studies: {} }, [imagingOrderPlaced]);

    expect(first.outcomes).toEqual([{ kind: 'ordered', studyId: 'order-1', encounterId: 'encounter-1' }]);
    expect(first.context.studies['order-1']).toMatchObject({ modality: 'CT', status: 'ordered' });

    const redelivered = reactToOutpatientEffectsForImaging(imagingEngine, first.context, [imagingOrderPlaced]);

    expect(redelivered.outcomes).toEqual([{ kind: 'already-ordered', studyId: 'order-1' }]);
    expect(redelivered.effects).toEqual([]);
  });

  it('reports reaction-failed (not already-ordered) for a genuine handler error', () => {
    const failingEngine: ImagingEngineLike = {
      execute: (_context, instruction) => {
        if (instruction.kind === 'OrderStudy') {
          return { ok: false, error: { kind: 'StudyNotFound', studyId: studyId('order-1') } satisfies ImagingError };
        }
        throw new Error('unexpected instruction in this test');
      },
    };

    const result = reactToOutpatientEffectsForImaging(failingEngine, { studies: {} }, [imagingOrderPlaced]);

    expect(result.outcomes).toEqual([{ kind: 'reaction-failed', studyId: 'order-1', error: { kind: 'StudyNotFound', studyId: 'order-1' } }]);
  });
});

describe('outpatient check-in + CPOE order -> imaging study, end to end', () => {
  it('checks in a patient, places an imaging CPOE order, and the relay reaction produces a real OrderStudy commit', () => {
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
        detail: { orderType: 'imaging', modality: 'CT' },
        placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
      },
    ]);
    expect(orderOutcome.ok).toBe(true);
    if (!orderOutcome.ok) throw new Error('expected ok');

    const relayed = reactToOutpatientEffectsForImaging(imagingEngine, { studies: {} }, orderOutcome.value.effects);

    expect(relayed.outcomes).toEqual([{ kind: 'ordered', studyId: 'order-1', encounterId: 'encounter-1' }]);
    expect(relayed.context.studies['order-1']).toMatchObject({ modality: 'CT', status: 'ordered', orderedAt: '2026-10-18T09:15:00.000Z' });
  });
});
