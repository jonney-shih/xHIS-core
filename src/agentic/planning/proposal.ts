import type { Kinded } from '../../core/execution/kinded.js';

/** What the planner is asked to plan for. Kept to a plain description for
 * this first slice — richer structure (constraints, priority, ...) can be
 * added once a real planner needs it. */
export interface PlanningGoal {
  readonly description: string;
}

/**
 * What a planner produces: a candidate instruction sequence plus the
 * provenance needed for the audit record and for a human to judge it in an
 * approval flow (see docs/AGENTIC_LAYER.md).
 *
 * `instructions` is typed as `TInstruction[]` here, but that is only a
 * compile-time shape — it says nothing about *where the values came from*.
 * A real (LLM-backed) planner's raw output is untrusted text/JSON; it must
 * be validated against the closed `Instruction` union *before* a
 * `PlanProposal` is constructed. This type is downstream of that gate, not
 * a substitute for it.
 */
export interface PlanProposal<TInstruction extends Kinded> {
  readonly instructions: readonly TInstruction[];
  readonly rationale: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly proposedAt: string;
}

/**
 * A pure-shaped contract: `plan` receives everything it needs (including
 * the timestamp to stamp the proposal with) as arguments, mirroring the
 * "instructions carry their own timestamp" discipline handlers already
 * follow — see docs/ARCHITECTURE.md. `plan` itself is still free to be
 * non-deterministic (it may call out to an LLM); only the two `Instruction`-
 * facing gates around it (validation, then Do/Check/Act) are held to the
 * core's determinism discipline.
 */
export interface Planner<TCtx, TInstruction extends Kinded> {
  plan(goal: PlanningGoal, context: TCtx, proposedAt: string): Promise<PlanProposal<TInstruction>>;
}
