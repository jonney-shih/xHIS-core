import { err, ok, type Result } from '../../core/execution/result.js';
import type { UiKinded } from './component.js';
import type { ComponentPropsValidatorRegistry } from './validator.js';
import { validateComponent } from './validator.js';
import type { UiRenderProposal } from './proposal.js';

/**
 * What an untrusted Agent actually produces, before its output has been
 * checked against the closed component-descriptor union — the UI-side
 * counterpart to `planning/toPlanProposal.ts`'s `RawPlanOutput`.
 * `component` is `unknown` on purpose — this is the raw shape a real
 * Agent's JSON output has, prior to the gate below.
 */
export interface RawUiRenderOutput {
  readonly component: unknown;
  readonly rationale: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * The only sanctioned way to turn untrusted Agent output into a
 * `UiRenderProposal` — Guardrail #1's "every LLM output (JSON) must
 * pass through a strict runtime validation schema before reaching the
 * render layer," made concrete. Unlike `toPlanProposal`, there is no
 * batch here to be all-or-nothing over (see `UiRenderProposal`'s own
 * doc comment) — one candidate either validates into a real component
 * or it doesn't.
 */
export function toUiRenderProposal<TComponent extends UiKinded>(
  registry: ComponentPropsValidatorRegistry<TComponent>,
  raw: RawUiRenderOutput,
  proposedAt: string,
): Result<UiRenderProposal<TComponent>, readonly string[]> {
  const validated = validateComponent(registry, raw.component);

  if (!validated.ok) {
    return err(validated.error);
  }

  return ok({
    component: validated.value,
    rationale: raw.rationale,
    modelVersion: raw.modelVersion,
    promptVersion: raw.promptVersion,
    proposedAt,
  });
}
