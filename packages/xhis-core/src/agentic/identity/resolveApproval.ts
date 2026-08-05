import type { Approval } from '../shell/auditRecord.js';
import type { IdentityProvider } from './identity.js';

/**
 * A raw, unverified claim: "I am `approverId`, and my decision is
 * `approved`." Nothing about this type implies the claim is true — that's
 * exactly what `resolveApproval` checks before it becomes a trusted
 * `Approval`.
 */
export interface ApprovalRequest {
  readonly approverId: string;
  readonly approved: boolean;
  readonly decidedAt: string;
}

export type ApprovalResolution =
  | { readonly kind: 'resolved'; readonly approval: Approval }
  | { readonly kind: 'unresolved'; readonly reason: string };

/**
 * The only sanctioned way to turn an `ApprovalRequest` into an `Approval`
 * that `act()` will honor (see docs/AGENTIC_LAYER.md). Two things have to
 * hold, and both are checked here rather than left to the caller: the
 * claimed `approverId` must resolve to a real identity, and that identity
 * must hold at least one of `requiredRoles`. Note this applies equally to
 * a decline — an unauthenticated "no" is just as untrustworthy as an
 * unauthenticated "yes", since either could be used to block a legitimate
 * action under a false identity.
 *
 * `requiredRoles` is a parameter rather than something this function looks
 * up itself — see `approvalPolicy.ts` and `resolveApprovalForProposal.ts`
 * for the risk-tier-driven policy that decides what to pass here. An empty
 * `requiredRoles` fails closed (nobody is authorized), never open, so a
 * policy that forgets to list a tier's roles doesn't silently mean
 * "unrestricted."
 */
export function resolveApproval(
  identityProvider: IdentityProvider,
  requiredRoles: readonly string[],
  request: ApprovalRequest,
): ApprovalResolution {
  // `request.decidedAt` is the moment this claim was made — exactly the
  // timestamp a time-varying `IdentityProvider` (see
  // `nursingIdentityProvider.ts`) needs to decide whether a role's
  // backing credential was still valid then, not whether it happens to
  // be valid at whatever moment this function itself executes.
  const identity = identityProvider.resolve(request.approverId, request.decidedAt);

  if (!identity) {
    return { kind: 'unresolved', reason: `no identity found for approver '${request.approverId}'` };
  }

  const matchedRole = requiredRoles.find((role) => identity.roles.includes(role));

  if (!matchedRole) {
    return {
      kind: 'unresolved',
      reason: `identity '${identity.id}' holds none of the required roles [${requiredRoles.join(', ')}]`,
    };
  }

  return {
    kind: 'resolved',
    approval: {
      // The identity provider's canonical ID, not necessarily whatever
      // casing/format the raw request claimed.
      approverId: identity.id,
      // The specific role that matched, not the whole `requiredRoles`
      // list — the audit record should say exactly what permission
      // authorized this decision, not every permission that would have.
      approverRole: matchedRole,
      approved: request.approved,
      decidedAt: request.decidedAt,
    },
  };
}
