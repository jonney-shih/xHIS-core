import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCdssTriagePlanner } from '../../../src/agentic/planning/cdssPlanner.js';
import type { TriageSignal } from '../../../src/agentic/planning/cdssPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { patientInstructionValidators } from '../../../src/agentic/validation/patient.js';
import { patientVerificationWorkers, patientVerifier } from '../../../src/agentic/verification/patient.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { patientRiskTiers } from '../../../src/agentic/risk/patient.js';
import { EXAMPLE_patientApprovalPolicy } from '../../../src/agentic/identity/patient.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { encounterId, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';

const emptyPatientContext: PatientContext = { encounters: {} };
const requiredWorkers = patientVerificationWorkers.map((worker) => worker.workerId);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-cdss-through-spine-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newSpineFixtures() {
  return {
    proposalLog: createFileProposalLog<PatientInstruction>(join(dir, 'proposals.jsonl')),
    recordStore: createFileVerificationRecordStore(join(dir, 'records.jsonl')),
    actedStore: createFileSchedulerActedStore(join(dir, 'acted.jsonl')),
    shell: createInMemoryShell<PatientContext, PatientInstruction, PatientEffect>(),
  };
}

/** Runs every one of `patientVerificationWorkers` against everything new
 * in `proposalLog`, each against its own durable cursor — mirroring how
 * independent, separately deployed harnesses would each poll the same
 * log on their own schedule, not a single combined call. */
async function verifyWithAllPatientWorkers(
  proposalLog: ReturnType<typeof createFileProposalLog<PatientInstruction>>,
  recordStore: ReturnType<typeof createFileVerificationRecordStore>,
) {
  for (const worker of patientVerificationWorkers) {
    await runVerificationWorker(
      worker,
      proposalLog,
      createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
      recordStore,
      isoTimestamp('2026-07-29T00:01:00.000Z'),
    );
  }
}

/**
 * The same claim `verificationState.test.ts`'s end-to-end test already
 * proved for two synthetic `createMaxBatchSizeVerifier` instances, now
 * checked against the real, production patient Check assembly: folding
 * `patientVerificationWorkers`' independently recorded verdicts via
 * `resolveVerificationState` must reach the identical decision
 * `patientVerifier.verify` reaches inline. If it didn't, decoupling
 * Check from Plan would be an observable behavior change, not just a
 * latency one — exactly the risk "Proposed: a federated choreography
 * spine for verification" flagged and every slice since has had to
 * avoid.
 */
describe('the patient domain Checked through the verification spine reaches the same decisions patientVerifier already reaches inline', () => {
  it('accepts a proposal with nothing to review, exactly like patientVerifier does', async () => {
    const proposal: PlanProposal<PatientInstruction> = {
      instructions: [],
      rationale: 'nothing to admit or discharge this sweep',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-29T00:00:00.000Z',
    };
    const inlineDecision = patientVerifier.verify(proposal);
    expect(inlineDecision).toEqual({ kind: 'accept' });

    const { proposalLog, recordStore } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllPatientWorkers(proposalLog, recordStore);

    expect(resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers)).toEqual({
      kind: 'resolved',
      decision: inlineDecision,
    });
  });

  it('rejects a leaked-PII rationale exactly like patientVerifier does, without needing every worker to report', async () => {
    const proposal: PlanProposal<PatientInstruction> = {
      instructions: [],
      rationale: 'per phone call with the patient at 0912-345-678',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-29T00:00:00.000Z',
    };
    const inlineDecision = patientVerifier.verify(proposal);
    expect(inlineDecision.kind).toBe('reject');

    const { proposalLog, recordStore } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllPatientWorkers(proposalLog, recordStore);

    expect(resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers)).toEqual({
      kind: 'resolved',
      decision: inlineDecision,
    });
  });

  it('needs human approval for an AdmitPatient exactly like patientVerifier does, and the scheduler correctly leaves it awaiting-approval', async () => {
    const signal: TriageSignal = { patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), severity: 'emergent' };
    const planResult = await planWithRetries(
      createCdssTriagePlanner(),
      patientInstructionValidators,
      { description: 'triage sweep' },
      { patientContext: emptyPatientContext, signals: [signal] },
      '2026-07-29T00:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const inlineDecision = patientVerifier.verify(proposal);
    expect(inlineDecision.kind).toBe('needs-human-approval');

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllPatientWorkers(proposalLog, recordStore);

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
      engine: patientEngine,
      initialContext: emptyPatientContext,
      recordedAt: '2026-07-29T00:02:00.000Z',
    });

    // No approval was ever supplied to the scheduler — same as calling
    // act() directly with no `approval`, which is exactly what
    // cdssPlanningEndToEnd.test.ts's own unresolved-approval test does.
    expect(results).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(shell.commits).toHaveLength(0);
  });

  /**
   * The approval-arrives-later flow is deliberately outside
   * `runScheduler`'s own job (see `scheduler.ts`'s doc comment) — this
   * proves that boundary doesn't strand a proposal that went through the
   * spine. `SchedulerActedStore` marking it acted is scheduler-internal
   * bookkeeping only `runScheduler` itself consults; a separate caller —
   * exactly the one `cdssPlanningEndToEnd.test.ts`'s "commits once a
   * human approves" test already uses for the direct path — can still
   * call `act()` a second time once a real approval resolves, completely
   * unaffected by the scheduler having already touched this proposal.
   */
  it('a human approving afterward still commits, via the exact same mechanism the direct pipeline already uses', async () => {
    const signal: TriageSignal = { patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), severity: 'emergent' };
    const planResult = await planWithRetries(
      createCdssTriagePlanner(),
      patientInstructionValidators,
      { description: 'triage sweep' },
      { patientContext: emptyPatientContext, signals: [signal] },
      '2026-07-29T00:00:00.000Z',
      1,
    );
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllPatientWorkers(proposalLog, recordStore);

    const schedulerResults = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: patientEngine,
      initialContext: emptyPatientContext,
      recordedAt: '2026-07-29T00:02:00.000Z',
    });
    expect(schedulerResults).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(actedStore.hasActed(proposalId)).toBe(true);

    const decision = resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
    if (decision.kind !== 'resolved') throw new Error('expected resolved');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'dr-lin', displayName: 'Dr. Lin', roles: ['physician'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, proposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-29T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const latest = shell.readLatest() ?? emptyPatientContext;
    const finalOutcome = act(shell, {
      proposal,
      doOutcome: patientEngine.executeSequence(latest, proposal.instructions),
      decision: decision.decision,
      baselineContext: latest,
      reexecute: (ctx) => patientEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-29T00:05:01.000Z',
    });

    expect(finalOutcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.encounters['encounter-1']).toMatchObject({ status: 'admitted' });
  });
});
