import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExternalVerificationWorker } from '../../../src/agentic/verification/externalVerificationWorker.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker, workerId } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp, tick } from '../../../src/core/temporal.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { encounterId, patientId, isoTimestamp as patientIsoTimestamp } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import type { VerifyDecision } from '../../../src/agentic/verification/verifier.js';

/** A promise this test controls the resolution of, standing in for
 * whatever a real external harness would eventually resolve — no real
 * timers, so the test stays fast and deterministic while still proving
 * genuinely asynchronous, not merely `Promise.resolve()`-wrapped,
 * behavior. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const externalWorkerId = workerId('external-compliance');

function admitProposal(encounterNumber: number): PlanProposal<PatientInstruction> {
  return {
    instructions: [
      {
        kind: 'AdmitPatient',
        patientId: patientId(`patient-${encounterNumber}`),
        encounterId: encounterId(`encounter-${encounterNumber}`),
        admittedAt: patientIsoTimestamp('2026-07-29T00:00:00.000Z'),
      },
    ],
    rationale: 'test proposal',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-29T00:00:00.000Z',
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-external-verification-worker-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createExternalVerificationWorker — proving the async branch is genuinely non-blocking', () => {
  it("Plan's append is never delayed by a still-pending external check, and resolveVerificationState correctly reports pending until it resolves", async () => {
    const proposalLog = createFileProposalLog<PatientInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const deferred = createDeferred<VerifyDecision>();

    const worker = createExternalVerificationWorker<PatientInstruction>(externalWorkerId, () => deferred.promise);

    const firstProposalId = proposalLog.append(admitProposal(1));

    // Start the worker against the log. Its own `verify` call returns
    // `deferred.promise` synchronously, so `runVerificationWorker`
    // suspends at the `await` inside its loop — this promise is
    // intentionally not awaited yet, standing in for "the external call
    // is still in flight."
    const runPromise = runVerificationWorker(
      worker,
      proposalLog,
      createFileOutboxCursor(join(dir, 'cursor.jsonl')),
      recordStore,
      isoTimestamp('2026-07-29T00:01:00.000Z'),
    );

    // Plan keeps working regardless: a second proposal appends
    // immediately, with no dependency on the first proposal's
    // still-pending external check whatsoever.
    const secondProposalId = proposalLog.append(admitProposal(2));
    expect(secondProposalId).not.toBe(firstProposalId);
    expect(proposalLog.readSince(tick(0))).toHaveLength(2);

    // And verification genuinely hasn't happened yet — not "resolved
    // with an accept nobody checked," but actually still pending.
    expect(resolveVerificationState(recordStore.readAllFor(firstProposalId), [externalWorkerId])).toEqual({
      kind: 'pending',
      reportedBy: [],
      accumulated: { kind: 'accept' },
    });

    // Only now does the external check actually resolve.
    deferred.resolve({ kind: 'accept' });
    await runPromise;

    expect(resolveVerificationState(recordStore.readAllFor(firstProposalId), [externalWorkerId])).toEqual({
      kind: 'resolved',
      decision: { kind: 'accept' },
    });
  });

  it('the scheduler correctly leaves a proposal alone while its external check is in flight, and acts on it the moment it resolves', async () => {
    const proposalLog = createFileProposalLog<PatientInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const actedStore = createFileSchedulerActedStore(join(dir, 'acted.jsonl'));
    const shell = createInMemoryShell<PatientContext, PatientInstruction, PatientEffect>();
    const emptyContext: PatientContext = { encounters: {} };
    const deferred = createDeferred<VerifyDecision>();

    const worker = createExternalVerificationWorker<PatientInstruction>(externalWorkerId, () => deferred.promise);
    const proposalId = proposalLog.append(admitProposal(1));

    const schedulerInput = {
      proposalLog,
      recordStore,
      requiredWorkers: [externalWorkerId],
      actedStore,
      shell,
      engine: patientEngine,
      initialContext: emptyContext,
      recordedAt: '2026-07-29T00:02:00.000Z',
    };

    const runPromise = runVerificationWorker(
      worker,
      proposalLog,
      createFileOutboxCursor(join(dir, 'cursor.jsonl')),
      recordStore,
      isoTimestamp('2026-07-29T00:01:00.000Z'),
    );

    // A poll while the external check is still in flight must act on
    // nothing — not commit speculatively, not mark it acted.
    expect(runScheduler(schedulerInput)).toEqual([]);
    expect(shell.commits).toHaveLength(0);

    deferred.resolve({ kind: 'accept' });
    await runPromise;

    // Now that verification has actually resolved, the very next poll acts.
    expect(runScheduler(schedulerInput)).toEqual([{ proposalId, outcome: 'committed' }]);
    expect(shell.commits).toHaveLength(1);
  });
});
