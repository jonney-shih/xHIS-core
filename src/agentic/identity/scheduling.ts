import type { ApprovalPolicy } from './approvalPolicy.js';

/**
 * Documentation, not a default — same `EXAMPLE_` discipline as every
 * other domain's `EXAMPLE_*ApprovalPolicy`. `'scheduling-coordinator'`
 * and `'or-director'` are both new — no other domain's policy uses
 * either. Unlike every prior domain (where the higher tier's role list
 * is a strict *subset* of the lower tier's — `physician` alone out of
 * `[physician, lab-technologist]`, `finance-controller` alone out of
 * `[billing-clerk, finance-controller]`), scheduling's two tiers use
 * fully *disjoint* role lists: `'or-director'` never appears at
 * `'review-required'`, and `'scheduling-coordinator'` never appears at
 * `'approval-required'`. This is deliberate — it tests whether
 * `resolveApprovalForProposal` assumes any hierarchy relationship
 * between tiers (a senior role always also covering the junior one) or
 * genuinely just looks up each tier's own independent list. It does the
 * latter: nothing in `resolveApproval`'s implementation ever compares
 * across tiers.
 */
export const EXAMPLE_schedulingApprovalPolicy: ApprovalPolicy = {
  auto: [],
  'review-required': ['scheduling-coordinator'],
  'approval-required': ['or-director'],
};
