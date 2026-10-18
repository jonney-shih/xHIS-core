import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { InpatientContext, InpatientEffect, InpatientError, InpatientInstruction } from '../types.js';

type RecordProgressNote = Extract<InpatientInstruction, { kind: 'RecordProgressNote' }>;

/**
 * Only checks that the ward assignment exists and is still `'active'`
 * -- same shape as `recordSoapNoteHandler`'s check against encounter
 * status, applied to an assignment instead. More than one progress
 * note per assignment is allowed (daily rounding produces one per
 * visit), the same "no artificial one-per-X limit" restraint
 * `recordSoapNoteHandler` already applies per encounter.
 */
export const recordProgressNoteHandler: Handler<InpatientContext, RecordProgressNote, InpatientEffect, InpatientError> = (
  ctx,
  instruction,
) => {
  if (ctx.progressNotes[instruction.noteId]) {
    return err({ kind: 'ProgressNoteAlreadyExists', noteId: instruction.noteId });
  }

  const assignment = ctx.wardAssignments[instruction.assignmentId];
  if (!assignment) {
    return err({ kind: 'WardAssignmentNotFound', assignmentId: instruction.assignmentId });
  }
  if (assignment.status !== 'active') {
    return err({ kind: 'WardAssignmentNotActive', assignmentId: instruction.assignmentId });
  }

  const context: InpatientContext = {
    ...ctx,
    progressNotes: {
      ...ctx.progressNotes,
      [instruction.noteId]: {
        noteId: instruction.noteId,
        assignmentId: instruction.assignmentId,
        authorStaffId: instruction.authorStaffId,
        subjective: instruction.subjective,
        objective: instruction.objective,
        assessment: instruction.assessment,
        plan: instruction.plan,
        status: 'draft',
        recordedAt: instruction.recordedAt,
      },
    },
  };

  return ok({
    context,
    effects: [{ kind: 'ProgressNoteRecorded', noteId: instruction.noteId, assignmentId: instruction.assignmentId, recordedAt: instruction.recordedAt }],
  });
};
