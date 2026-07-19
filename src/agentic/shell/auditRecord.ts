import type { Kinded } from '../../core/execution/kinded.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';

/**
 * What Act decided to do with a proposal (see docs/AGENTIC_LAYER.md).
 * `awaiting-approval` is distinct from `rejected`: Check asked for a human
 * decision and none has arrived yet. `act()` may be called again later for
 * the same proposal, this time with an `Approval` attached, to resolve it
 * either way.
 */
export type CommitOutcome = 'committed' | 'rejected' | 'awaiting-approval';

/** A human's resolution of a `needs-human-approval` decision. */
export interface Approval {
  readonly approverId: string;
  readonly approved: boolean;
  readonly decidedAt: string;
}

/**
 * The one thing Act always produces, regardless of outcome — this is the
 * non-repudiable record docs/AGENTIC_LAYER.md's MOHW/PDPA restrictions call
 * for. `effects` is only populated when `commitOutcome` is `'committed'`;
 * on rejection or pending approval nothing was applied, mirroring
 * `executeSequence`'s all-or-nothing batch contract.
 */
export interface AuditRecord<TInstruction extends Kinded, TEffect> {
  readonly proposal: PlanProposal<TInstruction>;
  readonly decision: VerifyDecision;
  readonly commitOutcome: CommitOutcome;
  readonly reasons: readonly string[];
  readonly effects: readonly TEffect[];
  readonly approval?: Approval;
  readonly recordedAt: string;
}
