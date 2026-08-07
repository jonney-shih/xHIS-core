import type { UiKinded } from './component.js';

/**
 * What Plan proposes when the output is "show this UI," not "run these
 * instructions" — the UI-side counterpart to `planning/proposal.ts`'s
 * `PlanProposal`. Deliberately singular (`component`, not `components:
 * TComponent[]`): `PlanProposal.instructions` is an array because
 * instructions are a *sequence of state transitions* that need
 * all-or-nothing atomicity (see `core/execution/engine.ts`'s
 * `executeSequence` batch contract). A UI descriptor has no such
 * causality — there is no "render panel A, then panel B" ordering
 * concern, and nothing to roll back — so batching here would import a
 * concern this shape doesn't have.
 */
export interface UiRenderProposal<TComponent extends UiKinded> {
  readonly component: TComponent;
  readonly rationale: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly proposedAt: string;
}
