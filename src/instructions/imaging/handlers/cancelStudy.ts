import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { ImagingContext, ImagingEffect, ImagingError, ImagingInstruction } from '../types.js';

type CancelStudy = Extract<ImagingInstruction, { kind: 'CancelStudy' }>;

/**
 * Only cancellable while still `'ordered'` — the same restriction
 * `lab/handlers/cancelLabOrder.ts` applies, and for the same reason:
 * this exists to resolve a still-*pending* order, not to retract
 * something already performed or reported. Reuses `StudyNotOrdered`
 * rather than a new error kind, mirroring how `cancelLabOrderHandler`
 * reuses `LabOrderNotPending` — "not in the one state this instruction
 * can act on" is the same condition `recordStudyStoredHandler` already
 * checks, just triggered by a different instruction.
 */
export const cancelStudyHandler: Handler<ImagingContext, CancelStudy, ImagingEffect, ImagingError> = (
  ctx,
  instruction,
) => {
  const existing = ctx.studies[instruction.studyId];

  if (!existing) {
    return err({ kind: 'StudyNotFound', studyId: instruction.studyId });
  }

  if (existing.status !== 'ordered') {
    return err({ kind: 'StudyNotOrdered', studyId: instruction.studyId });
  }

  const context: ImagingContext = {
    studies: {
      ...ctx.studies,
      [instruction.studyId]: { ...existing, status: 'cancelled', cancelledAt: instruction.cancelledAt },
    },
  };

  return ok({
    context,
    effects: [{ kind: 'StudyCancelled', studyId: instruction.studyId, encounterId: existing.encounterId, cancelledAt: instruction.cancelledAt }],
  });
};
