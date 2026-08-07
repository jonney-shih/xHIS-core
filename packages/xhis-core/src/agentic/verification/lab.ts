import type { LabInstruction } from '../../instructions/lab/types.js';
import { labRiskTiers } from '../risk/lab.js';
import { verifierAsWorker, workerId } from './verificationWorker.js';
import { createMaxBatchSizeVerifier } from './batchSizeRule.js';
import { combineVerifiers } from './combineVerifiers.js';
import { createRationalePiiScanVerifier } from './pdpaRules.js';
import { createRiskTierVerifier } from './riskTierVerifier.js';

/**
 * Chosen as a reasonable starting point for one proposal, not derived from
 * any specific regulation — same reasoning as `PATIENT_MAX_BATCH_SIZE`.
 */
export const LAB_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the lab domain — mirrors `patientVerifier`
 * exactly: PDPA rationale scan, batch-size sanity, then risk tier. The
 * factories (`createRationalePiiScanVerifier`, `createMaxBatchSizeVerifier`,
 * `createRiskTierVerifier`) were already domain-agnostic; this is the
 * first time anything other than `patient` has actually exercised that.
 */
export const labVerifier = combineVerifiers<LabInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(LAB_MAX_BATCH_SIZE),
  createRiskTierVerifier(labRiskTiers),
);

/**
 * The same three verifiers `labVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — the third real domain (after patient and bed)
 * routed through `ProposalLog`/`runVerificationWorker`/`runScheduler`.
 * Lab has no CDSS/LLM planner either (same gap `ui/bed.ts` already
 * documents for bed), so its own spine-equivalence tests use
 * hand-constructed proposals, exactly like `labVerifier`'s own tests
 * already do. What lab actually adds that bed didn't: two *different*
 * risk tiers in real use (`review-required` for `OrderLabTest`/
 * `CancelLabOrder`, `approval-required` for `ReportLabResult`), so the
 * spine has to prove it reaches the correct one, not just *a*
 * `needs-human-approval`.
 */
export const labVerificationWorkers = [
  verifierAsWorker(workerId('lab-pdpa-rationale-scan'), createRationalePiiScanVerifier<LabInstruction>()),
  verifierAsWorker(workerId('lab-max-batch-size'), createMaxBatchSizeVerifier<LabInstruction>(LAB_MAX_BATCH_SIZE)),
  verifierAsWorker(workerId('lab-risk-tier'), createRiskTierVerifier<LabInstruction>(labRiskTiers)),
];
