import { describe, expect, it } from 'vitest';
import { reportLabResultHandler } from '../../../src/instructions/lab/handlers/reportLabResult.js';
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

describe('reportLabResultHandler', () => {
  it('records the result and emits a LabResultReported effect', () => {
    const result = reportLabResultHandler(contextWithOrderedTest, {
      kind: 'ReportLabResult',
      orderId: labOrderId('order-1'),
      result: 'WBC 7.2',
      resultedAt: isoTimestamp('2026-07-19T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.orders['order-1']).toEqual({
      orderId: 'order-1',
      encounterId: 'encounter-1',
      testCode: 'CBC',
      status: 'resulted',
      orderedAt: '2026-07-18T00:00:00.000Z',
      result: 'WBC 7.2',
      resultedAt: '2026-07-19T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'LabResultReported', orderId: 'order-1', encounterId: 'encounter-1', result: 'WBC 7.2', resultedAt: '2026-07-19T00:00:00.000Z' },
    ]);
  });

  it('rejects reporting a result for an order that does not exist', () => {
    const result = reportLabResultHandler(
      { orders: {} },
      { kind: 'ReportLabResult', orderId: labOrderId('order-1'), result: 'WBC 7.2', resultedAt: isoTimestamp('2026-07-19T00:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'LabOrderNotFound', orderId: 'order-1' } });
  });

  it('rejects reporting a result for an order that is not pending', () => {
    const cancelledContext: LabContext = {
      orders: {
        'order-1': {
          orderId: labOrderId('order-1'),
          encounterId: encounterId('encounter-1'),
          testCode: 'CBC',
          status: 'cancelled',
          orderedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
          cancelledAt: isoTimestamp('2026-07-18T12:00:00.000Z'),
        },
      },
    };

    const result = reportLabResultHandler(cancelledContext, {
      kind: 'ReportLabResult',
      orderId: labOrderId('order-1'),
      result: 'WBC 7.2',
      resultedAt: isoTimestamp('2026-07-19T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'LabOrderNotPending', orderId: 'order-1' } });
  });
});
