import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { schedulingVerifier } from '../../../src/agentic/verification/scheduling.js';
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
