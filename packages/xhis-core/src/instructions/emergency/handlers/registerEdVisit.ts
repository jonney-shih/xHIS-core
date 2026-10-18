import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { EmergencyContext, EmergencyEffect, EmergencyError, EmergencyInstruction } from '../types.js';

type RegisterEdVisit = Extract<EmergencyInstruction, { kind: 'RegisterEdVisit' }>;

export const registerEdVisitHandler: Handler<EmergencyContext, RegisterEdVisit, EmergencyEffect, EmergencyError> = (
  ctx,
  instruction,
) => {
  if (ctx.visits[instruction.visitId]) {
    return err({ kind: 'EdVisitAlreadyExists', visitId: instruction.visitId });
  }

  const context: EmergencyContext = {
    visits: {
      ...ctx.visits,
      [instruction.visitId]: {
        visitId: instruction.visitId,
        encounterId: instruction.encounterId,
        patientId: instruction.patientId,
        chiefComplaint: instruction.chiefComplaint,
        status: 'registered',
        registeredAt: instruction.registeredAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'EdVisitRegistered',
        visitId: instruction.visitId,
        encounterId: instruction.encounterId,
        patientId: instruction.patientId,
        chiefComplaint: instruction.chiefComplaint,
        registeredAt: instruction.registeredAt,
      },
    ],
  });
};
