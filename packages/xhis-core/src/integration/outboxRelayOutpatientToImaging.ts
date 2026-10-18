import { readCommits } from '../core/io/commitLog.js';
import type { OutboxCursor } from '../core/io/outboxCursor.js';
import { relayEffects } from '../core/io/relay.js';
import type { ImagingContext, ImagingEffect } from '../instructions/imaging/types.js';
import type { OutpatientContext, OutpatientEffect } from '../instructions/outpatient/types.js';
import type {
  ImagingEngineLike,
  OutpatientImagingReactionOutcome,
  ReactToOutpatientEffectsForImagingResult,
} from './outpatientToImaging.js';
import { reactToOutpatientEffectsForImaging } from './outpatientToImaging.js';

export type OutpatientImagingReactor = (
  imagingEngine: ImagingEngineLike,
  imagingContext: ImagingContext,
  outpatientEffects: readonly OutpatientEffect[],
) => ReactToOutpatientEffectsForImagingResult;

/** Mirrors `outboxRelayImaging.ts`'s `ImagingCommitter` — see
 * `outboxRelayOutpatientToLab.ts`'s own `LabCommitter` doc comment for
 * why a second, independent relay writing into the same target domain
 * needs no coordination with the existing patient-discharge one. */
export interface ImagingCommitter {
  commit(context: ImagingContext, effects: readonly ImagingEffect[]): void | Promise<void>;
  readLatest(): ImagingContext | undefined | Promise<ImagingContext | undefined>;
}

export interface RelayOutpatientEffectsToImagingResult {
  readonly context: ImagingContext;
  readonly outcomes: readonly OutpatientImagingReactionOutcome[];
  readonly processedThroughIndex: number;
}

/**
 * The CPOE-to-imaging counterpart to `outboxRelayOutpatientToLab.ts`,
 * mirroring it exactly.
 */
export async function relayOutpatientEffectsToImaging(
  outpatientCommitsFile: string,
  cursor: OutboxCursor,
  imagingCommitter: ImagingCommitter,
  imagingEngine: ImagingEngineLike,
  imagingContext: ImagingContext,
  react: OutpatientImagingReactor = reactToOutpatientEffectsForImaging,
): Promise<RelayOutpatientEffectsToImagingResult> {
  return relayEffects<OutpatientContext, OutpatientEffect, ImagingContext, OutpatientImagingReactionOutcome, ImagingEffect>(
    (fromIndex) => readCommits<OutpatientContext, OutpatientEffect>(outpatientCommitsFile).slice(fromIndex),
    cursor,
    imagingCommitter,
    imagingContext,
    (context, effects) => react(imagingEngine, context, effects),
  );
}
