import type { OutboxCursor } from '../core/io/outboxCursor.js';
import { readCommits } from '../agentic/shell/fileShell.js';
import type { IsoTimestamp } from '../instructions/bed/ids.js';
import type { BedContext, BedEffect } from '../instructions/bed/types.js';
import type { PatientContext, PatientEffect } from '../instructions/patient/types.js';
import type { BedSelectionStrategy } from './bedSelection.js';
import type { BedEngineLike, PatientBedReactionOutcome } from './patientToBed.js';
import { reactToPatientEffects } from './patientToBed.js';

/** The minimal shape this relay needs to durably persist a bed reaction —
 * deliberately not the agentic `ImperativeShell`, since that interface's
 * `recordAudit` is tied to `AuditRecord`'s `PlanProposal`/`VerifyDecision`
 * shape, neither of which exists for a plain choreographed reaction. A
 * `createFileShell<BedContext, BedInstruction, BedEffect>(...)` already
 * satisfies this structurally — it just has one method more than this
 * needs. */
export interface BedCommitter {
  commit(context: BedContext, effects: readonly BedEffect[]): void;
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
 * which is a worse failure mode than surfacing it and moving on. Turning
 * this into a guarantee that every admission eventually gets a bed would
 * be a saga, which this deliberately still isn't.
 */
export function relayPatientEffectsToBed(
  patientCommitsFile: string,
  cursor: OutboxCursor,
  bedCommitter: BedCommitter,
  bedEngine: BedEngineLike,
  bedContext: BedContext,
  strategy: BedSelectionStrategy,
  timestamp: IsoTimestamp,
): RelayPatientEffectsToBedResult {
  const commits = readCommits<PatientContext, PatientEffect>(patientCommitsFile);
  const startIndex = cursor.read();

  let context = bedContext;
  const outcomes: PatientBedReactionOutcome[] = [];
  let processedThroughIndex = startIndex;

  for (let index = startIndex; index < commits.length; index += 1) {
    const commit = commits[index]!;
    const result = reactToPatientEffects(bedEngine, context, commit.effects, strategy, timestamp);

    context = result.context;
    outcomes.push(...result.outcomes);

    if (result.effects.length > 0) {
      bedCommitter.commit(result.context, result.effects);
    }

    processedThroughIndex = index + 1;
    cursor.advance(processedThroughIndex);
  }

  return { context, outcomes, processedThroughIndex };
}
