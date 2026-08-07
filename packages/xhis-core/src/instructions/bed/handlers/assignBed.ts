import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { BedContext, BedEffect, BedError, BedInstruction } from '../types.js';

type AssignBed = Extract<BedInstruction, { kind: 'AssignBed' }>;

export const assignBedHandler: Handler<BedContext, AssignBed, BedEffect, BedError> = (ctx, instruction) => {
  const existing = ctx.beds[instruction.bedId];

  if (!existing) {
    return err({ kind: 'BedNotFound', bedId: instruction.bedId });
  }

  if (existing.status !== 'available') {
    return err({ kind: 'BedAlreadyOccupied', bedId: instruction.bedId });
  }

  const context: BedContext = {
    beds: {
      ...ctx.beds,
      [instruction.bedId]: {
        bedId: existing.bedId,
        status: 'occupied',
        encounterId: instruction.encounterId,
        assignedAt: instruction.assignedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'BedAssigned',
        bedId: instruction.bedId,
        encounterId: instruction.encounterId,
        assignedAt: instruction.assignedAt,
      },
    ],
  });
};
