import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { OutpatientContext, OutpatientEffect, OutpatientError, OutpatientInstruction } from '../types.js';

type PlaceCpoeOrder = Extract<OutpatientInstruction, { kind: 'PlaceCpoeOrder' }>;

/**
 * Records the order as placed; nothing here drives a real `lab`/
 * `imaging`/`pharmacy` instruction yet — see `types.ts`'s own doc
 * comment on `CpoeOrderDetail` for why that's deliberately deferred to
 * a future outbox relay rather than this handler reaching into another
 * domain directly (which would break the same domain-isolation
 * discipline every other handler in this codebase holds to).
 */
export const placeCpoeOrderHandler: Handler<OutpatientContext, PlaceCpoeOrder, OutpatientEffect, OutpatientError> = (
  ctx,
  instruction,
) => {
  if (ctx.cpoeOrders[instruction.orderId]) {
    return err({ kind: 'CpoeOrderAlreadyExists', orderId: instruction.orderId });
  }

  const encounter = ctx.encounters[instruction.encounterId];
  if (!encounter) {
    return err({ kind: 'EncounterNotFound', encounterId: instruction.encounterId });
  }
  if (encounter.status !== 'checked-in') {
    return err({ kind: 'EncounterNotCheckedIn', encounterId: instruction.encounterId });
  }

  const context: OutpatientContext = {
    ...ctx,
    cpoeOrders: {
      ...ctx.cpoeOrders,
      [instruction.orderId]: {
        orderId: instruction.orderId,
        encounterId: instruction.encounterId,
        detail: instruction.detail,
        placedAt: instruction.placedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'CpoeOrderPlaced',
        orderId: instruction.orderId,
        encounterId: instruction.encounterId,
        detail: instruction.detail,
        placedAt: instruction.placedAt,
      },
    ],
  });
};
