import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { ledgerVerifier } from '../../../src/agentic/verification/ledger.js';
import { ledgerRiskTiers } from '../../../src/agentic/risk/ledger.js';
import { EXAMPLE_ledgerApprovalPolicy } from '../../../src/agentic/identity/ledger.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/ledger.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { ledgerEngine } from '../../../src/instructions/ledger/engine.js';
import { accountId, entryId, isoTimestamp } from '../../../src/instructions/ledger/ids.js';
import type { LedgerContext, LedgerEffect, LedgerInstruction } from '../../../src/instructions/ledger/types.js';

const emptyLedgerContext: LedgerContext = { accounts: {}, entries: {} };

const postEntry: LedgerInstruction = {
  kind: 'PostEntry',
  entryId: entryId('entry-1'),
  lines: [
    { accountId: accountId('cash'), direction: 'debit', amount: 500 },
    { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
  ],
  memo: 'invoice #1',
  postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
};

const postedContext: LedgerContext = {
  accounts: {
    cash: { accountId: accountId('cash'), balance: 500 },
    revenue: { accountId: accountId('revenue'), balance: -500 },
  },
  entries: {
    'entry-1': {
      entryId: entryId('entry-1'),
      lines: [
        { accountId: accountId('cash'), direction: 'debit', amount: 500 },
        { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
      ],
      memo: 'invoice #1',
      status: 'posted',
      postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
    },
  },
};

const reverseEntry: LedgerInstruction = {
  kind: 'ReverseEntry',
  entryId: entryId('entry-1'),
  reversedAt: isoTimestamp('2026-08-01T02:00:00.000Z'),
};

const postProposal: PlanProposal<LedgerInstruction> = {
  instructions: [postEntry],
  rationale: 'posted per invoice #1',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-08-01T00:00:00.000Z',
};

const reverseProposal: PlanProposal<LedgerInstruction> = {
  instructions: [reverseEntry],
  rationale: 'reversal per correction request',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-08-01T02:00:00.000Z',
};

/**
 * The ledger-domain counterpart to `bedApprovalFlowEndToEnd.test.ts`'s,
 * `labApprovalFlowEndToEnd.test.ts`'s, `pharmacyApprovalFlowEndToEnd.test.ts`'s,
 * and `schedulingApprovalFlowEndToEnd.test.ts`'s real approval flows —
 * same wiring, hand-constructed proposals for the identical reason those
 * files document (no CDSS/LLM planner exists for ledger either).
 * `ledgerAgenticPipelineEndToEnd.test.ts` already proved a billing-clerk
 * cannot approve `ReverseEntry`; this file adds the half that test
 * couldn't show on its own — a `finance-controller` *succeeding* at
 * exactly the tier a billing-clerk fails, plus the UI panel derivation
 * and telemetry recording every other domain's own approval-flow test
 * already exercises.
 */
describe('ledger domain approval flow, end to end', () => {
  it('a billing-clerk may approve a PostEntry (review-required), and it commits', () => {
    const doOutcome = ledgerEngine.executeSequence(emptyLedgerContext, postProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = ledgerVerifier.verify(postProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(postProposal, decision);
    telemetryLog.record({ component: approvalPanel.component, outcome: 'rendered', reasons: decision.reasons, recordedAt: '2026-08-01T00:04:59.000Z' });
    expect(approvalPanel.props.entryIds).toEqual(['entry-1']);

    const identityProvider = createInMemoryIdentityProvider([{ id: 'clerk-tan', displayName: 'Tan (billing)', roles: ['billing-clerk'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, ledgerRiskTiers, EXAMPLE_ledgerApprovalPolicy, postProposal, {
      approverId: 'clerk-tan',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<LedgerContext, LedgerInstruction, LedgerEffect>();
    const outcome = act(shell, {
      proposal: postProposal,
      doOutcome,
      decision,
      baselineContext: emptyLedgerContext,
      reexecute: (ctx) => ledgerEngine.executeSequence(ctx, postProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed', approval: { approverId: 'clerk-tan', approverRole: 'billing-clerk' } });
  });

  it('the same billing-clerk may NOT approve a ReverseEntry (approval-required) — finance-controller-only, and nothing commits', () => {
    const doOutcome = ledgerEngine.executeSequence(postedContext, reverseProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = ledgerVerifier.verify(reverseProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'clerk-tan', displayName: 'Tan (billing)', roles: ['billing-clerk'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, ledgerRiskTiers, EXAMPLE_ledgerApprovalPolicy, reverseProposal, {
      approverId: 'clerk-tan',
      approved: true,
      decidedAt: '2026-08-01T02:05:00.000Z',
    });
    // Not impersonation this time -- a real, resolvable identity, just
    // one that doesn't hold a sufficient role for *this* tier.
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<LedgerContext, LedgerInstruction, LedgerEffect>();
    const outcome = act(shell, {
      proposal: reverseProposal,
      doOutcome,
      decision,
      baselineContext: postedContext,
      reexecute: (ctx) => ledgerEngine.executeSequence(ctx, reverseProposal.instructions),
      recordedAt: '2026-08-01T02:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });

  it('a finance-controller may approve the same ReverseEntry a billing-clerk could not, and it commits', () => {
    const doOutcome = ledgerEngine.executeSequence(postedContext, reverseProposal.instructions);
    const decision = ledgerVerifier.verify(reverseProposal);
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'fc-wu', displayName: 'Wu (finance)', roles: ['finance-controller'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, ledgerRiskTiers, EXAMPLE_ledgerApprovalPolicy, reverseProposal, {
      approverId: 'fc-wu',
      approved: true,
      decidedAt: '2026-08-01T02:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<LedgerContext, LedgerInstruction, LedgerEffect>();
    const outcome = act(shell, {
      proposal: reverseProposal,
      doOutcome,
      decision,
      baselineContext: postedContext,
      reexecute: (ctx) => ledgerEngine.executeSequence(ctx, reverseProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T02:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
  });
});
