import { describe, expect, it } from 'vitest';
import { toPlanProposal } from '../../../src/agentic/planning/toPlanProposal.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { schedulingInstructionValidators } from '../../../src/agentic/validation/scheduling.js';
import { schedulingVerifier } from '../../../src/agentic/verification/scheduling.js';
import { schedulingRiskTiers } from '../../../src/agentic/risk/scheduling.js';
import { EXAMPLE_schedulingApprovalPolicy } from '../../../src/agentic/identity/scheduling.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { schedulingEngine } from '../../../src/instructions/scheduling/engine.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingEffect, SchedulingInstruction } from '../../../src/instructions/scheduling/types.js';

/**
 * Proves the full Plan -> Do -> Check -> Approve -> Act pipeline
 * genuinely works for scheduling, not just that the types compile — the
 * fourth domain besides `patient` (after `lab`, `bed`, `ledger`)
 * exercised through the whole chain end to end.
 */
describe('scheduling agentic pipeline, end to end', () => {
  const emptySchedulingContext: SchedulingContext = { bookings: {} };

  it('a raw untrusted ScheduleBooking candidate flows through validation, Do, Check, approval, and Act to a real commit', () => {
    const proposalResult = toPlanProposal<SchedulingInstruction>(
      schedulingInstructionValidators,
      {
        instructions: [
          {
            kind: 'ScheduleBooking',
            bookingId: 'booking-1',
            resourceId: 'or-1',
            subjectId: 'patient-1',
            startAt: '2026-07-22T09:00:00.000Z',
            endAt: '2026-07-22T10:00:00.000Z',
          },
        ],
        rationale: 'booked per OR schedule request',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-22T00:00:00.000Z',
    );
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    const doOutcome = schedulingEngine.executeSequence(emptySchedulingContext, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = schedulingVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'coord-hsu', displayName: 'Hsu (scheduling)', roles: ['scheduling-coordinator'] },
    ]);

    const resolution = resolveApprovalForProposal(
      identityProvider,
      schedulingRiskTiers,
      EXAMPLE_schedulingApprovalPolicy,
      proposal,
      { approverId: 'coord-hsu', approved: true, decidedAt: '2026-07-22T00:05:00.000Z' },
    );
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptySchedulingContext,
      reexecute: (ctx) => schedulingEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-22T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.bookings['booking-1']).toMatchObject({ bookingId: 'booking-1', status: 'scheduled' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      approval: { approverId: 'coord-hsu', approverRole: 'scheduling-coordinator' },
    });
  });

  it('a malformed candidate never becomes a PlanProposal at all', () => {
    const proposalResult = toPlanProposal<SchedulingInstruction>(
      schedulingInstructionValidators,
      {
        instructions: [{ kind: 'ScheduleBooking', bookingId: '' }],
        rationale: 'malformed',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-22T00:00:00.000Z',
    );

    expect(proposalResult.ok).toBe(false);
  });

  it('a scheduling-coordinator cannot approve CancelBooking — the tiers use disjoint roles, not a hierarchy', () => {
    const bookedId = bookingId('booking-1');
    const cancelBooking: SchedulingInstruction = {
      kind: 'CancelBooking',
      bookingId: bookedId,
      cancelledAt: isoTimestamp('2026-07-22T11:00:00.000Z'),
    };
    const proposal: PlanProposal<SchedulingInstruction> = {
      instructions: [cancelBooking],
      rationale: 'cancelled per patient request',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-22T11:00:00.000Z',
    };

    const contextWithScheduledBooking: SchedulingContext = {
      bookings: {
        'booking-1': {
          bookingId: bookedId,
          resourceId: resourceId('or-1'),
          subjectId: 'patient-1',
          startAt: isoTimestamp('2026-07-22T09:00:00.000Z'),
          endAt: isoTimestamp('2026-07-22T10:00:00.000Z'),
          status: 'scheduled',
        },
      },
    };

    const doOutcome = schedulingEngine.executeSequence(contextWithScheduledBooking, proposal.instructions);
    const decision = schedulingVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'coord-hsu', displayName: 'Hsu (scheduling)', roles: ['scheduling-coordinator'] },
    ]);

    const resolution = resolveApprovalForProposal(
      identityProvider,
      schedulingRiskTiers,
      EXAMPLE_schedulingApprovalPolicy,
      proposal,
      { approverId: 'coord-hsu', approved: true, decidedAt: '2026-07-22T11:05:00.000Z' },
    );
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithScheduledBooking,
      reexecute: (ctx) => schedulingEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-07-22T11:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
