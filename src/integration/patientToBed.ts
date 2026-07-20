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
 * Calling this directly is in-process and synchronous, not durable
 * messaging — see `outboxRelay.ts` for the actual reliability mechanism.
 * That relay redelivers at least once rather than risk losing a reaction,
 * which is exactly why the `EncounterAdmitted` case below checks for an
 * existing assignment before selecting a bed: this function has to be
 * safe to call twice for the same effect, not just once.
 */
export type PatientBedReaction =
  | { readonly kind: 'assign'; readonly instruction: Extract<BedInstruction, { kind: 'AssignBed' }> }
  | { readonly kind: 'release'; readonly instruction: Extract<BedInstruction, { kind: 'ReleaseBed' }> }
  | { readonly kind: 'already-assigned'; readonly encounterId: EncounterId; readonly bedId: BedId }
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
 *
 * `EncounterAdmitted` checks `findBedHoldingEncounter` *before* selecting
 * a bed, specifically for redelivery safety: without this check, calling
 * this twice for the same admission (which `outboxRelay.ts` can do after
 * a crash) would select a *second* available bed for an encounter that
 * already has one, rather than recognizing the first assignment already
 * satisfied this effect. `EncounterDischarged` doesn't need an equivalent
 * check — it's already lookup-driven, not selection-driven, so a
 * redelivered discharge for an already-released encounter naturally
 * finds nothing to release (`no-bed-to-release`) instead of doing
 * anything harmful.
 */
export function reactToPatientEffect(
  effect: PatientEffect,
  bedContext: BedContext,
  strategy: BedSelectionStrategy,
  timestamp: IsoTimestamp,
): PatientBedReaction {
  switch (effect.kind) {
    case 'EncounterAdmitted': {
      const existing = findBedHoldingEncounter(bedContext, effect.encounterId);

      if (existing.kind === 'found') {
        return { kind: 'already-assigned', encounterId: effect.encounterId, bedId: existing.bedId };
      }
      if (existing.kind === 'ambiguous') {
        return { kind: 'ambiguous-bed-assignment', encounterId: effect.encounterId, bedIds: existing.bedIds };
      }

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
        // Covers two situations this context snapshot alone can't tell
        // apart: this encounter never got a bed at all, or it did and a
        // prior (possibly redelivered) reaction already released it.
        // Both end the same way — nothing left to release — so neither
        // needs distinguishing for correctness, only for observability
        // if someone later wants it.
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
  | { readonly kind: 'already-assigned'; readonly encounterId: EncounterId; readonly bedId: BedId }
  | { readonly kind: 'no-bed-available'; readonly encounterId: EncounterId }
  | { readonly kind: 'no-bed-to-release'; readonly encounterId: EncounterId }
  | { readonly kind: 'ambiguous-bed-assignment'; readonly encounterId: EncounterId; readonly bedIds: readonly BedId[] }
  | { readonly kind: 'reaction-failed'; readonly encounterId: EncounterId; readonly error: BedError };

export interface ReactToPatientEffectsResult {
  readonly context: BedContext;
  readonly outcomes: readonly PatientBedReactionOutcome[];
  /** Every `BedEffect` actually produced by a successful `assign`/`release`
   * in this batch, in order — `outboxRelay.ts` commits these durably
   * alongside the resulting `context`; nothing here persists anything
   * itself. Empty when nothing in the batch resulted in a real bed
   * transition (e.g. every effect was `already-assigned` or
   * `no-bed-available`). */
  readonly effects: readonly BedEffect[];
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
 * never swallowed. Does *not* itself implement saga/compensation
 * semantics: if this runs against a batch where one admission gets a bed
 * and a later one in the same batch doesn't, nothing *here* rolls the
 * first one back — that's `patientBedSaga.ts`'s `reactToPatientEffectsAsSaga`,
 * layered on top of this function rather than built into it, so best-
 * effort and all-or-nothing stay two independently choosable behaviors
 * instead of one hardcoded policy.
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
  const effects: BedEffect[] = [];

  for (const effect of patientEffects) {
    const reaction = reactToPatientEffect(effect, context, strategy, timestamp);

    switch (reaction.kind) {
      case 'already-assigned':
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
        effects.push(...result.value.effects);
        outcomes.push(
          reaction.kind === 'assign'
            ? { kind: 'assigned', encounterId: reaction.instruction.encounterId, bedId: reaction.instruction.bedId }
            : { kind: 'released', encounterId: effect.encounterId, bedId: reaction.instruction.bedId },
        );
        continue;
      }
    }
  }

  return { context, outcomes, effects };
}
