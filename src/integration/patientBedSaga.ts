import type { IsoTimestamp } from '../instructions/bed/ids.js';
import type { BedContext, BedEffect } from '../instructions/bed/types.js';
import type { PatientEffect } from '../instructions/patient/types.js';
import type { BedSelectionStrategy } from './bedSelection.js';
import type { BedEngineLike, PatientBedReactionOutcome, ReactToPatientEffectsResult } from './patientToBed.js';
import { reactToPatientEffects } from './patientToBed.js';

export interface SagaPolicy {
  /**
   * Given every outcome from one batch, decides whether the batch should
   * be compensated (rolled back to all-or-nothing) rather than left in
   * whatever partial state it ended up in. Returns the first outcome
   * that justifies compensating, or `undefined` if the batch should
   * stand as-is.
   */
  shouldCompensate(outcomes: readonly PatientBedReactionOutcome[]): PatientBedReactionOutcome | undefined;
}

/**
 * Illustrative, not authoritative — same caveat as
 * `EXAMPLE_firstAvailableBedStrategy` and `EXAMPLE_patientApprovalPolicy`.
 * Treats `no-bed-available`, `reaction-failed`, and
 * `ambiguous-bed-assignment` as genuine failures that should roll the
 * whole batch back to all-or-nothing. Deliberately does *not* treat
 * `already-assigned` or `no-bed-to-release` as failures — the outbox
 * relay's redelivery (see `outboxRelay.ts`) produces those routinely for
 * already-completed work, and rolling back a whole batch because a
 * redelivered no-op showed up would be wrong.
 */
export const EXAMPLE_allOrNothingSagaPolicy: SagaPolicy = {
  shouldCompensate(outcomes) {
    return outcomes.find(
      (outcome) =>
        outcome.kind === 'no-bed-available' ||
        outcome.kind === 'reaction-failed' ||
        outcome.kind === 'ambiguous-bed-assignment',
    );
  },
};

export interface SagaCompensation {
  /** The outcome that triggered compensation — always one of the kinds
   * `SagaPolicy.shouldCompensate` returned for this batch. */
  readonly reason: PatientBedReactionOutcome;
  /**
   * What happened undoing each successful reaction in the batch, in
   * reverse order: a compensating `released` for each `assigned`, a
   * compensating `assigned` for each `released`. If a compensation
   * itself fails, that's reported as `reaction-failed` here too, not
   * retried further — a compensation that can't complete needs a human,
   * not a third layer of automatic retry.
   */
  readonly compensatingOutcomes: readonly PatientBedReactionOutcome[];
}

export interface SagaResult extends ReactToPatientEffectsResult {
  readonly compensation?: SagaCompensation;
}

/**
 * Wraps `reactToPatientEffects` with all-or-nothing semantics for one
 * batch — closing the exact gap that function's own doc comment flags:
 * "if this runs against a batch where one admission gets a bed and a
 * later one in the same batch doesn't, nothing here rolls the first one
 * back." This does, whenever `policy.shouldCompensate` says to.
 *
 * Deliberately scoped to *one batch* — one call's worth of
 * `patientEffects`, e.g. one patient commit's effects — not across
 * batches or across a whole outbox relay run. Guaranteeing "every
 * admission across all of history eventually gets a bed" would be a much
 * bigger promise than compensating one transaction's own steps, and
 * isn't what this closes; see docs/DETERMINISTIC_CORE_PATTERN.md.
 *
 * Composes with `outboxRelay.ts`'s redelivery: a compensated batch's net
 * effect on `context` is the same as if it had never been reacted to at
 * all (whatever got assigned gets released again, in reverse), so
 * redelivering the same batch after a crash re-attempts it from the same
 * starting point rather than compounding a partial state.
 */
export function reactToPatientEffectsAsSaga(
  bedEngine: BedEngineLike,
  bedContext: BedContext,
  patientEffects: readonly PatientEffect[],
  strategy: BedSelectionStrategy,
  timestamp: IsoTimestamp,
  policy: SagaPolicy,
): SagaResult {
  const result = reactToPatientEffects(bedEngine, bedContext, patientEffects, strategy, timestamp);

  const reason = policy.shouldCompensate(result.outcomes);
  if (!reason) {
    return result;
  }

  let context = result.context;
  const compensatingEffects: BedEffect[] = [];
  const compensatingOutcomes: PatientBedReactionOutcome[] = [];

  for (const outcome of [...result.outcomes].reverse()) {
    if (outcome.kind === 'assigned') {
      const undo = bedEngine.execute(context, { kind: 'ReleaseBed', bedId: outcome.bedId, releasedAt: timestamp });

      if (undo.ok) {
        context = undo.value.context;
        compensatingEffects.push(...undo.value.effects);
        compensatingOutcomes.push({ kind: 'released', encounterId: outcome.encounterId, bedId: outcome.bedId });
      } else {
        compensatingOutcomes.push({ kind: 'reaction-failed', encounterId: outcome.encounterId, error: undo.error });
      }
      continue;
    }

    if (outcome.kind === 'released') {
      const undo = bedEngine.execute(context, {
        kind: 'AssignBed',
        bedId: outcome.bedId,
        encounterId: outcome.encounterId,
        assignedAt: timestamp,
      });

      if (undo.ok) {
        context = undo.value.context;
        compensatingEffects.push(...undo.value.effects);
        compensatingOutcomes.push({ kind: 'assigned', encounterId: outcome.encounterId, bedId: outcome.bedId });
      } else {
        compensatingOutcomes.push({ kind: 'reaction-failed', encounterId: outcome.encounterId, error: undo.error });
      }
    }
  }

  return {
    context,
    effects: [...result.effects, ...compensatingEffects],
    outcomes: result.outcomes,
    compensation: { reason, compensatingOutcomes },
  };
}
