import type { BedInstruction } from '../../instructions/bed/types.js';
import { bedRiskTiers } from '../risk/bed.js';
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

/**
 * The same three verifiers `bedVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — the second real domain (after patient) routed
 * through `ProposalLog`/`runVerificationWorker`/`runScheduler` instead
 * of one direct `bedVerifier.verify(proposal)` call. See
 * `src/agentic/ui/bed.ts`'s own doc comment for the one genuine
 * difference from patient's wiring this domain surfaced: there is no
 * CDSS/LLM planner proposing `BedInstruction`s today, so proving
 * equivalence here uses hand-built proposals directly, the same way
 * `tests/agentic/verification/bed.test.ts` already does for
 * `bedVerifier` itself — not a gap in this slice, a reflection of what
 * actually exists.
 */
export const bedVerificationWorkers = [
  verifierAsWorker(workerId('bed-pdpa-rationale-scan'), createRationalePiiScanVerifier<BedInstruction>()),
  verifierAsWorker(workerId('bed-max-batch-size'), createMaxBatchSizeVerifier<BedInstruction>(BED_MAX_BATCH_SIZE)),
  verifierAsWorker(workerId('bed-risk-tier'), createRiskTierVerifier<BedInstruction>(bedRiskTiers)),
];
