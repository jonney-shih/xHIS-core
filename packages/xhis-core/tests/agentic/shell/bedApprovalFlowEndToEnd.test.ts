import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { bedVerifier } from '../../../src/agentic/verification/bed.js';
import { bedRiskTiers } from '../../../src/agentic/risk/bed.js';
import { EXAMPLE_bedApprovalPolicy } from '../../../src/agentic/identity/bed.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/bed.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { bedEngine } from '../../../src/instructions/bed/engine.js';
import { bedId, isoTimestamp } from '../../../src/instructions/bed/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { BedContext, BedEffect, BedInstruction } from '../../../src/instructions/bed/types.js';

const emptyBedContext: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };

const assign: BedInstruction = {
  kind: 'AssignBed',
  bedId: bedId('bed-1'),
  encounterId: encounterId('encounter-1'),
  assignedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
};

const proposal: PlanProposal<BedInstruction> = {
  instructions: [assign],
  rationale: 'assigned per bed board',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-08-01T00:00:00.000Z',
};

/**
 * The bed-domain counterpart to `cdssPlanningEndToEnd.test.ts`'s real
 * approval flow — same wiring (derive the fixed panel from Check's
 * decision, approve against it, commit), built with a hand-constructed
 * proposal instead of a CDSS-sourced one. That's not a shortcut taken
 * here: bed has no CDSS/LLM planner today (see `ui/bed.ts`'s own doc
 * comment), so a hand-built proposal *is* what a real caller has to
 * work with, the same way `bedVerifier`'s own tests already do.
 */
describe('bed domain approval flow, end to end', () => {
  it('a bed assignment is not exempt from risk-tiered human approval, and commits only once a permitted identity approves', () => {
    const doOutcome = bedEngine.executeSequence(emptyBedContext, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = bedVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    // Coordinator Tan approves against this deterministically-derived
    // panel, not a bare data blob — same wiring point patient's own
    // approval flow uses.
    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(proposal, decision);
    telemetryLog.record({
      component: approvalPanel.component,
      outcome: 'rendered',
      reasons: decision.reasons,
      recordedAt: '2026-08-01T00:04:59.000Z',
    });

    expect(approvalPanel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        bedIds: ['bed-1'],
        instructionSummary: ['AssignBed — bed-1 / encounter-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
    });
    expect(telemetryLog.entries).toHaveLength(1);

    const identityProvider = createInMemoryIdentityProvider([{ id: 'coordinator-tan', displayName: 'Coordinator Tan', roles: ['bed-coordinator'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, bedRiskTiers, EXAMPLE_bedApprovalPolicy, proposal, {
      approverId: 'coordinator-tan',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<BedContext, BedInstruction, BedEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyBedContext,
      reexecute: (ctx) => bedEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      approval: { approverId: 'coordinator-tan', approverRole: 'bed-coordinator' },
    });
  });

  it('an unresolved (impersonated) approval leaves a bed assignment awaiting approval, never committed', () => {
    const doOutcome = bedEngine.executeSequence(emptyBedContext, proposal.instructions);
    const decision = bedVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([{ id: 'coordinator-tan', displayName: 'Coordinator Tan', roles: ['bed-coordinator'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, bedRiskTiers, EXAMPLE_bedApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-coordinator-tan',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<BedContext, BedInstruction, BedEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyBedContext,
      reexecute: (ctx) => bedEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-08-01T00:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
