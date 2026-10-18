import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { InpatientContext, InpatientEffect, InpatientError, InpatientInstruction } from '../types.js';

type AssignWard = Extract<InpatientInstruction, { kind: 'AssignWard' }>;

/**
 * The first ward assignment for an encounter — `transferWardHandler` is
 * what handles every assignment after this one. Rejects
 * `EncounterAlreadyHasActiveWardAssignment` if this encounter already
 * has an active assignment, scanning the real records rather than
 * trusting a cached flag, the same discipline `completeEncounterHandler`'s
 * finalized-note check already follows.
 */
export const assignWardHandler: Handler<InpatientContext, AssignWard, InpatientEffect, InpatientError> = (ctx, instruction) => {
  if (ctx.wardAssignments[instruction.assignmentId]) {
    return err({ kind: 'WardAssignmentAlreadyExists', assignmentId: instruction.assignmentId });
  }

  const hasActiveAssignment = Object.values(ctx.wardAssignments).some(
    (assignment) => assignment.encounterId === instruction.encounterId && assignment.status === 'active',
  );
  if (hasActiveAssignment) {
    return err({ kind: 'EncounterAlreadyHasActiveWardAssignment', encounterId: instruction.encounterId });
  }

  const context: InpatientContext = {
    ...ctx,
    wardAssignments: {
      ...ctx.wardAssignments,
      [instruction.assignmentId]: {
        assignmentId: instruction.assignmentId,
        encounterId: instruction.encounterId,
        ward: instruction.ward,
        attendingStaffId: instruction.attendingStaffId,
        status: 'active',
        assignedAt: instruction.assignedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'WardAssigned',
        assignmentId: instruction.assignmentId,
        encounterId: instruction.encounterId,
        ward: instruction.ward,
        attendingStaffId: instruction.attendingStaffId,
        assignedAt: instruction.assignedAt,
      },
    ],
  });
};
