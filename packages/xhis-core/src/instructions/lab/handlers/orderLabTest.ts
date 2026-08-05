import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { LabContext, LabEffect, LabError, LabInstruction } from '../types.js';

type OrderLabTest = Extract<LabInstruction, { kind: 'OrderLabTest' }>;

export const orderLabTestHandler: Handler<LabContext, OrderLabTest, LabEffect, LabError> = (ctx, instruction) => {
  if (ctx.orders[instruction.orderId]) {
    return err({ kind: 'LabOrderAlreadyExists', orderId: instruction.orderId });
  }

  const context: LabContext = {
    orders: {
      ...ctx.orders,
      [instruction.orderId]: {
        orderId: instruction.orderId,
        encounterId: instruction.encounterId,
        testCode: instruction.testCode,
        status: 'ordered',
        orderedAt: instruction.orderedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'LabTestOrdered',
        orderId: instruction.orderId,
        encounterId: instruction.encounterId,
        testCode: instruction.testCode,
        orderedAt: instruction.orderedAt,
      },
    ],
  });
};
