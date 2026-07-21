import type { SchedulingInstruction } from '../../instructions/scheduling/types.js';
import { schedulingRiskTiers } from '../risk/scheduling.js';
import { createMaxBatchSizeVerifier } from './batchSizeRule.js';
import { combineVerifiers } from './combineVerifiers.js';
import { createRationalePiiScanVerifier } from './pdpaRules.js';
import { createRiskTierVerifier } from './riskTierVerifier.js';

/**
 * Chosen as a reasonable starting point for one proposal, not derived from
 * any specific regulation — same reasoning as every other domain's
 * `*_MAX_BATCH_SIZE`.
 */
export const SCHEDULING_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the scheduling domain — mirrors `patientVerifier`/
 * `labVerifier`/`bedVerifier`/`ledgerVerifier` exactly: PDPA rationale
 * scan, batch-size sanity, then risk tier. Fifth real caller of the
 * domain-agnostic factories.
 */
export const schedulingVerifier = combineVerifiers<SchedulingInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(SCHEDULING_MAX_BATCH_SIZE),
  createRiskTierVerifier(schedulingRiskTiers),
);
