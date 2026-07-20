import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { LabContext, LabEffect, LabError, LabInstruction } from '../types.js';

type CancelLabOrder = Extract<LabInstruction, { kind: 'CancelLabOrder' }>;

export const cancelLabOrderHandler: Handler<LabContext, CancelLabOrder, LabEffect, LabError> = (ctx, instruction) => {
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
        status: 'cancelled',
        cancelledAt: instruction.cancelledAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'LabOrderCancelled',
        orderId: instruction.orderId,
        encounterId: existing.encounterId,
        cancelledAt: instruction.cancelledAt,
      },
    ],
  });
};
