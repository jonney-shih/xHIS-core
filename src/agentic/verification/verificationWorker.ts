import { appendJsonLine, ensureParentDirectory, readJsonLines } from '../../core/io/jsonLines.js';
import type { Kinded } from '../../core/execution/kinded.js';
import type { OutboxCursor } from '../../core/io/outboxCursor.js';
import { tick, type IsoTimestamp } from '../../core/temporal.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { ProposalId, ProposalLog } from './proposalLog.js';
import type { Verifier, VerifyDecision } from './verifier.js';

type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorkerId = Brand<string, 'WorkerId'>;

export function workerId(value: string): WorkerId {
  return value as WorkerId;
}

/**
 * A verification harness, decoupled from Plan by `ProposalLog` rather
 * than called inline the way `combineVerifiers.ts` calls every `Verifier`
 * today. `verify` may return a `VerifyDecision` directly (any existing
 * synchronous `Verifier` already does) or a `Promise` of one — the only
 * thing a genuinely slow harness (an external compliance service, a
 * second LLM as safety reviewer) needs to add. See `verifierAsWorker`
 * below for the adapter that makes every existing `Verifier` satisfy this
 * with no behavior change.
 */
export interface VerificationWorker<TInstruction extends Kinded> {
  readonly workerId: WorkerId;
  verify(proposal: PlanProposal<TInstruction>): VerifyDecision | Promise<VerifyDecision>;
}

/** One worker's verdict on one proposal, durably recorded. Several of
 * these — one per worker — accumulate per `proposalId`; folding them into
 * a single `VerifyDecision` (via `combineVerifiers.ts`'s `mergeDecisions`)
 * is `docs/DETERMINISTIC_CORE_PATTERN.md`'s `VerificationState`, not yet
 * built — this slice only proves recording and redelivery-safe reading. */
export interface VerificationRecord {
  readonly proposalId: ProposalId;
  readonly workerId: WorkerId;
  readonly decision: VerifyDecision;
  readonly verifiedAt: IsoTimestamp;
}

export interface VerificationRecordStore {
  record(entry: VerificationRecord): void;
  readAllFor(proposalId: ProposalId): readonly VerificationRecord[];
}

/** Durable, file-backed — same append-only JSON Lines discipline as
 * `proposalLog.ts` and `agentic/shell/fileShell.ts`. */
export function createFileVerificationRecordStore(recordsFile: string): VerificationRecordStore {
  ensureParentDirectory(recordsFile);

  return {
    record(entry) {
      appendJsonLine(recordsFile, entry);
    },
    readAllFor(proposalId) {
      return readJsonLines<VerificationRecord>(recordsFile).filter((entry) => entry.proposalId === proposalId);
    },
  };
}

/**
 * Adapts any existing synchronous `Verifier` (`batchSizeRule.ts`,
 * `riskTierVerifier.ts`, `pdpaRules.ts`, ...) into a `VerificationWorker`
 * with zero behavior change — proves the adapter direction actually costs
 * nothing, before a genuinely async harness ever needs the
 * `Promise`-returning branch `VerificationWorker.verify` also allows.
 */
export function verifierAsWorker<TInstruction extends Kinded>(
  id: WorkerId,
  verifier: Verifier<TInstruction>,
): VerificationWorker<TInstruction> {
  return {
    workerId: id,
    verify(proposal) {
      return verifier.verify(proposal);
    },
  };
}

/**
 * The verification-side counterpart to `core/io/relay.ts`'s
 * `relayEffects`: reads whatever the proposal log has gained since this
 * worker's own durable `cursor` position, runs `worker.verify` against
 * each, and durably records the verdict *before* advancing the cursor
 * past that entry — the identical commit-then-advance ordering
 * `relayEffects` uses, for the identical reason: a crash between
 * recording and advancing must leave the entry looking unprocessed on
 * the next run, never the reverse, so it gets redelivered rather than
 * silently skipped.
 *
 * Redelivery is safe here for a stronger reason than
 * `reactToPatientEffect` has: `Verifier.verify` is already required to be
 * pure with no side effects (`verifier.ts`), so re-verifying the same
 * proposal after a crash-and-redeliver recomputes the identical verdict —
 * no equivalent of `reactToPatientEffect`'s existing-assignment guard is
 * needed. What this does *not* give you: exactly-once recording. A
 * redelivered proposal gets a second, but never a *conflicting*, record
 * for the same worker — the same "delivery guarantee, not a success (or
 * uniqueness) guarantee" `relayEffects` itself already documents. Folding
 * duplicate identical records is harmless once `VerificationState`
 * folding exists; this slice proves redelivery never loses a proposal or
 * corrupts the record with a differing verdict, not that storage rows are
 * deduplicated.
 */
export async function runVerificationWorker<TInstruction extends Kinded>(
  worker: VerificationWorker<TInstruction>,
  proposalLog: ProposalLog<TInstruction>,
  cursor: OutboxCursor,
  recordStore: VerificationRecordStore,
  verifiedAt: IsoTimestamp,
): Promise<void> {
  const startTick = tick(cursor.read());
  const envelopes = proposalLog.readSince(startTick);

  for (let offset = 0; offset < envelopes.length; offset += 1) {
    const envelope = envelopes[offset]!;
    const decision = await worker.verify(envelope.proposal);

    recordStore.record({
      proposalId: envelope.proposalId,
      workerId: worker.workerId,
      decision,
      verifiedAt,
    });

    cursor.advance(startTick + offset + 1);
  }
}
