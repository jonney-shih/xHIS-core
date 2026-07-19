import type { Kinded } from '../../core/execution/kinded.js';

/**
 * Check's outcome (see docs/AGENTIC_LAYER.md). `needs-human-approval` is
 * distinct from `reject`: the proposal isn't wrong, it just isn't allowed
 * to commit without a human decision. Risk tier can only ever push a
 * decision from `accept` toward `needs-human-approval`, never the reverse.
 */
export type VerifyDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject'; readonly reasons: readonly string[] }
  | { readonly kind: 'needs-human-approval'; readonly reasons: readonly string[] };

export interface Verifier<TInstruction extends Kinded> {
  verify(instructions: readonly TInstruction[]): VerifyDecision;
}
