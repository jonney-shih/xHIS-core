import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCdssImagingPlanner } from '../../../src/agentic/planning/cdssImagingPlanner.js';
import type { CdssImagingContext, ImagingDischargeSignal } from '../../../src/agentic/planning/cdssImagingPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { imagingInstructionValidators } from '../../../src/agentic/validation/imaging.js';
import { imagingVerificationWorkers, imagingVerifier } from '../../../src/agentic/verification/imaging.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { imagingRiskTiers } from '../../../src/agentic/risk/imaging.js';
import { EXAMPLE_imagingApprovalPolicy } from '../../../src/agentic/identity/imaging.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { imagingEngine } from '../../../src/instructions/imaging/engine.js';
import { encounterId, studyId } from '../../../src/instructions/imaging/ids.js';
import type { ImagingContext, ImagingEffect, ImagingInstruction } from '../../../src/instructions/imaging/types.js';

const contextWithOrderedStudy: ImagingContext = {
  studies: {
    'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
  },
};
const requiredWorkers = imagingVerificationWorkers.map((worker) => worker.workerId);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-cdss-imaging-through-spine-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newSpineFixtures() {
  return {
    proposalLog: createFileProposalLog<ImagingInstruction>(join(dir, 'proposals.jsonl')),
    recordStore: createFileVerificationRecordStore(join(dir, 'records.jsonl')),
    actedStore: createFileSchedulerActedStore(join(dir, 'acted.jsonl')),
    shell: createInMemoryShell<ImagingContext, ImagingInstruction, ImagingEffect>(),
  };
}

/** Mirrors `verifyWithAllLedgerWorkers` in the ledger-domain CDSS spine
 * test — one independent, durably-cursored worker at a time, not a
 * single combined call. */
async function verifyWithAllImagingWorkers(
  proposalLog: ReturnType<typeof createFileProposalLog<ImagingInstruction>>,
  recordStore: ReturnType<typeof createFileVerificationRecordStore>,
) {
  for (const worker of imagingVerificationWorkers) {
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
 * The imaging-domain counterpart to
 * `cdssLabPlanningThroughVerificationSpineEndToEnd.test.ts` — same
 * claim, now for a CDSS-sourced `CancelStudy` proposal: folding
 * `imagingVerificationWorkers`' independently recorded verdicts via
 * `resolveVerificationState` must reach the identical decision
 * `imagingVerifier.verify` reaches inline, and `runScheduler` must
 * correctly leave an unapproved proposal awaiting-approval rather than
 * acting on it.
 */
describe('a CDSS-sourced imaging proposal, Checked through the verification spine, reaches the same decision imagingVerifier already reaches inline', () => {
  it('needs human approval for a CDSS-recommended CancelStudy exactly like imagingVerifier does, and the scheduler correctly leaves it awaiting-approval', async () => {
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1') };
    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see
    // `imaging/engine.ts`).
    const planResult = await planWithRetries<CdssImagingContext, ImagingInstruction>(
      createCdssImagingPlanner(),
      imagingInstructionValidators,
      { description: 'discharge sweep' },
      { imagingContext: contextWithOrderedStudy, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const inlineDecision = imagingVerifier.verify(proposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllImagingWorkers(proposalLog, recordStore);

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
      engine: imagingEngine,
      initialContext: contextWithOrderedStudy,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });

    // No approval was ever supplied to the scheduler — same as calling
    // act() directly with no `approval`, which is exactly what
    // cdssImagingPlanningEndToEnd.test.ts's own unresolved-approval test
    // does.
    expect(results).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(shell.commits).toHaveLength(0);
  });

  it('a human approving afterward still commits, via the exact same mechanism the direct pipeline already uses', async () => {
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1') };
    const planResult = await planWithRetries<CdssImagingContext, ImagingInstruction>(
      createCdssImagingPlanner(),
      imagingInstructionValidators,
      { description: 'discharge sweep' },
      { imagingContext: contextWithOrderedStudy, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllImagingWorkers(proposalLog, recordStore);

    const schedulerResults = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: imagingEngine,
      initialContext: contextWithOrderedStudy,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });
    expect(schedulerResults).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(actedStore.hasActed(proposalId)).toBe(true);

    const decision = resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
    if (decision.kind !== 'resolved') throw new Error('expected resolved');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'tech-huang', displayName: 'Huang (radiologic technologist)', roles: ['radiologic-technologist'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, imagingRiskTiers, EXAMPLE_imagingApprovalPolicy, proposal, {
      approverId: 'tech-huang',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const latest = shell.readLatest() ?? contextWithOrderedStudy;
    const finalOutcome = act(shell, {
      proposal,
      doOutcome: imagingEngine.executeSequence(latest, proposal.instructions),
      decision: decision.decision,
      baselineContext: latest,
      reexecute: (ctx) => imagingEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(finalOutcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.studies['study-1']).toMatchObject({ status: 'cancelled' });
  });
});
