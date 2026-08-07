import type { SchedulingInstruction } from '../../instructions/scheduling/types.js';
import { schedulingRiskTiers } from '../risk/scheduling.js';
import { verifierAsWorker, workerId } from './verificationWorker.js';
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

/**
 * The same three verifiers `schedulingVerifier` above combines inline
 * and synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — the fifth domain (after patient, bed, lab, and
 * pharmacy) routed through `ProposalLog`/`runVerificationWorker`/
 * `runScheduler`. Unlike bed, lab, and pharmacy, scheduling already has
 * a real CDSS-adjacent consumer (`patientToScheduling.ts`'s choreography
 * reaction), but that reaction commits directly through `actHuman()`
 * rather than proposing through this spine, so the spine-equivalence
 * tests still use hand-constructed proposals, the same reasoning
 * `pharmacyVerificationWorkers`' own doc comment gives. What scheduling
 * actually adds here: `schedulingRiskTiers`' two tiers are backed by
 * `EXAMPLE_schedulingApprovalPolicy`'s *disjoint* role lists (see that
 * file's own doc comment), so the spine has to reach the correct one of
 * two tiers whose required roles don't even overlap, not just a
 * "higher" and a "lower" version of the same role set the way lab's and
 * pharmacy's tiers do.
 */
export const schedulingVerificationWorkers = [
  verifierAsWorker(workerId('scheduling-pdpa-rationale-scan'), createRationalePiiScanVerifier<SchedulingInstruction>()),
  verifierAsWorker(workerId('scheduling-max-batch-size'), createMaxBatchSizeVerifier<SchedulingInstruction>(SCHEDULING_MAX_BATCH_SIZE)),
  verifierAsWorker(workerId('scheduling-risk-tier'), createRiskTierVerifier<SchedulingInstruction>(schedulingRiskTiers)),
];
