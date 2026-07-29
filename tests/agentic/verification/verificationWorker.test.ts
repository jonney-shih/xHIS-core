import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMaxBatchSizeVerifier } from '../../../src/agentic/verification/batchSizeRule.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import {
  createFileVerificationRecordStore,
  runVerificationWorker,
  verifierAsWorker,
  workerId,
} from '../../../src/agentic/verification/verificationWorker.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { encounterId, patientId, isoTimestamp as patientIsoTimestamp } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';

let dir: string;
let proposalsFile: string;
let recordsFile: string;
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-verification-worker-'));
  proposalsFile = join(dir, 'proposals.jsonl');
  recordsFile = join(dir, 'records.jsonl');
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

describe('runVerificationWorker wrapping createMaxBatchSizeVerifier', () => {
  it('records one verdict per new proposal, matching what combineVerifiers would decide synchronously', async () => {
    const log = createFileProposalLog<PatientInstruction>(proposalsFile);
    const withinLimitId = log.append(proposalWithInstructionCount(2));
    const overLimitId = log.append(proposalWithInstructionCount(5));

    const worker = verifierAsWorker(workerId('max-batch-size'), createMaxBatchSizeVerifier<PatientInstruction>(3));
    const recordStore = createFileVerificationRecordStore(recordsFile);

    await runVerificationWorker(
      worker,
      log,
      createFileOutboxCursor(cursorFile),
      recordStore,
      isoTimestamp('2026-07-28T00:01:00.000Z'),
    );

    expect(recordStore.readAllFor(withinLimitId)).toEqual([
      {
        proposalId: withinLimitId,
        workerId: 'max-batch-size',
        decision: { kind: 'accept' },
        verifiedAt: '2026-07-28T00:01:00.000Z',
      },
    ]);
    expect(recordStore.readAllFor(overLimitId)).toEqual([
      {
        proposalId: overLimitId,
        workerId: 'max-batch-size',
        decision: {
          kind: 'needs-human-approval',
          reasons: ['proposal contains 5 instructions, exceeding the auto-reviewable limit of 3'],
        },
        verifiedAt: '2026-07-28T00:01:00.000Z',
      },
    ]);
  });

  it('a later run against the same cursor picks up only proposals appended since', async () => {
    const log = createFileProposalLog<PatientInstruction>(proposalsFile);
    log.append(proposalWithInstructionCount(1));

    const worker = verifierAsWorker(workerId('max-batch-size'), createMaxBatchSizeVerifier<PatientInstruction>(3));
    const recordStore = createFileVerificationRecordStore(recordsFile);
    const cursor = createFileOutboxCursor(cursorFile);

    await runVerificationWorker(worker, log, cursor, recordStore, isoTimestamp('2026-07-28T00:01:00.000Z'));
    expect(cursor.read()).toBe(1);

    const secondId = log.append(proposalWithInstructionCount(1));
    await runVerificationWorker(worker, log, cursor, recordStore, isoTimestamp('2026-07-28T00:02:00.000Z'));

    expect(cursor.read()).toBe(2);
    expect(recordStore.readAllFor(secondId)).toHaveLength(1);
  });

  /**
   * Mirrors `tests/integration/outboxRelay.test.ts`'s "safely redelivers
   * an already-processed admission if the cursor is ever behind where
   * bed state actually is" — same simulated failure (the cursor's own
   * progress is lost, e.g. a crash between recording a verdict and the
   * cursor advance landing on disk), same fix (`readSince` is
   * idempotent to call again from an earlier tick). The property proved
   * here is narrower than the domain-choreography case, and deliberately
   * so: `Verifier.verify` is pure, so redelivery can never disagree with
   * itself — a redelivered proposal gets a second, but never a
   * *conflicting*, record. This is not exactly-once recording (see
   * `runVerificationWorker`'s own doc comment); it's proof that
   * redelivery never loses a proposal or corrupts it with a differing
   * verdict.
   */
  it('redelivers safely after a lost cursor: no proposal is ever lost, and redelivery never produces a conflicting verdict', async () => {
    const log = createFileProposalLog<PatientInstruction>(proposalsFile);
    const firstId = log.append(proposalWithInstructionCount(2));
    const secondId = log.append(proposalWithInstructionCount(5));

    const worker = verifierAsWorker(workerId('max-batch-size'), createMaxBatchSizeVerifier<PatientInstruction>(3));
    const recordStore = createFileVerificationRecordStore(recordsFile);

    await runVerificationWorker(
      worker,
      log,
      createFileOutboxCursor(cursorFile),
      recordStore,
      isoTimestamp('2026-07-28T00:01:00.000Z'),
    );
    expect(recordStore.readAllFor(firstId)).toHaveLength(1);
    expect(recordStore.readAllFor(secondId)).toHaveLength(1);

    // Simulate the worst case this pattern is meant to survive: the
    // cursor's own record of progress never made it to disk, so a fresh
    // cursor starts back at 0 even though both proposals already have a
    // recorded verdict.
    const resetCursor = createFileOutboxCursor(join(dir, 'cursor-reset.jsonl'));
    await runVerificationWorker(worker, log, resetCursor, recordStore, isoTimestamp('2026-07-28T00:02:00.000Z'));

    expect(resetCursor.read()).toBe(2);

    const firstRecords = recordStore.readAllFor(firstId);
    const secondRecords = recordStore.readAllFor(secondId);

    // Redelivered, not lost: each proposal now has two records...
    expect(firstRecords).toHaveLength(2);
    expect(secondRecords).toHaveLength(2);
    // ...and never conflicting: verify is pure, so both records for a
    // given proposal always carry the identical decision.
    expect(firstRecords[0]!.decision).toEqual(firstRecords[1]!.decision);
    expect(secondRecords[0]!.decision).toEqual(secondRecords[1]!.decision);
    expect(secondRecords[0]!.decision.kind).toBe('needs-human-approval');
  });
});

