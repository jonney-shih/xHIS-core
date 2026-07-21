import type { ExecutionOutcome } from '../core/execution/outcome.js';
import type { Result } from '../core/execution/result.js';
import type { EncounterId } from '../instructions/patient/ids.js';
import type { BookingId, IsoTimestamp } from '../instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingEffect, SchedulingError, SchedulingInstruction } from '../instructions/scheduling/types.js';
import type { PatientEffect } from '../instructions/patient/types.js';
import { findPendingBookingsForEncounter } from './schedulingLookup.js';

/**
 * The choreography reaction for scheduling, mirroring `patientToLab.ts`/
 * `patientToImaging.ts` — the gap the original top-3-gaps synthesis
 * flagged as "shovel-ready": `CancelBooking` already existed, but
 * nothing invoked it on discharge yet. This does.
 *
 * `EncounterAdmitted` has no scheduling reaction, the same reasoning
 * lab and imaging already established: a booking is made by an
 * explicit scheduling instruction, never implied by admission itself —
 * a deliberate no-op, not a gap, and not a coincidence that the same
 * reasoning recurs a third time; booking creation genuinely shares this
 * trait with ordering a lab test or an imaging study. `EncounterDischarged`
 * cancels every still-`'scheduled'` booking found by
 * `findPendingBookingsForEncounter` — one-to-many, the same shape
 * lab/imaging's discharge reactions have.
 *
 * The one real difference from lab/imaging: `findPendingBookingsForEncounter`
 * matches on `subjectId`, a plain `string`, not a branded `EncounterId`
 * foreign key — see that module's doc comment. This reaction only finds
 * bookings actually made with `subjectId = encounterId`; a booking for
 * equipment maintenance or a staff shift never matches any encounter at
 * all, correctly.
 */
export type PatientSchedulingReaction =
  | { readonly kind: 'cancel-pending'; readonly instructions: readonly Extract<SchedulingInstruction, { kind: 'CancelBooking' }>[] }
  | { readonly kind: 'no-pending-bookings'; readonly encounterId: EncounterId };

export function reactToPatientEffect(
  effect: PatientEffect,
  schedulingContext: SchedulingContext,
  timestamp: IsoTimestamp,
): PatientSchedulingReaction {
  switch (effect.kind) {
    case 'EncounterAdmitted':
      return { kind: 'no-pending-bookings', encounterId: effect.encounterId };
    case 'EncounterDischarged': {
      const pending = findPendingBookingsForEncounter(schedulingContext, effect.encounterId);

      if (pending.length === 0) {
        return { kind: 'no-pending-bookings', encounterId: effect.encounterId };
      }

      return {
        kind: 'cancel-pending',
        instructions: pending.map((bookingId) => ({ kind: 'CancelBooking', bookingId, cancelledAt: timestamp })),
      };
    }
  }
}

export type PatientSchedulingReactionOutcome =
  | { readonly kind: 'cancelled'; readonly encounterId: EncounterId; readonly bookingId: BookingId }
  | { readonly kind: 'no-pending-bookings'; readonly encounterId: EncounterId }
  | {
      readonly kind: 'reaction-failed';
      readonly encounterId: EncounterId;
      readonly bookingId: BookingId;
      readonly error: SchedulingError;
    };

export interface ReactToPatientEffectsForSchedulingResult {
  readonly context: SchedulingContext;
  readonly outcomes: readonly PatientSchedulingReactionOutcome[];
  /** Every `SchedulingEffect` actually produced by a successful
   * cancellation in this batch, in order — same role as
   * `patientToLab.ts`'s `ReactToPatientEffectsForLabResult.effects`. */
  readonly effects: readonly SchedulingEffect[];
}

/** The minimal structural shape this module needs from a scheduling
 * engine — mirrors `patientToLab.ts`'s `LabEngineLike`. */
export interface SchedulingEngineLike {
  execute(
    context: SchedulingContext,
    instruction: SchedulingInstruction,
  ): Result<ExecutionOutcome<SchedulingContext, SchedulingEffect>, SchedulingError>;
}

/**
 * Processes every patient effect independently and best-effort, same
 * contract as `patientToLab.ts`'s `reactToPatientEffectsForLab` —
 * including *within* one effect's own `cancel-pending` reaction: one
 * booking that fails to cancel doesn't block cancelling the rest of
 * that encounter's pending bookings. No saga/compensation semantics
 * here either; if that's ever needed for scheduling, it composes on top
 * the same way `patientBedSaga.ts` does for bed, not built into this.
 */
export function reactToPatientEffectsForScheduling(
  schedulingEngine: SchedulingEngineLike,
  schedulingContext: SchedulingContext,
  patientEffects: readonly PatientEffect[],
  timestamp: IsoTimestamp,
): ReactToPatientEffectsForSchedulingResult {
  let context = schedulingContext;
  const outcomes: PatientSchedulingReactionOutcome[] = [];
  const effects: SchedulingEffect[] = [];

  for (const effect of patientEffects) {
    const reaction = reactToPatientEffect(effect, context, timestamp);

    if (reaction.kind === 'no-pending-bookings') {
      outcomes.push(reaction);
      continue;
    }

    for (const instruction of reaction.instructions) {
      const result = schedulingEngine.execute(context, instruction);

      if (!result.ok) {
        outcomes.push({ kind: 'reaction-failed', encounterId: effect.encounterId, bookingId: instruction.bookingId, error: result.error });
        continue;
      }

      context = result.value.context;
      effects.push(...result.value.effects);
      outcomes.push({ kind: 'cancelled', encounterId: effect.encounterId, bookingId: instruction.bookingId });
    }
  }

  return { context, outcomes, effects };
}
