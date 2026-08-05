import { describe, expect, it } from 'vitest';
import { cancelLabOrderHandler } from '../../../src/instructions/lab/handlers/cancelLabOrder.js';
import { labOrderId } from '../../../src/instructions/lab/ids.js';
import { encounterId, isoTimestamp } from '../../../src/instructions/patient/ids.js';
import type { LabContext } from '../../../src/instructions/lab/types.js';

const contextWithOrderedTest: LabContext = {
  orders: {
    'order-1': {
      orderId: labOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      testCode: 'CBC',
      status: 'ordered',
      orderedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    },
  },
};

describe('cancelLabOrderHandler', () => {
  it('cancels a pending order and emits a LabOrderCancelled effect', () => {
    const result = cancelLabOrderHandler(contextWithOrderedTest, {
      kind: 'CancelLabOrder',
      orderId: labOrderId('order-1'),
      cancelledAt: isoTimestamp('2026-07-19T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.orders['order-1']).toEqual({
      orderId: 'order-1',
      encounterId: 'encounter-1',
      testCode: 'CBC',
      status: 'cancelled',
      orderedAt: '2026-07-18T00:00:00.000Z',
      cancelledAt: '2026-07-19T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'LabOrderCancelled', orderId: 'order-1', encounterId: 'encounter-1', cancelledAt: '2026-07-19T00:00:00.000Z' },
    ]);
  });

  it('rejects cancelling an order that does not exist', () => {
    const result = cancelLabOrderHandler(
      { orders: {} },
      { kind: 'CancelLabOrder', orderId: labOrderId('order-1'), cancelledAt: isoTimestamp('2026-07-19T00:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'LabOrderNotFound', orderId: 'order-1' } });
  });

  it('rejects cancelling an order that already has a result', () => {
    const resultedContext: LabContext = {
      orders: {
        'order-1': {
          orderId: labOrderId('order-1'),
          encounterId: encounterId('encounter-1'),
          testCode: 'CBC',
          status: 'resulted',
          orderedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
          result: 'WBC 7.2',
          resultedAt: isoTimestamp('2026-07-18T12:00:00.000Z'),
        },
      },
    };

    const result = cancelLabOrderHandler(resultedContext, {
      kind: 'CancelLabOrder',
      orderId: labOrderId('order-1'),
      cancelledAt: isoTimestamp('2026-07-19T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'LabOrderNotPending', orderId: 'order-1' } });
  });
});
