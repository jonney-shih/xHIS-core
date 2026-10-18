import type { ExecutionOutcome } from '../core/execution/outcome.js';
import type { Result } from '../core/execution/result.js';
import { studyId } from '../instructions/imaging/ids.js';
import type { EncounterId, StudyId } from '../instructions/imaging/ids.js';
import type { ImagingContext, ImagingEffect, ImagingError, ImagingInstruction } from '../instructions/imaging/types.js';
import type { OutpatientEffect } from '../instructions/outpatient/types.js';

/**
 * The imaging counterpart to `outpatientToLab.ts`, mirroring it exactly
 * — see that module's own doc comment for the full reasoning (ID reuse
 * as the redelivery-safety mechanism, `performedAt`... here `orderedAt`
 * taken from the CPOE effect's own `placedAt` rather than a fresh
 * relay-time timestamp, three separate files for three genuinely
 * different target types).
 */
export type OutpatientImagingReaction =
  | { readonly kind: 'order-study'; readonly instruction: Extract<ImagingInstruction, { kind: 'OrderStudy' }> }
  | { readonly kind: 'not-applicable'; readonly sourceEffectKind: OutpatientEffect['kind'] };

export function reactToOutpatientEffect(effect: OutpatientEffect): OutpatientImagingReaction {
  if (effect.kind !== 'CpoeOrderPlaced' || effect.detail.orderType !== 'imaging') {
    return { kind: 'not-applicable', sourceEffectKind: effect.kind };
  }

  return {
    kind: 'order-study',
    instruction: {
      kind: 'OrderStudy',
      studyId: studyId(effect.orderId),
      encounterId: effect.encounterId,
      modality: effect.detail.modality,
      orderedAt: effect.placedAt,
    },
  };
}

export type OutpatientImagingReactionOutcome =
  | { readonly kind: 'ordered'; readonly studyId: StudyId; readonly encounterId: EncounterId }
  | { readonly kind: 'already-ordered'; readonly studyId: StudyId }
  | { readonly kind: 'not-applicable'; readonly sourceEffectKind: OutpatientEffect['kind'] }
  | { readonly kind: 'reaction-failed'; readonly studyId: StudyId; readonly error: ImagingError };

export interface ReactToOutpatientEffectsForImagingResult {
  readonly context: ImagingContext;
  readonly outcomes: readonly OutpatientImagingReactionOutcome[];
  readonly effects: readonly ImagingEffect[];
}

/** The minimal structural shape this module needs from an imaging
 * engine — mirrors `patientToImaging.ts`'s `ImagingEngineLike`. */
export interface ImagingEngineLike {
  execute(
    context: ImagingContext,
    instruction: ImagingInstruction,
  ): Result<ExecutionOutcome<ImagingContext, ImagingEffect>, ImagingError>;
}

/**
 * Processes every outpatient effect independently and best-effort, same
 * contract as `outpatientToLab.ts`'s `reactToOutpatientEffectsForLab`. A
 * `StudyAlreadyExists` failure is reported as `already-ordered`, not
 * `reaction-failed` — the expected, harmless shape of a redelivered
 * `CpoeOrderPlaced`, not a real error.
 */
export function reactToOutpatientEffectsForImaging(
  imagingEngine: ImagingEngineLike,
  imagingContext: ImagingContext,
  outpatientEffects: readonly OutpatientEffect[],
): ReactToOutpatientEffectsForImagingResult {
  let context = imagingContext;
  const outcomes: OutpatientImagingReactionOutcome[] = [];
  const effects: ImagingEffect[] = [];

  for (const effect of outpatientEffects) {
    const reaction = reactToOutpatientEffect(effect);

    if (reaction.kind === 'not-applicable') {
      outcomes.push(reaction);
      continue;
    }

    const result = imagingEngine.execute(context, reaction.instruction);

    if (!result.ok) {
      if (result.error.kind === 'StudyAlreadyExists') {
        outcomes.push({ kind: 'already-ordered', studyId: reaction.instruction.studyId });
        continue;
      }
      outcomes.push({ kind: 'reaction-failed', studyId: reaction.instruction.studyId, error: result.error });
      continue;
    }

    context = result.value.context;
    effects.push(...result.value.effects);
    outcomes.push({ kind: 'ordered', studyId: reaction.instruction.studyId, encounterId: reaction.instruction.encounterId });
  }

  return { context, outcomes, effects };
}
