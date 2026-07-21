import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — same `EXAMPLE_` discipline as
 * `EXAMPLE_patientApprovalPolicy`, `EXAMPLE_labApprovalPolicy`, and
 * `EXAMPLE_bedApprovalPolicy`. Ledger is the first domain whose
 * illustrative roles come from an entirely different professional
 * context — finance/billing, not clinical or nursing staff —
 * `'billing-clerk'` and `'finance-controller'` appear in no other
 * domain's policy. `'approval-required'` intentionally excludes
 * `'billing-clerk'`: reversing a posted entry is a step with no direct
 * undo (see `risk/ledger.ts`'s doc comment), so it needs the more
 * senior role, the same "narrower role list at the higher tier" shape
 * every other domain's policy already has.
 */
export const EXAMPLE_ledgerApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['billing-clerk', 'finance-controller'],
  'approval-required': ['finance-controller'],
};
