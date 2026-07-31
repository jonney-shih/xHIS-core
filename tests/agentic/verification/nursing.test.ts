import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { nursingVerificationWorkers, nursingVerifier } from '../../../src/agentic/verification/nursing.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp as verifiedAtTimestamp } from '../../../src/core/temporal.js';
import { credentialId, isoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingInstruction } from '../../../src/instructions/nursing/types.js';

const issueCredential: NursingInstruction = {
  kind: 'IssueCredential',
  credentialId: credentialId('cred-1'),
  staffId: staffId('dr-lin'),
  credentialType: 'MD-License',
  issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
  expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z'),
};

const grantRole: NursingInstruction = {
  kind: 'GrantRole',
  grantId: roleGrantId('grant-1'),
  staffId: staffId('dr-lin'),
  role: 'physician',
  credentialId: credentialId('cred-1'),
  grantedAt: isoTimestamp('2026-02-01T00:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<NursingInstruction>> = {}): PlanProposal<NursingInstruction> {
  return {
    instructions: [issueCredential],
    rationale: 'issued per credentialing office record',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('nursingVerifier', () => {
  it('needs human approval for IssueCredential, via risk tier alone', () => {
    expect(nursingVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for GrantRole too, at its own (higher) tier', () => {
    expect(nursingVerifier.verify(proposal({ instructions: [grantRole] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = nursingVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than NURSING_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(issueCredential);
    const result = nursingVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});

/**
 * The same claim proven for patient, bed, lab, pharmacy, scheduling,
 * ledger, and imaging, now for the eighth and last real domain: folding
 * `nursingVerificationWorkers`' independently recorded verdicts must
 * reach the identical decision `nursingVerifier.verify` reaches inline.
 */
describe('the nursing domain Checked through the verification spine reaches the same decisions nursingVerifier already reaches inline', () => {
  const requiredWorkers = nursingVerificationWorkers.map((worker) => worker.workerId);
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xhis-nursing-verification-spine-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function verifyThroughSpine(nursingProposal: PlanProposal<NursingInstruction>) {
    const proposalLog = createFileProposalLog<NursingInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const proposalId = proposalLog.append(nursingProposal);

    for (const worker of nursingVerificationWorkers) {
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

  it('needs human approval for IssueCredential at review-required, exactly like nursingVerifier does', async () => {
    const inlineDecision = nursingVerifier.verify(proposal());
    expect(await verifyThroughSpine(proposal())).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('needs human approval for GrantRole at its own, higher approval-required tier, exactly like nursingVerifier does', async () => {
    const grantProposal = proposal({ instructions: [grantRole] });
    const inlineDecision = nursingVerifier.verify(grantProposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });

    expect(await verifyThroughSpine(grantProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('rejects a leaked-national-ID rationale exactly like nursingVerifier does, without needing every worker to report', async () => {
    const leakyProposal = proposal({ rationale: 'national ID A123456789 confirms identity' });
    const inlineDecision = nursingVerifier.verify(leakyProposal);
    expect(inlineDecision.kind).toBe('reject');

    expect(await verifyThroughSpine(leakyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('accepts a proposal with nothing to review, exactly like nursingVerifier does', async () => {
    const emptyProposal = proposal({ instructions: [] });
    const inlineDecision = nursingVerifier.verify(emptyProposal);
    expect(inlineDecision).toEqual({ kind: 'accept' });

    expect(await verifyThroughSpine(emptyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });
});
