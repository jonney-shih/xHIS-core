import { readCommits } from '../core/io/commitLog.js';
import type { OutboxCursor } from '../core/io/outboxCursor.js';
import { relayEffects } from '../core/io/relay.js';
import type { LabContext, LabEffect } from '../instructions/lab/types.js';
import type { OutpatientContext, OutpatientEffect } from '../instructions/outpatient/types.js';
import type { LabEngineLike, OutpatientLabReactionOutcome, ReactToOutpatientEffectsForLabResult } from './outpatientToLab.js';
import { reactToOutpatientEffectsForLab } from './outpatientToLab.js';

export type OutpatientLabReactor = (
  labEngine: LabEngineLike,
  labContext: LabContext,
  outpatientEffects: readonly OutpatientEffect[],
) => ReactToOutpatientEffectsForLabResult;

/** Mirrors `outboxRelayLab.ts`'s `LabCommitter` — the minimal shape
 * needed to durably persist a lab reaction and re-validate it against
 * reality before each commit. A second, independent relay writing into
 * the same `LabContext` as `outboxRelayLab.ts`'s existing patient-
 * discharge relay — both go through the same `ImperativeShell`/OCC
 * machinery underneath, which is what makes two independent writers
 * into one target domain safe without this relay needing to know the
 * other one exists at all. */
export interface LabCommitter {
  commit(context: LabContext, effects: readonly LabEffect[]): void | Promise<void>;
  readLatest(): LabContext | undefined | Promise<LabContext | undefined>;
}

export interface RelayOutpatientEffectsToLabResult {
  readonly context: LabContext;
  readonly outcomes: readonly OutpatientLabReactionOutcome[];
  readonly processedThroughIndex: number;
}

/**
 * The CPOE-to-lab counterpart to `outboxRelayLab.ts`'s existing
 * `relayPatientEffectsToLab` — same `core/io/relay.ts` loop, a different
 * source domain (`outpatient` instead of `patient`) and reaction
 * (`outpatientToLab.ts`'s `reactToOutpatientEffectsForLab` instead of
 * `patientToLab.ts`'s). No `timestamp` parameter here, unlike that
 * function — see `outpatientToLab.ts`'s own doc comment for why every
 * timestamp this reaction needs already travels with the source effect.
 */
export async function relayOutpatientEffectsToLab(
  outpatientCommitsFile: string,
  cursor: OutboxCursor,
  labCommitter: LabCommitter,
  labEngine: LabEngineLike,
  labContext: LabContext,
  react: OutpatientLabReactor = reactToOutpatientEffectsForLab,
): Promise<RelayOutpatientEffectsToLabResult> {
  return relayEffects<OutpatientContext, OutpatientEffect, LabContext, OutpatientLabReactionOutcome, LabEffect>(
    (fromIndex) => readCommits<OutpatientContext, OutpatientEffect>(outpatientCommitsFile).slice(fromIndex),
    cursor,
    labCommitter,
    labContext,
    (context, effects) => react(labEngine, context, effects),
  );
}
