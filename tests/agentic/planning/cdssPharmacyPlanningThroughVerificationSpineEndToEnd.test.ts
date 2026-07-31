import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCdssPharmacyPlanner } from '../../../src/agentic/planning/cdssPharmacyPlanner.js';
import type { CdssPharmacyContext, PharmacyDispenseReadySignal } from '../../../src/agentic/planning/cdssPharmacyPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { pharmacyInstructionValidators } from '../../../src/agentic/validation/pharmacy.js';
import { pharmacyVerificationWorkers, pharmacyVerifier } from '../../../src/agentic/verification/pharmacy.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { pharmacyRiskTiers } from '../../../src/agentic/risk/pharmacy.js';
import { EXAMPLE_pharmacyApprovalPolicy } from '../../../src/agentic/identity/pharmacy.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { pharmacyEngine } from '../../../src/instructions/pharmacy/engine.js';
import { encounterId, prescriptionId } from '../../../src/instructions/pharmacy/ids.js';
import type { PharmacyContext, PharmacyEffect, PharmacyInstruction } from '../../../src/instructions/pharmacy/types.js';

const contextWithPrescribedRx: PharmacyContext = {
  prescriptions: {
    'rx-1': { prescriptionId: prescriptionId('rx-1'), encounterId: encounterId('encounter-1'), medicationCode: 'AMOX-500', status: 'prescribed', prescribedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
  },
};
const requiredWorkers = pharmacyVerificationWorkers.map((worker) => worker.workerId);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-cdss-pharmacy-through-spine-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newSpineFixtures() {
  return {
    proposalLog: createFileProposalLog<PharmacyInstruction>(join(dir, 'proposals.jsonl')),
    recordStore: createFileVerificationRecordStore(join(dir, 'records.jsonl')),
    actedStore: createFileSchedulerActedStore(join(dir, 'acted.jsonl')),
    shell: createInMemoryShell<PharmacyContext, PharmacyInstruction, PharmacyEffect>(),
  };
}

/** Mirrors `verifyWithAllLabWorkers` in the lab-domain CDSS spine test —
 * one independent, durably-cursored worker at a time, not a single
 * combined call. */
async function verifyWithAllPharmacyWorkers(
  proposalLog: ReturnType<typeof createFileProposalLog<PharmacyInstruction>>,
  recordStore: ReturnType<typeof createFileVerificationRecordStore>,
) {
  for (const worker of pharmacyVerificationWorkers) {
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
 * The pharmacy-domain counterpart to
 * `cdssLabPlanningThroughVerificationSpineEndToEnd.test.ts` — same
 * claim, now for a CDSS-sourced `DispenseMedication` proposal at
 * pharmacy's own top `approval-required` tier: folding
 * `pharmacyVerificationWorkers`' independently recorded verdicts via
 * `resolveVerificationState` must reach the identical decision
 * `pharmacyVerifier.verify` reaches inline, and `runScheduler` must
 * correctly leave an unapproved proposal awaiting-approval rather than
 * acting on it.
 */
describe('a CDSS-sourced pharmacy proposal, Checked through the verification spine, reaches the same decision pharmacyVerifier already reaches inline', () => {
  it('needs human approval for a CDSS-recommended DispenseMedication exactly like pharmacyVerifier does, and the scheduler correctly leaves it awaiting-approval', async () => {
    const signal: PharmacyDispenseReadySignal = { prescriptionId: prescriptionId('rx-1') };
    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see `pharmacy/engine.ts`).
    const planResult = await planWithRetries<CdssPharmacyContext, PharmacyInstruction>(
      createCdssPharmacyPlanner(),
      pharmacyInstructionValidators,
      { description: 'pharmacy queue sweep' },
      { pharmacyContext: contextWithPrescribedRx, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const inlineDecision = pharmacyVerifier.verify(proposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllPharmacyWorkers(proposalLog, recordStore);

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
      engine: pharmacyEngine,
      initialContext: contextWithPrescribedRx,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });

    // No approval was ever supplied to the scheduler — same as calling
    // act() directly with no `approval`, which is exactly what
    // cdssPharmacyPlanningEndToEnd.test.ts's own unresolved-approval
    // test does.
    expect(results).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(shell.commits).toHaveLength(0);
  });

  it('a human approving afterward still commits, via the exact same mechanism the direct pipeline already uses', async () => {
    const signal: PharmacyDispenseReadySignal = { prescriptionId: prescriptionId('rx-1') };
    const planResult = await planWithRetries<CdssPharmacyContext, PharmacyInstruction>(
      createCdssPharmacyPlanner(),
      pharmacyInstructionValidators,
      { description: 'pharmacy queue sweep' },
      { pharmacyContext: contextWithPrescribedRx, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllPharmacyWorkers(proposalLog, recordStore);

    const schedulerResults = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: pharmacyEngine,
      initialContext: contextWithPrescribedRx,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });
    expect(schedulerResults).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(actedStore.hasActed(proposalId)).toBe(true);

    const decision = resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
    if (decision.kind !== 'resolved') throw new Error('expected resolved');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'rph-tan', displayName: 'Tan (pharmacist)', roles: ['pharmacist'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, pharmacyRiskTiers, EXAMPLE_pharmacyApprovalPolicy, proposal, {
      approverId: 'rph-tan',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const latest = shell.readLatest() ?? contextWithPrescribedRx;
    const finalOutcome = act(shell, {
      proposal,
      doOutcome: pharmacyEngine.executeSequence(latest, proposal.instructions),
      decision: decision.decision,
      baselineContext: latest,
      reexecute: (ctx) => pharmacyEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(finalOutcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.prescriptions['rx-1']).toMatchObject({ status: 'dispensed' });
  });
});
