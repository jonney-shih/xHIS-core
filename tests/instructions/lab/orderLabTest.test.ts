import { describe, expect, it } from 'vitest';
import { orderLabTestHandler } from '../../../src/instructions/lab/handlers/orderLabTest.js';
import { labOrderId } from '../../../src/instructions/lab/ids.js';
import { encounterId, isoTimestamp } from '../../../src/instructions/patient/ids.js';
import type { LabContext } from '../../../src/instructions/lab/types.js';

const emptyContext: LabContext = { orders: {} };

describe('orderLabTestHandler', () => {
  it('adds an ordered order and emits a LabTestOrdered effect', () => {
    const result = orderLabTestHandler(emptyContext, {
      kind: 'OrderLabTest',
      orderId: labOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      testCode: 'CBC',
      orderedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.orders['order-1']).toEqual({
      orderId: 'order-1',
      encounterId: 'encounter-1',
      testCode: 'CBC',
      status: 'ordered',
      orderedAt: '2026-07-18T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'LabTestOrdered', orderId: 'order-1', encounterId: 'encounter-1', testCode: 'CBC', orderedAt: '2026-07-18T00:00:00.000Z' },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(emptyContext);

    orderLabTestHandler(emptyContext, {
      kind: 'OrderLabTest',
      orderId: labOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      testCode: 'CBC',
      orderedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    });

    expect(JSON.stringify(emptyContext)).toBe(before);
  });

  it('rejects ordering the same order twice', () => {
    const context: LabContext = {
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

    const result = orderLabTestHandler(context, {
      kind: 'OrderLabTest',
      orderId: labOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      testCode: 'CBC',
      orderedAt: isoTimestamp('2026-07-18T01:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'LabOrderAlreadyExists', orderId: 'order-1' } });
  });
});
