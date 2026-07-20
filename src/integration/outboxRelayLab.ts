import type { OutboxCursor } from '../core/io/outboxCursor.js';
import { relayEffects } from '../core/io/relay.js';
import type { IsoTimestamp } from '../instructions/lab/ids.js';
import type { LabContext, LabEffect } from '../instructions/lab/types.js';
import type { PatientContext, PatientEffect } from '../instructions/patient/types.js';
import type { LabEngineLike, PatientLabReactionOutcome, ReactToPatientEffectsForLabResult } from './patientToLab.js';
import { reactToPatientEffectsForLab } from './patientToLab.js';

export type PatientLabReactor = (
  labEngine: LabEngineLike,
  labContext: LabContext,
  patientEffects: readonly PatientEffect[],
  timestamp: IsoTimestamp,
) => ReactToPatientEffectsForLabResult;

/** Mirrors `outboxRelay.ts`'s `BedCommitter` — the minimal shape needed
 * to durably persist a lab reaction. */
export interface LabCommitter {
  commit(context: LabContext, effects: readonly LabEffect[]): void;
}

export interface RelayPatientEffectsToLabResult {
  readonly context: LabContext;
  readonly outcomes: readonly PatientLabReactionOutcome[];
  readonly processedThroughIndex: number;
}

/**
 * The lab counterpart to `outboxRelay.ts`'s `relayPatientEffectsToBed` —
 * this is the empirical test itself: writing this function is what
 * confirmed `core/io/relay.ts`'s `relayEffects` loop generalizes cleanly
 * to a second real domain with a genuinely different reaction shape
 * (one-to-many, no selection strategy) and *no* changes to `relayEffects`
 * itself. Note there is no `strategy` parameter here at all — bed's
 * `BedSelectionStrategy` was never part of the relay's own shape, only
 * of bed's `react` closure, and lab's closure simply doesn't need one.
 * See `docs/DETERMINISTIC_CORE_PATTERN.md`'s event-bus section for the
 * full conclusion this supports.
 */
export function relayPatientEffectsToLab(
  patientCommitsFile: string,
  cursor: OutboxCursor,
  labCommitter: LabCommitter,
  labEngine: LabEngineLike,
  labContext: LabContext,
  timestamp: IsoTimestamp,
  react: PatientLabReactor = reactToPatientEffectsForLab,
): RelayPatientEffectsToLabResult {
  return relayEffects<PatientContext, PatientEffect, LabContext, PatientLabReactionOutcome, LabEffect>(
    patientCommitsFile,
    cursor,
    labCommitter,
    labContext,
    (context, effects) => react(labEngine, context, effects, timestamp),
  );
}
