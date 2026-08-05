import type { PharmacyInstruction } from '../../instructions/pharmacy/types.js';
import { pharmacyRiskTiers } from '../risk/pharmacy.js';
import { verifierAsWorker, workerId } from './verificationWorker.js';
import { createMaxBatchSizeVerifier } from './batchSizeRule.js';
import { combineVerifiers } from './combineVerifiers.js';
import { createRationalePiiScanVerifier } from './pdpaRules.js';
import { createRiskTierVerifier } from './riskTierVerifier.js';

/**
 * Chosen as a reasonable starting point for one proposal, not derived from
 * any specific regulation — same reasoning as `PATIENT_MAX_BATCH_SIZE`
 * and `LAB_MAX_BATCH_SIZE`.
 */
export const PHARMACY_MAX_BATCH_SIZE = 20;

/**
 * Check, assembled for the pharmacy domain — mirrors `labVerifier`
 * exactly: PDPA rationale scan, batch-size sanity, then risk tier.
 */
export const pharmacyVerifier = combineVerifiers<PharmacyInstruction>(
  createRationalePiiScanVerifier(),
  createMaxBatchSizeVerifier(PHARMACY_MAX_BATCH_SIZE),
  createRiskTierVerifier(pharmacyRiskTiers),
);

/**
 * The same three verifiers `pharmacyVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — the fourth real domain (after patient, bed, and
 * lab) routed through `ProposalLog`/`runVerificationWorker`/
 * `runScheduler`. Pharmacy has no CDSS/LLM planner either (same gap
 * `ui/bed.ts` and `ui/lab.ts` already document), so its own
 * spine-equivalence tests use hand-constructed proposals, exactly like
 * `pharmacyVerifier`'s own tests already do. Pharmacy shares lab's
 * genuinely-two-tier shape (`review-required` for `PrescribeMedication`,
 * `approval-required` for `DispenseMedication`), so the spine has to
 * prove it reaches the correct one here too, not just *a*
 * `needs-human-approval`.
 */
export const pharmacyVerificationWorkers = [
  verifierAsWorker(workerId('pharmacy-pdpa-rationale-scan'), createRationalePiiScanVerifier<PharmacyInstruction>()),
  verifierAsWorker(workerId('pharmacy-max-batch-size'), createMaxBatchSizeVerifier<PharmacyInstruction>(PHARMACY_MAX_BATCH_SIZE)),
  verifierAsWorker(workerId('pharmacy-risk-tier'), createRiskTierVerifier<PharmacyInstruction>(pharmacyRiskTiers)),
];
