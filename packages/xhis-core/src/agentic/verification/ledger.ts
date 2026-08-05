import type { LedgerInstruction } from '../../instructions/ledger/types.js';
import { ledgerRiskTiers } from '../risk/ledger.js';
import { verifierAsWorker, workerId } from './verificationWorker.js';
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

/**
 * The same three verifiers `ledgerVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — the sixth domain (after patient, bed, lab,
 * pharmacy, and scheduling) routed through `ProposalLog`/
 * `runVerificationWorker`/`runScheduler`. Ledger has no CDSS/LLM planner
 * either (same gap every non-patient domain's own section documents),
 * so its own spine-equivalence tests use hand-constructed proposals for
 * the identical reason. Ledger's `'review-required'`/`'approval-required'`
 * split is the superset/subset shape (`finance-controller` alone out of
 * `[billing-clerk, finance-controller]`), the same as lab's and
 * pharmacy's, not scheduling's disjoint one — the spine still has to
 * reach the correct tier of the two, not just *a* `needs-human-approval`.
 */
export const ledgerVerificationWorkers = [
  verifierAsWorker(workerId('ledger-pdpa-rationale-scan'), createRationalePiiScanVerifier<LedgerInstruction>()),
  verifierAsWorker(workerId('ledger-max-batch-size'), createMaxBatchSizeVerifier<LedgerInstruction>(LEDGER_MAX_BATCH_SIZE)),
  verifierAsWorker(workerId('ledger-risk-tier'), createRiskTierVerifier<LedgerInstruction>(ledgerRiskTiers)),
];
