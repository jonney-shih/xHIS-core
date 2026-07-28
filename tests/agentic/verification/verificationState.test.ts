import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { combineVerifiers } from '../../../src/agentic/verification/combineVerifiers.js';
import { createMaxBatchSizeVerifier } from '../../../src/agentic/verification/batchSizeRule.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import {
  createFileVerificationRecordStore,
  runVerificationWorker,
  verifierAsWorker,
  workerId,
} from '../../../src/agentic/verification/verificationWorker.js';
import { foldVerdict, initialVerificationState, resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { encounterId, patientId, isoTimestamp as patientIsoTimestamp } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';

const workerA = workerId('worker-a');
const workerB = workerId('worker-b');

function proposalWithInstructionCount(count: number): PlanProposal<PatientInstruction> {
  return {
    instructions: Array.from({ length: count }, (_, index) => ({
      kind: 'AdmitPatient',
      patientId: patientId(`patient-${index}`),
      encounterId: encounterId(`encounter-${index}`),
      admittedAt: patientIsoTimestamp('2026-07-28T00:00:00.000Z'),
    })),
    rationale: 'test proposal',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-28T00:00:00.000Z',
  };
}

describe('foldVerdict / resolveVerificationState', () => {
  it('stays pending while fewer than every required worker has reported, and nothing severe has arrived', () => {
    const afterOne = foldVerdict(initialVerificationState(), workerA, { kind: 'accept' }, [workerA, workerB]);
    expect(afterOne).toEqual({ kind: 'pending', reportedBy: ['worker-a'], accumulated: { kind: 'accept' } });
  });

  it('resolves to accept once every required worker has reported accept', () => {
    const state = resolveVerificationState(
      [
        { workerId: workerA, decision: { kind: 'accept' } },
        { workerId: workerB, decision: { kind: 'accept' } },
      ],
      [workerA, workerB],
    );
    expect(state).toEqual({ kind: 'resolved', decision: { kind: 'accept' } });
  });

  it('resolves to needs-human-approval once every required worker has reported, merging reasons via the same severity rule combineVerifiers uses', () => {
    const state = resolveVerificationState(
      [
        { workerId: workerA, decision: { kind: 'accept' } },
        { workerId: workerB, decision: { kind: 'needs-human-approval', reasons: ['big batch'] } },
      ],
      [workerA, workerB],
    );
    expect(state).toEqual({
      kind: 'resolved',
      decision: { kind: 'needs-human-approval', reasons: ['big batch'] },
    });
  });

  it('resolves to reject the moment any worker reports it, without waiting for the rest of requiredWorkers', () => {
    const state = resolveVerificationState(
      [{ workerId: workerA, decision: { kind: 'reject', reasons: ['leaked id'] } }],
      [workerA, workerB], // worker-b has not reported at all
    );
    expect(state).toEqual({ kind: 'resolved', decision: { kind: 'reject', reasons: ['leaked id'] } });
  });

  it('a duplicate record from the same worker never double-counts toward the quorum', () => {
    // Exactly the shape runVerificationWorker's own redelivery test
    // produces: the same worker reporting the same decision twice.
    const state = resolveVerificationState(
      [
        { workerId: workerA, decision: { kind: 'accept' } },
        { workerId: workerA, decision: { kind: 'accept' } },
      ],
      [workerA, workerB],
    );
    // Still pending: only one *distinct* required worker has reported,
    // regardless of how many records that worker produced.
    expect(state).toEqual({ kind: 'pending', reportedBy: ['worker-a'], accumulated: { kind: 'accept' } });
  });

  it('folding a duplicate record after the state already resolved has no effect', () => {
    const resolved = foldVerdict(initialVerificationState(), workerA, { kind: 'reject', reasons: ['leaked id'] }, [
      workerA,
      workerB,
    ]);
    expect(resolved.kind).toBe('resolved');

    const foldedAgain = foldVerdict(resolved, workerA, { kind: 'reject', reasons: ['leaked id'] }, [workerA, workerB]);
    expect(foldedAgain).toBe(resolved); // same object: resolved is terminal, short-circuited before any merge
  });

  it('empty requiredWorkers resolves immediately to accept, regardless of records — same "nothing to wait for" semantics combineVerifiers() has for zero verifiers', () => {
    expect(resolveVerificationState([], [])).toEqual({ kind: 'resolved', decision: { kind: 'accept' } });
    expect(
      resolveVerificationState([{ workerId: workerA, decision: { kind: 'reject', reasons: ['irrelevant'] } }], []),
    ).toEqual({ kind: 'resolved', decision: { kind: 'accept' } });
  });
});

describe('end-to-end: independent VerificationWorkers fold to the same decision combineVerifiers would produce inline', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xhis-verification-state-e2e-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('two workers, each wrapping a different max-batch-size limit, fold to the stricter (more severe) decision', async () => {
    const proposal = proposalWithInstructionCount(4);
    const log = createFileProposalLog<PatientInstruction>(join(dir, 'proposals.jsonl'));
    const proposalId = log.append(proposal);

    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const lenientWorker = verifierAsWorker(workerId('lenient'), createMaxBatchSizeVerifier<PatientInstruction>(10));
    const strictWorker = verifierAsWorker(workerId('strict'), createMaxBatchSizeVerifier<PatientInstruction>(3));

    await runVerificationWorker(
      lenientWorker,
      log,
      createFileOutboxCursor(join(dir, 'cursor-lenient.jsonl')),
      recordStore,
      isoTimestamp('2026-07-28T00:01:00.000Z'),
    );
    await runVerificationWorker(
      strictWorker,
      log,
      createFileOutboxCursor(join(dir, 'cursor-strict.jsonl')),
      recordStore,
      isoTimestamp('2026-07-28T00:01:00.000Z'),
    );

    const state = resolveVerificationState(recordStore.readAllFor(proposalId), [
      lenientWorker.workerId,
      strictWorker.workerId,
    ]);

    const inline = combineVerifiers(
      createMaxBatchSizeVerifier<PatientInstruction>(10),
      createMaxBatchSizeVerifier<PatientInstruction>(3),
    ).verify(proposal);

    expect(state).toEqual({ kind: 'resolved', decision: inline });
    expect(inline.kind).toBe('needs-human-approval'); // sanity: the strict worker's limit is what actually bites
  });
});
