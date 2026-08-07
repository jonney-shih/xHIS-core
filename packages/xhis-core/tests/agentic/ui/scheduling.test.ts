import { describe, expect, it } from 'vitest';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/scheduling.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingInstruction } from '../../../src/instructions/scheduling/types.js';
import type { VerifyDecision } from '../../../src/agentic/verification/verifier.js';

function needsApproval(reasons: readonly string[]): Extract<VerifyDecision, { kind: 'needs-human-approval' }> {
  return { kind: 'needs-human-approval', reasons };
}

describe('deriveApprovalConfirmationPanel (scheduling)', () => {
  it('summarizes a single ScheduleBooking instruction and carries the risk reasons and provenance through unchanged', () => {
    const proposal: PlanProposal<SchedulingInstruction> = {
      instructions: [
        { kind: 'ScheduleBooking', bookingId: bookingId('booking-1'), resourceId: resourceId('or-1'), subjectId: 'patient-1', startAt: isoTimestamp('2026-07-31T09:00:00.000Z'), endAt: isoTimestamp('2026-07-31T10:00:00.000Z') },
      ],
      rationale: 'booked per OR schedule request',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(["sequence contains an instruction at risk tier 'review-required'"]));

    expect(panel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        bookingIds: ['booking-1'],
        instructionSummary: ['ScheduleBooking — booking-1 / or-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
    });
  });

  it('summarizes CancelBooking distinctly from ScheduleBooking, and de-duplicates a repeated bookingId without merging distinct ones', () => {
    const proposal: PlanProposal<SchedulingInstruction> = {
      instructions: [
        { kind: 'ScheduleBooking', bookingId: bookingId('booking-1'), resourceId: resourceId('or-1'), subjectId: 'patient-1', startAt: isoTimestamp('2026-07-31T09:00:00.000Z'), endAt: isoTimestamp('2026-07-31T10:00:00.000Z') },
        { kind: 'CancelBooking', bookingId: bookingId('booking-1'), cancelledAt: isoTimestamp('2026-07-31T11:00:00.000Z') },
        { kind: 'ScheduleBooking', bookingId: bookingId('booking-2'), resourceId: resourceId('or-2'), subjectId: 'patient-2', startAt: isoTimestamp('2026-07-31T09:00:00.000Z'), endAt: isoTimestamp('2026-07-31T10:00:00.000Z') },
      ],
      rationale: 'end-of-day OR reshuffle',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(['proposal contains 3 instructions, exceeding the auto-reviewable limit of 2']));

    expect(panel.props.bookingIds).toEqual(['booking-1', 'booking-2']); // deduplicated, not tripled
    expect(panel.props.instructionSummary).toEqual([
      'ScheduleBooking — booking-1 / or-1',
      'CancelBooking — booking-1',
      'ScheduleBooking — booking-2 / or-2',
    ]);
  });

  it('never invents risk reasons — an empty reasons list stays empty, not a fabricated placeholder', () => {
    const proposal: PlanProposal<SchedulingInstruction> = {
      instructions: [{ kind: 'CancelBooking', bookingId: bookingId('booking-1'), cancelledAt: isoTimestamp('2026-07-31T00:00:00.000Z') }],
      rationale: 'test',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval([]));

    expect(panel.props.riskReasons).toEqual([]);
  });
});
