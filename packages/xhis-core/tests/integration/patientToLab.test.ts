import { describe, expect, it } from 'vitest';
import { labEngine } from '../../src/instructions/lab/engine.js';
import { labOrderId, isoTimestamp as labIsoTimestamp } from '../../src/instructions/lab/ids.js';
import type { LabContext, LabError } from '../../src/instructions/lab/types.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect } from '../../src/instructions/patient/types.js';
import { reactToPatientEffect, reactToPatientEffectsForLab } from '../../src/integration/patientToLab.js';
import type { LabEngineLike } from '../../src/integration/patientToLab.js';

const twoPendingOrdersForEncounter1: LabContext = {
  orders: {
    'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'ordered', orderedAt: labIsoTimestamp('2026-07-18T00:00:00.000Z') },
    'order-2': { orderId: labOrderId('order-2'), encounterId: encounterId('encounter-1'), testCode: 'BMP', status: 'ordered', orderedAt: labIsoTimestamp('2026-07-18T00:01:00.000Z') },
  },
};

const admitted: PatientEffect = {
  kind: 'EncounterAdmitted',
  encounterId: encounterId('encounter-1'),
  patientId: patientId('patient-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

const discharged: PatientEffect = {
  kind: 'EncounterDischarged',
  encounterId: encounterId('encounter-1'),
  dischargedAt: isoTimestamp('2026-07-18T01:00:00.000Z'),
};

describe('reactToPatientEffect', () => {
  it('reports no-pending-orders for EncounterAdmitted — admission never implies a lab order', () => {
    const reaction = reactToPatientEffect(admitted, twoPendingOrdersForEncounter1, labIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-orders', encounterId: 'encounter-1' });
  });

  it('produces one CancelLabOrder instruction per still-pending order for EncounterDischarged', () => {
    const reaction = reactToPatientEffect(discharged, twoPendingOrdersForEncounter1, labIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(reaction).toEqual({
      kind: 'cancel-pending',
      instructions: [
        { kind: 'CancelLabOrder', orderId: 'order-1', cancelledAt: '2026-07-19T00:00:00.000Z' },
        { kind: 'CancelLabOrder', orderId: 'order-2', cancelledAt: '2026-07-19T00:00:00.000Z' },
      ],
    });
  });

  it('reports no-pending-orders for EncounterDischarged when nothing is pending', () => {
    const reaction = reactToPatientEffect(discharged, { orders: {} }, labIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-orders', encounterId: 'encounter-1' });
  });

  it('ignores orders already resulted or cancelled, and orders belonging to a different encounter', () => {
    const mixedContext: LabContext = {
      orders: {
        'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'resulted', orderedAt: labIsoTimestamp('2026-07-18T00:00:00.000Z'), result: 'WBC 7.2', resultedAt: labIsoTimestamp('2026-07-18T02:00:00.000Z') },
        'order-2': { orderId: labOrderId('order-2'), encounterId: encounterId('encounter-2'), testCode: 'BMP', status: 'ordered', orderedAt: labIsoTimestamp('2026-07-18T00:01:00.000Z') },
      },
    };

    const reaction = reactToPatientEffect(discharged, mixedContext, labIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-orders', encounterId: 'encounter-1' });
  });
});

describe('reactToPatientEffectsForLab', () => {
  it('cancels every pending order for a discharged encounter, redelivery-safe: a second run finds nothing left to cancel', () => {
    const first = reactToPatientEffectsForLab(labEngine, twoPendingOrdersForEncounter1, [discharged], labIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(first.outcomes).toEqual([
      { kind: 'cancelled', encounterId: 'encounter-1', orderId: 'order-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', orderId: 'order-2' },
    ]);
    expect(first.context.orders['order-1'].status).toBe('cancelled');
    expect(first.context.orders['order-2'].status).toBe('cancelled');

    const redelivered = reactToPatientEffectsForLab(labEngine, first.context, [discharged], labIsoTimestamp('2026-07-19T00:01:00.000Z'));

    expect(redelivered.outcomes).toEqual([{ kind: 'no-pending-orders', encounterId: 'encounter-1' }]);
    expect(redelivered.effects).toEqual([]);
  });

  it('reports reaction-failed for one order without blocking cancellation of the rest', () => {
    const failingEngine: LabEngineLike = {
      execute: (context, instruction) => {
        if (instruction.kind === 'CancelLabOrder' && instruction.orderId === labOrderId('order-1')) {
          return { ok: false, error: { kind: 'LabOrderNotFound', orderId: labOrderId('order-1') } satisfies LabError };
        }
        return labEngine.execute(context, instruction);
      },
    };

    const result = reactToPatientEffectsForLab(failingEngine, twoPendingOrdersForEncounter1, [discharged], labIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(result.outcomes).toEqual([
      { kind: 'reaction-failed', encounterId: 'encounter-1', orderId: 'order-1', error: { kind: 'LabOrderNotFound', orderId: 'order-1' } },
      { kind: 'cancelled', encounterId: 'encounter-1', orderId: 'order-2' },
    ]);
  });
});

describe('patient discharge -> lab order cancellation, end to end', () => {
  it('admits a patient, orders two tests, discharges the patient, and cancels both still-pending orders', () => {
    const emptyPatientContext: PatientContext = { encounters: {} };

    const admissionOutcome = patientEngine.executeSequence(emptyPatientContext, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
    ]);
    expect(admissionOutcome.ok).toBe(true);
    if (!admissionOutcome.ok) throw new Error('expected ok');

    const orderOutcome = labEngine.executeSequence(
      { orders: {} },
      [
        { kind: 'OrderLabTest', orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', orderedAt: labIsoTimestamp('2026-07-18T00:05:00.000Z') },
        { kind: 'OrderLabTest', orderId: labOrderId('order-2'), encounterId: encounterId('encounter-1'), testCode: 'BMP', orderedAt: labIsoTimestamp('2026-07-18T00:06:00.000Z') },
      ],
    );
    expect(orderOutcome.ok).toBe(true);
    if (!orderOutcome.ok) throw new Error('expected ok');

    const dischargeOutcome = patientEngine.executeSequence(admissionOutcome.value.context, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-19T00:00:00.000Z') },
    ]);
    expect(dischargeOutcome.ok).toBe(true);
    if (!dischargeOutcome.ok) throw new Error('expected ok');

    const afterDischarge = reactToPatientEffectsForLab(
      labEngine,
      orderOutcome.value.context,
      dischargeOutcome.value.effects,
      labIsoTimestamp('2026-07-19T00:01:00.000Z'),
    );

    expect(afterDischarge.outcomes).toEqual([
      { kind: 'cancelled', encounterId: 'encounter-1', orderId: 'order-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', orderId: 'order-2' },
    ]);
    expect(afterDischarge.context.orders['order-1'].status).toBe('cancelled');
    expect(afterDischarge.context.orders['order-2'].status).toBe('cancelled');
  });
});
