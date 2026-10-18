import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — see `identity/patient.ts`'s own doc
 * comment for why this is named `EXAMPLE_` rather than
 * `emergencyApprovalPolicy`: every deployment must supply its own,
 * reviewed against its own credentialing policy. Reuses the same two
 * role names every other domain's `EXAMPLE_*ApprovalPolicy` does —
 * a real ED would likely define a distinct triage-nurse role for
 * `TriagePatient` specifically, which is exactly the kind of
 * institution-specific detail this file deliberately doesn't guess at.
 */
export const EXAMPLE_emergencyApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['physician', 'charge-nurse'],
  'approval-required': ['physician'],
};
