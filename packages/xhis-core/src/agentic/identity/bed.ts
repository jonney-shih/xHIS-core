import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — same `EXAMPLE_` discipline as
 * `EXAMPLE_patientApprovalPolicy` and `EXAMPLE_labApprovalPolicy`.
 * Bed assignment/release in a real hospital is routinely coordinated by
 * nursing/patient-flow staff, not physicians — so `'bed-coordinator'`
 * is introduced here rather than reusing `'physician'` for the tier
 * both of bed's instructions share. Nothing in `bedRiskTiers` currently
 * maps to `'approval-required'`; the role list there is a placeholder
 * for if/when a future `BedInstruction` variant ever earns that tier,
 * not a role anything in this domain currently consults.
 */
export const EXAMPLE_bedApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['charge-nurse', 'bed-coordinator'],
  'approval-required': ['charge-nurse'],
};
