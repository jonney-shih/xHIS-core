import type { EmergencyInstruction } from '../../instructions/emergency/types.js';
import { emergencyRiskTiers } from '../risk/emergency.js';
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
export const EMERGENCY_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the emergency domain: PDPA rationale scan (rejects
 * outright — see `pdpaRules.ts`), batch-size sanity, then risk tier — see
 * docs/AGENTIC_LAYER.md's PDCA table.
 */
export const emergencyVerifier = combineVerifiers<EmergencyInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(EMERGENCY_MAX_BATCH_SIZE),
  createRiskTierVerifier(emergencyRiskTiers),
);

/**
 * The same three verifiers `emergencyVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — the same relationship `patientVerificationWorkers`
 * has to `patientVerifier`.
 */
export const emergencyVerificationWorkers = [
  verifierAsWorker(workerId('emergency-pdpa-rationale-scan'), createRationalePiiScanVerifier<EmergencyInstruction>()),
  verifierAsWorker(
    workerId('emergency-max-batch-size'),
    createMaxBatchSizeVerifier<EmergencyInstruction>(EMERGENCY_MAX_BATCH_SIZE),
  ),
  verifierAsWorker(workerId('emergency-risk-tier'), createRiskTierVerifier<EmergencyInstruction>(emergencyRiskTiers)),
];
