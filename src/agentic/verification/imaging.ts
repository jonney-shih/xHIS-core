import type { ImagingInstruction } from '../../instructions/imaging/types.js';
import { imagingRiskTiers } from '../risk/imaging.js';
import { createMaxBatchSizeVerifier } from './batchSizeRule.js';
import { combineVerifiers } from './combineVerifiers.js';
import { createRationalePiiScanVerifier } from './pdpaRules.js';
import { createRiskTierVerifier } from './riskTierVerifier.js';

/**
 * Chosen as a reasonable starting point for one proposal, not derived from
 * any specific regulation — same reasoning as every other domain's
 * `*_MAX_BATCH_SIZE`.
 */
export const IMAGING_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the imaging domain — mirrors every other domain's
 * verifier exactly: PDPA rationale scan, batch-size sanity, then risk
 * tier. Sixth real caller of the domain-agnostic factories.
 */
export const imagingVerifier = combineVerifiers<ImagingInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(IMAGING_MAX_BATCH_SIZE),
  createRiskTierVerifier(imagingRiskTiers),
);
