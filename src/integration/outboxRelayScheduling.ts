import { readCommits } from '../core/io/commitLog.js';
import type { OutboxCursor } from '../core/io/outboxCursor.js';
import { relayEffects } from '../core/io/relay.js';
import type { IsoTimestamp } from '../instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingEffect } from '../instructions/scheduling/types.js';
import type { PatientContext, PatientEffect } from '../instructions/patient/types.js';
import type { PatientSchedulingReactionOutcome, ReactToPatientEffectsForSchedulingResult, SchedulingEngineLike } from './patientToScheduling.js';
import { reactToPatientEffectsForScheduling } from './patientToScheduling.js';

/** Mirrors `outboxRelayImaging.ts`'s `PatientImagingReactor` — the same
 * "reliable delivery and all-or-nothing batches are two independent,
 * freely composable concerns" reasoning applies here: nothing about
 * scheduling needs a saga-wrapped reactor either
 * (`reactToPatientEffectsForScheduling` is already best-effort per
 * booking, and cancelling a booking has no compensating "un-cancel"
 * the way an assign/release pair does). */
export type PatientSchedulingReactor = (
  schedulingEngine: SchedulingEngineLike,
  schedulingContext: SchedulingContext,
  patientEffects: readonly PatientEffect[],
  timestamp: IsoTimestamp,
) => ReactToPatientEffectsForSchedulingResult;

/** Mirrors `outboxRelayImaging.ts`'s `ImagingCommitter` — the minimal
 * shape needed to durably persist a scheduling reaction. */
export interface SchedulingCommitter {
  commit(context: SchedulingContext, effects: readonly SchedulingEffect[]): void;
}

export interface RelayPatientEffectsToSchedulingResult {
  readonly context: SchedulingContext;
  readonly outcomes: readonly PatientSchedulingReactionOutcome[];
  readonly processedThroughIndex: number;
}

/**
 * The scheduling counterpart to `outboxRelay.ts`'s `relayPatientEffectsToBed`,
 * `outboxRelayLab.ts`'s `relayPatientEffectsToLab`, and
 * `outboxRelayImaging.ts`'s `relayPatientEffectsToImaging` — the
 * durable-delivery half of the choreography `patientToScheduling.ts`
 * only supplies the in-process reaction for. Reads the patient domain's
 * durable commit log via `readCommits`, tracks progress with a durable
 * `cursor`, and commits each entry's scheduling effects *before*
 * advancing the cursor past it — the same crash-safety ordering every
 * relay in this codebase follows. `reactToPatientEffect`'s
 * `EncounterDischarged` case needs no extra idempotency check for
 * redelivery: it's already lookup-driven
 * (`findPendingBookingsForEncounter`), so a redelivered discharge for
 * an encounter whose bookings are already cancelled naturally finds
 * nothing left to cancel, the same reasoning `patientToLab.ts`'s and
 * `patientToImaging.ts`'s discharge cases already rely on.
 *
 * `findPendingBookingsForEncounter`'s own weaker link — matching a
 * booking's plain-`string` `subjectId` against `EncounterId` by
 * convention, not a type-enforced foreign key (see
 * `schedulingLookup.ts`) — carries through unchanged here: a booking
 * genuinely unrelated to any encounter (equipment maintenance, a staff
 * shift) is correctly never touched by a relayed discharge either,
 * same as in the in-process reaction.
 */
export function relayPatientEffectsToScheduling(
  patientCommitsFile: string,
  cursor: OutboxCursor,
  schedulingCommitter: SchedulingCommitter,
  schedulingEngine: SchedulingEngineLike,
  schedulingContext: SchedulingContext,
  timestamp: IsoTimestamp,
  react: PatientSchedulingReactor = reactToPatientEffectsForScheduling,
): RelayPatientEffectsToSchedulingResult {
  return relayEffects<PatientContext, PatientEffect, SchedulingContext, PatientSchedulingReactionOutcome, SchedulingEffect>(
    (fromIndex) => readCommits<PatientContext, PatientEffect>(patientCommitsFile).slice(fromIndex),
    cursor,
    schedulingCommitter,
    schedulingContext,
    (context, effects) => react(schedulingEngine, context, effects, timestamp),
  );
}
