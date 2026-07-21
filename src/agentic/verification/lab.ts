import type { LabInstruction } from '../../instructions/lab/types.js';
import { labRiskTiers } from '../risk/lab.js';
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
