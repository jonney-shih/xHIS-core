import type { ExecutionOutcome } from '../core/execution/outcome.js';
import type { Result } from '../core/execution/result.js';
import { labOrderId } from '../instructions/lab/ids.js';
import type { EncounterId, LabOrderId } from '../instructions/lab/ids.js';
import type { LabContext, LabEffect, LabError, LabInstruction } from '../instructions/lab/types.js';
import type { OutpatientEffect } from '../instructions/outpatient/types.js';

/**
 * The CPOE choreography reaction `instructions/outpatient/handlers/
 * placeCpoeOrder.ts`'s own doc comment already promised: a placed CPOE
 * order drives a real instruction in whichever clinical domain it
 * actually targets, instead of sitting only in `outpatient`'s own
 * context forever. This is the `lab` half; `outpatientToImaging.ts`/
 * `outpatientToPharmacy.ts` are the other two, kept as separate files
 * for the same reason `patientToLab.ts`/`patientToImaging.ts` already
 * are despite being nearly identical to each other — real, independently
 * evolving relationships to three genuinely different target types, not
 * one relationship wearing three costumes.
 *
 * Unlike `patientToBed.ts`'s `AssignBed` (which has to *select* a bed)
 * or `patientToLab.ts`'s own discharge reaction (which has to *look up*
 * which orders are still pending), this reaction needs neither: a CPOE
 * order's `orderId` is already a fixed, externally-decided fact by the
 * time it reaches here, reused verbatim as `OrderLabTest`'s own
 * `orderId` — not re-branded to a new value, just re-branded to
 * `LabOrderId`'s nominal type. That reuse is also this reaction's entire
 * redelivery-safety mechanism: `labEngine.execute` itself rejects a
 * repeat with `LabOrderAlreadyExists` (see `orderLabTestHandler`), so a
 * redelivered `CpoeOrderPlaced` (the same at-least-once guarantee
 * `relayEffects` gives every source commit) naturally becomes a no-op
 * on its second delivery — no separate lookup helper needed, unlike
 * `labLookup.ts`'s role for the discharge reaction.
 *
 * `orderedAt` is taken from the CPOE effect's own `placedAt`, not a
 * fresh timestamp generated here — the real clinical fact is *when the
 * order was placed*, not whenever this relay happens to get around to
 * processing it. Contrast `patientToLab.ts`'s `CancelLabOrder`, whose
 * `cancelledAt` genuinely does occur at reaction time, not earlier.
 */
export type OutpatientLabReaction =
  | { readonly kind: 'order-lab-test'; readonly instruction: Extract<LabInstruction, { kind: 'OrderLabTest' }> }
  | { readonly kind: 'not-applicable'; readonly sourceEffectKind: OutpatientEffect['kind'] };

export function reactToOutpatientEffect(effect: OutpatientEffect): OutpatientLabReaction {
  if (effect.kind !== 'CpoeOrderPlaced' || effect.detail.orderType !== 'lab') {
    return { kind: 'not-applicable', sourceEffectKind: effect.kind };
  }

  return {
    kind: 'order-lab-test',
    instruction: {
      kind: 'OrderLabTest',
      orderId: labOrderId(effect.orderId),
      encounterId: effect.encounterId,
      testCode: effect.detail.testCode,
      orderedAt: effect.placedAt,
    },
  };
}

export type OutpatientLabReactionOutcome =
  | { readonly kind: 'ordered'; readonly orderId: LabOrderId; readonly encounterId: EncounterId }
  | { readonly kind: 'already-ordered'; readonly orderId: LabOrderId }
  | { readonly kind: 'not-applicable'; readonly sourceEffectKind: OutpatientEffect['kind'] }
  | { readonly kind: 'reaction-failed'; readonly orderId: LabOrderId; readonly error: LabError };

export interface ReactToOutpatientEffectsForLabResult {
  readonly context: LabContext;
  readonly outcomes: readonly OutpatientLabReactionOutcome[];
  readonly effects: readonly LabEffect[];
}

/** The minimal structural shape this module needs from a lab engine —
 * mirrors `patientToLab.ts`'s `LabEngineLike`. */
export interface LabEngineLike {
  execute(context: LabContext, instruction: LabInstruction): Result<ExecutionOutcome<LabContext, LabEffect>, LabError>;
}

/**
 * Processes every outpatient effect independently and best-effort, same
 * contract as `patientToLab.ts`'s `reactToPatientEffectsForLab`. A
 * `LabOrderAlreadyExists` failure is reported as `already-ordered`, not
 * `reaction-failed` — see this module's own doc comment for why that's
 * the expected, harmless shape of a redelivered `CpoeOrderPlaced`, not a
 * real error.
 */
export function reactToOutpatientEffectsForLab(
  labEngine: LabEngineLike,
  labContext: LabContext,
  outpatientEffects: readonly OutpatientEffect[],
): ReactToOutpatientEffectsForLabResult {
  let context = labContext;
  const outcomes: OutpatientLabReactionOutcome[] = [];
  const effects: LabEffect[] = [];

  for (const effect of outpatientEffects) {
    const reaction = reactToOutpatientEffect(effect);

    if (reaction.kind === 'not-applicable') {
      outcomes.push(reaction);
      continue;
    }

    const result = labEngine.execute(context, reaction.instruction);

    if (!result.ok) {
      if (result.error.kind === 'LabOrderAlreadyExists') {
        outcomes.push({ kind: 'already-ordered', orderId: reaction.instruction.orderId });
        continue;
      }
      outcomes.push({ kind: 'reaction-failed', orderId: reaction.instruction.orderId, error: result.error });
      continue;
    }

    context = result.value.context;
    effects.push(...result.value.effects);
    outcomes.push({ kind: 'ordered', orderId: reaction.instruction.orderId, encounterId: reaction.instruction.encounterId });
  }

  return { context, outcomes, effects };
}
