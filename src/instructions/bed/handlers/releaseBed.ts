import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { BedContext, BedEffect, BedError, BedInstruction } from '../types.js';

type ReleaseBed = Extract<BedInstruction, { kind: 'ReleaseBed' }>;

export const releaseBedHandler: Handler<BedContext, ReleaseBed, BedEffect, BedError> = (ctx, instruction) => {
  const existing = ctx.beds[instruction.bedId];

  if (!existing) {
    return err({ kind: 'BedNotFound', bedId: instruction.bedId });
  }

  if (existing.status !== 'occupied') {
    return err({ kind: 'BedNotOccupied', bedId: instruction.bedId });
  }

  // Sanctioned assertion, not a cast past the "correlated union" limitation
  // engine.ts's dispatch works around — this is a plain domain invariant:
  // `BedRecord` doesn't type-link `status` and `encounterId` together (it
  // mirrors `EncounterRecord`'s plain-optional-fields style rather than a
  // discriminated union), but `assignBedHandler` never sets `status:
  // 'occupied'` without also setting `encounterId`, so an occupied record
  // reaching here always has one.
  const releasedEncounterId = existing.encounterId!;

  const context: BedContext = {
    beds: {
      ...ctx.beds,
      [instruction.bedId]: {
        bedId: existing.bedId,
        status: 'available',
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'BedReleased',
        bedId: instruction.bedId,
        encounterId: releasedEncounterId,
        releasedAt: instruction.releasedAt,
      },
    ],
  });
};
