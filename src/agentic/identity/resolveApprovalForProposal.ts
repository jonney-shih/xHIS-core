import type { Kinded } from '../../core/execution/kinded.js';
import type { PlanProposal } from '../planning/proposal.js';
import { effectiveTier, type RiskTierRegistry } from '../risk/tiers.js';
import type { ApprovalPolicy } from './approvalPolicy.js';
import type { IdentityProvider } from './identity.js';
import { resolveApproval, type ApprovalRequest, type ApprovalResolution } from './resolveApproval.js';

/**
 * Closes the gap `resolveApproval`'s own doc comment flags: this is what
 * actually derives `requiredRoles` from something, instead of a caller
 * having to know it. Recomputes the proposal's `effectiveTier` from
 * `riskTierRegistry` and looks up that tier's roles in `approvalPolicy`,
 * then delegates to `resolveApproval`.
 *
 * Deliberately keyed off the proposal's risk tier alone, not off *which*
 * verifier actually produced `needs-human-approval` — a batch-size rule
 * and a risk-tier rule can both produce that decision, but there is no
 * per-rule role requirement here, only a per-risk-tier one. Still an open
 * question (see docs/AGENTIC_LAYER.md) whether that's the right long-term
 * answer or just what's simplest for now.
 */
export function resolveApprovalForProposal<TInstruction extends Kinded>(
  identityProvider: IdentityProvider,
  riskTierRegistry: RiskTierRegistry<TInstruction>,
  approvalPolicy: ApprovalPolicy,
  proposal: PlanProposal<TInstruction>,
  request: ApprovalRequest,
): ApprovalResolution {
  const tier = effectiveTier(riskTierRegistry, proposal.instructions);
  const requiredRoles = approvalPolicy[tier];

  return resolveApproval(identityProvider, requiredRoles, request);
}
