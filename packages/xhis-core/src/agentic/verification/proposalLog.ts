import { appendJsonLine, ensureParentDirectory, readJsonLines } from '../../core/io/jsonLines.js';
import type { Kinded } from '../../core/execution/kinded.js';
import { tick, type Tick } from '../../core/temporal.js';
import type { PlanProposal } from '../planning/proposal.js';

type Brand<T, B extends string> = T & { readonly __brand: B };

export type ProposalId = Brand<string, 'ProposalId'>;

function proposalIdAt(loggedAtTick: Tick): ProposalId {
  return `proposal-${loggedAtTick}` as ProposalId;
}

/**
 * One entry in a `ProposalLog` — the durable envelope Plan appends around
 * a `PlanProposal`, one layer up from `core/io/commitLog.ts`'s
 * `CommittedBatch`. `loggedAtTick` is this entry's position in the log,
 * assigned by `append` itself rather than by whoever calls it — the same
 * "ordering without a clock" role `core/temporal.ts`'s `Tick` was added
 * for, here playing the part `CommittedBatch`'s array index already plays
 * for `readCommits`/`relayEffects`, just given an explicit type instead of
 * staying an implicit array position.
 */
export interface ProposalEnvelope<TInstruction extends Kinded> {
  readonly proposalId: ProposalId;
  readonly proposal: PlanProposal<TInstruction>;
  readonly loggedAtTick: Tick;
}

/**
 * See docs/DETERMINISTIC_CORE_PATTERN.md's "Proposed: a federated
 * choreography spine for verification" for why this exists: Plan's only
 * synchronous obligation becomes `append`, so no verification harness —
 * however slow — can block Plan from producing its next proposal. Shaped
 * to mirror `core/io/commitLog.ts`'s `readCommits`/`CommittedBatch`
 * deliberately, not coincidentally: a `VerificationWorker`'s cursor reads
 * `readSince` exactly the way an outbox relay reads a source domain's
 * commit log.
 */
export interface ProposalLog<TInstruction extends Kinded> {
  append(proposal: PlanProposal<TInstruction>): ProposalId;
  /** Every entry at or after `fromTick`, oldest first — the same
   * absolute-indexed contract `relayEffects`'s `readNewCommits` already
   * follows: the first returned entry corresponds to `fromTick` itself,
   * not to position 0 of the returned array. */
  readSince(fromTick: Tick): readonly ProposalEnvelope<TInstruction>[];
}

/**
 * A durable, file-backed `ProposalLog` — same append-only JSON Lines
 * discipline as `agentic/shell/fileShell.ts` and `core/io/outboxCursor.ts`:
 * `append` is one `appendFileSync` call (atomic at the OS level for data
 * this size), and there is no separate snapshot to keep in sync with the
 * log itself. Same accepted limitation as `createFileShell`, for the same
 * reason: no concurrent-writer safety beyond a single process appending —
 * two processes calling `append` on the same file at once can interleave
 * lines, and nothing here coordinates that.
 */
export function createFileProposalLog<TInstruction extends Kinded>(logFile: string): ProposalLog<TInstruction> {
  ensureParentDirectory(logFile);

  return {
    append(proposal) {
      const loggedAtTick = tick(readJsonLines<ProposalEnvelope<TInstruction>>(logFile).length);
      const envelope: ProposalEnvelope<TInstruction> = {
        proposalId: proposalIdAt(loggedAtTick),
        proposal,
        loggedAtTick,
      };
      appendJsonLine(logFile, envelope);
      return envelope.proposalId;
    },
    readSince(fromTick) {
      return readJsonLines<ProposalEnvelope<TInstruction>>(logFile).filter(
        (envelope) => envelope.loggedAtTick >= fromTick,
      );
    },
  };
}
