import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — see `identity/patient.ts`'s own doc
 * comment for why this is named `EXAMPLE_` rather than
 * `inpatientApprovalPolicy`: every deployment must supply its own,
 * reviewed against its own credentialing policy. Reuses the same two
 * role names `EXAMPLE_patientApprovalPolicy`/`EXAMPLE_outpatientApprovalPolicy`
 * do, for the same reason: nothing about this domain's own instructions
 * calls for a different authority structure than either.
 */
export const EXAMPLE_inpatientApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['physician', 'charge-nurse'],
  'approval-required': ['physician'],
};
