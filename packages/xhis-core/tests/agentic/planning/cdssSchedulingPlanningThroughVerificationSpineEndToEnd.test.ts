import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCdssSchedulingPlanner } from '../../../src/agentic/planning/cdssSchedulingPlanner.js';
import type { CdssSchedulingContext, SchedulingDischargeSignal } from '../../../src/agentic/planning/cdssSchedulingPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { schedulingInstructionValidators } from '../../../src/agentic/validation/scheduling.js';
import { schedulingVerificationWorkers, schedulingVerifier } from '../../../src/agentic/verification/scheduling.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { schedulingRiskTiers } from '../../../src/agentic/risk/scheduling.js';
import { EXAMPLE_schedulingApprovalPolicy } from '../../../src/agentic/identity/scheduling.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { encounterId, patientId } from '../../../src/instructions/patient/ids.js';
import { schedulingEngine } from '../../../src/instructions/scheduling/engine.js';
import { bookingId, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingEffect, SchedulingInstruction } from '../../../src/instructions/scheduling/types.js';

const contextWithScheduledBooking: SchedulingContext = {
  bookings: {
    'booking-1': {
      bookingId: bookingId('booking-1'),
      resourceId: resourceId('or-1'),
      subjectId: 'encounter-1',
      startAt: isoTimestamp('2026-08-01T09:00:00.000Z'),
      endAt: isoTimestamp('2026-08-01T10:00:00.000Z'),
      status: 'scheduled',
    },
  },
};
const requiredWorkers = schedulingVerificationWorkers.map((worker) => worker.workerId);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-cdss-scheduling-through-spine-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newSpineFixtures() {
  return {
    proposalLog: createFileProposalLog<SchedulingInstruction>(join(dir, 'proposals.jsonl')),
    recordStore: createFileVerificationRecordStore(join(dir, 'records.jsonl')),
    actedStore: createFileSchedulerActedStore(join(dir, 'acted.jsonl')),
    shell: createInMemoryShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>(),
  };
}

/** Mirrors `verifyWithAllPharmacyWorkers` in the pharmacy-domain CDSS
 * spine test — one independent, durably-cursored worker at a time, not
 * a single combined call. */
async function verifyWithAllSchedulingWorkers(
  proposalLog: ReturnType<typeof createFileProposalLog<SchedulingInstruction>>,
  recordStore: ReturnType<typeof createFileVerificationRecordStore>,
) {
  for (const worker of schedulingVerificationWorkers) {
    await runVerificationWorker(
      worker,
      proposalLog,
      createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
      recordStore,
      isoTimestamp('2026-08-01T11:01:00.000Z'),
    );
  }
}

/**
 * The scheduling-domain counterpart to
 * `cdssPharmacyPlanningThroughVerificationSpineEndToEnd.test.ts` — same
 * claim, now for a CDSS-sourced `CancelBooking` proposal at scheduling's
 * own top `approval-required` tier: folding `schedulingVerificationWorkers`'
 * independently recorded verdicts via `resolveVerificationState` must
 * reach the identical decision `schedulingVerifier.verify` reaches
 * inline, and `runScheduler` must correctly leave an unapproved proposal
 * awaiting-approval rather than acting on it.
 */
describe('a CDSS-sourced scheduling proposal, Checked through the verification spine, reaches the same decision schedulingVerifier already reaches inline', () => {
  it('needs human approval for a CDSS-recommended CancelBooking exactly like schedulingVerifier does, and the scheduler correctly leaves it awaiting-approval', async () => {
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see
    // `scheduling/engine.ts`).
    const planResult = await planWithRetries<CdssSchedulingContext, SchedulingInstruction>(
      createCdssSchedulingPlanner(),
      schedulingInstructionValidators,
      { description: 'discharge sweep' },
      { schedulingContext: contextWithScheduledBooking, signals: [signal] },
      '2026-08-01T11:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const inlineDecision = schedulingVerifier.verify(proposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllSchedulingWorkers(proposalLog, recordStore);

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
      engine: schedulingEngine,
      initialContext: contextWithScheduledBooking,
      recordedAt: '2026-08-01T11:02:00.000Z',
    });

    // No approval was ever supplied to the scheduler — same as calling
    // act() directly with no `approval`, which is exactly what
    // cdssSchedulingPlanningEndToEnd.test.ts's own unresolved-approval
    // test does.
    expect(results).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(shell.commits).toHaveLength(0);
  });

  it('a human approving afterward still commits, via the exact same mechanism the direct pipeline already uses', async () => {
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    const planResult = await planWithRetries<CdssSchedulingContext, SchedulingInstruction>(
      createCdssSchedulingPlanner(),
      schedulingInstructionValidators,
      { description: 'discharge sweep' },
      { schedulingContext: contextWithScheduledBooking, signals: [signal] },
      '2026-08-01T11:00:00.000Z',
      1,
    );
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllSchedulingWorkers(proposalLog, recordStore);

    const schedulerResults = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: schedulingEngine,
      initialContext: contextWithScheduledBooking,
      recordedAt: '2026-08-01T11:02:00.000Z',
    });
    expect(schedulerResults).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(actedStore.hasActed(proposalId)).toBe(true);

    const decision = resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
    if (decision.kind !== 'resolved') throw new Error('expected resolved');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'dir-chen', displayName: 'Chen (OR director)', roles: ['or-director'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, schedulingRiskTiers, EXAMPLE_schedulingApprovalPolicy, proposal, {
      approverId: 'dir-chen',
      approved: true,
      decidedAt: '2026-08-01T11:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const latest = shell.readLatest() ?? contextWithScheduledBooking;
    const finalOutcome = act(shell, {
      proposal,
      doOutcome: schedulingEngine.executeSequence(latest, proposal.instructions),
      decision: decision.decision,
      baselineContext: latest,
      reexecute: (ctx) => schedulingEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T11:05:01.000Z',
    });

    expect(finalOutcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.bookings['booking-1']).toMatchObject({ status: 'cancelled' });
  });
});
