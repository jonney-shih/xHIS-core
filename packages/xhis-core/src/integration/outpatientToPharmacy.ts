import type { ExecutionOutcome } from '../core/execution/outcome.js';
import type { Result } from '../core/execution/result.js';
import type { OutpatientEffect } from '../instructions/outpatient/types.js';
import { prescriptionId } from '../instructions/pharmacy/ids.js';
import type { EncounterId, PrescriptionId } from '../instructions/pharmacy/ids.js';
import type { PharmacyContext, PharmacyEffect, PharmacyError, PharmacyInstruction } from '../instructions/pharmacy/types.js';

/**
 * The pharmacy counterpart to `outpatientToLab.ts`, mirroring it exactly
 * — see that module's own doc comment for the full reasoning. The first
 * outbox relay to touch `pharmacy` at all: unlike `lab`/`imaging`/`bed`,
 * no `patientTo*.ts` reaction exists for pharmacy (discharge has never
 * implied cancelling a prescription the way it implies cancelling a
 * pending lab order or imaging study), so this module introduces
 * `PharmacyEngineLike`/`PharmacyCommitter` fresh rather than reusing an
 * existing one.
 */
export type OutpatientPharmacyReaction =
  | { readonly kind: 'prescribe-medication'; readonly instruction: Extract<PharmacyInstruction, { kind: 'PrescribeMedication' }> }
  | { readonly kind: 'not-applicable'; readonly sourceEffectKind: OutpatientEffect['kind'] };

export function reactToOutpatientEffect(effect: OutpatientEffect): OutpatientPharmacyReaction {
  if (effect.kind !== 'CpoeOrderPlaced' || effect.detail.orderType !== 'pharmacy') {
    return { kind: 'not-applicable', sourceEffectKind: effect.kind };
  }

  return {
    kind: 'prescribe-medication',
    instruction: {
      kind: 'PrescribeMedication',
      prescriptionId: prescriptionId(effect.orderId),
      encounterId: effect.encounterId,
      medicationCode: effect.detail.medicationCode,
      prescribedAt: effect.placedAt,
    },
  };
}

export type OutpatientPharmacyReactionOutcome =
  | { readonly kind: 'prescribed'; readonly prescriptionId: PrescriptionId; readonly encounterId: EncounterId }
  | { readonly kind: 'already-prescribed'; readonly prescriptionId: PrescriptionId }
  | { readonly kind: 'not-applicable'; readonly sourceEffectKind: OutpatientEffect['kind'] }
  | { readonly kind: 'reaction-failed'; readonly prescriptionId: PrescriptionId; readonly error: PharmacyError };

export interface ReactToOutpatientEffectsForPharmacyResult {
  readonly context: PharmacyContext;
  readonly outcomes: readonly OutpatientPharmacyReactionOutcome[];
  readonly effects: readonly PharmacyEffect[];
}

/** The minimal structural shape this module needs from a pharmacy
 * engine. */
export interface PharmacyEngineLike {
  execute(
    context: PharmacyContext,
    instruction: PharmacyInstruction,
  ): Result<ExecutionOutcome<PharmacyContext, PharmacyEffect>, PharmacyError>;
}

/**
 * Processes every outpatient effect independently and best-effort, same
 * contract as `outpatientToLab.ts`'s `reactToOutpatientEffectsForLab`. A
 * `PrescriptionAlreadyExists` failure is reported as `already-prescribed`,
 * not `reaction-failed` — the expected, harmless shape of a redelivered
 * `CpoeOrderPlaced`, not a real error.
 */
export function reactToOutpatientEffectsForPharmacy(
  pharmacyEngine: PharmacyEngineLike,
  pharmacyContext: PharmacyContext,
  outpatientEffects: readonly OutpatientEffect[],
): ReactToOutpatientEffectsForPharmacyResult {
  let context = pharmacyContext;
  const outcomes: OutpatientPharmacyReactionOutcome[] = [];
  const effects: PharmacyEffect[] = [];

  for (const effect of outpatientEffects) {
    const reaction = reactToOutpatientEffect(effect);

    if (reaction.kind === 'not-applicable') {
      outcomes.push(reaction);
      continue;
    }

    const result = pharmacyEngine.execute(context, reaction.instruction);

    if (!result.ok) {
      if (result.error.kind === 'PrescriptionAlreadyExists') {
        outcomes.push({ kind: 'already-prescribed', prescriptionId: reaction.instruction.prescriptionId });
        continue;
      }
      outcomes.push({ kind: 'reaction-failed', prescriptionId: reaction.instruction.prescriptionId, error: result.error });
      continue;
    }

    context = result.value.context;
    effects.push(...result.value.effects);
    outcomes.push({
      kind: 'prescribed',
      prescriptionId: reaction.instruction.prescriptionId,
      encounterId: reaction.instruction.encounterId,
    });
  }

  return { context, outcomes, effects };
}
