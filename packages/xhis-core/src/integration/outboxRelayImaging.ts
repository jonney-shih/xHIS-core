import { readCommits } from '../core/io/commitLog.js';
import type { OutboxCursor } from '../core/io/outboxCursor.js';
import { relayEffects } from '../core/io/relay.js';
import type { IsoTimestamp } from '../instructions/imaging/ids.js';
import type { ImagingContext, ImagingEffect } from '../instructions/imaging/types.js';
import type { PatientContext, PatientEffect } from '../instructions/patient/types.js';
import type { ImagingEngineLike, PatientImagingReactionOutcome, ReactToPatientEffectsForImagingResult } from './patientToImaging.js';
import { reactToPatientEffectsForImaging } from './patientToImaging.js';

/** Mirrors `outboxRelayLab.ts`'s `PatientLabReactor` — the same
 * "reliable delivery and all-or-nothing batches are two independent,
 * freely composable concerns" reasoning applies here, even though
 * imaging has no saga-wrapped reactor built yet (nothing needs one:
 * `reactToPatientEffectsForImaging` is already best-effort per study,
 * and cancelling a study has no compensating "un-cancel" the way an
 * assign/release pair does). */
export type PatientImagingReactor = (
  imagingEngine: ImagingEngineLike,
  imagingContext: ImagingContext,
  patientEffects: readonly PatientEffect[],
  timestamp: IsoTimestamp,
) => ReactToPatientEffectsForImagingResult;

/** Mirrors `outboxRelayLab.ts`'s `LabCommitter` — the minimal shape
 * needed to durably persist an imaging reaction and re-validate it
 * against reality before each commit. */
export interface ImagingCommitter {
  commit(context: ImagingContext, effects: readonly ImagingEffect[]): void;
  readLatest(): ImagingContext | undefined;
}

export interface RelayPatientEffectsToImagingResult {
  readonly context: ImagingContext;
  readonly outcomes: readonly PatientImagingReactionOutcome[];
  readonly processedThroughIndex: number;
}

/**
 * The imaging counterpart to `outboxRelay.ts`'s `relayPatientEffectsToBed`
 * and `outboxRelayLab.ts`'s `relayPatientEffectsToLab` — the durable-
 * delivery half of the choreography `patientToImaging.ts` only supplies
 * the in-process reaction for. Reads the patient domain's durable commit
 * log via `readCommits`, tracks progress with a durable `cursor`, and
 * commits each entry's imaging effects *before* advancing the cursor
 * past it — the same crash-safety ordering every relay in this codebase
 * follows. `reactToPatientEffect`'s `EncounterDischarged` case needs no
 * extra idempotency check for redelivery: it's already lookup-driven
 * (`findPendingStudiesForEncounter`), so a redelivered discharge for an
 * encounter whose studies are already cancelled naturally finds nothing
 * left to cancel, the same reasoning `patientToLab.ts`'s discharge case
 * already relies on.
 */
export function relayPatientEffectsToImaging(
  patientCommitsFile: string,
  cursor: OutboxCursor,
  imagingCommitter: ImagingCommitter,
  imagingEngine: ImagingEngineLike,
  imagingContext: ImagingContext,
  timestamp: IsoTimestamp,
  react: PatientImagingReactor = reactToPatientEffectsForImaging,
): RelayPatientEffectsToImagingResult {
  return relayEffects<PatientContext, PatientEffect, ImagingContext, PatientImagingReactionOutcome, ImagingEffect>(
    (fromIndex) => readCommits<PatientContext, PatientEffect>(patientCommitsFile).slice(fromIndex),
    cursor,
    imagingCommitter,
    imagingContext,
    (context, effects) => react(imagingEngine, context, effects, timestamp),
  );
}
