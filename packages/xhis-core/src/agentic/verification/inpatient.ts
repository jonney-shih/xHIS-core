import type { InpatientInstruction } from '../../instructions/inpatient/types.js';
import { inpatientRiskTiers } from '../risk/inpatient.js';
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
export const INPATIENT_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the inpatient domain: PDPA rationale scan (rejects
 * outright — see `pdpaRules.ts`), batch-size sanity, then risk tier — see
 * docs/AGENTIC_LAYER.md's PDCA table.
 */
export const inpatientVerifier = combineVerifiers<InpatientInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(INPATIENT_MAX_BATCH_SIZE),
  createRiskTierVerifier(inpatientRiskTiers),
);

/**
 * The same three verifiers `inpatientVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — the same relationship `patientVerificationWorkers`
 * has to `patientVerifier`.
 */
export const inpatientVerificationWorkers = [
  verifierAsWorker(workerId('inpatient-pdpa-rationale-scan'), createRationalePiiScanVerifier<InpatientInstruction>()),
  verifierAsWorker(
    workerId('inpatient-max-batch-size'),
    createMaxBatchSizeVerifier<InpatientInstruction>(INPATIENT_MAX_BATCH_SIZE),
  ),
  verifierAsWorker(workerId('inpatient-risk-tier'), createRiskTierVerifier<InpatientInstruction>(inpatientRiskTiers)),
];
