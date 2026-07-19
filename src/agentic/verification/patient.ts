import type { PatientInstruction } from '../../instructions/patient/types.js';
import { patientRiskTiers } from '../risk/patient.js';
import { createMaxBatchSizeVerifier } from './batchSizeRule.js';
import { combineVerifiers } from './combineVerifiers.js';
import { createRationalePiiScanVerifier } from './pdpaRules.js';
import { createRiskTierVerifier } from './riskTierVerifier.js';

/**
 * Chosen as a reasonable starting point for one proposal, not derived from
 * any specific regulation — tune to real operational needs once there's
 * usage to observe.
 */
export const PATIENT_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the patient domain: PDPA rationale scan (rejects
 * outright — see `pdpaRules.ts`), batch-size sanity, then risk tier — see
 * docs/AGENTIC_LAYER.md's PDCA table. Order doesn't change the outcome
 * (`combineVerifiers` merges by severity regardless of order), but runs the
 * cheap, decisive PDPA check first so an obviously-bad proposal short-circuits
 * conceptually even though every verifier still runs.
 */
export const patientVerifier = combineVerifiers<PatientInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(PATIENT_MAX_BATCH_SIZE),
  createRiskTierVerifier(patientRiskTiers),
);
