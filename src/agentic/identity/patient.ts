import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default. xHIS-core ships no production-ready
 * `ApprovalPolicy` for any domain — this is intentionally named and
 * exported as an `EXAMPLE_` constant, not `patientApprovalPolicy`, so an
 * import of it reads as a placeholder at the call site, not as something
 * safe to wire up as-is.
 *
 * Role taxonomies and delegation-of-authority rules for clinical orders
 * differ institution to institution (and are usually already documented
 * somewhere at each hospital, tied to 醫療法/醫師法 credentialing rules) —
 * xHIS-core has no way to know what a given deployment's rules actually
 * are, the same reasoning already applied to not picking an LLM vendor or
 * a real persistence backend. Every deployment must supply its own
 * `ApprovalPolicy`, reviewed against its own credentialing policy, before
 * calling `resolveApprovalForProposal`.
 */
export const EXAMPLE_patientApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['physician', 'charge-nurse'],
  'approval-required': ['physician'],
};
