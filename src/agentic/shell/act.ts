import type { SequenceFailure } from '../../core/execution/engine.js';
import type { Kinded } from '../../core/execution/kinded.js';
import type { ExecutionOutcome } from '../../core/execution/outcome.js';
import type { Result } from '../../core/execution/result.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { Approval, CommitOutcome } from './auditRecord.js';
import type { ImperativeShell } from './shell.js';

export interface ActInput<TCtx, TInstruction extends Kinded, TEffect, TError> {
  readonly proposal: PlanProposal<TInstruction>;
  /** Do's result — typically `engine.executeSequence(context, proposal.instructions)`. */
  readonly doOutcome: Result<ExecutionOutcome<TCtx, TEffect>, SequenceFailure<TCtx, TEffect, TError>>;
  readonly decision: VerifyDecision;
  /**
   * Present only once a human has resolved a `needs-human-approval`
   * decision *and* their identity/permission has been verified — construct
   * this via `agentic/identity/resolveApproval.ts`, never by hand.
   */
  readonly approval?: Approval;
  readonly recordedAt: string;
}

/**
 * Act: the only place a proposal's effects may actually be committed (see
 * docs/AGENTIC_LAYER.md's PDCA table). Writes exactly one audit record no
 * matter what happens, and commits only when Check accepted outright or a
 * human has since approved — never on `reject`, never while
 * `needs-human-approval` is still unresolved, and never when Do itself
 * failed (there is nothing valid to commit, same principle as
 * `executeSequence`'s all-or-nothing batch contract).
 */
export function act<TCtx, TInstruction extends Kinded, TEffect, TError>(
  shell: ImperativeShell<TCtx, TInstruction, TEffect>,
  input: ActInput<TCtx, TInstruction, TEffect, TError>,
): CommitOutcome {
  const { proposal, doOutcome, decision, approval, recordedAt } = input;

  const finalize = (
    commitOutcome: CommitOutcome,
    reasons: readonly string[],
    committed?: ExecutionOutcome<TCtx, TEffect>,
  ): CommitOutcome => {
    if (committed) {
      shell.commit(committed.context, committed.effects);
    }
    shell.recordAudit({
      proposal,
      decision,
      commitOutcome,
      reasons,
      effects: committed ? committed.effects : [],
      approval,
      recordedAt,
    });
    return commitOutcome;
  };

  if (!doOutcome.ok) {
    return finalize('rejected', [`dry run failed at instruction ${doOutcome.error.failedAtIndex}`]);
  }

  switch (decision.kind) {
    case 'accept':
      return finalize('committed', [], doOutcome.value);
    case 'reject':
      return finalize('rejected', decision.reasons);
    case 'needs-human-approval':
      if (approval === undefined) {
        return finalize('awaiting-approval', decision.reasons);
      }
      return approval.approved
        ? finalize('committed', [], doOutcome.value)
        : finalize('rejected', [`rejected by approver ${approval.approverId}`]);
  }
}
