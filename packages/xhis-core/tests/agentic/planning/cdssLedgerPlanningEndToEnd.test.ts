import { describe, expect, it } from 'vitest';
import { createCdssLedgerPlanner } from '../../../src/agentic/planning/cdssLedgerPlanner.js';
import type { CdssLedgerContext, LedgerReversalReadySignal } from '../../../src/agentic/planning/cdssLedgerPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { ledgerInstructionValidators } from '../../../src/agentic/validation/ledger.js';
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

const contextWithPostedEntry: LedgerContext = {
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

/**
 * The ledger-domain counterpart to `cdssPharmacyPlanningEndToEnd.test.ts`
 * — same `planWithRetries` -> `toPlanProposal` -> Do -> Check -> approval
 * -> Act pipeline, now driven by `createCdssLedgerPlanner`. Does not
 * repeat the `suggestVitalsEntryPanel`/`resolveUiRenderOutcome` tests
 * for the same reason every prior non-patient CDSS end-to-end file
 * doesn't: no Agent-selected UI component exists for ledger.
 */
describe('CDSS ledger-reversal planning path, end to end', () => {
  it('retrying a deterministic rule against an unchanging bad timestamp produces the identical failure every attempt, unlike an LLM recovering from feedback', async () => {
    // Same reasoning `cdssPharmacyPlanningEndToEnd.test.ts`'s own retry
    // test gives: `signal.entryId` only ever reaches the output after
    // being matched against a real, already-valid `entryId` key in
    // `context.ledgerContext.entries` (see `cdssLedgerPlanner.ts`'s own
    // filter), so an unknown or malformed one is filtered out, not
    // propagated. `proposedAt` is the one input that flows straight into
    // `reversedAt` unvalidated, and `planWithRetries` passes the same
    // one to every attempt.
    const signal: LedgerReversalReadySignal = { entryId: entryId('entry-1') };
    const planner = createCdssLedgerPlanner();

    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see `ledger/engine.ts`).
    const result = await planWithRetries<CdssLedgerContext, LedgerInstruction>(
      planner,
      ledgerInstructionValidators,
      { description: 'reconciliation sweep' },
      { ledgerContext: contextWithPostedEntry, signals: [signal] },
      'not-a-timestamp',
      3,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.attempts).toBe(3);
    expect(result.error.issues).toEqual(["instruction 0: 'reversedAt' must be an ISO-8601 timestamp string"]);
  });

  it('a CDSS-recommended reversal is not exempt from risk-tiered human approval, and a billing-clerk cannot clear it — only a finance-controller can', async () => {
    const signal: LedgerReversalReadySignal = { entryId: entryId('entry-1') };
    const planner = createCdssLedgerPlanner();

    const planResult = await planWithRetries<CdssLedgerContext, LedgerInstruction>(
      planner,
      ledgerInstructionValidators,
      { description: 'reconciliation sweep' },
      { ledgerContext: contextWithPostedEntry, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    // Do — against the real, plain `LedgerContext`, entirely decoupled
    // from `CdssLedgerContext`: Do/Check/Act never know or care that
    // this proposal came from a rule engine rather than a model.
    const doOutcome = ledgerEngine.executeSequence(contextWithPostedEntry, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    // Check — `ReverseEntry` is `approval-required`, ledger's own top
    // tier (see `risk/ledger.ts`), so this must be
    // `needs-human-approval`, never `accept` outright.
    const decision = ledgerVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(proposal, decision);
    telemetryLog.record({
      component: approvalPanel.component,
      outcome: 'rendered',
      reasons: decision.reasons,
      recordedAt: '2026-08-01T01:04:59.000Z',
    });

    expect(approvalPanel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        entryIds: ['entry-1'],
        instructionSummary: ['ReverseEntry — entry-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'approval-required'"],
        modelVersion: 'cdss-ledger-reversal-rule-engine-v1',
        promptVersion: 'ledger-reversal-ruleset-v1',
      },
    });
    expect(telemetryLog.entries).toHaveLength(1);

    // Nested, not disjoint: a billing-clerk is permitted at ledger's
    // lower review-required tier but not this one — the same "one tier
    // too low inside a shared hierarchy" reason a physician fails to
    // approve pharmacy's DispenseMedication, not scheduling's
    // "unrelated role entirely" reason.
    const clerkIdentityProvider = createInMemoryIdentityProvider([
      { id: 'clerk-tan', displayName: 'Tan (billing)', roles: ['billing-clerk'] },
    ]);
    const clerkResolution = resolveApprovalForProposal(clerkIdentityProvider, ledgerRiskTiers, EXAMPLE_ledgerApprovalPolicy, proposal, {
      approverId: 'clerk-tan',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(clerkResolution.kind).toBe('unresolved');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'fc-wu', displayName: 'Wu (finance)', roles: ['finance-controller'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, ledgerRiskTiers, EXAMPLE_ledgerApprovalPolicy, proposal, {
      approverId: 'fc-wu',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<LedgerContext, LedgerInstruction, LedgerEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithPostedEntry,
      reexecute: (ctx) => ledgerEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.entries['entry-1']).toMatchObject({ entryId: 'entry-1', status: 'reversed' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { modelVersion: 'cdss-ledger-reversal-rule-engine-v1', promptVersion: 'ledger-reversal-ruleset-v1' },
      approval: { approverId: 'fc-wu', approverRole: 'finance-controller' },
    });
  });

  it('an unresolved (impersonated) approval leaves a CDSS-recommended reversal awaiting approval, never committed', async () => {
    const signal: LedgerReversalReadySignal = { entryId: entryId('entry-1') };
    const planner = createCdssLedgerPlanner();

    const planResult = await planWithRetries<CdssLedgerContext, LedgerInstruction>(
      planner,
      ledgerInstructionValidators,
      { description: 'reconciliation sweep' },
      { ledgerContext: contextWithPostedEntry, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const doOutcome = ledgerEngine.executeSequence(contextWithPostedEntry, proposal.instructions);
    const decision = ledgerVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'fc-wu', displayName: 'Wu (finance)', roles: ['finance-controller'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, ledgerRiskTiers, EXAMPLE_ledgerApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-fc-wu',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<LedgerContext, LedgerInstruction, LedgerEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithPostedEntry,
      reexecute: (ctx) => ledgerEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
