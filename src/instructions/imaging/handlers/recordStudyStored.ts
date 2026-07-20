import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { ImagingContext, ImagingEffect, ImagingError, ImagingInstruction } from '../types.js';

type RecordStudyStored = Extract<ImagingInstruction, { kind: 'RecordStudyStored' }>;

/**
 * A generous bound on a *reference* (an object-store key or URI), not on
 * an image — any legitimate PACS storage reference fits comfortably
 * under this; actual pixel data would be many orders of magnitude
 * larger. Chosen as a reasonable starting point, not derived from any
 * specific storage backend's key format — same reasoning
 * `PATIENT_MAX_BATCH_SIZE` documents for its own number.
 */
export const MAX_STORAGE_REF_LENGTH = 512;

/**
 * The domain-specific invariant proof for this boundary (see `types.ts`'s
 * doc comment): rejecting outright, before ever writing anything into
 * `ImagingContext`, is what actually enforces "reference by ID, never
 * embed bytes" — without this check, nothing in the type system stops a
 * caller from passing a base64-encoded image through `storageRef` and
 * turning this domain's plain-JSON context into exactly the large-binary
 * problem it exists to avoid. See
 * `tests/instructions/imaging/referenceById.guard.test.ts` for the
 * empirical proof that this is load-bearing.
 */
export const recordStudyStoredHandler: Handler<ImagingContext, RecordStudyStored, ImagingEffect, ImagingError> = (
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

  if (instruction.storageRef.length > MAX_STORAGE_REF_LENGTH) {
    return err({
      kind: 'StorageRefTooLarge',
      studyId: instruction.studyId,
      length: instruction.storageRef.length,
      maxLength: MAX_STORAGE_REF_LENGTH,
    });
  }

  const context: ImagingContext = {
    studies: {
      ...ctx.studies,
      [instruction.studyId]: {
        ...existing,
        status: 'performed',
        performedAt: instruction.performedAt,
        storageRef: instruction.storageRef,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'StudyStored',
        studyId: instruction.studyId,
        encounterId: existing.encounterId,
        storageRef: instruction.storageRef,
        performedAt: instruction.performedAt,
      },
    ],
  });
};
