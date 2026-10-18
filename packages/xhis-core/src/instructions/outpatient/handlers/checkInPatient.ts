import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { OutpatientContext, OutpatientEffect, OutpatientError, OutpatientInstruction } from '../types.js';

type CheckInPatient = Extract<OutpatientInstruction, { kind: 'CheckInPatient' }>;

export const checkInPatientHandler: Handler<OutpatientContext, CheckInPatient, OutpatientEffect, OutpatientError> = (
  ctx,
  instruction,
) => {
  if (ctx.encounters[instruction.encounterId]) {
    return err({ kind: 'EncounterAlreadyExists', encounterId: instruction.encounterId });
  }

  const context: OutpatientContext = {
    ...ctx,
    encounters: {
      ...ctx.encounters,
      [instruction.encounterId]: {
        encounterId: instruction.encounterId,
        patientId: instruction.patientId,
        status: 'checked-in',
        checkedInAt: instruction.checkedInAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'PatientCheckedIn',
        encounterId: instruction.encounterId,
        patientId: instruction.patientId,
        checkedInAt: instruction.checkedInAt,
      },
    ],
  });
};
