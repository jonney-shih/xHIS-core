import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { imagingVerificationWorkers, imagingVerifier } from '../../../src/agentic/verification/imaging.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp as verifiedAtTimestamp } from '../../../src/core/temporal.js';
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingInstruction } from '../../../src/instructions/imaging/types.js';

const orderStudy: ImagingInstruction = {
  kind: 'OrderStudy',
  studyId: studyId('study-1'),
  encounterId: encounterId('encounter-1'),
  modality: 'CT',
  orderedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
};

const reportStudy: ImagingInstruction = {
  kind: 'ReportStudy',
  studyId: studyId('study-1'),
  reportText: 'No acute findings.',
  reportedAt: isoTimestamp('2026-07-22T01:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<ImagingInstruction>> = {}): PlanProposal<ImagingInstruction> {
  return {
    instructions: [orderStudy],
    rationale: 'ordered per attending note',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('imagingVerifier', () => {
  it('needs human approval for OrderStudy, via risk tier alone', () => {
    expect(imagingVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for ReportStudy too, at its own (higher) tier', () => {
    expect(imagingVerifier.verify(proposal({ instructions: [reportStudy] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = imagingVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than IMAGING_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(orderStudy);
    const result = imagingVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});

/**
 * The same claim proven for patient, bed, lab, pharmacy, scheduling, and
 * ledger, now for the seventh real domain: folding
 * `imagingVerificationWorkers`' independently recorded verdicts must
 * reach the identical decision `imagingVerifier.verify` reaches inline.
 */
describe('the imaging domain Checked through the verification spine reaches the same decisions imagingVerifier already reaches inline', () => {
  const requiredWorkers = imagingVerificationWorkers.map((worker) => worker.workerId);
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xhis-imaging-verification-spine-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function verifyThroughSpine(imagingProposal: PlanProposal<ImagingInstruction>) {
    const proposalLog = createFileProposalLog<ImagingInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const proposalId = proposalLog.append(imagingProposal);

    for (const worker of imagingVerificationWorkers) {
      await runVerificationWorker(
        worker,
        proposalLog,
        createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
        recordStore,
        verifiedAtTimestamp('2026-08-01T00:01:00.000Z'),
      );
    }

    return resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
  }

  it('needs human approval for OrderStudy at review-required, exactly like imagingVerifier does', async () => {
    const inlineDecision = imagingVerifier.verify(proposal());
    expect(await verifyThroughSpine(proposal())).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('needs human approval for ReportStudy at its own, higher approval-required tier, exactly like imagingVerifier does', async () => {
    const reportProposal = proposal({ instructions: [reportStudy] });
    const inlineDecision = imagingVerifier.verify(reportProposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });

    expect(await verifyThroughSpine(reportProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('rejects a leaked-national-ID rationale exactly like imagingVerifier does, without needing every worker to report', async () => {
    const leakyProposal = proposal({ rationale: 'national ID A123456789 confirms identity' });
    const inlineDecision = imagingVerifier.verify(leakyProposal);
    expect(inlineDecision.kind).toBe('reject');

    expect(await verifyThroughSpine(leakyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('accepts a proposal with nothing to review, exactly like imagingVerifier does', async () => {
    const emptyProposal = proposal({ instructions: [] });
    const inlineDecision = imagingVerifier.verify(emptyProposal);
    expect(inlineDecision).toEqual({ kind: 'accept' });

    expect(await verifyThroughSpine(emptyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });
});
