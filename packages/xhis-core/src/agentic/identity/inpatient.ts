import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — see `identity/patient.ts`'s own doc
 * comment for why this is named `EXAMPLE_` rather than
 * `inpatientApprovalPolicy`: every deployment must supply its own,
 * reviewed against its own credentialing policy.
 *
 * `'attending-physician'`, not bare `'physician'`: a ward stay's
 * `TransferWard`/`FinalizeProgressNote` are specifically the attending-
 * of-record's call, the same "narrower than 'any physician'" reasoning
 * `identity/imaging.ts`'s `'radiologist'` and `identity/pharmacy.ts`'s
 * `'pharmacist'` already apply — unlike `outpatient`, whose own
 * treating-physician-closes-their-own-visit shape has no narrower
 * real-world role to reach for. `'charge-nurse'` joins at
 * `'review-required'` for the same ward-level operational reason
 * `identity/bed.ts` already gives it that role.
 */
export const EXAMPLE_inpatientApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['attending-physician', 'charge-nurse'],
  'approval-required': ['attending-physician'],
};
