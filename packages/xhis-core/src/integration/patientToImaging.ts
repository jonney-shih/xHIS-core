import type { ExecutionOutcome } from '../core/execution/outcome.js';
import type { Result } from '../core/execution/result.js';
import type { EncounterId, IsoTimestamp, StudyId } from '../instructions/imaging/ids.js';
import type { ImagingContext, ImagingEffect, ImagingError, ImagingInstruction } from '../instructions/imaging/types.js';
import type { PatientEffect } from '../instructions/patient/types.js';
import { findPendingStudiesForEncounter } from './imagingLookup.js';

/**
 * The choreography reaction for imaging, mirroring `patientToLab.ts`
 * exactly — this is the piece `docs/DETERMINISTIC_CORE_PATTERN.md`'s
 * imaging section flagged as still missing once `CancelStudy` closed
 * the structural half of the lab asymmetry: the instruction existed,
 * but nothing invoked it on discharge yet. This does.
 *
 * `EncounterAdmitted` has no imaging reaction, same reasoning as lab's
 * `EncounterAdmitted` case: studies are ordered by an explicit clinical
 * instruction, never implied by admission itself — a deliberate no-op,
 * not a gap. `EncounterDischarged` cancels every still-`'ordered'`
 * (not yet performed) study for that encounter — one-to-many, the same
 * shape lab's discharge reaction has, and for the same reason: a
 * discharge can leave behind more than one dangling pending order.
 */
export type PatientImagingReaction =
  | { readonly kind: 'cancel-pending'; readonly instructions: readonly Extract<ImagingInstruction, { kind: 'CancelStudy' }>[] }
  | { readonly kind: 'no-pending-studies'; readonly encounterId: EncounterId };

export function reactToPatientEffect(
  effect: PatientEffect,
  imagingContext: ImagingContext,
  timestamp: IsoTimestamp,
): PatientImagingReaction {
  switch (effect.kind) {
    case 'EncounterAdmitted':
      return { kind: 'no-pending-studies', encounterId: effect.encounterId };
    case 'EncounterDischarged': {
      const pending = findPendingStudiesForEncounter(imagingContext, effect.encounterId);

      if (pending.length === 0) {
        return { kind: 'no-pending-studies', encounterId: effect.encounterId };
      }

      return {
        kind: 'cancel-pending',
        instructions: pending.map((studyId) => ({ kind: 'CancelStudy', studyId, cancelledAt: timestamp })),
      };
    }
  }
}

export type PatientImagingReactionOutcome =
  | { readonly kind: 'cancelled'; readonly encounterId: EncounterId; readonly studyId: StudyId }
  | { readonly kind: 'no-pending-studies'; readonly encounterId: EncounterId }
  | {
      readonly kind: 'reaction-failed';
      readonly encounterId: EncounterId;
      readonly studyId: StudyId;
      readonly error: ImagingError;
    };

export interface ReactToPatientEffectsForImagingResult {
  readonly context: ImagingContext;
  readonly outcomes: readonly PatientImagingReactionOutcome[];
  /** Every `ImagingEffect` actually produced by a successful cancellation
   * in this batch, in order — same role as `patientToLab.ts`'s
   * `ReactToPatientEffectsForLabResult.effects`. */
  readonly effects: readonly ImagingEffect[];
}

/** The minimal structural shape this module needs from an imaging
 * engine — mirrors `patientToLab.ts`'s `LabEngineLike`. */
export interface ImagingEngineLike {
  execute(
    context: ImagingContext,
    instruction: ImagingInstruction,
  ): Result<ExecutionOutcome<ImagingContext, ImagingEffect>, ImagingError>;
}

/**
 * Processes every patient effect independently and best-effort, same
 * contract as `patientToLab.ts`'s `reactToPatientEffectsForLab` —
 * including *within* one effect's own `cancel-pending` reaction: one
 * study that fails to cancel doesn't block cancelling the rest of that
 * encounter's pending studies. No saga/compensation semantics here
 * either; if that's ever needed for imaging, it composes on top the
 * same way `patientBedSaga.ts` does for bed, not built into this.
 */
export function reactToPatientEffectsForImaging(
  imagingEngine: ImagingEngineLike,
  imagingContext: ImagingContext,
  patientEffects: readonly PatientEffect[],
  timestamp: IsoTimestamp,
): ReactToPatientEffectsForImagingResult {
  let context = imagingContext;
  const outcomes: PatientImagingReactionOutcome[] = [];
  const effects: ImagingEffect[] = [];

  for (const effect of patientEffects) {
    const reaction = reactToPatientEffect(effect, context, timestamp);

    if (reaction.kind === 'no-pending-studies') {
      outcomes.push(reaction);
      continue;
    }

    for (const instruction of reaction.instructions) {
      const result = imagingEngine.execute(context, instruction);

      if (!result.ok) {
        outcomes.push({ kind: 'reaction-failed', encounterId: effect.encounterId, studyId: instruction.studyId, error: result.error });
        continue;
      }

      context = result.value.context;
      effects.push(...result.value.effects);
      outcomes.push({ kind: 'cancelled', encounterId: effect.encounterId, studyId: instruction.studyId });
    }
  }

  return { context, outcomes, effects };
}
