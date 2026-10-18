import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — see `identity/patient.ts`'s own doc
 * comment for why this is named `EXAMPLE_` rather than
 * `emergencyApprovalPolicy`: every deployment must supply its own,
 * reviewed against its own credentialing policy.
 *
 * `'emergency-physician'`, not bare `'physician'`: `TriagePatient`/
 * `DispositionPatient` are specifically the ED attending's call, the
 * same "narrower than 'any physician'" reasoning `identity/imaging.ts`'s
 * `'radiologist'` already applies. `'triage-nurse'` joins at
 * `'review-required'` because real triage assessment is a nursing
 * function in practice — the specially-trained nurse who actually
 * performs it reviews at that tier, while sign-off on the committed
 * ESI determination and on disposition both narrow to the physician
 * alone at `'approval-required'`, the same "narrower set at the
 * higher tier" shape every other domain's policy already has.
 */
export const EXAMPLE_emergencyApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['emergency-physician', 'triage-nurse'],
  'approval-required': ['emergency-physician'],
};
