import type { NursingInstruction } from '../../instructions/nursing/types.js';
import { nursingRiskTiers } from '../risk/nursing.js';
import { verifierAsWorker, workerId } from './verificationWorker.js';
import { createMaxBatchSizeVerifier } from './batchSizeRule.js';
import { combineVerifiers } from './combineVerifiers.js';
import { createRationalePiiScanVerifier } from './pdpaRules.js';
import { createRiskTierVerifier } from './riskTierVerifier.js';

/**
 * Chosen as a reasonable starting point for one proposal, not derived from
 * any specific regulation — same reasoning as every other domain's
 * `*_MAX_BATCH_SIZE`.
 */
export const NURSING_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the nursing domain — mirrors every other domain's
 * verifier exactly: PDPA rationale scan, batch-size sanity, then risk
 * tier. Seventh, and last, real caller of the domain-agnostic factories.
 */
export const nursingVerifier = combineVerifiers<NursingInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(NURSING_MAX_BATCH_SIZE),
  createRiskTierVerifier(nursingRiskTiers),
);

/**
 * The same three verifiers `nursingVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — the eighth, and last, domain routed through
 * `ProposalLog`/`runVerificationWorker`/`runScheduler`, closing the
 * verification-spine wiring gap across every domain in this codebase.
 * Nursing has no CDSS/LLM planner either, so its own spine-equivalence
 * tests use hand-constructed proposals, the same reasoning every other
 * non-patient domain's own section already gives. `GrantRole`'s
 * `'approval-required'` tier carries the highest stakes of any domain's
 * top tier (see `risk/nursing.ts`'s own doc comment: it's what backs
 * every other domain's approval authority), so the spine has to reach
 * that specific tier correctly, not just *a* `needs-human-approval`.
 */
export const nursingVerificationWorkers = [
  verifierAsWorker(workerId('nursing-pdpa-rationale-scan'), createRationalePiiScanVerifier<NursingInstruction>()),
  verifierAsWorker(workerId('nursing-max-batch-size'), createMaxBatchSizeVerifier<NursingInstruction>(NURSING_MAX_BATCH_SIZE)),
  verifierAsWorker(workerId('nursing-risk-tier'), createRiskTierVerifier<NursingInstruction>(nursingRiskTiers)),
];