/**
 * Closes the gap "Resolved: a genuinely async VerificationWorker, proven
 * non-blocking" deliberately left open: what happens when the external
 * call fails, not just when it's slow. Mirrors
 * `tests/integration/outboxRelay.test.ts`'s "advances the cursor even
 * when a reaction cannot be applied, so one stuck entry does not block
 * later ones" — same shape of proof, applied to a failing verification
 * call instead of a failing domain reaction.
 */
describe('runVerificationWorker — a failing verify() never crashes the loop or blocks a later proposal', () => {
  it('records a needs-human-approval verdict (never a silent accept, never reject) when verify() rejects, and still advances the cursor', async () => {
    const log = createFileProposalLog<PatientInstruction>(proposalsFile);
    const proposalId = log.append(proposalWithInstructionCount(1));

    const flakyWorker = verifierAsWorker(workerId('flaky-external-check'), {
      verify() {
        throw new Error('simulated network timeout');
      },
    });
    const recordStore = createFileVerificationRecordStore(recordsFile);
    const cursor = createFileOutboxCursor(cursorFile);

    await expect(
      runVerificationWorker(flakyWorker, log, cursor, recordStore, isoTimestamp('2026-07-28T00:01:00.000Z')),
    ).resolves.toBeUndefined();

    expect(cursor.read()).toBe(1);
    expect(recordStore.readAllFor(proposalId)).toEqual([
      {
        proposalId,
        workerId: 'flaky-external-check',
        decision: {
          kind: 'needs-human-approval',
          reasons: ["'flaky-external-check' failed to verify: simulated network timeout"],
        },
        verifiedAt: '2026-07-28T00:01:00.000Z',
      },
    ]);
  });

  it("one proposal's failing check does not block a later proposal in the same run", async () => {
    const log = createFileProposalLog<PatientInstruction>(proposalsFile);
    const failingProposalId = log.append(proposalWithInstructionCount(1));
    const healthyProposalId = log.append(proposalWithInstructionCount(2));

    let callCount = 0;
    const intermittentWorker = verifierAsWorker(workerId('intermittent-external-check'), {
      async verify() {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('simulated failure on the first call only');
        }
        return { kind: 'accept' };
      },
    });
    const recordStore = createFileVerificationRecordStore(recordsFile);
    const cursor = createFileOutboxCursor(cursorFile);

    await runVerificationWorker(intermittentWorker, log, cursor, recordStore, isoTimestamp('2026-07-28T00:01:00.000Z'));

    // Both proposals were processed in this single run -- the first
    // proposal's failure never stopped the loop from reaching the second.
    expect(cursor.read()).toBe(2);
    expect(recordStore.readAllFor(failingProposalId)[0]?.decision.kind).toBe('needs-human-approval');
    expect(recordStore.readAllFor(healthyProposalId)[0]?.decision).toEqual({ kind: 'accept' });
  });
});
