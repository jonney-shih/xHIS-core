import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { schedulingVerifier } from '../../../src/agentic/verification/scheduling.js';
import { schedulingRiskTiers } from '../../../src/agentic/risk/scheduling.js';
import { EXAMPLE_schedulingApprovalPolicy } from '../../../src/agentic/identity/scheduling.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/scheduling.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { schedulingEngine } from '../../../src/instructions/scheduling/engine.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingEffect, SchedulingInstruction } from '../../../src/instructions/scheduling/types.js';

const emptySchedulingContext: SchedulingContext = { bookings: {} };

const scheduleBooking: SchedulingInstruction = {
  kind: 'ScheduleBooking',
  bookingId: bookingId('booking-1'),
  resourceId: resourceId('or-1'),
  subjectId: 'patient-1',
  startAt: isoTimestamp('2026-07-31T09:00:00.000Z'),
  endAt: isoTimestamp('2026-07-31T10:00:00.000Z'),
};

const scheduledContext: SchedulingContext = {
  bookings: {
    'booking-1': {
      bookingId: bookingId('booking-1'),
      resourceId: resourceId('or-1'),
      subjectId: 'patient-1',
      startAt: isoTimestamp('2026-07-31T09:00:00.000Z'),
      endAt: isoTimestamp('2026-07-31T10:00:00.000Z'),
      status: 'scheduled',
    },
  },
};

const cancelBooking: SchedulingInstruction = {
  kind: 'CancelBooking',
  bookingId: bookingId('booking-1'),
  cancelledAt: isoTimestamp('2026-07-31T11:00:00.000Z'),
};

const scheduleProposal: PlanProposal<SchedulingInstruction> = {
  instructions: [scheduleBooking],
  rationale: 'booked per OR schedule request',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-31T00:00:00.000Z',
};

const cancelProposal: PlanProposal<SchedulingInstruction> = {
  instructions: [cancelBooking],
  rationale: 'cancelled per patient request',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-31T11:00:00.000Z',
};

/**
 * The scheduling-domain counterpart to `bedApprovalFlowEndToEnd.test.ts`'s,
 * `labApprovalFlowEndToEnd.test.ts`'s, and `pharmacyApprovalFlowEndToEnd.test.ts`'s
 * real approval flows — same wiring, hand-constructed proposals.
 * `schedulingAgenticPipelineEndToEnd.test.ts` already proved a
 * `scheduling-coordinator` cannot approve `CancelBooking`; what this
 * file adds is the other half neither that test nor any prior domain's
 * approval-flow test could show — a real `or-director` *succeeding*
 * where the disjoint-role policy's lower tier fails, plus the UI panel
 * derivation and telemetry recording every other domain's own
 * approval-flow test already exercises.
 */
describe('scheduling domain approval flow, end to end', () => {
  it('a scheduling-coordinator may approve a ScheduleBooking (review-required), and it commits', () => {
    const doOutcome = schedulingEngine.executeSequence(emptySchedulingContext, scheduleProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = schedulingVerifier.verify(scheduleProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(scheduleProposal, decision);
    telemetryLog.record({ component: approvalPanel.component, outcome: 'rendered', reasons: decision.reasons, recordedAt: '2026-07-31T00:04:59.000Z' });
    expect(approvalPanel.props.bookingIds).toEqual(['booking-1']);

    const identityProvider = createInMemoryIdentityProvider([{ id: 'coord-hsu', displayName: 'Hsu (scheduling)', roles: ['scheduling-coordinator'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, schedulingRiskTiers, EXAMPLE_schedulingApprovalPolicy, scheduleProposal, {
      approverId: 'coord-hsu',
      approved: true,
      decidedAt: '2026-07-31T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>();
    const outcome = act(shell, {
      proposal: scheduleProposal,
      doOutcome,
      decision,
      baselineContext: emptySchedulingContext,
      reexecute: (ctx) => schedulingEngine.executeSequence(ctx, scheduleProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-31T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed', approval: { approverId: 'coord-hsu', approverRole: 'scheduling-coordinator' } });
  });

  it('the same scheduling-coordinator may NOT approve a CancelBooking (approval-required) — disjoint tiers, not a hierarchy, and nothing commits', () => {
    const doOutcome = schedulingEngine.executeSequence(scheduledContext, cancelProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = schedulingVerifier.verify(cancelProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'coord-hsu', displayName: 'Hsu (scheduling)', roles: ['scheduling-coordinator'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, schedulingRiskTiers, EXAMPLE_schedulingApprovalPolicy, cancelProposal, {
      approverId: 'coord-hsu',
      approved: true,
      decidedAt: '2026-07-31T11:05:00.000Z',
    });
    // Not impersonation this time -- a real, resolvable identity, just
    // one whose only role sits in the *other*, disjoint tier's list.
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>();
    const outcome = act(shell, {
      proposal: cancelProposal,
      doOutcome,
      decision,
      baselineContext: scheduledContext,
      reexecute: (ctx) => schedulingEngine.executeSequence(ctx, cancelProposal.instructions),
      recordedAt: '2026-07-31T11:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });

  it('an or-director may approve the same CancelBooking a scheduling-coordinator could not, and it commits', () => {
    const doOutcome = schedulingEngine.executeSequence(scheduledContext, cancelProposal.instructions);
    const decision = schedulingVerifier.verify(cancelProposal);
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'dir-chen', displayName: 'Chen (OR director)', roles: ['or-director'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, schedulingRiskTiers, EXAMPLE_schedulingApprovalPolicy, cancelProposal, {
      approverId: 'dir-chen',
      approved: true,
      decidedAt: '2026-07-31T11:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>();
    const outcome = act(shell, {
      proposal: cancelProposal,
      doOutcome,
      decision,
      baselineContext: scheduledContext,
      reexecute: (ctx) => schedulingEngine.executeSequence(ctx, cancelProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-31T11:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
  });
});
