import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { OutpatientContext, OutpatientEffect, OutpatientError, OutpatientInstruction } from '../types.js';

type CompleteEncounter = Extract<OutpatientInstruction, { kind: 'CompleteEncounter' }>;

/**
 * The one real gating invariant this domain exists to prove: an
 * encounter cannot be completed unless at least one of its SOAP notes
 * has been finalized — scanning every `SoapNoteRecord` for a matching
 * `encounterId` with `status === 'finalized'`, not trusting a count or
 * a flag carried on the encounter itself, the same "derive the fact
 * from the actual records, don't cache a derived boolean" discipline
 * `grantRoleHandler`'s own credential-validity check already follows.
 * An encounter with only draft notes, or no notes at all, is rejected —
 * closing out a visit with nothing finalized in its chart is exactly
 * the failure mode a real outpatient workflow cannot allow.
 */
export const completeEncounterHandler: Handler<OutpatientContext, CompleteEncounter, OutpatientEffect, OutpatientError> = (
  ctx,
  instruction,
) => {
  const encounter = ctx.encounters[instruction.encounterId];
  if (!encounter) {
    return err({ kind: 'EncounterNotFound', encounterId: instruction.encounterId });
  }
  if (encounter.status !== 'checked-in') {
    return err({ kind: 'EncounterNotCheckedIn', encounterId: instruction.encounterId });
  }

  const hasFinalizedNote = Object.values(ctx.soapNotes).some(
    (note) => note.encounterId === instruction.encounterId && note.status === 'finalized',
  );
  if (!hasFinalizedNote) {
    return err({ kind: 'NoFinalizedSoapNote', encounterId: instruction.encounterId });
  }

  const context: OutpatientContext = {
    ...ctx,
    encounters: {
      ...ctx.encounters,
      [instruction.encounterId]: { ...encounter, status: 'completed', completedAt: instruction.completedAt },
    },
  };

  return ok({
    context,
    effects: [{ kind: 'EncounterCompleted', encounterId: instruction.encounterId, completedAt: instruction.completedAt }],
  });
};
