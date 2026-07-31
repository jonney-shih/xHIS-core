import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCdssLabPlanner } from '../../../src/agentic/planning/cdssLabPlanner.js';
import type { CdssLabContext, LabDischargeSignal } from '../../../src/agentic/planning/cdssLabPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { labInstructionValidators } from '../../../src/agentic/validation/lab.js';
import { labVerificationWorkers, labVerifier } from '../../../src/agentic/verification/lab.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { labRiskTiers } from '../../../src/agentic/risk/lab.js';
import { EXAMPLE_labApprovalPolicy } from '../../../src/agentic/identity/lab.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { labEngine } from '../../../src/instructions/lab/engine.js';
import { encounterId, labOrderId } from '../../../src/instructions/lab/ids.js';
import type { LabContext, LabEffect, LabInstruction } from '../../../src/instructions/lab/types.js';

const contextWithPendingOrder: LabContext = {
  orders: {
    'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
  },
};
const requiredWorkers = labVerificationWorkers.map((worker) => worker.workerId);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-cdss-lab-through-spine-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newSpineFixtures() {
  return {
    proposalLog: createFileProposalLog<LabInstruction>(join(dir, 'proposals.jsonl')),
    recordStore: createFileVerificationRecordStore(join(dir, 'records.jsonl')),
    actedStore: createFileSchedulerActedStore(join(dir, 'acted.jsonl')),
    shell: createInMemoryShell<LabContext, LabInstruction, LabEffect>(),
  };
}

/** Mirrors `verifyWithAllBedWorkers` in the bed-domain CDSS spine test —
 * one independent, durably-cursored worker at a time, not a single
 * combined call. */
async function verifyWithAllLabWorkers(
  proposalLog: ReturnType<typeof createFileProposalLog<LabInstruction>>,
  recordStore: ReturnType<typeof createFileVerificationRecordStore>,
) {
  for (const worker of labVerificationWorkers) {
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
 * The lab-domain counterpart to `cdssBedPlanningThroughVerificationSpineEndToEnd.test.ts`
 * — same claim, now for a CDSS-sourced `CancelLabOrder` proposal: folding
 * `labVerificationWorkers`' independently recorded verdicts via
 * `resolveVerificationState` must reach the identical decision
 * `labVerifier.verify` reaches inline, and `runScheduler` must correctly
 * leave an unapproved proposal awaiting-approval rather than acting on
 * it.
 */
describe('a CDSS-sourced lab proposal, Checked through the verification spine, reaches the same decision labVerifier already reaches inline', () => {
  it('needs human approval for a CDSS-recommended CancelLabOrder exactly like labVerifier does, and the scheduler correctly leaves it awaiting-approval', async () => {
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1') };
    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see `lab/engine.ts`).
    const planResult = await planWithRetries<CdssLabContext, LabInstruction>(
      createCdssLabPlanner(),
      labInstructionValidators,
      { description: 'discharge sweep' },
      { labContext: contextWithPendingOrder, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const inlineDecision = labVerifier.verify(proposal);
    expect(inlineDecision.kind).toBe('needs-human-approval');

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllLabWorkers(proposalLog, recordStore);

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
      engine: labEngine,
      initialContext: contextWithPendingOrder,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });

    // No approval was ever supplied to the scheduler — same as calling
    // act() directly with no `approval`, which is exactly what
    // cdssLabPlanningEndToEnd.test.ts's own unresolved-approval test does.
    expect(results).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(shell.commits).toHaveLength(0);
  });

  it('a human approving afterward still commits, via the exact same mechanism the direct pipeline already uses', async () => {
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1') };
    const planResult = await planWithRetries<CdssLabContext, LabInstruction>(
      createCdssLabPlanner(),
      labInstructionValidators,
      { description: 'discharge sweep' },
      { labContext: contextWithPendingOrder, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllLabWorkers(proposalLog, recordStore);

    const schedulerResults = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: labEngine,
      initialContext: contextWithPendingOrder,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });
    expect(schedulerResults).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(actedStore.hasActed(proposalId)).toBe(true);

    const decision = resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
    if (decision.kind !== 'resolved') throw new Error('expected resolved');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'tech-lin', displayName: 'Tech Lin', roles: ['lab-technologist'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, labRiskTiers, EXAMPLE_labApprovalPolicy, proposal, {
      approverId: 'tech-lin',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const latest = shell.readLatest() ?? contextWithPendingOrder;
    const finalOutcome = act(shell, {
      proposal,
      doOutcome: labEngine.executeSequence(latest, proposal.instructions),
      decision: decision.decision,
      baselineContext: latest,
      reexecute: (ctx) => labEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(finalOutcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.orders['order-1']).toMatchObject({ status: 'cancelled' });
  });
});
