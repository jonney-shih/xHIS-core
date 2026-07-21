import type { SequenceFailure } from '../core/execution/engine.js';
import type { Kinded } from '../core/execution/kinded.js';
import type { ExecutionOutcome } from '../core/execution/outcome.js';
import type { Result } from '../core/execution/result.js';
import type { ApprovalResolution } from '../agentic/identity/resolveApproval.js';
import type { ImperativeShell } from '../agentic/shell/shell.js';
import type { HumanActionAuditRecord, HumanActionOutcome } from './humanActionAuditRecord.js';

export interface ActHumanInput<TCtx, TInstruction extends Kinded, TEffect, TError> {
  readonly instructions: readonly TInstruction[];
  /**
   * The context a caller would fall back to if `shell.readLatest()`
   * reports nothing has ever been committed — in that case "latest" and
   * "baseline" are the same context by definition, mirroring `act()`'s
   * `ActInput.baselineContext` exactly.
   */
  readonly baselineContext: TCtx;
  /** Recomputes Do against a given context — typically
   * `(ctx) => engine.executeSequence(ctx, instructions)`. */
  readonly reexecute: (ctx: TCtx) => Result<ExecutionOutcome<TCtx, TEffect>, SequenceFailure<TCtx, TEffect, TError>>;
  /**
   * Already resolved — construct this via
   * `agentic/identity/resolveActorForInstructions.ts`, never by hand,
   * mirroring `act()`'s own `approval` convention: this function takes
   * the resolution, it doesn't perform it.
   */
  readonly authorization: ApprovalResolution;
  readonly recordedAt: string;
}

/**
 * The human-initiated counterpart to `act()` — closes the gap
 * docs/ARCHITECTURE.md and docs/AGENTIC_LAYER.md both flag: nothing
 * wires a directly-issued instruction sequence's Do output through an
 * `ImperativeShell` the way `act()` already does for an AI-sourced
 * proposal.
 *
 * Deliberately does *not* run instructions through `PlanProposal`,
 * `toPlanProposal`, or any `Verifier` (`combineVerifiers.ts`'s PDPA
 * rationale scan, batch-size rule, risk-tier rule) — all three exist
 * specifically to compensate for an AI proposal having no inherent
 * authority of its own. A human directly issuing an instruction *is*
 * the authority, once `resolveActorForInstructions` confirms their
 * identity holds a sufficient role for what they're issuing — there is
 * no separate rationale to scan (nothing an LLM wrote), no batch-size
 * heuristic that should apply to a legitimate large order set the way
 * it should to an AI proposing suspiciously many actions at once, and
 * no separate "Check, then wait for a human" step, since the human is
 * already here.
 *
 * Re-derives what to commit against `shell.readLatest()` before
 * writing, exactly like `act()` does — the same optimistic-concurrency
 * closing `tests/agentic/shell/actStaleCommitRace.test.ts` proved
 * necessary applies here too; nothing about *this* path being
 * human-initiated makes it immune to the same race.
 */
export function actHuman<TCtx, TInstruction extends Kinded, TEffect, TError>(
  shell: ImperativeShell<TCtx, TInstruction, TEffect, HumanActionAuditRecord<TInstruction, TEffect>>,
  input: ActHumanInput<TCtx, TInstruction, TEffect, TError>,
): HumanActionOutcome {
  const { instructions, baselineContext, reexecute, authorization, recordedAt } = input;

  const finalize = (
    outcome: HumanActionOutcome,
    reasons: readonly string[],
    committed?: ExecutionOutcome<TCtx, TEffect>,
  ): HumanActionOutcome => {
    if (committed) {
      shell.commit(committed.context, committed.effects);
    }
    shell.recordAudit({
      instructions,
      outcome,
      reasons,
      effects: committed ? committed.effects : [],
      actor: authorization.kind === 'resolved' ? authorization.approval : undefined,
      recordedAt,
    });
    return outcome;
  };

  if (authorization.kind === 'unresolved') {
    return finalize('unauthorized', [authorization.reason]);
  }

  const latest = shell.readLatest() ?? baselineContext;
  const freshOutcome = reexecute(latest);

  if (!freshOutcome.ok) {
    return finalize('rejected', [`instruction sequence failed at index ${freshOutcome.error.failedAtIndex}`]);
  }

  return finalize('committed', [], freshOutcome.value);
}
