import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — same `EXAMPLE_` discipline as
 * `EXAMPLE_patientApprovalPolicy`. Deliberately introduces a role name
 * (`lab-technologist`) patient's own policy never needed, rather than
 * just reusing patient's role list — role taxonomies are genuinely
 * domain-specific, and this is the first real evidence of that: lab's
 * illustrative roles aren't a copy-paste of patient's.
 */
export const EXAMPLE_labApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['physician', 'lab-technologist'],
  'approval-required': ['physician'],
};
