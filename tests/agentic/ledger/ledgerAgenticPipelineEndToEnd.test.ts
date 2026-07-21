import { describe, expect, it } from 'vitest';
import { toPlanProposal } from '../../../src/agentic/planning/toPlanProposal.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { ledgerInstructionValidators } from '../../../src/agentic/validation/ledger.js';
import { ledgerVerifier } from '../../../src/agentic/verification/ledger.js';
import { ledgerRiskTiers } from '../../../src/agentic/risk/ledger.js';
import { EXAMPLE_ledgerApprovalPolicy } from '../../../src/agentic/identity/ledger.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { ledgerEngine } from '../../../src/instructions/ledger/engine.js';
import { accountId, entryId, isoTimestamp } from '../../../src/instructions/ledger/ids.js';
import type { LedgerContext, LedgerEffect, LedgerInstruction } from '../../../src/instructions/ledger/types.js';

/**
 * Proves the full Plan -> Do -> Check -> Approve -> Act pipeline
 * genuinely works for ledger, not just that the types compile — the
 * third domain besides `patient` (after `lab`, `bed`) exercised through
 * the whole chain end to end.
 */
describe('ledger agentic pipeline, end to end', () => {
  const emptyLedgerContext: LedgerContext = { accounts: {}, entries: {} };

  it('a raw untrusted PostEntry candidate flows through validation, Do, Check, approval, and Act to a real commit', () => {
    const proposalResult = toPlanProposal<LedgerInstruction>(
      ledgerInstructionValidators,
      {
        instructions: [
          {
            kind: 'PostEntry',
            entryId: 'entry-1',
            lines: [
              { accountId: 'cash', direction: 'debit', amount: 500 },
              { accountId: 'revenue', direction: 'credit', amount: 500 },
            ],
            memo: 'invoice #1',
            postedAt: '2026-07-22T00:00:00.000Z',
          },
        ],
        rationale: 'posted per invoice #1',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-22T00:00:00.000Z',
    );
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    const doOutcome = ledgerEngine.executeSequence(emptyLedgerContext, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = ledgerVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'clerk-tan', displayName: 'Tan (billing)', roles: ['billing-clerk'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, ledgerRiskTiers, EXAMPLE_ledgerApprovalPolicy, proposal, {
      approverId: 'clerk-tan',
      approved: true,
      decidedAt: '2026-07-22T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<LedgerContext, LedgerInstruction, LedgerEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyLedgerContext,
      reexecute: (ctx) => ledgerEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-22T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.entries['entry-1']).toMatchObject({ entryId: 'entry-1', status: 'posted' });
    expect(shell.commits[0]!.context.accounts['cash']).toEqual({ accountId: 'cash', balance: 500 });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      approval: { approverId: 'clerk-tan', approverRole: 'billing-clerk' },
    });
  });

  it('a malformed candidate never becomes a PlanProposal at all', () => {
    const proposalResult = toPlanProposal<LedgerInstruction>(
      ledgerInstructionValidators,
      {
        instructions: [{ kind: 'PostEntry', entryId: '' }],
        rationale: 'malformed',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-22T00:00:00.000Z',
    );

    expect(proposalResult.ok).toBe(false);
  });

  it('a billing-clerk cannot approve ReverseEntry — only finance-controller satisfies its (higher) tier', () => {
    const postedEntryId = entryId('entry-1');
    const reverseEntry: LedgerInstruction = {
      kind: 'ReverseEntry',
      entryId: postedEntryId,
      reversedAt: isoTimestamp('2026-07-22T02:00:00.000Z'),
    };
    const proposal: PlanProposal<LedgerInstruction> = {
      instructions: [reverseEntry],
      rationale: 'reversal per correction request',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-22T02:00:00.000Z',
    };

    const contextWithPostedEntry: LedgerContext = {
      accounts: {
        cash: { accountId: accountId('cash'), balance: 500 },
        revenue: { accountId: accountId('revenue'), balance: -500 },
      },
      entries: {
        'entry-1': {
          entryId: postedEntryId,
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 500 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
          ],
          memo: 'invoice #1',
          status: 'posted',
          postedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
        },
      },
    };

    const doOutcome = ledgerEngine.executeSequence(contextWithPostedEntry, proposal.instructions);
    const decision = ledgerVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'clerk-tan', displayName: 'Tan (billing)', roles: ['billing-clerk'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, ledgerRiskTiers, EXAMPLE_ledgerApprovalPolicy, proposal, {
      approverId: 'clerk-tan',
      approved: true,
      decidedAt: '2026-07-22T02:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<LedgerContext, LedgerInstruction, LedgerEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithPostedEntry,
      reexecute: (ctx) => ledgerEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-07-22T02:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
