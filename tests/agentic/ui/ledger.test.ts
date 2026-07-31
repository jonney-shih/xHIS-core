import { describe, expect, it } from 'vitest';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/ledger.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { accountId, entryId, isoTimestamp } from '../../../src/instructions/ledger/ids.js';
import type { LedgerInstruction } from '../../../src/instructions/ledger/types.js';
import type { VerifyDecision } from '../../../src/agentic/verification/verifier.js';

function needsApproval(reasons: readonly string[]): Extract<VerifyDecision, { kind: 'needs-human-approval' }> {
  return { kind: 'needs-human-approval', reasons };
}

describe('deriveApprovalConfirmationPanel (ledger)', () => {
  it('summarizes a single PostEntry instruction and carries the risk reasons and provenance through unchanged', () => {
    const proposal: PlanProposal<LedgerInstruction> = {
      instructions: [
        {
          kind: 'PostEntry',
          entryId: entryId('entry-1'),
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 500 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
          ],
          memo: 'invoice #1',
          postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
      ],
      rationale: 'posted per invoice #1',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(["sequence contains an instruction at risk tier 'review-required'"]));

    expect(panel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        entryIds: ['entry-1'],
        instructionSummary: ['PostEntry — entry-1 / 2 line(s)'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
    });
  });

  it('summarizes ReverseEntry distinctly from PostEntry, and de-duplicates a repeated entryId without merging distinct ones', () => {
    const proposal: PlanProposal<LedgerInstruction> = {
      instructions: [
        {
          kind: 'PostEntry',
          entryId: entryId('entry-1'),
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 500 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
          ],
          memo: 'invoice #1',
          postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
        { kind: 'ReverseEntry', entryId: entryId('entry-1'), reversedAt: isoTimestamp('2026-08-01T01:00:00.000Z') },
        {
          kind: 'PostEntry',
          entryId: entryId('entry-2'),
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 200 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 200 },
          ],
          memo: 'invoice #2',
          postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
      ],
      rationale: 'end-of-day batch',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(['proposal contains 3 instructions, exceeding the auto-reviewable limit of 2']));

    expect(panel.props.entryIds).toEqual(['entry-1', 'entry-2']); // deduplicated, not tripled
    expect(panel.props.instructionSummary).toEqual([
      'PostEntry — entry-1 / 2 line(s)',
      'ReverseEntry — entry-1',
      'PostEntry — entry-2 / 2 line(s)',
    ]);
  });

  it('never invents risk reasons — an empty reasons list stays empty, not a fabricated placeholder', () => {
    const proposal: PlanProposal<LedgerInstruction> = {
      instructions: [{ kind: 'ReverseEntry', entryId: entryId('entry-1'), reversedAt: isoTimestamp('2026-08-01T00:00:00.000Z') }],
      rationale: 'test',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval([]));

    expect(panel.props.riskReasons).toEqual([]);
  });
});
