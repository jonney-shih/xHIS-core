import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — same `EXAMPLE_` discipline as every
 * other domain's `EXAMPLE_*ApprovalPolicy`. `'credentialing-officer'`
 * is new, mirroring the pattern of introducing a domain-specific role
 * for the profession that actually does the work
 * (`'lab-technologist'`, `'bed-coordinator'`, `'billing-clerk'`,
 * `'radiologic-technologist'`). `'chief-medical-officer'` is new too,
 * and — unlike scheduling's deliberately *disjoint* tiers — is a
 * superset of `'review-required'`'s authority, not a stranger to it: a
 * CMO's real-world authority genuinely subsumes a credentialing
 * officer's, the same "narrower list at the higher tier" nesting
 * `patient`/`lab`/`ledger`/`imaging` already use. Scheduling's
 * disjoint shape and this nested one are both legitimate; which one
 * fits depends on whether the domain's real-world roles actually
 * nest, not on any property of the mechanism itself.
 */
export const EXAMPLE_nursingApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['credentialing-officer', 'chief-medical-officer'],
  'approval-required': ['chief-medical-officer'],
};
