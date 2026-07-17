import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { PatientContext, PatientEffect, PatientError, PatientInstruction } from '../types.js';

type DischargePatient = Extract<PatientInstruction, { kind: 'DischargePatient' }>;

export const dischargePatientHandler: Handler<
  PatientContext,
  DischargePatient,
  PatientEffect,
  PatientError
> = (ctx, instruction) => {
  const existing = ctx.encounters[instruction.encounterId];

  if (!existing) {
    return err({ kind: 'EncounterNotFound', encounterId: instruction.encounterId });
  }

  if (existing.status !== 'admitted') {
    return err({ kind: 'EncounterNotAdmitted', encounterId: instruction.encounterId });
  }

  const context: PatientContext = {
    encounters: {
      ...ctx.encounters,
      [instruction.encounterId]: {
        ...existing,
        status: 'discharged',
        dischargedAt: instruction.dischargedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'EncounterDischarged',
        encounterId: instruction.encounterId,
        dischargedAt: instruction.dischargedAt,
      },
    ],
  });
};
