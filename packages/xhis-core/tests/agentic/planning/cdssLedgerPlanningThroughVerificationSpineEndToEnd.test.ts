import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCdssLedgerPlanner } from '../../../src/agentic/planning/cdssLedgerPlanner.js';
import type { CdssLedgerContext, LedgerReversalReadySignal } from '../../../src/agentic/planning/cdssLedgerPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { ledgerInstructionValidators } from '../../../src/agentic/validation/ledger.js';
import { ledgerVerificationWorkers, ledgerVerifier } from '../../../src/agentic/verification/ledger.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { ledgerRiskTiers } from '../../../src/agentic/risk/ledger.js';
import { EXAMPLE_ledgerApprovalPolicy } from '../../../src/agentic/identity/ledger.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { ledgerEngine } from '../../../src/instructions/ledger/engine.js';
import { accountId, entryId } from '../../../src/instructions/ledger/ids.js';
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
const requiredWorkers = ledgerVerificationWorkers.map((worker) => worker.workerId);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-cdss-ledger-through-spine-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newSpineFixtures() {
  return {
    proposalLog: createFileProposalLog<LedgerInstruction>(join(dir, 'proposals.jsonl')),
    recordStore: createFileVerificationRecordStore(join(dir, 'records.jsonl')),
    actedStore: createFileSchedulerActedStore(join(dir, 'acted.jsonl')),
    shell: createInMemoryShell<LedgerContext, LedgerInstruction, LedgerEffect>(),
  };
}

/** Mirrors `verifyWithAllPharmacyWorkers` in the pharmacy-domain CDSS
 * spine test — one independent, durably-cursored worker at a time, not
 * a single combined call. */
async function verifyWithAllLedgerWorkers(
  proposalLog: ReturnType<typeof createFileProposalLog<LedgerInstruction>>,
  recordStore: ReturnType<typeof createFileVerificationRecordStore>,
) {
  for (const worker of ledgerVerificationWorkers) {
    await runVerificationWorker(
      worker,
      proposalLog,
      createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
      recordStore,
      isoTimestamp('2026-08-01T01:01:00.000Z'),
    );
  }
}

/**
 * The ledger-domain counterpart to
 * `cdssPharmacyPlanningThroughVerificationSpineEndToEnd.test.ts` — same
 * claim, now for a CDSS-sourced `ReverseEntry` proposal at ledger's own
 * top `approval-required` tier: folding `ledgerVerificationWorkers`'
 * independently recorded verdicts via `resolveVerificationState` must
 * reach the identical decision `ledgerVerifier.verify` reaches inline,
 * and `runScheduler` must correctly leave an unapproved proposal
 * awaiting-approval rather than acting on it.
 */
describe('a CDSS-sourced ledger proposal, Checked through the verification spine, reaches the same decision ledgerVerifier already reaches inline', () => {
  it('needs human approval for a CDSS-recommended ReverseEntry exactly like ledgerVerifier does, and the scheduler correctly leaves it awaiting-approval', async () => {
    const signal: LedgerReversalReadySignal = { entryId: entryId('entry-1') };
    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see `ledger/engine.ts`).
    const planResult = await planWithRetries<CdssLedgerContext, LedgerInstruction>(
      createCdssLedgerPlanner(),
      ledgerInstructionValidators,
      { description: 'reconciliation sweep' },
      { ledgerContext: contextWithPostedEntry, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const inlineDecision = ledgerVerifier.verify(proposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllLedgerWorkers(proposalLog, recordStore);

    expect(resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers)).toEqual({
      kind: 'resolved',
      decision: inlineDecision,
    });

    const results = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: ledgerEngine,
      initialContext: contextWithPostedEntry,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });

    // No approval was ever supplied to the scheduler — same as calling
    // act() directly with no `approval`, which is exactly what
    // cdssLedgerPlanningEndToEnd.test.ts's own unresolved-approval test
    // does.
    expect(results).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(shell.commits).toHaveLength(0);
  });

  it('a human approving afterward still commits, via the exact same mechanism the direct pipeline already uses', async () => {
    const signal: LedgerReversalReadySignal = { entryId: entryId('entry-1') };
    const planResult = await planWithRetries<CdssLedgerContext, LedgerInstruction>(
      createCdssLedgerPlanner(),
      ledgerInstructionValidators,
      { description: 'reconciliation sweep' },
      { ledgerContext: contextWithPostedEntry, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllLedgerWorkers(proposalLog, recordStore);

    const schedulerResults = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: ledgerEngine,
      initialContext: contextWithPostedEntry,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });
    expect(schedulerResults).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(actedStore.hasActed(proposalId)).toBe(true);

    const decision = resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
    if (decision.kind !== 'resolved') throw new Error('expected resolved');

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

    const latest = shell.readLatest() ?? contextWithPostedEntry;
    const finalOutcome = act(shell, {
      proposal,
      doOutcome: ledgerEngine.executeSequence(latest, proposal.instructions),
      decision: decision.decision,
      baselineContext: latest,
      reexecute: (ctx) => ledgerEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(finalOutcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.entries['entry-1']).toMatchObject({ status: 'reversed' });
  });
});
