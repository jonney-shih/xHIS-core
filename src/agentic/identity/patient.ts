import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Illustrative, not authoritative: these role names are placeholders, not
 * derived from any actual hospital credentialing policy. Whoever operates
 * this system needs to replace them with real role names from their own
 * identity system before relying on this — see docs/AGENTIC_LAYER.md's
 * open questions.
 */
export const patientApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['physician', 'charge-nurse'],
  'approval-required': ['physician'],
};
