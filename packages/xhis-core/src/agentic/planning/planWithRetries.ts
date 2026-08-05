import type { Kinded } from '../../core/execution/kinded.js';
import { err, type Result } from '../../core/execution/result.js';
import type { InstructionValidatorRegistry } from '../validation/validator.js';
import type { PlanningGoal, PlanProposal } from './proposal.js';
import type { RawPlanner } from './toPlanProposal.js';
import { toPlanProposal } from './toPlanProposal.js';

export interface PlanningFailure {
  readonly attempts: number;
  readonly issues: readonly string[];
}

/**
 * Drives a `RawPlanner` through up to `maxAttempts` tries, feeding each
 * attempt's problems back into the next one's `feedback` so a real LLM
 * planner gets a chance to fix what it got wrong, instead of failing
 * silently after one try. Two distinct failure tiers get normalized into
 * the same `readonly string[]` feedback shape: the planner not producing a
 * parseable response at all (`RawPlanner`'s own `err`), and a parseable
 * response whose instructions don't validate (`toPlanProposal`'s `err`,
 * flattened from per-index issues into `"instruction N: ..."` strings).
 *
 * Succeeds on the first attempt that produces a fully valid `PlanProposal`.
 * Returns `PlanningFailure` — attempt count plus the last attempt's
 * feedback — only once every attempt has been exhausted; nothing partial
 * or "probably fine" is ever returned.
 */
export async function planWithRetries<TCtx, TInstruction extends Kinded>(
  planner: RawPlanner<TCtx>,
  registry: InstructionValidatorRegistry<TInstruction>,
  goal: PlanningGoal,
  context: TCtx,
  proposedAt: string,
  maxAttempts: number,
): Promise<Result<PlanProposal<TInstruction>, PlanningFailure>> {
  let feedback: readonly string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const rawResult = await planner.plan(goal, context, proposedAt, feedback);

    if (!rawResult.ok) {
      feedback = [rawResult.error];
      continue;
    }

    const proposalResult = toPlanProposal(registry, rawResult.value, proposedAt);

    if (proposalResult.ok) {
      return proposalResult;
    }

    feedback = proposalResult.error.flatMap((failure) =>
      failure.issues.map((issue) => `instruction ${failure.index}: ${issue}`),
    );
  }

  return err({ attempts: maxAttempts, issues: feedback });
}
