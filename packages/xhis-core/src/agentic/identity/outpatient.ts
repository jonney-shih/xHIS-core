import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — see `identity/patient.ts`'s own doc
 * comment for why this is named `EXAMPLE_` rather than
 * `outpatientApprovalPolicy`: every deployment must supply its own,
 * reviewed against its own credentialing policy.
 *
 * Bare `'physician'`, not a narrower subspecialty-style role like
 * `identity/imaging.ts`'s `'radiologist'` or `identity/inpatient.ts`'s
 * `'attending-physician'`: an outpatient visit's `FinalizeSoapNote`/
 * `CompleteEncounter` are closed out by the same treating physician who
 * saw the patient in clinic — there is no distinct real-world role to
 * narrow to the way a ward stay has an attending-of-record distinct
 * from whoever's merely reviewing, or imaging has a radiologist
 * distinct from the ordering physician. `'charge-nurse'` joins at
 * `'review-required'` for the same administrative reason
 * `identity/patient.ts` already gives it that role.
 */
export const EXAMPLE_outpatientApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['physician', 'charge-nurse'],
  'approval-required': ['physician'],
};
