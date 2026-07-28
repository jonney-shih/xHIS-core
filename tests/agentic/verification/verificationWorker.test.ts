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
