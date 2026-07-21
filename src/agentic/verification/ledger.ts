import type { LedgerInstruction } from '../../instructions/ledger/types.js';
import { ledgerRiskTiers } from '../risk/ledger.js';
import { createMaxBatchSizeVerifier } from './batchSizeRule.js';
import { combineVerifiers } from './combineVerifiers.js';
import { createRationalePiiScanVerifier } from './pdpaRules.js';
import { createRiskTierVerifier } from './riskTierVerifier.js';

/**
 * Chosen as a reasonable starting point for one proposal, not derived from
 * any specific regulation — same reasoning as `PATIENT_MAX_BATCH_SIZE`,
 * `LAB_MAX_BATCH_SIZE`, and `BED_MAX_BATCH_SIZE`.
 */
export const LEDGER_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the ledger domain — mirrors `patientVerifier`/
 * `labVerifier`/`bedVerifier` exactly: PDPA rationale scan, batch-size
 * sanity, then risk tier. Fourth real caller of the domain-agnostic
 * factories.
 */
export const ledgerVerifier = combineVerifiers<LedgerInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(LEDGER_MAX_BATCH_SIZE),
  createRiskTierVerifier(ledgerRiskTiers),
);
