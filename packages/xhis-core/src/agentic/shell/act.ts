import { isoTimestamp } from '../../core/temporal.js';
import type { SequenceFailure } from '../../core/execution/engine.js';
import type { Kinded } from '../../core/execution/kinded.js';
import type { ExecutionOutcome } from '../../core/execution/outcome.js';
import type { Result } from '../../core/execution/result.js';
import { telemetry } from '../../telemetry/hook.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { Approval, CommitOutcome } from './auditRecord.js';
import type { ImperativeShell } from './shell.js';

/**
 * Optional tag identifying which domain/proposal this `act()` call is
 * for, used only to label the `HandlerException`/`CommitConflict`
 * telemetry below — see `core/execution/engine.ts`'s own
 * `HandlerExceptionTelemetryContext` doc comment for why this is
 * optional and caller-supplied rather than inferred: `TInstruction`
 * only guarantees a `kind` per `Kinded`, never a domain name, and
 * `PlanProposal` has no correlation ID of its own. Omitting this (every
 * call site that predates telemetry) emits nothing — additive, not a
 * behavior change.
 */
export interface ActTelemetryTag {
  readonly domain: string;
  readonly correlationId: string;
}

export interface ActInput<TCtx, TInstruction extends Kinded, TEffect, TError> {
  readonly proposal: PlanProposal<TInstruction>;
  /** Do's result — typically `engine.executeSequence(context, proposal.instructions)`. */
  readonly doOutcome: Result<ExecutionOutcome<TCtx, TEffect>, SequenceFailure<TCtx, TEffect, TError>>;
  readonly decision: VerifyDecision;
  /**
   * The context `doOutcome` was actually computed against. Used only as
   * the fallback baseline for the fresh, commit-time re-check below, for
   * when `shell.readLatest()` reports nothing has ever been committed —
   * in that case "latest" and "baseline" are the same context by
   * definition, so there is nothing that could have drifted yet.
   */
  readonly baselineContext: TCtx;
  /**
   * Recomputes Do against a given context — typically
   * `(ctx) => engine.executeSequence(ctx, proposal.instructions)`. Never
   * called unless Act is actually about to commit. This is what makes the
   * `'stale'` outcome below possible: re-deriving the effect of this
   * proposal against the shell's *actual* current state, rather than
   * trusting `doOutcome`, which may have been computed long before this
   * call (e.g. across a human-approval wait) against a snapshot something
   * else has since moved past.
   */
  readonly reexecute: (ctx: TCtx) => Result<ExecutionOutcome<TCtx, TEffect>, SequenceFailure<TCtx, TEffect, TError>>;
  /**
   * Present only once a human has resolved a `needs-human-approval`
   * decision *and* their identity/permission has been verified — construct
   * this via `agentic/identity/resolveApproval.ts`, never by hand.
   */
  readonly approval?: Approval;
  readonly recordedAt: string;
  /** See `ActTelemetryTag`'s own doc comment. Optional; omitting it
   * emits no telemetry at all. */
  readonly telemetryTag?: ActTelemetryTag;
}

/**
 * Act: the only place a proposal's effects may actually be committed (see
 * docs/AGENTIC_LAYER.md's PDCA table). Writes exactly one audit record no
 * matter what happens, and commits only when Check accepted outright or a
 * human has since approved — never on `reject`, never while
 * `needs-human-approval` is still unresolved, and never when Do itself
 * failed (there is nothing valid to commit, same principle as
 * `executeSequence`'s all-or-nothing batch contract).
 *
 * Every commit path re-derives the effect to write via `reexecute` against
 * `shell.readLatest()`, not by trusting the already-computed `doOutcome` —
 * see `tests/agentic/shell/actStaleCommitRace.test.ts` for the race this
 * closes (a second proposal's stale `doOutcome`, blindly committed,
 * silently erasing a first proposal that already committed in the
 * meantime) and docs/AGENTIC_LAYER.md's open questions for why. `decision`
 * itself is never recomputed here: every `Verifier` (see
 * `combineVerifiers.ts`) only ever looks at the proposal — instructions
 * and rationale — never at context, so nothing about Check's decision can
 * go stale the way Do's context-dependent computation can.
 */
export function act<TCtx, TInstruction extends Kinded, TEffect, TError>(
  shell: ImperativeShell<TCtx, TInstruction, TEffect>,
  input: ActInput<TCtx, TInstruction, TEffect, TError>,
): CommitOutcome {
  const { proposal, doOutcome, decision, baselineContext, reexecute, approval, recordedAt, telemetryTag } = input;

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

  const commitAfterFreshCheck = (): CommitOutcome => {
    const latest = shell.readLatest() ?? baselineContext;
    const freshOutcome = reexecute(latest);

    if (!freshOutcome.ok) {
      const reasons = [
        `re-validation against the latest committed state failed at instruction ${freshOutcome.error.failedAtIndex} — the world changed since this proposal was verified; re-propose`,
      ];
      // The race `tests/agentic/shell/actStaleCommitRace.test.ts` proves
      // this closes: something else committed between this proposal's
      // original Do and this commit-time re-check. Reported as
      // `CommitConflict`, not `HandlerException` — nothing threw, and
      // nothing about either instruction sequence is wrong in
      // isolation; only their arrival order conflicted.
      if (telemetryTag) {
        telemetry.emit({
          kind: 'CommitConflict',
          domain: telemetryTag.domain,
          correlationId: telemetryTag.correlationId,
          recordedAt: isoTimestamp(recordedAt),
          reasons,
        });
      }
      return finalize('stale', reasons);
    }

    return finalize('committed', [], freshOutcome.value);
  };

  if (!doOutcome.ok) {
    const reasons = [`dry run failed at instruction ${doOutcome.error.failedAtIndex}`];
    // Distinct from `core/execution/engine.ts`'s own `HandlerException`
    // telemetry (a handler that *threw*): this is Do's well-typed `err`
    // path — `doOutcome` already failed before `act()` was even called
    // — reported here as the same event kind anyway, since both
    // describe "this instruction sequence could not be executed against
    // its context" from an operator's point of view, just discovered at
    // a different layer.
    if (telemetryTag) {
      telemetry.emit({
        kind: 'HandlerException',
        domain: telemetryTag.domain,
        correlationId: telemetryTag.correlationId,
        recordedAt: isoTimestamp(recordedAt),
        message: reasons[0]!,
      });
    }
    return finalize('rejected', reasons);
  }

  switch (decision.kind) {
    case 'accept':
      return commitAfterFreshCheck();
    case 'reject':
      return finalize('rejected', decision.reasons);
    case 'needs-human-approval':
      if (approval === undefined) {
        return finalize('awaiting-approval', decision.reasons);
      }
      return approval.approved
        ? commitAfterFreshCheck()
        : finalize('rejected', [`rejected by approver ${approval.approverId}`]);
  }
}
