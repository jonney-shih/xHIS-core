import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { schedulingVerificationWorkers, schedulingVerifier } from '../../../src/agentic/verification/scheduling.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp as verifiedAtTimestamp } from '../../../src/core/temporal.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingInstruction } from '../../../src/instructions/scheduling/types.js';

const scheduleBooking: SchedulingInstruction = {
  kind: 'ScheduleBooking',
  bookingId: bookingId('booking-1'),
  resourceId: resourceId('or-1'),
  subjectId: 'patient-1',
  startAt: isoTimestamp('2026-07-22T09:00:00.000Z'),
  endAt: isoTimestamp('2026-07-22T10:00:00.000Z'),
};

const cancelBooking: SchedulingInstruction = {
  kind: 'CancelBooking',
  bookingId: bookingId('booking-1'),
  cancelledAt: isoTimestamp('2026-07-22T02:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<SchedulingInstruction>> = {}): PlanProposal<SchedulingInstruction> {
  return {
    instructions: [scheduleBooking],
    rationale: 'booked per OR schedule request',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('schedulingVerifier', () => {
  it('needs human approval for ScheduleBooking, via risk tier alone', () => {
    expect(schedulingVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for CancelBooking too, at its own (higher) tier', () => {
    expect(schedulingVerifier.verify(proposal({ instructions: [cancelBooking] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = schedulingVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than SCHEDULING_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(scheduleBooking);
    const result = schedulingVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});

/**
 * The same claim proven for patient, bed, lab, and pharmacy, now for the
 * fifth real domain: folding `schedulingVerificationWorkers`'
 * independently recorded verdicts must reach the identical decision
 * `schedulingVerifier.verify` reaches inline. Scheduling's two tiers are
 * backed by `EXAMPLE_schedulingApprovalPolicy`'s disjoint role lists, so
 * this proves the spine reaches the correct tier even where the two
 * tiers' required roles don't overlap at all.
 */
describe('the scheduling domain Checked through the verification spine reaches the same decisions schedulingVerifier already reaches inline', () => {
  const requiredWorkers = schedulingVerificationWorkers.map((worker) => worker.workerId);
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xhis-scheduling-verification-spine-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function verifyThroughSpine(schedulingProposal: PlanProposal<SchedulingInstruction>) {
    const proposalLog = createFileProposalLog<SchedulingInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const proposalId = proposalLog.append(schedulingProposal);

    for (const worker of schedulingVerificationWorkers) {
      await runVerificationWorker(
        worker,
        proposalLog,
        createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
        recordStore,
        verifiedAtTimestamp('2026-07-31T00:01:00.000Z'),
      );
    }

    return resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
  }

  it('needs human approval for ScheduleBooking at review-required, exactly like schedulingVerifier does', async () => {
    const inlineDecision = schedulingVerifier.verify(proposal());
    expect(await verifyThroughSpine(proposal())).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('needs human approval for CancelBooking at its own, higher approval-required tier, exactly like schedulingVerifier does', async () => {
    const cancelProposal = proposal({ instructions: [cancelBooking] });
    const inlineDecision = schedulingVerifier.verify(cancelProposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });

    expect(await verifyThroughSpine(cancelProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('rejects a leaked-national-ID rationale exactly like schedulingVerifier does, without needing every worker to report', async () => {
    const leakyProposal = proposal({ rationale: 'national ID A123456789 confirms identity' });
    const inlineDecision = schedulingVerifier.verify(leakyProposal);
    expect(inlineDecision.kind).toBe('reject');

    expect(await verifyThroughSpine(leakyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('accepts a proposal with nothing to review, exactly like schedulingVerifier does', async () => {
    const emptyProposal = proposal({ instructions: [] });
    const inlineDecision = schedulingVerifier.verify(emptyProposal);
    expect(inlineDecision).toEqual({ kind: 'accept' });

    expect(await verifyThroughSpine(emptyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });
});
