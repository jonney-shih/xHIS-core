import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { PharmacyContext, PharmacyEffect, PharmacyError, PharmacyInstruction } from '../types.js';

type DispenseMedication = Extract<PharmacyInstruction, { kind: 'DispenseMedication' }>;

export const dispenseMedicationHandler: Handler<PharmacyContext, DispenseMedication, PharmacyEffect, PharmacyError> = (ctx, instruction) => {
  const existing = ctx.prescriptions[instruction.prescriptionId];

  if (!existing) {
    return err({ kind: 'PrescriptionNotFound', prescriptionId: instruction.prescriptionId });
  }

  if (existing.status !== 'prescribed') {
    return err({ kind: 'PrescriptionNotPending', prescriptionId: instruction.prescriptionId });
  }

  const context: PharmacyContext = {
    prescriptions: {
      ...ctx.prescriptions,
      [instruction.prescriptionId]: {
        ...existing,
        status: 'dispensed',
        dispensedAt: instruction.dispensedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'MedicationDispensed',
        prescriptionId: instruction.prescriptionId,
        encounterId: existing.encounterId,
        dispensedAt: instruction.dispensedAt,
      },
    ],
  });
};
