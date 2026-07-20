import type { ExecutionOutcome } from '../core/execution/outcome.js';
import type { Result } from '../core/execution/result.js';
import type { BedId, EncounterId, IsoTimestamp } from '../instructions/bed/ids.js';
import type { BedContext, BedEffect, BedError, BedInstruction } from '../instructions/bed/types.js';
import type { PatientEffect } from '../instructions/patient/types.js';
import type { BedSelectionStrategy } from './bedSelection.js';

/**
 * The choreography reaction docs/DETERMINISTIC_CORE_PATTERN.md's "next
 * domain" note anticipated: the patient (clinical) core doesn't know bed
 * management exists, and bed management doesn't know why a bed got
 * requested — this module is the only place that knows about the
 * relationship between the two.
 *
 * This is in-process and synchronous, not durable messaging. If the
 * process crashes between a patient commit and this reaction running,
 * the reaction is simply lost — that's the exact event-reliability gap
 * (an outbox pattern, or at-least-once delivery + idempotent consumers)
 * already flagged as unresolved; nothing here closes it.
 */
export type AdmissionBedReaction =
  | { readonly kind: 'assign'; readonly instruction: Extract<BedInstruction, { kind: 'AssignBed' }> }
  | { readonly kind: 'not-applicable' }
  | { readonly kind: 'no-bed-available'; readonly encounterId: EncounterId };

/** Decides what, if anything, a single patient effect should trigger in
 * bed management — pure, no execution. `reactToPatientEffects` below is
 * what actually runs the result against a bed engine. */
export function reactToPatientEffect(
  effect: PatientEffect,
  bedContext: BedContext,
  strategy: BedSelectionStrategy,
  assignedAt: IsoTimestamp,
): AdmissionBedReaction {
  if (effect.kind !== 'EncounterAdmitted') {
    return { kind: 'not-applicable' };
  }

  const selectedBedId = strategy.selectAvailableBed(bedContext);

  if (!selectedBedId) {
    return { kind: 'no-bed-available', encounterId: effect.encounterId };
  }

  return {
    kind: 'assign',
    instruction: { kind: 'AssignBed', bedId: selectedBedId, encounterId: effect.encounterId, assignedAt },
  };
}

export type AdmissionBedReactionOutcome =
  | { readonly kind: 'assigned'; readonly encounterId: EncounterId; readonly bedId: BedId }
  | { readonly kind: 'not-applicable' }
  | { readonly kind: 'no-bed-available'; readonly encounterId: EncounterId }
  | {
      readonly kind: 'assignment-failed';
      readonly encounterId: EncounterId;
      readonly bedId: BedId;
      readonly error: BedError;
    };

export interface ReactToPatientEffectsResult {
  readonly context: BedContext;
  readonly outcomes: readonly AdmissionBedReactionOutcome[];
}

/** The minimal structural shape this module needs from a bed engine —
 * avoids importing `createEngine`'s return type by name; the real
 * `bedEngine` already satisfies this. */
export interface BedEngineLike {
  execute(
    context: BedContext,
    instruction: BedInstruction,
  ): Result<ExecutionOutcome<BedContext, BedEffect>, BedError>;
}

/**
 * Processes every patient effect independently and best-effort: one
 * failed or unavailable bed assignment doesn't block the rest of the
 * batch, and every outcome — including failure — is reported, never
 * swallowed. Does *not* implement saga/compensation semantics: if this
 * runs against a batch where one admission gets a bed and a later one in
 * the same batch doesn't, nothing here rolls the first one back. Whether
 * "admitted with no bed" should instead be prevented earlier — a
 * stronger, saga-level guarantee on the admission itself, per the
 * choreography-vs-saga discussion this integration follows — is a real
 * design question this module deliberately leaves open rather than
 * deciding.
 */
export function reactToPatientEffects(
  bedEngine: BedEngineLike,
  bedContext: BedContext,
  patientEffects: readonly PatientEffect[],
  strategy: BedSelectionStrategy,
  assignedAt: IsoTimestamp,
): ReactToPatientEffectsResult {
  let context = bedContext;
  const outcomes: AdmissionBedReactionOutcome[] = [];

  for (const effect of patientEffects) {
    const reaction = reactToPatientEffect(effect, context, strategy, assignedAt);

    if (reaction.kind !== 'assign') {
      outcomes.push(reaction);
      continue;
    }

    const result = bedEngine.execute(context, reaction.instruction);

    if (!result.ok) {
      outcomes.push({
        kind: 'assignment-failed',
        encounterId: reaction.instruction.encounterId,
        bedId: reaction.instruction.bedId,
        error: result.error,
      });
      continue;
    }

    context = result.value.context;
    outcomes.push({ kind: 'assigned', encounterId: reaction.instruction.encounterId, bedId: reaction.instruction.bedId });
  }

  return { context, outcomes };
}
