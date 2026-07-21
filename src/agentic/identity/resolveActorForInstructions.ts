import type { Kinded } from '../../core/execution/kinded.js';
import { effectiveTier, type RiskTierRegistry } from '../risk/tiers.js';
import type { ApprovalPolicy } from './approvalPolicy.js';
import type { IdentityProvider } from './identity.js';
import { resolveApproval, type ApprovalResolution } from './resolveApproval.js';

/**
 * The human-initiated-path counterpart to `resolveApprovalForProposal`.
 * That function checks whether a *separate* approver may clear a
 * proposal an AI already produced; this checks whether the person
 * directly issuing `instructions` themselves holds a sufficient role to
 * do so — the same `RiskTierRegistry`/`ApprovalPolicy` lookup, reused
 * rather than duplicated, because "who may approve X" and "who may
 * directly issue X" are the same real-world authority question in every
 * domain modeled so far (a physician who can approve a discharge is
 * also the one who orders it directly). There is no separate proposal
 * here to key off of — no rationale, model version, or prompt version,
 * nothing an LLM produced — so this takes `instructions` directly
 * instead of a `PlanProposal`.
 *
 * Deliberately reuses `resolveApproval`'s vocabulary (`Approval`,
 * `ApprovalResolution`) even though "approving" reads slightly oddly for
 * someone confirming their own identity before their own direct action —
 * the actual check (does this identity hold one of the required roles,
 * as of this moment) and the audit-worthy record it produces (who, what
 * role, when) are identical in shape either way; inventing a parallel
 * construct for the same shape would just be duplication. `approved` is
 * always `true` here — there is no "decline" case for someone directly
 * issuing an instruction the way there is for someone asked to approve
 * someone else's; declining just means never calling this at all.
 */
export function resolveActorForInstructions<TInstruction extends Kinded>(
  identityProvider: IdentityProvider,
  riskTierRegistry: RiskTierRegistry<TInstruction>,
  approvalPolicy: ApprovalPolicy,
  instructions: readonly TInstruction[],
  actor: { readonly actorId: string; readonly assertedAt: string },
): ApprovalResolution {
  const tier = effectiveTier(riskTierRegistry, instructions);
  const requiredRoles = approvalPolicy[tier];

  return resolveApproval(identityProvider, requiredRoles, {
    approverId: actor.actorId,
    approved: true,
    decidedAt: actor.assertedAt,
  });
}
