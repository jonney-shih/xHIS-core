import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { LabContext, LabEffect, LabError, LabInstruction } from '../types.js';

type ReportLabResult = Extract<LabInstruction, { kind: 'ReportLabResult' }>;

export const reportLabResultHandler: Handler<LabContext, ReportLabResult, LabEffect, LabError> = (ctx, instruction) => {
  const existing = ctx.orders[instruction.orderId];

  if (!existing) {
    return err({ kind: 'LabOrderNotFound', orderId: instruction.orderId });
  }

  if (existing.status !== 'ordered') {
    return err({ kind: 'LabOrderNotPending', orderId: instruction.orderId });
  }

  const context: LabContext = {
    orders: {
      ...ctx.orders,
      [instruction.orderId]: {
        ...existing,
        status: 'resulted',
        result: instruction.result,
        resultedAt: instruction.resultedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'LabResultReported',
        orderId: instruction.orderId,
        encounterId: existing.encounterId,
        result: instruction.result,
        resultedAt: instruction.resultedAt,
      },
    ],
  });
};
