import type { PatientInstruction } from '../../instructions/patient/types.js';
import { patientRiskTiers } from '../risk/patient.js';
import { verifierAsWorker, workerId } from './verificationWorker.js';
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

/**
 * The same three verifiers `patientVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — for a proposal Checked through
 * `ProposalLog`/`runVerificationWorker`/`runScheduler` (see
 * `docs/DETERMINISTIC_CORE_PATTERN.md`'s "Proposed: a federated
 * choreography spine for verification" and the slices that followed it)
 * instead of one direct `patientVerifier.verify(proposal)` call.
 * Deliberately additive, not a replacement: `patientVerifier` above is
 * unchanged and still the right choice for a caller that wants Check
 * resolved synchronously, in the same call as Plan and Do — nothing
 * forces migration (see "Resolved: a genuinely async VerificationWorker,
 * proven non-blocking"'s "Nothing forces migration" point, which applies
 * here identically). `resolveVerificationState` folds these three
 * workers' recorded verdicts via the exact same `mergeDecisions`
 * severity rule `combineVerifiers` uses, so a proposal reaches the
 * identical decision either way — see
 * `tests/agentic/planning/cdssPlanningThroughVerificationSpineEndToEnd.test.ts`
 * for the proof, run against the same CDSS-sourced proposals
 * `cdssPlanningEndToEnd.test.ts` already exercises through the direct
 * path.
 */
export const patientVerificationWorkers = [
  verifierAsWorker(workerId('patient-pdpa-rationale-scan'), createRationalePiiScanVerifier<PatientInstruction>()),
  verifierAsWorker(workerId('patient-max-batch-size'), createMaxBatchSizeVerifier<PatientInstruction>(PATIENT_MAX_BATCH_SIZE)),
  verifierAsWorker(workerId('patient-risk-tier'), createRiskTierVerifier<PatientInstruction>(patientRiskTiers)),
];
