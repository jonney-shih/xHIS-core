import type { ExecutionOutcome } from '../core/execution/outcome.js';
import type { Result } from '../core/execution/result.js';
import type { BedId, EncounterId, IsoTimestamp } from '../instructions/bed/ids.js';
import type { BedContext, BedEffect, BedError, BedInstruction } from '../instructions/bed/types.js';
import type { PatientEffect } from '../instructions/patient/types.js';
import { findBedHoldingEncounter } from './bedLookup.js';
import type { BedSelectionStrategy } from './bedSelection.js';

/**
 * The choreography reaction docs/DETERMINISTIC_CORE_PATTERN.md's "next
 * domain" note anticipated: the patient (clinical) core doesn't know bed
 * management exists, and bed management doesn't know why a bed got
 * requested or released — this module is the only place that knows about
 * the relationship between the two.
 *
 * This is in-process and synchronous, not durable messaging. If the
 * process crashes between a patient commit and this reaction running,
 * the reaction is simply lost — that's the exact event-reliability gap
 * (an outbox pattern, or at-least-once delivery + idempotent consumers)
 * already flagged as unresolved; nothing here closes it.
 */
export type PatientBedReaction =
  | { readonly kind: 'assign'; readonly instruction: Extract<BedInstruction, { kind: 'AssignBed' }> }
  | { readonly kind: 'release'; readonly instruction: Extract<BedInstruction, { kind: 'ReleaseBed' }> }
  | { readonly kind: 'no-bed-available'; readonly encounterId: EncounterId }
  | { readonly kind: 'no-bed-to-release'; readonly encounterId: EncounterId }
  | { readonly kind: 'ambiguous-bed-assignment'; readonly encounterId: EncounterId; readonly bedIds: readonly BedId[] };

/**
 * Decides what, if anything, a single patient effect should trigger in
 * bed management — pure, no execution. `reactToPatientEffects` below is
 * what actually runs the result against a bed engine.
 *
 * Written as a `switch` with no `default`, over `PatientEffect['kind']` —
 * exhaustive on purpose. `PatientInstruction` only has two variants
 * today, so this needs no `not-applicable` case at all — every current
 * patient effect has a bed-management reaction. If a third `PatientEffect`
 * variant is ever added, this switch stops compiling until someone
 * decides what it should do here, rather than silently doing nothing.
 */
export function reactToPatientEffect(
  effect: PatientEffect,
  bedContext: BedContext,
  strategy: BedSelectionStrategy,
  timestamp: IsoTimestamp,
): PatientBedReaction {
  switch (effect.kind) {
    case 'EncounterAdmitted': {
      const selectedBedId = strategy.selectAvailableBed(bedContext);

      if (!selectedBedId) {
        return { kind: 'no-bed-available', encounterId: effect.encounterId };
      }

      return {
        kind: 'assign',
        instruction: { kind: 'AssignBed', bedId: selectedBedId, encounterId: effect.encounterId, assignedAt: timestamp },
      };
    }
    case 'EncounterDischarged': {
      const lookup = findBedHoldingEncounter(bedContext, effect.encounterId);

      switch (lookup.kind) {
        case 'not-found':
          return { kind: 'no-bed-to-release', encounterId: effect.encounterId };
        case 'ambiguous':
          return { kind: 'ambiguous-bed-assignment', encounterId: effect.encounterId, bedIds: lookup.bedIds };
        case 'found':
          return { kind: 'release', instruction: { kind: 'ReleaseBed', bedId: lookup.bedId, releasedAt: timestamp } };
      }
    }
  }
}

export type PatientBedReactionOutcome =
  | { readonly kind: 'assigned'; readonly encounterId: EncounterId; readonly bedId: BedId }
  | { readonly kind: 'released'; readonly encounterId: EncounterId; readonly bedId: BedId }
  | { readonly kind: 'no-bed-available'; readonly encounterId: EncounterId }
  | { readonly kind: 'no-bed-to-release'; readonly encounterId: EncounterId }
  | { readonly kind: 'ambiguous-bed-assignment'; readonly encounterId: EncounterId; readonly bedIds: readonly BedId[] }
  | { readonly kind: 'reaction-failed'; readonly encounterId: EncounterId; readonly error: BedError };

export interface ReactToPatientEffectsResult {
  readonly context: BedContext;
  readonly outcomes: readonly PatientBedReactionOutcome[];
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
 * failed, unavailable, or ambiguous bed reaction doesn't block the rest
 * of the batch, and every outcome — including failure — is reported,
 * never swallowed. Does *not* implement saga/compensation semantics: if
 * this runs against a batch where one admission gets a bed and a later
 * one in the same batch doesn't, nothing here rolls the first one back.
 * Whether "admitted with no bed" (or "discharged with no bed to
 * release") should instead be prevented earlier — a stronger, saga-level
 * guarantee on the triggering instruction itself, per the choreography-
 * vs-saga discussion this integration follows — is a real design
 * question this module deliberately leaves open rather than deciding.
 */
export function reactToPatientEffects(
  bedEngine: BedEngineLike,
  bedContext: BedContext,
  patientEffects: readonly PatientEffect[],
  strategy: BedSelectionStrategy,
  timestamp: IsoTimestamp,
): ReactToPatientEffectsResult {
  let context = bedContext;
  const outcomes: PatientBedReactionOutcome[] = [];

  for (const effect of patientEffects) {
    const reaction = reactToPatientEffect(effect, context, strategy, timestamp);

    switch (reaction.kind) {
      case 'no-bed-available':
      case 'no-bed-to-release':
      case 'ambiguous-bed-assignment':
        outcomes.push(reaction);
        continue;
      case 'assign':
      case 'release': {
        const result = bedEngine.execute(context, reaction.instruction);

        if (!result.ok) {
          outcomes.push({ kind: 'reaction-failed', encounterId: effect.encounterId, error: result.error });
          continue;
        }

        context = result.value.context;
        outcomes.push(
          reaction.kind === 'assign'
            ? { kind: 'assigned', encounterId: reaction.instruction.encounterId, bedId: reaction.instruction.bedId }
            : { kind: 'released', encounterId: effect.encounterId, bedId: reaction.instruction.bedId },
        );
        continue;
      }
    }
  }

  return { context, outcomes };
}
