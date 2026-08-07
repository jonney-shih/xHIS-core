import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, workerId } from '../../../src/agentic/verification/verificationWorker.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { encounterId, patientId, isoTimestamp as patientIsoTimestamp } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';

const workerA = workerId('worker-a');
const workerB = workerId('worker-b');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-scheduler-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function admitProposal(encounterNumber: number): PlanProposal<PatientInstruction> {
  return {
    instructions: [
      {
        kind: 'AdmitPatient',
        patientId: patientId(`patient-${encounterNumber}`),
        encounterId: encounterId(`encounter-${encounterNumber}`),
        admittedAt: patientIsoTimestamp('2026-07-28T00:00:00.000Z'),
      },
    ],
    rationale: 'test proposal',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-28T00:00:00.000Z',
  };
}

function newFixtures() {
  return {
    proposalLog: createFileProposalLog<PatientInstruction>(join(dir, 'proposals.jsonl')),
    recordStore: createFileVerificationRecordStore(join(dir, 'records.jsonl')),
    actedStore: createFileSchedulerActedStore(join(dir, 'acted.jsonl')),
    shell: createInMemoryShell<PatientContext, PatientInstruction, PatientEffect>(),
  };
}

const emptyContext: PatientContext = { encounters: {} };

describe('runScheduler', () => {
  it('acts on a proposal exactly once every required worker has reported accept, committing it', () => {
    const { proposalLog, recordStore, actedStore, shell } = newFixtures();
    const proposal = admitProposal(1);
    const proposalId = proposalLog.append(proposal);
    recordStore.record({ proposalId, workerId: workerA, decision: { kind: 'accept' }, verifiedAt: isoTimestamp('2026-07-28T00:01:00.000Z') });
    recordStore.record({ proposalId, workerId: workerB, decision: { kind: 'accept' }, verifiedAt: isoTimestamp('2026-07-28T00:01:00.000Z') });

    const results = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers: [workerA, workerB],
      actedStore,
      shell,
      engine: patientEngine,
      initialContext: emptyContext,
      recordedAt: '2026-07-28T00:02:00.000Z',
    });

    expect(results).toEqual([{ proposalId, outcome: 'committed' }]);
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.encounters['encounter-1']).toMatchObject({ status: 'admitted' });
    expect(actedStore.hasActed(proposalId)).toBe(true);
  });

  it('does not act while verification is still pending — no audit record, no commit', () => {
    const { proposalLog, recordStore, actedStore, shell } = newFixtures();
    const proposalId = proposalLog.append(admitProposal(1));
    recordStore.record({ proposalId, workerId: workerA, decision: { kind: 'accept' }, verifiedAt: isoTimestamp('2026-07-28T00:01:00.000Z') });
    // worker-b never reports.

    const results = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers: [workerA, workerB],
      actedStore,
      shell,
      engine: patientEngine,
      initialContext: emptyContext,
      recordedAt: '2026-07-28T00:02:00.000Z',
    });

    expect(results).toEqual([]);
    expect(shell.commits).toHaveLength(0);
    expect(shell.auditLog).toHaveLength(0);
    expect(actedStore.hasActed(proposalId)).toBe(false);
  });

  it('resolves and acts the moment one worker rejects, writing a rejected audit record without ever committing', () => {
    const { proposalLog, recordStore, actedStore, shell } = newFixtures();
    const proposalId = proposalLog.append(admitProposal(1));
    recordStore.record({
      proposalId,
      workerId: workerA,
      decision: { kind: 'reject', reasons: ['leaked id'] },
      verifiedAt: isoTimestamp('2026-07-28T00:01:00.000Z'),
    });
    // worker-b never reports — the reject short-circuits, so this must not matter.

    const results = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers: [workerA, workerB],
      actedStore,
      shell,
      engine: patientEngine,
      initialContext: emptyContext,
      recordedAt: '2026-07-28T00:02:00.000Z',
    });

    expect(results).toEqual([{ proposalId, outcome: 'rejected' }]);
    expect(shell.commits).toHaveLength(0);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'rejected', reasons: ['leaked id'] });
  });

  it('marks a proposal acted on an awaiting-approval outcome too, and never calls act on it again itself', () => {
    const { proposalLog, recordStore, actedStore, shell } = newFixtures();
    const proposalId = proposalLog.append(admitProposal(1));
    recordStore.record({
      proposalId,
      workerId: workerA,
      decision: { kind: 'needs-human-approval', reasons: ['big batch'] },
      verifiedAt: isoTimestamp('2026-07-28T00:01:00.000Z'),
    });

    const input = {
      proposalLog,
      recordStore,
      requiredWorkers: [workerA],
      actedStore,
      shell,
      engine: patientEngine,
      initialContext: emptyContext,
      recordedAt: '2026-07-28T00:02:00.000Z',
    };

    const firstRun = runScheduler(input);
    expect(firstRun).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(shell.auditLog).toHaveLength(1);

    // A later poll must not re-act on it — the human-approval loop-back
    // is a separate caller's job (see runScheduler's own doc comment),
    // not this polling loop retrying itself.
    const secondRun = runScheduler(input);
    expect(secondRun).toEqual([]);
    expect(shell.auditLog).toHaveLength(1);
  });

  /**
   * The property `runScheduler`'s own doc comment claims and this test
   * proves rather than assumes: resolution order does not have to match
   * `ProposalLog` order. Worker A is fast and has already rejected
   * proposal 2 (short-circuiting — resolved with no need for worker B at
   * all); worker B is slow and hasn't reported on proposal 1 (the
   * *earlier* proposal) at all yet, so proposal 1 is still pending. A
   * `SchedulerActedStore` keyed by cursor position rather than identity
   * could not represent "2 is done, 1 is not" — this is exactly why it's
   * a membership set.
   */
  it('acts on a later proposal that resolves before an earlier still-pending one, without getting stuck behind it', () => {
    const { proposalLog, recordStore, actedStore, shell } = newFixtures();
    const firstProposalId = proposalLog.append(admitProposal(1));
    const secondProposalId = proposalLog.append(admitProposal(2));

    recordStore.record({ proposalId: firstProposalId, workerId: workerA, decision: { kind: 'accept' }, verifiedAt: isoTimestamp('2026-07-28T00:01:00.000Z') });
    // worker-b never reports on proposal 1 -- it stays pending.
    recordStore.record({
      proposalId: secondProposalId,
      workerId: workerA,
      decision: { kind: 'reject', reasons: ['flagged'] },
      verifiedAt: isoTimestamp('2026-07-28T00:01:00.000Z'),
    });
    // worker-b never reports on proposal 2 either -- irrelevant, the reject already resolved it.

    const input = {
      proposalLog,
      recordStore,
      requiredWorkers: [workerA, workerB],
      actedStore,
      shell,
      engine: patientEngine,
      initialContext: emptyContext,
      recordedAt: '2026-07-28T00:02:00.000Z',
    };

    const firstPoll = runScheduler(input);
    expect(firstPoll).toEqual([{ proposalId: secondProposalId, outcome: 'rejected' }]);
    expect(actedStore.hasActed(firstProposalId)).toBe(false);
    expect(actedStore.hasActed(secondProposalId)).toBe(true);

    // worker-b finally reports on proposal 1.
    recordStore.record({ proposalId: firstProposalId, workerId: workerB, decision: { kind: 'accept' }, verifiedAt: isoTimestamp('2026-07-28T00:03:00.000Z') });

    const secondPoll = runScheduler(input);
    expect(secondPoll).toEqual([{ proposalId: firstProposalId, outcome: 'committed' }]);
    // Proposal 2 is not re-acted on, even though this poll saw it again in the log.
    expect(shell.commits).toHaveLength(1);
  });

  it('end-to-end against the real file-backed stores: a fresh runScheduler pointed at the same files picks up where the last one left off', () => {
    const proposalLog = createFileProposalLog<PatientInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const shell = createInMemoryShell<PatientContext, PatientInstruction, PatientEffect>();
    const actedFile = join(dir, 'acted.jsonl');

    const proposalId = proposalLog.append(admitProposal(1));
    recordStore.record({ proposalId, workerId: workerA, decision: { kind: 'accept' }, verifiedAt: isoTimestamp('2026-07-28T00:01:00.000Z') });

    runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers: [workerA],
      actedStore: createFileSchedulerActedStore(actedFile),
      shell,
      engine: patientEngine,
      initialContext: emptyContext,
      recordedAt: '2026-07-28T00:02:00.000Z',
    });
    expect(shell.commits).toHaveLength(1);

    // A brand-new process reopening the same acted-store file must not
    // re-commit the same admission a second time.
    const reopenedActedStore = createFileSchedulerActedStore(actedFile);
    expect(reopenedActedStore.hasActed(proposalId)).toBe(true);

    const secondRun = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers: [workerA],
      actedStore: reopenedActedStore,
      shell,
      engine: patientEngine,
      initialContext: emptyContext,
      recordedAt: '2026-07-28T00:03:00.000Z',
    });
    expect(secondRun).toEqual([]);
    expect(shell.commits).toHaveLength(1);
  });
});
