import type { ApprovalPolicy } from '@xhis/core';

/**
 * An example policy for exercising approval resolution end to end
 * (identity + role check via `@xhis/core`'s `resolveApprovalForProposal`)
 * — named `EXAMPLE_` for the identical reason `@xhis/core`'s own
 * `agentic/identity/bed.ts` exports `EXAMPLE_bedApprovalPolicy`: a real
 * deployment's actual on-call/lead roster is an ops decision this
 * package should not hardcode.
 *
 * `'auto'`'s roles are never consulted (Check accepts `auto`-tier
 * proposals outright), but the key is still required — `ApprovalPolicy`
 * is total over every `RiskTier`, same discipline as everywhere else.
 */
export const EXAMPLE_opsApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['sre-oncall'],
  'approval-required': ['sre-lead', 'platform-lead'],
};
