import type { PatientContext, PatientInstruction } from '../../instructions/patient/types.js';
import type { Planner } from './proposal.js';

/**
 * Always proposes the same fixed instruction sequence, ignoring the goal
 * and context it's given. Exists so the Plan -> Do -> Check -> Act path can
 * be built and exercised end-to-end against something deterministic before
 * an LLM-backed planner exists — see docs/AGENTIC_LAYER.md, "Suggested
 * minimal first slice".
 */
export function createStubPatientPlanner(
  instructions: readonly PatientInstruction[],
  rationale: string,
): Planner<PatientContext, PatientInstruction> {
  return {
    plan: async (_goal, _context, proposedAt) => ({
      instructions,
      rationale,
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt,
    }),
  };
}
