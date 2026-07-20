import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { ImagingContext, ImagingEffect, ImagingError, ImagingInstruction } from '../types.js';

type OrderStudy = Extract<ImagingInstruction, { kind: 'OrderStudy' }>;

export const orderStudyHandler: Handler<ImagingContext, OrderStudy, ImagingEffect, ImagingError> = (ctx, instruction) => {
  if (ctx.studies[instruction.studyId]) {
    return err({ kind: 'StudyAlreadyExists', studyId: instruction.studyId });
  }

  const context: ImagingContext = {
    studies: {
      ...ctx.studies,
      [instruction.studyId]: {
        studyId: instruction.studyId,
        encounterId: instruction.encounterId,
        modality: instruction.modality,
        status: 'ordered',
        orderedAt: instruction.orderedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'StudyOrdered',
        studyId: instruction.studyId,
        encounterId: instruction.encounterId,
        modality: instruction.modality,
        orderedAt: instruction.orderedAt,
      },
    ],
  });
};
