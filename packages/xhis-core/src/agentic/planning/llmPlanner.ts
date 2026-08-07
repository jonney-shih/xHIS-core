import { err, ok, type Result } from '../../core/execution/result.js';
import { extractJson } from './json.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';
import type { PlanningGoal } from './proposal.js';

/**
 * A single text-completion call: prompt in, raw text out. Deliberately
 * this narrow — no vendor SDK, no model name, no auth, nothing else about
 * the call shows up in this codebase's types. xHIS-core has no opinion
 * about which LLM vendor is used and isn't the place that decision gets
 * made (see docs/AGENTIC_LAYER.md's PDPA restrictions on vendor DPAs/BAAs
 * and cross-border transfer, none of which this file resolves). Whoever
 * calls `createLlmPlanner` supplies this, using whatever SDK and
 * credentials their own vendor agreement covers.
 */
export type CompletionFn = (prompt: string) => Promise<string>;

/**
 * Builds the actual prompt text for a domain. Kept as its own interface
 * because "how do you describe this context to a model" is a domain
 * decision (see `patientPromptBuilder.ts`), not something this generic
 * adapter should hardcode.
 */
export interface PromptBuilder<TCtx> {
  build(goal: PlanningGoal, context: TCtx, feedback: readonly string[]): string;
}

/**
 * Wraps a raw completion call into a `RawPlanner`: build a prompt, call
 * `complete`, and parse the result into `RawPlanOutput`'s shape. Fails (an
 * `err`, not a thrown exception) if the response isn't parseable JSON, or
 * parses into something missing `instructions`/`rationale` — either way,
 * before any single instruction has been checked against the closed
 * `Instruction` union, which is `toPlanProposal`'s job, not this one's.
 *
 * `modelVersion`/`promptVersion` are constructor parameters, fixed at
 * call-site, never read from the model's response or any runtime input —
 * the same "known, reviewed, closed set, not runtime-configurable"
 * discipline docs/AGENTIC_LAYER.md's TFDA restrictions require.
 */
export function createLlmPlanner<TCtx>(
  complete: CompletionFn,
  promptBuilder: PromptBuilder<TCtx>,
  modelVersion: string,
  promptVersion: string,
): RawPlanner<TCtx> {
  return {
    async plan(goal, context, _proposedAt, feedback): Promise<Result<RawPlanOutput, string>> {
      const prompt = promptBuilder.build(goal, context, feedback);
      const responseText = await complete(prompt);

      const parsed = extractJson(responseText);
      if (!parsed.ok) {
        return err(parsed.error);
      }

      const candidate = parsed.value;
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        return err('parsed response was not a JSON object');
      }

      const { instructions, rationale } = candidate as Record<string, unknown>;
      if (!Array.isArray(instructions)) {
        return err("parsed response is missing an 'instructions' array");
      }
      if (typeof rationale !== 'string') {
        return err("parsed response is missing a 'rationale' string");
      }

      return ok({ instructions, rationale, modelVersion, promptVersion });
    },
  };
}
