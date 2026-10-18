import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { EmergencyContext, EmergencyEffect, EmergencyError, EmergencyInstruction } from '../types.js';

type TriagePatient = Extract<EmergencyInstruction, { kind: 'TriagePatient' }>;

/**
 * No re-triage: rejects `EdVisitAlreadyTriaged` for any visit that is
 * no longer `'registered'` — see `types.ts`'s own doc comment on why
 * that's a deliberate, deferred restraint, not an oversight.
 */
export const triagePatientHandler: Handler<EmergencyContext, TriagePatient, EmergencyEffect, EmergencyError> = (ctx, instruction) => {
  const visit = ctx.visits[instruction.visitId];
  if (!visit) {
    return err({ kind: 'EdVisitNotFound', visitId: instruction.visitId });
  }
  if (visit.status !== 'registered') {
    return err({ kind: 'EdVisitAlreadyTriaged', visitId: instruction.visitId });
  }

  const context: EmergencyContext = {
    visits: {
      ...ctx.visits,
      [instruction.visitId]: { ...visit, status: 'triaged', esiLevel: instruction.esiLevel, triagedAt: instruction.triagedAt },
    },
  };

  return ok({
    context,
    effects: [{ kind: 'PatientTriaged', visitId: instruction.visitId, esiLevel: instruction.esiLevel, triagedAt: instruction.triagedAt }],
  });
};
