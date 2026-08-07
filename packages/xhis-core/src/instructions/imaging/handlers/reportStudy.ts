import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { ImagingContext, ImagingEffect, ImagingError, ImagingInstruction } from '../types.js';

type ReportStudy = Extract<ImagingInstruction, { kind: 'ReportStudy' }>;

export const reportStudyHandler: Handler<ImagingContext, ReportStudy, ImagingEffect, ImagingError> = (ctx, instruction) => {
  const existing = ctx.studies[instruction.studyId];

  if (!existing) {
    return err({ kind: 'StudyNotFound', studyId: instruction.studyId });
  }

  if (existing.status !== 'performed') {
    return err({ kind: 'StudyNotPerformed', studyId: instruction.studyId });
  }

  const context: ImagingContext = {
    studies: {
      ...ctx.studies,
      [instruction.studyId]: {
        ...existing,
        status: 'reported',
        reportText: instruction.reportText,
        reportedAt: instruction.reportedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'StudyReported',
        studyId: instruction.studyId,
        encounterId: existing.encounterId,
        reportText: instruction.reportText,
        reportedAt: instruction.reportedAt,
      },
    ],
  });
};
