import { describe, expect, it } from 'vitest';
import { placeCpoeOrderHandler } from '../../../src/instructions/outpatient/handlers/placeCpoeOrder.js';
import { cpoeOrderId, encounterId, isoTimestamp, patientId } from '../../../src/instructions/outpatient/ids.js';
import type { OutpatientContext } from '../../../src/instructions/outpatient/types.js';

function checkedInContext(): OutpatientContext {
  return {
    encounters: {
      'encounter-1': {
        encounterId: encounterId('encounter-1'),
        patientId: patientId('patient-1'),
        status: 'checked-in',
        checkedInAt: isoTimestamp('2026-10-17T09:00:00.000Z'),
      },
    },
    soapNotes: {},
    cpoeOrders: {},
  };
}

describe('placeCpoeOrderHandler', () => {
  it('places a lab order against a checked-in encounter and emits CpoeOrderPlaced', () => {
    const result = placeCpoeOrderHandler(checkedInContext(), {
      kind: 'PlaceCpoeOrder',
      orderId: cpoeOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      detail: { orderType: 'lab', testCode: 'CBC' },
      placedAt: isoTimestamp('2026-10-17T09:15:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.cpoeOrders['order-1']).toEqual({
      orderId: 'order-1',
      encounterId: 'encounter-1',
      detail: { orderType: 'lab', testCode: 'CBC' },
      placedAt: '2026-10-17T09:15:00.000Z',
    });
    expect(result.value.effects).toEqual([
      {
        kind: 'CpoeOrderPlaced',
        orderId: 'order-1',
        encounterId: 'encounter-1',
        detail: { orderType: 'lab', testCode: 'CBC' },
        placedAt: '2026-10-17T09:15:00.000Z',
      },
    ]);
  });

  it.each([
    { orderType: 'lab' as const, testCode: 'CBC' },
    { orderType: 'imaging' as const, modality: 'CT' },
    { orderType: 'pharmacy' as const, medicationCode: 'AMOX500' },
  ])('accepts a %j order detail', (detail) => {
    const result = placeCpoeOrderHandler(checkedInContext(), {
      kind: 'PlaceCpoeOrder',
      orderId: cpoeOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      detail,
      placedAt: isoTimestamp('2026-10-17T09:15:00.000Z'),
    });

    expect(result.ok).toBe(true);
  });

  it('rejects an order id that already exists', () => {
    const context = checkedInContext();
    const first = placeCpoeOrderHandler(context, {
      kind: 'PlaceCpoeOrder',
      orderId: cpoeOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      detail: { orderType: 'lab', testCode: 'CBC' },
      placedAt: isoTimestamp('2026-10-17T09:15:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first order to succeed');

    const second = placeCpoeOrderHandler(first.value.context, {
      kind: 'PlaceCpoeOrder',
      orderId: cpoeOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      detail: { orderType: 'imaging', modality: 'CT' },
      placedAt: isoTimestamp('2026-10-17T09:16:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'CpoeOrderAlreadyExists', orderId: 'order-1' } });
  });

  it('rejects placing an order against an unknown encounter', () => {
    const result = placeCpoeOrderHandler(
      { encounters: {}, soapNotes: {}, cpoeOrders: {} },
      {
        kind: 'PlaceCpoeOrder',
        orderId: cpoeOrderId('order-1'),
        encounterId: encounterId('encounter-1'),
        detail: { orderType: 'lab', testCode: 'CBC' },
        placedAt: isoTimestamp('2026-10-17T09:15:00.000Z'),
      },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'EncounterNotFound', encounterId: 'encounter-1' } });
  });

  it('rejects placing an order against an already-completed encounter', () => {
    const context: OutpatientContext = {
      ...checkedInContext(),
      encounters: {
        'encounter-1': {
          encounterId: encounterId('encounter-1'),
          patientId: patientId('patient-1'),
          status: 'completed',
          checkedInAt: isoTimestamp('2026-10-17T09:00:00.000Z'),
          completedAt: isoTimestamp('2026-10-17T10:00:00.000Z'),
        },
      },
    };

    const result = placeCpoeOrderHandler(context, {
      kind: 'PlaceCpoeOrder',
      orderId: cpoeOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      detail: { orderType: 'lab', testCode: 'CBC' },
      placedAt: isoTimestamp('2026-10-17T09:15:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'EncounterNotCheckedIn', encounterId: 'encounter-1' } });
  });
});
