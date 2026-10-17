import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { OutpatientContext, OutpatientEffect, OutpatientError, OutpatientInstruction } from '../types.js';

type RecordSoapNote = Extract<OutpatientInstruction, { kind: 'RecordSoapNote' }>;

/**
 * Only checks that the encounter exists and is still `'checked-in'` —
 * nothing here cares whether a draft note already exists for this
 * encounter; recording more than one draft per encounter (e.g. a
 * correction, or separate notes per problem) is allowed, the same
 * "no artificial one-per-encounter limit" restraint `placeCpoeOrderHandler`
 * applies for CPOE orders.
 */
export const recordSoapNoteHandler: Handler<OutpatientContext, RecordSoapNote, OutpatientEffect, OutpatientError> = (
  ctx,
  instruction,
) => {
  if (ctx.soapNotes[instruction.noteId]) {
    return err({ kind: 'SoapNoteAlreadyExists', noteId: instruction.noteId });
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
    soapNotes: {
      ...ctx.soapNotes,
      [instruction.noteId]: {
        noteId: instruction.noteId,
        encounterId: instruction.encounterId,
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
    effects: [{ kind: 'SoapNoteRecorded', noteId: instruction.noteId, encounterId: instruction.encounterId, recordedAt: instruction.recordedAt }],
  });
};
