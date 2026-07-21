import type { BedInstruction } from '../../instructions/bed/types.js';
import { bedRiskTiers } from '../risk/bed.js';
import { createMaxBatchSizeVerifier } from './batchSizeRule.js';
import { combineVerifiers } from './combineVerifiers.js';
import { createRationalePiiScanVerifier } from './pdpaRules.js';
import { createRiskTierVerifier } from './riskTierVerifier.js';

/**
 * Chosen as a reasonable starting point for one proposal, not derived from
 * any specific regulation — same reasoning as `PATIENT_MAX_BATCH_SIZE`
 * and `LAB_MAX_BATCH_SIZE`.
 */
export const BED_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the bed domain — mirrors `patientVerifier`/
 * `labVerifier` exactly: PDPA rationale scan, batch-size sanity, then
 * risk tier. Third real caller of the domain-agnostic factories.
 */
export const bedVerifier = combineVerifiers<BedInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(BED_MAX_BATCH_SIZE),
  createRiskTierVerifier(bedRiskTiers),
);
