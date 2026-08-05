import type { ImagingInstruction } from '../../instructions/imaging/types.js';
import { imagingRiskTiers } from '../risk/imaging.js';
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

/**
 * The same three verifiers `imagingVerifier` above combines inline and
 * synchronously, each instead wrapped as its own independent
 * `VerificationWorker` — the seventh domain (after patient, bed, lab,
 * pharmacy, scheduling, and ledger) routed through `ProposalLog`/
 * `runVerificationWorker`/`runScheduler`. Imaging has no CDSS/LLM
 * planner either, so its own spine-equivalence tests use
 * hand-constructed proposals, the same reasoning every other non-patient
 * domain's own section already gives. Imaging's four instructions
 * collapse to the same two-tier shape the spine has already had to
 * discriminate (`review-required` for `OrderStudy`/`RecordStudyStored`/
 * `CancelStudy`, `approval-required` for `ReportStudy` alone) —
 * `EXAMPLE_imagingApprovalPolicy`'s roles are what's actually new here
 * (see that file's own doc comment), not the tier count.
 */
export const imagingVerificationWorkers = [
  verifierAsWorker(workerId('imaging-pdpa-rationale-scan'), createRationalePiiScanVerifier<ImagingInstruction>()),
  verifierAsWorker(workerId('imaging-max-batch-size'), createMaxBatchSizeVerifier<ImagingInstruction>(IMAGING_MAX_BATCH_SIZE)),
  verifierAsWorker(workerId('imaging-risk-tier'), createRiskTierVerifier<ImagingInstruction>(imagingRiskTiers)),
];
