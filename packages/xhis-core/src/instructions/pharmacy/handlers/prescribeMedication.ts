import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { PharmacyContext, PharmacyEffect, PharmacyError, PharmacyInstruction } from '../types.js';

type PrescribeMedication = Extract<PharmacyInstruction, { kind: 'PrescribeMedication' }>;

export const prescribeMedicationHandler: Handler<PharmacyContext, PrescribeMedication, PharmacyEffect, PharmacyError> = (ctx, instruction) => {
  if (ctx.prescriptions[instruction.prescriptionId]) {
    return err({ kind: 'PrescriptionAlreadyExists', prescriptionId: instruction.prescriptionId });
  }

  const context: PharmacyContext = {
    prescriptions: {
      ...ctx.prescriptions,
      [instruction.prescriptionId]: {
        prescriptionId: instruction.prescriptionId,
        encounterId: instruction.encounterId,
        medicationCode: instruction.medicationCode,
        status: 'prescribed',
        prescribedAt: instruction.prescribedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'MedicationPrescribed',
        prescriptionId: instruction.prescriptionId,
        encounterId: instruction.encounterId,
        medicationCode: instruction.medicationCode,
        prescribedAt: instruction.prescribedAt,
      },
    ],
  });
};
