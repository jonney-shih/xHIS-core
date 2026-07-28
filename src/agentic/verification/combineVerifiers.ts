import type { Kinded } from '../../core/execution/kinded.js';
import type { Verifier, VerifyDecision } from './verifier.js';

/**
 * Combines two decisions with "most severe wins": `reject` beats
 * `needs-human-approval` beats `accept`. Same-severity `reject`s or
 * `needs-human-approval`s merge their `reasons` rather than picking one
 * arbitrarily — a proposal that trips two rules should say so. Written as
 * a switch narrowing on both sides rather than a numeric rank lookup, so
 * every branch is exhaustively checked by the compiler with no cast.
 *
 * Exported (not just used internally by `combineVerifiers` below) so
 * `verificationState.ts`'s `foldVerdict` can fold verdicts that arrive
 * asynchronously, one at a time, via the exact same severity rule,
 * instead of reimplementing it — see
 * docs/DETERMINISTIC_CORE_PATTERN.md's "Proposed: a federated
 * choreography spine for verification".
 */
export function mergeDecisions(a: VerifyDecision, b: VerifyDecision): VerifyDecision {
  switch (a.kind) {
    case 'reject':
      return b.kind === 'reject' ? { kind: 'reject', reasons: [...a.reasons, ...b.reasons] } : a;
    case 'needs-human-approval':
      if (b.kind === 'reject') return b;
      if (b.kind === 'needs-human-approval') {
        return { kind: 'needs-human-approval', reasons: [...a.reasons, ...b.reasons] };
      }
      return a;
    case 'accept':
      return b;
  }
}

/**
 * Runs every verifier against the same proposal and folds their decisions
 * into one via `mergeDecisions`. This is how Check actually gets assembled
 * from risk tier + business rules + PDPA rules — see `patient.ts` for the
 * concrete example. An empty list of verifiers accepts everything.
 */
export function combineVerifiers<TInstruction extends Kinded>(
  ...verifiers: readonly Verifier<TInstruction>[]
): Verifier<TInstruction> {
  return {
    verify(proposal) {
      return verifiers.reduce<VerifyDecision>(
        (combined, verifier) => mergeDecisions(combined, verifier.verify(proposal)),
        { kind: 'accept' },
      );
    },
  };
}
