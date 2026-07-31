import type { UiKinded } from './component.js';
import type { ComponentPropsValidatorRegistry } from './validator.js';
import type { RawUiRenderOutput } from './toUiRenderProposal.js';
import { toUiRenderProposal } from './toUiRenderProposal.js';
import type { UiProposalTelemetryLog } from './telemetry.js';

/**
 * The Agent-selects-a-component-or-falls-back decision, made concrete
 * and typed — deliberately stops short of ever touching a real render
 * call. Guardrail #3 draws the line at "the Agent's role is selecting
 * the correct component type and supplying typed structured data/props"
 * — rendering itself is "100% governed by our audited TypeScript Design
 * System," a separate system this repo does not own (nothing under
 * `src/` references `react` at all, on purpose). This type is where
 * this repo's responsibility ends: a validated component descriptor to
 * render, or a typed reason it couldn't be. Whichever Design System
 * consumes this maps `component` to an actual rendered element in its
 * own registry.
 */
export type UiRenderOutcome<TComponent extends UiKinded> =
  | { readonly kind: 'render'; readonly component: TComponent }
  | { readonly kind: 'fallback'; readonly reasons: readonly string[] };

export interface ResolveUiRenderOutcomeInput<TComponent extends UiKinded> {
  readonly registry: ComponentPropsValidatorRegistry<TComponent>;
  readonly raw: RawUiRenderOutput;
  readonly proposedAt: string;
  readonly telemetryLog: UiProposalTelemetryLog;
  readonly recordedAt: string;
}

function attemptedComponentName(candidate: unknown): string {
  if (typeof candidate !== 'object' || candidate === null) {
    return 'unknown';
  }
  const component = (candidate as Record<string, unknown>)['component'];
  return typeof component === 'string' ? component : 'unknown';
}

/**
 * Guardrail #1's "if validation fails, trigger a graceful fallback to a
 * standard static UI" — resolved to a typed outcome, not yet a specific
 * fallback component. The actual static fallback panel is deliberately
 * not decided here, and deliberately never a member of any `TComponent`
 * union a caller passes in: keeping it out of the Agent's selectable
 * vocabulary is what keeps it safe to always fall back to — the same
 * harness/core separation this whole project already treats as
 * load-bearing, applied here to "what happens when the contract is
 * violated" instead of "what the deterministic core is allowed to do."
 * Whoever calls this supplies their own fixed fallback panel for the
 * `fallback` case — the same way `planning/llmPlanner.ts`'s
 * `CompletionFn` leaves the actual vendor call to its caller instead of
 * deciding it here.
 */
export function resolveUiRenderOutcome<TComponent extends UiKinded>(
  input: ResolveUiRenderOutcomeInput<TComponent>,
): UiRenderOutcome<TComponent> {
  const result = toUiRenderProposal(input.registry, input.raw, input.proposedAt);

  if (!result.ok) {
    input.telemetryLog.record({
      component: attemptedComponentName(input.raw.component),
      outcome: 'fallback',
      reasons: result.error,
      recordedAt: input.recordedAt,
    });
    return { kind: 'fallback', reasons: result.error };
  }

  input.telemetryLog.record({
    component: result.value.component.component,
    outcome: 'rendered',
    reasons: [],
    recordedAt: input.recordedAt,
  });
  return { kind: 'render', component: result.value.component };
}
