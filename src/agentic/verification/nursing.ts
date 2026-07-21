import type { NursingInstruction } from '../../instructions/nursing/types.js';
import { nursingRiskTiers } from '../risk/nursing.js';
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
