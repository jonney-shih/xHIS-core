import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { labVerificationWorkers, labVerifier } from '../../../src/agentic/verification/lab.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp as verifiedAtTimestamp } from '../../../src/core/temporal.js';
import { encounterId, isoTimestamp, labOrderId } from '../../../src/instructions/lab/ids.js';
import type { LabInstruction } from '../../../src/instructions/lab/types.js';

const orderTest: LabInstruction = {
  kind: 'OrderLabTest',
  orderId: labOrderId('order-1'),
  encounterId: encounterId('encounter-1'),
  testCode: 'CBC',
  orderedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
};

const reportResult: LabInstruction = {
  kind: 'ReportLabResult',
  orderId: labOrderId('order-1'),
  result: 'WBC 7.2',
  resultedAt: isoTimestamp('2026-07-22T01:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<LabInstruction>> = {}): PlanProposal<LabInstruction> {
  return {
    instructions: [orderTest],
    rationale: 'ordered per attending note',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('labVerifier', () => {
  it('needs human approval for OrderLabTest, via risk tier alone', () => {
    expect(labVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for ReportLabResult too, at its own (higher) tier', () => {
    expect(labVerifier.verify(proposal({ instructions: [reportResult] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = labVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than LAB_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(orderTest);
    const result = labVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});

/**
 * The same claim proven for patient and bed, now for the third real
 * domain: folding `labVerificationWorkers`' independently recorded
 * verdicts must reach the identical decision `labVerifier.verify`
 * reaches inline. Lab is the one that actually exercises *two*
 * different `needs-human-approval` reasons (`review-required` for
 * `OrderLabTest`, `approval-required` for `ReportLabResult`) — bed only
 * ever had one, so this is the first time the spine has had to prove it
 * reaches the *correct* tier, not just *a* tier.
 */
describe('the lab domain Checked through the verification spine reaches the same decisions labVerifier already reaches inline', () => {
  const requiredWorkers = labVerificationWorkers.map((worker) => worker.workerId);
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xhis-lab-verification-spine-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function verifyThroughSpine(labProposal: PlanProposal<LabInstruction>) {
    const proposalLog = createFileProposalLog<LabInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const proposalId = proposalLog.append(labProposal);

    for (const worker of labVerificationWorkers) {
      await runVerificationWorker(
        worker,
        proposalLog,
        createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
        recordStore,
        verifiedAtTimestamp('2026-08-02T00:01:00.000Z'),
      );
    }

    return resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
  }

  it('needs human approval for OrderLabTest at review-required, exactly like labVerifier does', async () => {
    const inlineDecision = labVerifier.verify(proposal());
    expect(await verifyThroughSpine(proposal())).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('needs human approval for ReportLabResult at its own, higher approval-required tier, exactly like labVerifier does', async () => {
    const reportProposal = proposal({ instructions: [reportResult] });
    const inlineDecision = labVerifier.verify(reportProposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });

    expect(await verifyThroughSpine(reportProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('rejects a leaked-national-ID rationale exactly like labVerifier does, without needing every worker to report', async () => {
    const leakyProposal = proposal({ rationale: 'national ID A123456789 confirms identity' });
    const inlineDecision = labVerifier.verify(leakyProposal);
    expect(inlineDecision.kind).toBe('reject');

    expect(await verifyThroughSpine(leakyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('accepts a proposal with nothing to review, exactly like labVerifier does', async () => {
    const emptyProposal = proposal({ instructions: [] });
    const inlineDecision = labVerifier.verify(emptyProposal);
    expect(inlineDecision).toEqual({ kind: 'accept' });

    expect(await verifyThroughSpine(emptyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });
});
