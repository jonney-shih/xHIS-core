import { appendJsonLine, ensureParentDirectory, readJsonLines } from '../../core/io/jsonLines.js';
import type { Kinded } from '../../core/execution/kinded.js';
import type { SequenceFailure } from '../../core/execution/engine.js';
import type { ExecutionOutcome } from '../../core/execution/outcome.js';
import type { Result } from '../../core/execution/result.js';
import { tick } from '../../core/temporal.js';
import type { ProposalId, ProposalLog } from '../verification/proposalLog.js';
import type { VerificationRecordStore, WorkerId } from '../verification/verificationWorker.js';
import { resolveVerificationState } from '../verification/verificationState.js';
import { act } from './act.js';
import type { CommitOutcome } from './auditRecord.js';
import type { ImperativeShell } from './shell.js';

/** The minimal shape the scheduler needs from a domain engine — avoids
 * importing `createEngine`'s return type by name, same reasoning as
 * `integration/patientToBed.ts`'s `BedEngineLike`. */
export interface EngineLike<TCtx, TInstruction extends Kinded, TEffect, TError> {
  executeSequence(
    context: TCtx,
    instructions: readonly TInstruction[],
  ): Result<ExecutionOutcome<TCtx, TEffect>, SequenceFailure<TCtx, TEffect, TError>>;
}

export interface SchedulerOutcome {
  readonly proposalId: ProposalId;
  readonly outcome: CommitOutcome;
}

/**
 * "Has this scheduler already called `act()` for this proposal" —
 * deliberately a durable *membership* store keyed by `ProposalId`, the
 * same shape `integration/externalMessageIdempotency.ts`'s
 * `MessageIdempotencyStore` uses for the identical reason that store
 * gives: a plain `OutboxCursor` works only when *we* control delivery
 * order end to end, reducing "already handled" to a single position.
 * Resolution order here is not guaranteed to match `ProposalLog` order —
 * see `runScheduler`'s own doc comment for why — so "already acted" has
 * to key off a proposal's own identity, not off a position in a log.
 */
export interface SchedulerActedStore {
  hasActed(proposalId: ProposalId): boolean;
  markActed(proposalId: ProposalId, outcome: CommitOutcome): void;
}

/** Durable, file-backed — same append-only JSON Lines discipline as
 * `createFileMessageIdempotencyStore`, including loading every
 * previously-acted ID into memory once at construction. */
export function createFileSchedulerActedStore(file: string): SchedulerActedStore {
  ensureParentDirectory(file);
  const acted = new Set(readJsonLines<{ proposalId: ProposalId }>(file).map((record) => record.proposalId));

  return {
    hasActed(proposalId) {
      return acted.has(proposalId);
    },
    markActed(proposalId, outcome) {
      acted.add(proposalId);
      appendJsonLine(file, { proposalId, outcome });
    },
  };
}

export interface RunSchedulerInput<TCtx, TInstruction extends Kinded, TEffect, TError> {
  readonly proposalLog: ProposalLog<TInstruction>;
  readonly recordStore: VerificationRecordStore;
  readonly requiredWorkers: readonly WorkerId[];
  readonly actedStore: SchedulerActedStore;
  readonly shell: ImperativeShell<TCtx, TInstruction, TEffect>;
  readonly engine: EngineLike<TCtx, TInstruction, TEffect, TError>;
  /** The context to dry-run against when `shell.readLatest()` reports
   * nothing has ever been committed — mirrors `act()`'s own
   * `baselineContext` fallback role exactly. */
  readonly initialContext: TCtx;
  readonly recordedAt: string;
}

/**
 * The piece "Proposed: a federated choreography spine for verification"
 * always said wouldn't need to exist inside `act()`/`actHuman()` — and,
 * across the two slices already built, hasn't needed to. This is that
 * scheduler: for every proposal in `proposalLog` not yet acted on, fold
 * its recorded verdicts via `resolveVerificationState`, and call `act()`
 * exactly once the moment that reaches `resolved` — the same "call
 * `act()` again once a decision arrives" flow `act()` already implements
 * for `needs-human-approval`, just triggered by verification resolving
 * instead of a human deciding.
 *
 * **Why `SchedulerActedStore` is a membership set, not a cursor — proven,
 * not assumed.** Each individual `VerificationWorker` processes
 * `ProposalLog` entries strictly in order (`runVerificationWorker`'s own
 * loop), but different workers advance at different paces, and
 * `foldVerdict` short-circuits to `resolved` the instant *any* worker
 * reports `reject` without waiting for the rest of `requiredWorkers`.
 * Concretely: proposal 5 can resolve (one fast worker rejects it) while
 * proposal 3 is still `pending` (a slower worker hasn't reported on it
 * at all yet) — resolution order does not have to match log order. A
 * monotonic cursor would either get stuck behind proposal 3 forever
 * (never reaching proposal 5) or would have to skip proposal 3 outright
 * to reach 5, silently abandoning it. `tests/agentic/shell/scheduler.test.ts`
 * constructs exactly this ordering and confirms both proposals are
 * handled correctly — 5 acted on immediately, 3 still checked (and acted
 * on) on a later poll once it resolves.
 *
 * **Acting exactly once per proposal, regardless of which `CommitOutcome`
 * came back**, is deliberate, not an oversight: `'awaiting-approval'`
 * means a human will resolve this later through the *separate*
 * approval-arrives-so-call-`act()`-again flow `act()` already supports —
 * not something this polling loop should ever retry itself. `'stale'`
 * means the world changed since verification; `act()`'s own
 * `CommitOutcome` doc comment already says the caller must re-propose
 * against current state, not retry the same proposal unchanged — so this
 * scheduler marking it acted-and-done is exactly what that instruction
 * requires, not a shortcut around it. Retrying `'stale'` here would
 * violate that contract, not fulfill it.
 */
export function runScheduler<TCtx, TInstruction extends Kinded, TEffect, TError>(
  input: RunSchedulerInput<TCtx, TInstruction, TEffect, TError>,
): readonly SchedulerOutcome[] {
  const { proposalLog, recordStore, requiredWorkers, actedStore, shell, engine, initialContext, recordedAt } = input;

  const envelopes = proposalLog.readSince(tick(0));
  const results: SchedulerOutcome[] = [];

  for (const envelope of envelopes) {
    if (actedStore.hasActed(envelope.proposalId)) {
      continue;
    }

    const state = resolveVerificationState(recordStore.readAllFor(envelope.proposalId), requiredWorkers);
    if (state.kind === 'pending') {
      continue; // not yet -- re-checked on a later poll, without blocking any later proposal in this same run
    }

    const latest = shell.readLatest() ?? initialContext;
    const doOutcome = engine.executeSequence(latest, envelope.proposal.instructions);

    const outcome = act(shell, {
      proposal: envelope.proposal,
      doOutcome,
      decision: state.decision,
      baselineContext: latest,
      reexecute: (ctx) => engine.executeSequence(ctx, envelope.proposal.instructions),
      recordedAt,
    });

    actedStore.markActed(envelope.proposalId, outcome);
    results.push({ proposalId: envelope.proposalId, outcome });
  }

  return results;
}
