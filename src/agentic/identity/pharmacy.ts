import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — same `EXAMPLE_` discipline as
 * `EXAMPLE_patientApprovalPolicy`, `EXAMPLE_bedApprovalPolicy`, and
 * `EXAMPLE_labApprovalPolicy`. Unlike lab (where the top tier is
 * `physician`-only) pharmacy's top tier is `pharmacist`-only: a
 * pharmacist, not a physician, holds the real-world authority and
 * legal responsibility for verifying and dispensing a medication —
 * the same "role taxonomies are genuinely domain-specific" evidence
 * `EXAMPLE_labApprovalPolicy`'s own doc comment already gives, now with
 * a top tier that isn't `physician` at all.
 */
export const EXAMPLE_pharmacyApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['physician', 'pharmacist'],
  'approval-required': ['pharmacist'],
};
