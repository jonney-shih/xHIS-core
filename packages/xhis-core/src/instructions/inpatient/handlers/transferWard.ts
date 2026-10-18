import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { InpatientContext, InpatientEffect, InpatientError, InpatientInstruction, WardAssignmentRecord } from '../types.js';

type TransferWard = Extract<InpatientInstruction, { kind: 'TransferWard' }>;

/**
 * The one real gating invariant this domain exists to prove: a ward
 * transfer requires the encounter's *current* active assignment to
 * already have at least one finalized progress note, derived by
 * scanning the real records for a match on `assignmentId` -- not just
 * `encounterId` -- so a note written during an earlier assignment can
 * never authorize a transfer out of a *later* one. Same "derive the
 * fact from the actual records, don't cache a derived boolean"
 * discipline `completeEncounterHandler`'s own check already follows,
 * applied at the finer granularity `types.ts`'s own doc comment on
 * `ProgressNoteRecord` explains.
 *
 * Ends the current assignment (`status: 'ended'`) and creates a brand
 * new one in the same commit -- two effects from one instruction, not
 * two separate instructions, because a transfer is one real-world
 * event, not two. There is no way to undo a transfer once it commits
 * (no `ReactivateWardAssignment`): the only path back to a ward is
 * another transfer.
 */
export const transferWardHandler: Handler<InpatientContext, TransferWard, InpatientEffect, InpatientError> = (ctx, instruction) => {
  if (ctx.wardAssignments[instruction.newAssignmentId]) {
    return err({ kind: 'WardAssignmentAlreadyExists', assignmentId: instruction.newAssignmentId });
  }

  const current = Object.values(ctx.wardAssignments).find(
    (assignment) => assignment.encounterId === instruction.encounterId && assignment.status === 'active',
  );
  if (!current) {
    return err({ kind: 'EncounterHasNoActiveWardAssignment', encounterId: instruction.encounterId });
  }

  const hasFinalizedNoteForCurrentAssignment = Object.values(ctx.progressNotes).some(
    (note) => note.assignmentId === current.assignmentId && note.status === 'finalized',
  );
  if (!hasFinalizedNoteForCurrentAssignment) {
    return err({ kind: 'NoFinalizedProgressNoteForCurrentAssignment', assignmentId: current.assignmentId });
  }

  const endedCurrent: WardAssignmentRecord = { ...current, status: 'ended', endedAt: instruction.transferredAt };

  const context: InpatientContext = {
    ...ctx,
    wardAssignments: {
      ...ctx.wardAssignments,
      [current.assignmentId]: endedCurrent,
      [instruction.newAssignmentId]: {
        assignmentId: instruction.newAssignmentId,
        encounterId: instruction.encounterId,
        ward: instruction.ward,
        attendingStaffId: instruction.attendingStaffId,
        status: 'active',
        assignedAt: instruction.transferredAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      { kind: 'WardAssignmentEnded', assignmentId: current.assignmentId, encounterId: instruction.encounterId, endedAt: instruction.transferredAt },
      {
        kind: 'WardAssigned',
        assignmentId: instruction.newAssignmentId,
        encounterId: instruction.encounterId,
        ward: instruction.ward,
        attendingStaffId: instruction.attendingStaffId,
        assignedAt: instruction.transferredAt,
      },
    ],
  });
};
