import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { ledgerVerifier } from '../../../src/agentic/verification/ledger.js';
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
