import type { Kinded } from '../../core/execution/kinded.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerificationWorker, WorkerId } from './verificationWorker.js';
import type { VerifyDecision } from './verifier.js';

/**
 * A single call out to whatever harness this codebase has no opinion
 * about — an external compliance service, a second LLM acting as a
 * safety reviewer, a queued human-review step. Deliberately this narrow
 * (no vendor SDK, no protocol, no auth) — the same "no vendor SDK, no
 * model name" restraint `planning/llmPlanner.ts`'s `CompletionFn`
 * already applies to the equivalent problem on the Plan side. All this
 * codebase needs from it is that it eventually resolves to a
 * `VerifyDecision`; how long that takes, or what it actually calls, is
 * exactly what `ProposalLog` + `runVerificationWorker` exist to keep off
 * Plan's critical path.
 */
export type ExternalVerificationFn<TInstruction extends Kinded> = (
  proposal: PlanProposal<TInstruction>,
) => Promise<VerifyDecision>;

/**
 * Adapts a genuinely slow, external call into a `VerificationWorker` —
 * the counterpart to `verificationWorker.ts`'s `verifierAsWorker`, but
 * for the `Promise`-returning branch that adapter never needed to
 * exercise (every existing `Verifier` — `batchSizeRule`,
 * `riskTierVerifier`, `pdpaRules` — is synchronous). See
 * docs/DETERMINISTIC_CORE_PATTERN.md's "Resolved: a genuinely async
 * VerificationWorker, proven non-blocking" for what this slice actually
 * had to prove that wrapping a synchronous `Verifier` never could.
 */
export function createExternalVerificationWorker<TInstruction extends Kinded>(
  id: WorkerId,
  checkExternally: ExternalVerificationFn<TInstruction>,
): VerificationWorker<TInstruction> {
  return {
    workerId: id,
    verify(proposal) {
      return checkExternally(proposal);
    },
  };
}
