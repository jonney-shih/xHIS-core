import type { Kinded } from '../../core/execution/kinded.js';
import { err, ok, type Result } from '../../core/execution/result.js';
import type { IndexedValidationIssues, InstructionValidatorRegistry } from '../validation/validator.js';
import { validateInstructions } from '../validation/validator.js';
import type { PlanningGoal, PlanProposal } from './proposal.js';

/**
 * What an untrusted planner (e.g. an LLM) actually produces, before its
 * output has been checked against the closed `Instruction` union.
 * `instructions` is `unknown[]` on purpose — this is the raw shape a real
 * planner's JSON output has, prior to the gate below.
 */
export interface RawPlanOutput {
  readonly instructions: readonly unknown[];
  readonly rationale: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * An untrusted planner's contract — deliberately different from
 * `Planner` in `proposal.ts`. `Planner.plan()` returns an already-typed
 * `PlanProposal` and is for planners that are trusted by construction
 * (see `stubPlanner.ts`); this one returns `Result<RawPlanOutput, string>`
 * because there are two distinct things that can go wrong before a
 * `PlanProposal` exists at all — the planner might not even produce a
 * parseable response (the `err` case here), or it might parse fine but
 * fail per-instruction validation (handled downstream by `toPlanProposal`,
 * not by this interface). `feedback` carries forward what went wrong on a
 * previous attempt — see `planWithRetries.ts` — empty on a first attempt.
 */
export interface RawPlanner<TCtx> {
  plan(
    goal: PlanningGoal,
    context: TCtx,
    proposedAt: string,
    feedback: readonly string[],
  ): Promise<Result<RawPlanOutput, string>>;
}

/**
 * The only sanctioned way to turn untrusted planner output into a
 * `PlanProposal` (see `PlanProposal`'s own doc comment, and
 * docs/AGENTIC_LAYER.md). Every candidate instruction must validate against
 * the closed `Instruction` union, or the whole proposal is rejected — no
 * partially-trusted proposals, same all-or-nothing principle as
 * `executeSequence`'s batch contract.
 */
export function toPlanProposal<TInstruction extends Kinded>(
  registry: InstructionValidatorRegistry<TInstruction>,
  raw: RawPlanOutput,
  proposedAt: string,
): Result<PlanProposal<TInstruction>, readonly IndexedValidationIssues[]> {
  const validated = validateInstructions(registry, raw.instructions);

  if (!validated.ok) {
    return err(validated.error);
  }

  return ok({
    instructions: validated.value,
    rationale: raw.rationale,
    modelVersion: raw.modelVersion,
    promptVersion: raw.promptVersion,
    proposedAt,
  });
}
