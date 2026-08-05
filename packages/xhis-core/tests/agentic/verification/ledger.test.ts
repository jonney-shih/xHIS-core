import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { ledgerVerificationWorkers, ledgerVerifier } from '../../../src/agentic/verification/ledger.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp as verifiedAtTimestamp } from '../../../src/core/temporal.js';
import { accountId, entryId, isoTimestamp } from '../../../src/instructions/ledger/ids.js';
import type { LedgerInstruction } from '../../../src/instructions/ledger/types.js';

const postEntry: LedgerInstruction = {
  kind: 'PostEntry',
  entryId: entryId('entry-1'),
  lines: [
    { accountId: accountId('cash'), direction: 'debit', amount: 500 },
    { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
  ],
  memo: 'invoice #1',
  postedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
};

const reverseEntry: LedgerInstruction = {
  kind: 'ReverseEntry',
  entryId: entryId('entry-1'),
  reversedAt: isoTimestamp('2026-07-22T02:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<LedgerInstruction>> = {}): PlanProposal<LedgerInstruction> {
  return {
    instructions: [postEntry],
    rationale: 'posted per invoice #1',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('ledgerVerifier', () => {
  it('needs human approval for PostEntry, via risk tier alone', () => {
    expect(ledgerVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for ReverseEntry too, at its own (higher) tier', () => {
    expect(ledgerVerifier.verify(proposal({ instructions: [reverseEntry] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = ledgerVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than LEDGER_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(postEntry);
    const result = ledgerVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});

/**
 * The same claim proven for patient, bed, lab, pharmacy, and scheduling,
 * now for the sixth real domain: folding `ledgerVerificationWorkers`'
 * independently recorded verdicts must reach the identical decision
 * `ledgerVerifier.verify` reaches inline.
 */
describe('the ledger domain Checked through the verification spine reaches the same decisions ledgerVerifier already reaches inline', () => {
  const requiredWorkers = ledgerVerificationWorkers.map((worker) => worker.workerId);
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xhis-ledger-verification-spine-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function verifyThroughSpine(ledgerProposal: PlanProposal<LedgerInstruction>) {
    const proposalLog = createFileProposalLog<LedgerInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const proposalId = proposalLog.append(ledgerProposal);

    for (const worker of ledgerVerificationWorkers) {
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

  it('needs human approval for PostEntry at review-required, exactly like ledgerVerifier does', async () => {
    const inlineDecision = ledgerVerifier.verify(proposal());
    expect(await verifyThroughSpine(proposal())).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('needs human approval for ReverseEntry at its own, higher approval-required tier, exactly like ledgerVerifier does', async () => {
    const reverseProposal = proposal({ instructions: [reverseEntry] });
    const inlineDecision = ledgerVerifier.verify(reverseProposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });

    expect(await verifyThroughSpine(reverseProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('rejects a leaked-national-ID rationale exactly like ledgerVerifier does, without needing every worker to report', async () => {
    const leakyProposal = proposal({ rationale: 'national ID A123456789 confirms identity' });
    const inlineDecision = ledgerVerifier.verify(leakyProposal);
    expect(inlineDecision.kind).toBe('reject');

    expect(await verifyThroughSpine(leakyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('accepts a proposal with nothing to review, exactly like ledgerVerifier does', async () => {
    const emptyProposal = proposal({ instructions: [] });
    const inlineDecision = ledgerVerifier.verify(emptyProposal);
    expect(inlineDecision).toEqual({ kind: 'accept' });

    expect(await verifyThroughSpine(emptyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });
});
