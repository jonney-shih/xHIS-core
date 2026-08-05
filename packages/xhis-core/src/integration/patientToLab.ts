import type { ExecutionOutcome } from '../core/execution/outcome.js';
import type { Result } from '../core/execution/result.js';
import type { EncounterId, IsoTimestamp, LabOrderId } from '../instructions/lab/ids.js';
import type { LabContext, LabEffect, LabError, LabInstruction } from '../instructions/lab/types.js';
import type { PatientEffect } from '../instructions/patient/types.js';
import { findPendingLabOrdersForEncounter } from './labLookup.js';

/**
 * The second choreography reaction, alongside `patientToBed.ts` — this
 * module is what the user's "先做 lab 或 nursing domain,再驗證 event bus
 * 需求" instruction actually needed built. Lab's reaction shape differs
 * from bed's in the one dimension that matters for the event-bus
 * question: bed's `EncounterAdmitted` reaction picks *one* bed via a
 * `BedSelectionStrategy`, but lab has no equivalent selection policy at
 * all — `EncounterDischarged` here can produce *zero, one, or many*
 * `CancelLabOrder` instructions, one per still-pending order, with no
 * "which one" decision to make. See `docs/DETERMINISTIC_CORE_PATTERN.md`'s
 * event-bus section for what that difference did, and didn't, end up
 * mattering for.
 */
export type PatientLabReaction =
  | { readonly kind: 'cancel-pending'; readonly instructions: readonly Extract<LabInstruction, { kind: 'CancelLabOrder' }>[] }
  | { readonly kind: 'no-pending-orders'; readonly encounterId: EncounterId };

/**
 * Decides what, if anything, a single patient effect should trigger in
 * lab management — pure, no execution, mirroring `patientToBed.ts`'s
 * `reactToPatientEffect`.
 *
 * `EncounterAdmitted` has no lab reaction: tests are ordered by an
 * explicit physician instruction (`OrderLabTest`), never implied by
 * admission itself — a deliberate no-op, not a gap. Not every patient
 * effect needs a reaction in every downstream domain; bed happened to
 * need one for both of today's two `PatientEffect` variants, lab only
 * needs one for `EncounterDischarged`.
 *
 * `EncounterDischarged` needs no redelivery-safety check the way bed's
 * `EncounterAdmitted` does — `findPendingLabOrdersForEncounter` is
 * already lookup-driven, not selection-driven, so redelivering the same
 * discharge after some orders are already cancelled naturally finds only
 * the ones still pending (or none at all) instead of double-cancelling.
 */
export function reactToPatientEffect(
  effect: PatientEffect,
  labContext: LabContext,
  timestamp: IsoTimestamp,
): PatientLabReaction {
  switch (effect.kind) {
    case 'EncounterAdmitted':
      return { kind: 'no-pending-orders', encounterId: effect.encounterId };
    case 'EncounterDischarged': {
      const pending = findPendingLabOrdersForEncounter(labContext, effect.encounterId);

      if (pending.length === 0) {
        return { kind: 'no-pending-orders', encounterId: effect.encounterId };
      }

      return {
        kind: 'cancel-pending',
        instructions: pending.map((orderId) => ({ kind: 'CancelLabOrder', orderId, cancelledAt: timestamp })),
      };
    }
  }
}

export type PatientLabReactionOutcome =
  | { readonly kind: 'cancelled'; readonly encounterId: EncounterId; readonly orderId: LabOrderId }
  | { readonly kind: 'no-pending-orders'; readonly encounterId: EncounterId }
  | { readonly kind: 'reaction-failed'; readonly encounterId: EncounterId; readonly orderId: LabOrderId; readonly error: LabError };

export interface ReactToPatientEffectsForLabResult {
  readonly context: LabContext;
  readonly outcomes: readonly PatientLabReactionOutcome[];
  /** Every `LabEffect` actually produced by a successful cancellation in
   * this batch, in order — same role as `patientToBed.ts`'s
   * `ReactToPatientEffectsResult.effects`. */
  readonly effects: readonly LabEffect[];
}

/** The minimal structural shape this module needs from a lab engine —
 * mirrors `patientToBed.ts`'s `BedEngineLike`. */
export interface LabEngineLike {
  execute(
    context: LabContext,
    instruction: LabInstruction,
  ): Result<ExecutionOutcome<LabContext, LabEffect>, LabError>;
}

/**
 * Processes every patient effect independently and best-effort, same
 * contract as `patientToBed.ts`'s `reactToPatientEffects` — including
 * *within* one effect's own `cancel-pending` reaction: one order that
 * fails to cancel doesn't block cancelling the rest of that encounter's
 * pending orders. No saga/compensation semantics here either; if that's
 * ever needed for lab, it composes on top the same way
 * `patientBedSaga.ts` does for bed, not built into this.
 */
export function reactToPatientEffectsForLab(
  labEngine: LabEngineLike,
  labContext: LabContext,
  patientEffects: readonly PatientEffect[],
  timestamp: IsoTimestamp,
): ReactToPatientEffectsForLabResult {
  let context = labContext;
  const outcomes: PatientLabReactionOutcome[] = [];
  const effects: LabEffect[] = [];

  for (const effect of patientEffects) {
    const reaction = reactToPatientEffect(effect, context, timestamp);

    if (reaction.kind === 'no-pending-orders') {
      outcomes.push(reaction);
      continue;
    }

    for (const instruction of reaction.instructions) {
      const result = labEngine.execute(context, instruction);

      if (!result.ok) {
        outcomes.push({ kind: 'reaction-failed', encounterId: effect.encounterId, orderId: instruction.orderId, error: result.error });
        continue;
      }

      context = result.value.context;
      effects.push(...result.value.effects);
      outcomes.push({ kind: 'cancelled', encounterId: effect.encounterId, orderId: instruction.orderId });
    }
  }

  return { context, outcomes, effects };
}
