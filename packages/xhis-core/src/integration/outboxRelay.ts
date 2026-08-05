import { readCommits } from '../core/io/commitLog.js';
import type { OutboxCursor } from '../core/io/outboxCursor.js';
import { relayEffects } from '../core/io/relay.js';
import type { IsoTimestamp } from '../instructions/bed/ids.js';
import type { BedContext, BedEffect } from '../instructions/bed/types.js';
import type { PatientContext, PatientEffect } from '../instructions/patient/types.js';
import type { BedSelectionStrategy } from './bedSelection.js';
import type { BedEngineLike, PatientBedReactionOutcome, ReactToPatientEffectsResult } from './patientToBed.js';
import { reactToPatientEffects } from './patientToBed.js';

/**
 * What this relay needs to react to one batch — `reactToPatientEffects`
 * by default (best-effort), or `reactToPatientEffectsAsSaga` bound to a
 * `SagaPolicy` (`patientBedSaga.ts`) for all-or-nothing batches. A
 * `SagaResult` satisfies this structurally (it's a `ReactToPatientEffectsResult`
 * plus an optional `compensation` field), so passing a saga-wrapped
 * reactor here needs no change to this relay at all — reliable delivery
 * and all-or-nothing batches are two independent, freely composable
 * concerns, not one feature.
 */
export type PatientBedReactor = (
  bedEngine: BedEngineLike,
  bedContext: BedContext,
  patientEffects: readonly PatientEffect[],
  strategy: BedSelectionStrategy,
  timestamp: IsoTimestamp,
) => ReactToPatientEffectsResult;

/** The minimal shape this relay needs to durably persist a bed reaction
 * *and* re-validate it against reality before each commit — deliberately
 * not the agentic `ImperativeShell`, since that interface's `recordAudit`
 * is tied to `AuditRecord`'s `PlanProposal`/`VerifyDecision` shape, neither
 * of which exists for a plain choreographed reaction. A
 * `createFileShell<BedContext, BedInstruction, BedEffect>(...)` already
 * satisfies this structurally — it just has one method (`recordAudit`)
 * more than this needs. */
export interface BedCommitter {
  commit(context: BedContext, effects: readonly BedEffect[]): void;
  readLatest(): BedContext | undefined;
}

export interface RelayPatientEffectsToBedResult {
  readonly context: BedContext;
  readonly outcomes: readonly PatientBedReactionOutcome[];
  readonly processedThroughIndex: number;
}

/**
 * The outbox relay: closes the exact gap flagged in
 * docs/DETERMINISTIC_CORE_PATTERN.md and docs/AGENTIC_LAYER.md — calling
 * `reactToPatientEffects` directly, in-process, right after a patient
 * commit means a crash between the two loses the reaction outright.
 *
 * Instead of reacting immediately, this reads the patient domain's
 * *durable* commit log (`patientCommitsFile`, written by
 * `agentic/shell/fileShell.ts`'s `createFileShell`) and a durable
 * `cursor` remembering how far it's gotten, and processes only what's
 * new since the last run — safe to call repeatedly, from a fresh
 * process, after any crash.
 *
 * Ordering is the whole mechanism: for each newly-seen commit entry, the
 * resulting bed effects are committed via `bedCommitter` *before* the
 * cursor advances past that entry. A crash between those two writes
 * means the entry looks unprocessed on the next run and gets redelivered
 * — never silently skipped. This is why `reactToPatientEffect`'s
 * `EncounterAdmitted` case is idempotent (checks for an existing
 * assignment before selecting a new bed): at-least-once delivery is only
 * safe if reprocessing the same entry can't do harm.
 *
 * The cursor advances once an entry has been *attempted*, regardless of
 * whether every reaction inside it succeeded — a delivery guarantee, not
 * a success guarantee. A `no-bed-available` or `reaction-failed` outcome
 * is still returned to the caller; retrying it automatically by holding
 * the cursor back would block every later entry behind one stuck one,
 * which is a worse failure mode than surfacing it and moving on. This
 * still doesn't guarantee every admission *eventually* gets a bed across
 * the whole relay run — only `react`, if it's a saga-wrapped reactor,
 * guarantees one *batch*'s own steps are all-or-nothing.
 *
 * The loop itself lives in `core/io/relay.ts`'s domain-agnostic
 * `relayEffects` — this function is now a thin, bed-specific binding of
 * it: closing `react` over `bedEngine`/`strategy`/`timestamp` so
 * `relayEffects` never needs to know bed exists.
 */
export function relayPatientEffectsToBed(
  patientCommitsFile: string,
  cursor: OutboxCursor,
  bedCommitter: BedCommitter,
  bedEngine: BedEngineLike,
  bedContext: BedContext,
  strategy: BedSelectionStrategy,
  timestamp: IsoTimestamp,
  react: PatientBedReactor = reactToPatientEffects,
): RelayPatientEffectsToBedResult {
  return relayEffects<PatientContext, PatientEffect, BedContext, PatientBedReactionOutcome, BedEffect>(
    (fromIndex) => readCommits<PatientContext, PatientEffect>(patientCommitsFile).slice(fromIndex),
    cursor,
    bedCommitter,
    bedContext,
    (context, effects) => react(bedEngine, context, effects, strategy, timestamp),
  );
}
