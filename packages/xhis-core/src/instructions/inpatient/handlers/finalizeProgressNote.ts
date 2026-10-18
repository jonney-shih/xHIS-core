import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { InpatientContext, InpatientEffect, InpatientError, InpatientInstruction, ProgressNoteRecord } from '../types.js';

type FinalizeProgressNote = Extract<InpatientInstruction, { kind: 'FinalizeProgressNote' }>;

/**
 * No assignment-status check here, deliberately -- same reasoning
 * `finalizeSoapNoteHandler` already gives: a note can still be
 * finalized after its ward assignment has ended (late documentation is
 * a real, legitimate workflow), even though `transferWardHandler`
 * itself requires one finalized note *for the current assignment*
 * before transferring. Those are two independent facts about two
 * different instructions, not a contradiction.
 */
export const finalizeProgressNoteHandler: Handler<InpatientContext, FinalizeProgressNote, InpatientEffect, InpatientError> = (
  ctx,
  instruction,
) => {
  const note = ctx.progressNotes[instruction.noteId];
  if (!note) {
    return err({ kind: 'ProgressNoteNotFound', noteId: instruction.noteId });
  }
  if (note.status === 'finalized') {
    return err({ kind: 'ProgressNoteAlreadyFinalized', noteId: instruction.noteId });
  }

  const updated: ProgressNoteRecord = { ...note, status: 'finalized', finalizedAt: instruction.finalizedAt };
  const context: InpatientContext = {
    ...ctx,
    progressNotes: { ...ctx.progressNotes, [instruction.noteId]: updated },
  };

  return ok({
    context,
    effects: [
      { kind: 'ProgressNoteFinalized', noteId: instruction.noteId, assignmentId: note.assignmentId, finalizedAt: instruction.finalizedAt },
    ],
  });
};
