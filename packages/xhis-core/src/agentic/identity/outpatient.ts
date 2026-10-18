import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — see `identity/patient.ts`'s own doc
 * comment for why this is named `EXAMPLE_` rather than
 * `outpatientApprovalPolicy`: every deployment must supply its own,
 * reviewed against its own credentialing policy. Reuses the same two
 * role names `EXAMPLE_patientApprovalPolicy` does (`physician`,
 * `charge-nurse`) since the same real-world authority structure governs
 * both an inpatient admission/discharge and an outpatient visit's
 * documentation/orders — not because the roles were copied without
 * thought, but because nothing about this domain's own instructions
 * calls for a different authority structure than patient's.
 */
export const EXAMPLE_outpatientApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['physician', 'charge-nurse'],
  'approval-required': ['physician'],
};
