import type { OutpatientInstruction } from '../../instructions/outpatient/types.js';
import { outpatientRiskTiers } from '../risk/outpatient.js';
import { verifierAsWorker, workerId } from './verificationWorker.js';
import { createMaxBatchSizeVerifier } from './batchSizeRule.js';
import { combineVerifiers } from './combineVerifiers.js';
import { createRationalePiiScanVerifier } from './pdpaRules.js';
import { createRiskTierVerifier } from './riskTierVerifier.js';

/**
 * Chosen as a reasonable starting point for one proposal, not derived from
 * any specific regulation — tune to real operational needs once there's
 * usage to observe. Same value every other domain starts at.
 */
export const OUTPATIENT_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the outpatient domain: PDPA rationale scan (rejects
 * outright — see `pdpaRules.ts`), batch-size sanity, then risk tier — see
 * docs/AGENTIC_LAYER.md's PDCA table. Order doesn't change the outcome
 * (`combineVerifiers` merges by severity regardless of order).
 */
export const outpatientVerifier = combineVerifiers<OutpatientInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(OUTPATIENT_MAX_BATCH_SIZE),
  createRiskTierVerifier(outpatientRiskTiers),
);

/**
 * The same three verifiers `outpatientVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — for a proposal Checked through
 * `ProposalLog`/`runVerificationWorker`/`runScheduler` instead of one
 * direct `outpatientVerifier.verify(proposal)` call. Deliberately
 * additive, not a replacement, the same relationship `patientVerificationWorkers`
 * has to `patientVerifier`.
 */
export const outpatientVerificationWorkers = [
  verifierAsWorker(workerId('outpatient-pdpa-rationale-scan'), createRationalePiiScanVerifier<OutpatientInstruction>()),
  verifierAsWorker(
    workerId('outpatient-max-batch-size'),
    createMaxBatchSizeVerifier<OutpatientInstruction>(OUTPATIENT_MAX_BATCH_SIZE),
  ),
  verifierAsWorker(workerId('outpatient-risk-tier'), createRiskTierVerifier<OutpatientInstruction>(outpatientRiskTiers)),
];
