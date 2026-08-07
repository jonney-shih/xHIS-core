import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { PatientContext, PatientEffect, PatientError, PatientInstruction } from '../types.js';

type AdmitPatient = Extract<PatientInstruction, { kind: 'AdmitPatient' }>;

export const admitPatientHandler: Handler<PatientContext, AdmitPatient, PatientEffect, PatientError> = (
  ctx,
  instruction,
) => {
  if (ctx.encounters[instruction.encounterId]) {
    return err({ kind: 'EncounterAlreadyExists', encounterId: instruction.encounterId });
  }

  const context: PatientContext = {
    encounters: {
      ...ctx.encounters,
      [instruction.encounterId]: {
        encounterId: instruction.encounterId,
        patientId: instruction.patientId,
        status: 'admitted',
        admittedAt: instruction.admittedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'EncounterAdmitted',
        encounterId: instruction.encounterId,
        patientId: instruction.patientId,
        admittedAt: instruction.admittedAt,
      },
    ],
  });
};
