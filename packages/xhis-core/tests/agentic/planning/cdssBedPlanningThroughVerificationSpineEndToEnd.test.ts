import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCdssBedPlanner } from '../../../src/agentic/planning/cdssBedPlanner.js';
import type { BedNeedSignal, CdssBedContext } from '../../../src/agentic/planning/cdssBedPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { bedInstructionValidators } from '../../../src/agentic/validation/bed.js';
import { bedVerificationWorkers, bedVerifier } from '../../../src/agentic/verification/bed.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { bedRiskTiers } from '../../../src/agentic/risk/bed.js';
import { EXAMPLE_bedApprovalPolicy } from '../../../src/agentic/identity/bed.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { EXAMPLE_firstAvailableBedStrategy } from '../../../src/integration/bedSelection.js';
import { bedEngine } from '../../../src/instructions/bed/engine.js';
import { bedId, encounterId } from '../../../src/instructions/bed/ids.js';
import { patientId } from '../../../src/instructions/patient/ids.js';
import type { BedContext, BedEffect, BedInstruction } from '../../../src/instructions/bed/types.js';

const contextWithAvailableBed: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };
const strategy = EXAMPLE_firstAvailableBedStrategy;
const requiredWorkers = bedVerificationWorkers.map((worker) => worker.workerId);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-cdss-bed-through-spine-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newSpineFixtures() {
  return {
    proposalLog: createFileProposalLog<BedInstruction>(join(dir, 'proposals.jsonl')),
    recordStore: createFileVerificationRecordStore(join(dir, 'records.jsonl')),
    actedStore: createFileSchedulerActedStore(join(dir, 'acted.jsonl')),
    shell: createInMemoryShell<BedContext, BedInstruction, BedEffect>(),
  };
}

/** Mirrors `verifyWithAllPatientWorkers` in the patient-domain spine test
 * — one independent, durably-cursored worker at a time, not a single
 * combined call. */
async function verifyWithAllBedWorkers(
  proposalLog: ReturnType<typeof createFileProposalLog<BedInstruction>>,
  recordStore: ReturnType<typeof createFileVerificationRecordStore>,
) {
  for (const worker of bedVerificationWorkers) {
    await runVerificationWorker(
      worker,
      proposalLog,
      createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
      recordStore,
      isoTimestamp('2026-08-01T00:01:00.000Z'),
    );
  }
}

/**
 * The bed-domain counterpart to `cdssPlanningThroughVerificationSpineEndToEnd.test.ts`
 * — same claim, now for a CDSS-sourced `AssignBed` proposal instead of an
 * LLM- or hand-constructed one: folding `bedVerificationWorkers`'
 * independently recorded verdicts via `resolveVerificationState` must
 * reach the identical decision `bedVerifier.verify` reaches inline, and
 * `runScheduler` must correctly leave an unapproved proposal
 * awaiting-approval rather than acting on it.
 */
describe('a CDSS-sourced bed proposal, Checked through the verification spine, reaches the same decision bedVerifier already reaches inline', () => {
  it('needs human approval for a CDSS-recommended AssignBed exactly like bedVerifier does, and the scheduler correctly leaves it awaiting-approval', async () => {
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see `bed/engine.ts`).
    const planResult = await planWithRetries<CdssBedContext, BedInstruction>(
      createCdssBedPlanner(),
      bedInstructionValidators,
      { description: 'bed board sweep' },
      { bedContext: contextWithAvailableBed, signals: [signal], strategy },
      '2026-08-01T00:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const inlineDecision = bedVerifier.verify(proposal);
    expect(inlineDecision.kind).toBe('needs-human-approval');

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllBedWorkers(proposalLog, recordStore);

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
      engine: bedEngine,
      initialContext: contextWithAvailableBed,
      recordedAt: '2026-08-01T00:02:00.000Z',
    });

    // No approval was ever supplied to the scheduler — same as calling
    // act() directly with no `approval`, which is exactly what
    // cdssBedPlanningEndToEnd.test.ts's own unresolved-approval test does.
    expect(results).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(shell.commits).toHaveLength(0);
  });

  it('a human approving afterward still commits, via the exact same mechanism the direct pipeline already uses', async () => {
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    const planResult = await planWithRetries<CdssBedContext, BedInstruction>(
      createCdssBedPlanner(),
      bedInstructionValidators,
      { description: 'bed board sweep' },
      { bedContext: contextWithAvailableBed, signals: [signal], strategy },
      '2026-08-01T00:00:00.000Z',
      1,
    );
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllBedWorkers(proposalLog, recordStore);

    const schedulerResults = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: bedEngine,
      initialContext: contextWithAvailableBed,
      recordedAt: '2026-08-01T00:02:00.000Z',
    });
    expect(schedulerResults).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(actedStore.hasActed(proposalId)).toBe(true);

    const decision = resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
    if (decision.kind !== 'resolved') throw new Error('expected resolved');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'coord-lin', displayName: 'Lin (bed coordinator)', roles: ['bed-coordinator'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, bedRiskTiers, EXAMPLE_bedApprovalPolicy, proposal, {
      approverId: 'coord-lin',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const latest = shell.readLatest() ?? contextWithAvailableBed;
    const finalOutcome = act(shell, {
      proposal,
      doOutcome: bedEngine.executeSequence(latest, proposal.instructions),
      decision: decision.decision,
      baselineContext: latest,
      reexecute: (ctx) => bedEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T00:05:01.000Z',
    });

    expect(finalOutcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.beds['bed-1']).toMatchObject({ status: 'occupied', encounterId: 'encounter-1' });
  });
});
