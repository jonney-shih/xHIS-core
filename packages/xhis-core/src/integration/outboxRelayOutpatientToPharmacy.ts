import { readCommits } from '../core/io/commitLog.js';
import type { OutboxCursor } from '../core/io/outboxCursor.js';
import { relayEffects } from '../core/io/relay.js';
import type { OutpatientContext, OutpatientEffect } from '../instructions/outpatient/types.js';
import type { PharmacyContext, PharmacyEffect } from '../instructions/pharmacy/types.js';
import type {
  OutpatientPharmacyReactionOutcome,
  PharmacyEngineLike,
  ReactToOutpatientEffectsForPharmacyResult,
} from './outpatientToPharmacy.js';
import { reactToOutpatientEffectsForPharmacy } from './outpatientToPharmacy.js';

export type OutpatientPharmacyReactor = (
  pharmacyEngine: PharmacyEngineLike,
  pharmacyContext: PharmacyContext,
  outpatientEffects: readonly OutpatientEffect[],
) => ReactToOutpatientEffectsForPharmacyResult;

/** Mirrors `outboxRelayOutpatientToLab.ts`'s `LabCommitter` — the first
 * `*Committer` shape for `pharmacy`, since no existing relay touches it
 * (see `outpatientToPharmacy.ts`'s own doc comment). */
export interface PharmacyCommitter {
  commit(context: PharmacyContext, effects: readonly PharmacyEffect[]): void | Promise<void>;
  readLatest(): PharmacyContext | undefined | Promise<PharmacyContext | undefined>;
}

export interface RelayOutpatientEffectsToPharmacyResult {
  readonly context: PharmacyContext;
  readonly outcomes: readonly OutpatientPharmacyReactionOutcome[];
  readonly processedThroughIndex: number;
}

/**
 * The CPOE-to-pharmacy counterpart to `outboxRelayOutpatientToLab.ts`,
 * mirroring it exactly.
 */
export async function relayOutpatientEffectsToPharmacy(
  outpatientCommitsFile: string,
  cursor: OutboxCursor,
  pharmacyCommitter: PharmacyCommitter,
  pharmacyEngine: PharmacyEngineLike,
  pharmacyContext: PharmacyContext,
  react: OutpatientPharmacyReactor = reactToOutpatientEffectsForPharmacy,
): Promise<RelayOutpatientEffectsToPharmacyResult> {
  return relayEffects<OutpatientContext, OutpatientEffect, PharmacyContext, OutpatientPharmacyReactionOutcome, PharmacyEffect>(
    (fromIndex) => readCommits<OutpatientContext, OutpatientEffect>(outpatientCommitsFile).slice(fromIndex),
    cursor,
    pharmacyCommitter,
    pharmacyContext,
    (context, effects) => react(pharmacyEngine, context, effects),
  );
}
