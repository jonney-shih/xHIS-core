import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { OutpatientContext, OutpatientEffect, OutpatientError, OutpatientInstruction, SoapNoteRecord } from '../types.js';

type FinalizeSoapNote = Extract<OutpatientInstruction, { kind: 'FinalizeSoapNote' }>;

/**
 * No encounter-status check here, deliberately: a note can still be
 * finalized after its encounter is `'completed'` (late documentation is
 * a real, legitimate clinical workflow), even though
 * `completeEncounterHandler` itself requires one finalized note to
 * already exist before completion succeeds. Those are two independent
 * facts about two different instructions, not a contradiction.
 */
export const finalizeSoapNoteHandler: Handler<OutpatientContext, FinalizeSoapNote, OutpatientEffect, OutpatientError> = (
  ctx,
  instruction,
) => {
  const note = ctx.soapNotes[instruction.noteId];
  if (!note) {
    return err({ kind: 'SoapNoteNotFound', noteId: instruction.noteId });
  }
  if (note.status === 'finalized') {
    return err({ kind: 'SoapNoteAlreadyFinalized', noteId: instruction.noteId });
  }

  const updated: SoapNoteRecord = { ...note, status: 'finalized', finalizedAt: instruction.finalizedAt };
  const context: OutpatientContext = {
    ...ctx,
    soapNotes: { ...ctx.soapNotes, [instruction.noteId]: updated },
  };

  return ok({
    context,
    effects: [
      { kind: 'SoapNoteFinalized', noteId: instruction.noteId, encounterId: note.encounterId, finalizedAt: instruction.finalizedAt },
    ],
  });
};
