import { describe, expect, it } from 'vitest';
import { createCdssSchedulingPlanner } from '../../../src/agentic/planning/cdssSchedulingPlanner.js';
import type { CdssSchedulingContext, SchedulingDischargeSignal } from '../../../src/agentic/planning/cdssSchedulingPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { schedulingInstructionValidators } from '../../../src/agentic/validation/scheduling.js';
import { schedulingVerifier } from '../../../src/agentic/verification/scheduling.js';
import { schedulingRiskTiers } from '../../../src/agentic/risk/scheduling.js';
import { EXAMPLE_schedulingApprovalPolicy } from '../../../src/agentic/identity/scheduling.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/scheduling.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import { schedulingEngine } from '../../../src/instructions/scheduling/engine.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingEffect, SchedulingInstruction } from '../../../src/instructions/scheduling/types.js';

const contextWithScheduledBooking: SchedulingContext = {
  bookings: {
    'booking-1': {
      bookingId: bookingId('booking-1'),
      resourceId: resourceId('or-1'),
      subjectId: 'encounter-1',
      startAt: isoTimestamp('2026-08-01T09:00:00.000Z'),
      endAt: isoTimestamp('2026-08-01T10:00:00.000Z'),
      status: 'scheduled',
    },
  },
};

/**
 * The scheduling-domain counterpart to `cdssLabPlanningEndToEnd.test.ts`
 * and `cdssPharmacyPlanningEndToEnd.test.ts` — same `planWithRetries` ->
 * `toPlanProposal` -> Do -> Check -> approval -> Act pipeline, now
 * driven by `createCdssSchedulingPlanner`. Does not repeat the
 * `suggestVitalsEntryPanel`/`resolveUiRenderOutcome` tests for the same
 * reason every prior non-patient CDSS end-to-end file doesn't: no
 * Agent-selected UI component exists for scheduling.
 */
describe('CDSS scheduling-cancellation planning path, end to end', () => {
  it('retrying a deterministic rule against an unchanging bad timestamp produces the identical failure every attempt, unlike an LLM recovering from feedback', async () => {
    // Same reasoning `cdssLabPlanningEndToEnd.test.ts`'s own retry test
    // gives: `CancelBooking` never carries `subjectId`/`encounterId` at
    // all, so a malformed *signal* can't taint the output; `proposedAt`
    // is the one input that flows straight into `cancelledAt`
    // unvalidated, and `planWithRetries` passes the same one to every
    // attempt.
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1') };
    const planner = createCdssSchedulingPlanner();

    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see
    // `scheduling/engine.ts`).
    const result = await planWithRetries<CdssSchedulingContext, SchedulingInstruction>(
      planner,
      schedulingInstructionValidators,
      { description: 'discharge sweep' },
      { schedulingContext: contextWithScheduledBooking, signals: [signal] },
      'not-a-timestamp',
      3,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.attempts).toBe(3);
    expect(result.error.issues).toEqual(["instruction 0: 'cancelledAt' must be an ISO-8601 timestamp string"]);
  });

  it('a CDSS-recommended cancellation is not exempt from risk-tiered human approval, and a scheduling-coordinator cannot clear it — only an or-director can', async () => {
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1') };
    const planner = createCdssSchedulingPlanner();

    const planResult = await planWithRetries<CdssSchedulingContext, SchedulingInstruction>(
      planner,
      schedulingInstructionValidators,
      { description: 'discharge sweep' },
      { schedulingContext: contextWithScheduledBooking, signals: [signal] },
      '2026-08-01T11:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    // Do — against the real, plain `SchedulingContext`, entirely
    // decoupled from `CdssSchedulingContext`: Do/Check/Act never know or
    // care that this proposal came from a rule engine rather than a
    // model.
    const doOutcome = schedulingEngine.executeSequence(contextWithScheduledBooking, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    // Check — `CancelBooking` is `approval-required`, scheduling's own
    // top tier (see `risk/scheduling.ts`), so this must be
    // `needs-human-approval`, never `accept` outright.
    const decision = schedulingVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(proposal, decision);
    telemetryLog.record({
      component: approvalPanel.component,
      outcome: 'rendered',
      reasons: decision.reasons,
      recordedAt: '2026-08-01T11:04:59.000Z',
    });

    expect(approvalPanel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        bookingIds: ['booking-1'],
        instructionSummary: ['CancelBooking — booking-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'approval-required'"],
        modelVersion: 'cdss-scheduling-cancellation-rule-engine-v1',
        promptVersion: 'scheduling-cancellation-ruleset-v1',
      },
    });
    expect(telemetryLog.entries).toHaveLength(1);

    // Disjoint roles, not nested: a scheduling-coordinator holds the
    // *lower* tier's role, which shares nothing with the top tier's
    // required role — unlike pharmacy's physician, who fails by sitting
    // one tier too low inside a shared hierarchy.
    const coordinatorIdentityProvider = createInMemoryIdentityProvider([
      { id: 'coord-hsu', displayName: 'Hsu (scheduling)', roles: ['scheduling-coordinator'] },
    ]);
    const coordinatorResolution = resolveApprovalForProposal(coordinatorIdentityProvider, schedulingRiskTiers, EXAMPLE_schedulingApprovalPolicy, proposal, {
      approverId: 'coord-hsu',
      approved: true,
      decidedAt: '2026-08-01T11:05:00.000Z',
    });
    expect(coordinatorResolution.kind).toBe('unresolved');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'dir-chen', displayName: 'Chen (OR director)', roles: ['or-director'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, schedulingRiskTiers, EXAMPLE_schedulingApprovalPolicy, proposal, {
      approverId: 'dir-chen',
      approved: true,
      decidedAt: '2026-08-01T11:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithScheduledBooking,
      reexecute: (ctx) => schedulingEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T11:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.bookings['booking-1']).toMatchObject({ bookingId: 'booking-1', status: 'cancelled' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { modelVersion: 'cdss-scheduling-cancellation-rule-engine-v1', promptVersion: 'scheduling-cancellation-ruleset-v1' },
      approval: { approverId: 'dir-chen', approverRole: 'or-director' },
    });
  });

  it('an unresolved (impersonated) approval leaves a CDSS-recommended cancellation awaiting approval, never committed', async () => {
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1') };
    const planner = createCdssSchedulingPlanner();

    const planResult = await planWithRetries<CdssSchedulingContext, SchedulingInstruction>(
      planner,
      schedulingInstructionValidators,
      { description: 'discharge sweep' },
      { schedulingContext: contextWithScheduledBooking, signals: [signal] },
      '2026-08-01T11:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const doOutcome = schedulingEngine.executeSequence(contextWithScheduledBooking, proposal.instructions);
    const decision = schedulingVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'dir-chen', displayName: 'Chen (OR director)', roles: ['or-director'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, schedulingRiskTiers, EXAMPLE_schedulingApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-dir-chen',
      approved: true,
      decidedAt: '2026-08-01T11:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithScheduledBooking,
      reexecute: (ctx) => schedulingEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-08-01T11:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
