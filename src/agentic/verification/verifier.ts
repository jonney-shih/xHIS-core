import type { Kinded } from '../../core/execution/kinded.js';
import type { PlanProposal } from '../planning/proposal.js';

/**
 * Check's outcome (see docs/AGENTIC_LAYER.md). `needs-human-approval` is
 * distinct from `reject`: the proposal isn't wrong, it just isn't allowed
 * to commit without a human decision. Any individual verifier in a
 * combined Check (see `combineVerifiers.ts`) can only ever push the overall
 * decision from `accept` toward `needs-human-approval` toward `reject`,
 * never the reverse — severity only accumulates.
 */
export type VerifyDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject'; readonly reasons: readonly string[] }
  | { readonly kind: 'needs-human-approval'; readonly reasons: readonly string[] };

/**
 * Takes the whole `PlanProposal`, not just its `instructions` — a rule may
 * need to look at `rationale` (see `pdpaRules.ts`'s PII scan) or other
 * proposal metadata, not only the instructions themselves.
 */
export interface Verifier<TInstruction extends Kinded> {
  verify(proposal: PlanProposal<TInstruction>): VerifyDecision;
}
