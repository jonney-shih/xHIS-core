import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — same `EXAMPLE_` discipline as every
 * other domain's `EXAMPLE_*ApprovalPolicy`. `'radiologic-technologist'`
 * is new, mirroring lab's `'lab-technologist'` for the profession that
 * actually performs the study. `'approval-required'` is the more
 * interesting departure: every prior domain's top tier used the generic
 * `'physician'` role (or a domain-specific replacement for it, like
 * ledger's `'finance-controller'`); imaging's top tier is
 * `'radiologist'` specifically — a subspecialty credential, not just
 * "any physician." A referring physician can order or cancel a study
 * (hence `'physician'` appears at `'review-required'`), but signing the
 * actual report is a radiologist's job specifically, so `'physician'`
 * is deliberately *not* repeated at `'approval-required'` the way it
 * was for `patient`/`lab`. This is the first domain whose top tier is
 * narrower than "any physician," not just narrower than its own lower
 * tier.
 */
export const EXAMPLE_imagingApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['physician', 'radiologic-technologist'],
  'approval-required': ['radiologist'],
};
