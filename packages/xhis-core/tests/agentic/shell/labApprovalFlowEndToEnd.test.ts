import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { labVerifier } from '../../../src/agentic/verification/lab.js';
import { labRiskTiers } from '../../../src/agentic/risk/lab.js';
import { EXAMPLE_labApprovalPolicy } from '../../../src/agentic/identity/lab.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/lab.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { labEngine } from '../../../src/instructions/lab/engine.js';
import { encounterId, isoTimestamp, labOrderId } from '../../../src/instructions/lab/ids.js';
import type { LabContext, LabEffect, LabInstruction } from '../../../src/instructions/lab/types.js';

const emptyLabContext: LabContext = { orders: {} };

const orderTest: LabInstruction = {
  kind: 'OrderLabTest',
  orderId: labOrderId('order-1'),
  encounterId: encounterId('encounter-1'),
  testCode: 'CBC',
  orderedAt: isoTimestamp('2026-08-02T00:00:00.000Z'),
};

const orderedContext: LabContext = {
  orders: { 'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'ordered', orderedAt: isoTimestamp('2026-08-02T00:00:00.000Z') } },
};

const reportResult: LabInstruction = {
  kind: 'ReportLabResult',
  orderId: labOrderId('order-1'),
  result: 'WBC 7.2',
  resultedAt: isoTimestamp('2026-08-02T01:00:00.000Z'),
};

const orderProposal: PlanProposal<LabInstruction> = {
  instructions: [orderTest],
  rationale: 'ordered per attending note',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-08-02T00:00:00.000Z',
};

const reportProposal: PlanProposal<LabInstruction> = {
  instructions: [reportResult],
  rationale: 'resulted per LIS feed',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-08-02T01:00:00.000Z',
};

/**
 * The lab-domain counterpart to `cdssPlanningEndToEnd.test.ts`'s and
 * `bedApprovalFlowEndToEnd.test.ts`'s real approval flows — same
 * wiring, hand-constructed proposals for the identical reason bed's own
 * test file documents (no CDSS/LLM planner exists for lab either). What
 * this file adds that neither patient's nor bed's could: a real,
 * multi-role approval policy (`EXAMPLE_labApprovalPolicy`) where a
 * `lab-technologist` may approve the lower `review-required` tier but
 * not the higher `approval-required` one — proving the risk-tier ->
 * required-role lookup actually discriminates, not just that
 * *some* role can always approve *something*.
 */
describe('lab domain approval flow, end to end', () => {
  it('a lab-technologist may approve an OrderLabTest (review-required), and it commits', () => {
    const doOutcome = labEngine.executeSequence(emptyLabContext, orderProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = labVerifier.verify(orderProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(orderProposal, decision);
    telemetryLog.record({ component: approvalPanel.component, outcome: 'rendered', reasons: decision.reasons, recordedAt: '2026-08-02T00:04:59.000Z' });
    expect(approvalPanel.props.orderIds).toEqual(['order-1']);

    const identityProvider = createInMemoryIdentityProvider([{ id: 'tech-lin', displayName: 'Tech Lin', roles: ['lab-technologist'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, labRiskTiers, EXAMPLE_labApprovalPolicy, orderProposal, {
      approverId: 'tech-lin',
      approved: true,
      decidedAt: '2026-08-02T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<LabContext, LabInstruction, LabEffect>();
    const outcome = act(shell, {
      proposal: orderProposal,
      doOutcome,
      decision,
      baselineContext: emptyLabContext,
      reexecute: (ctx) => labEngine.executeSequence(ctx, orderProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-02T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed', approval: { approverId: 'tech-lin', approverRole: 'lab-technologist' } });
  });

  it('the same lab-technologist may NOT approve a ReportLabResult (approval-required) — physician-only, and nothing commits', () => {
    const doOutcome = labEngine.executeSequence(orderedContext, reportProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = labVerifier.verify(reportProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'tech-lin', displayName: 'Tech Lin', roles: ['lab-technologist'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, labRiskTiers, EXAMPLE_labApprovalPolicy, reportProposal, {
      approverId: 'tech-lin',
      approved: true,
      decidedAt: '2026-08-02T01:05:00.000Z',
    });
    // Not impersonation this time -- a real, resolvable identity, just
    // one that doesn't hold a sufficient role for *this* tier.
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<LabContext, LabInstruction, LabEffect>();
    const outcome = act(shell, {
      proposal: reportProposal,
      doOutcome,
      decision,
      baselineContext: orderedContext,
      reexecute: (ctx) => labEngine.executeSequence(ctx, reportProposal.instructions),
      recordedAt: '2026-08-02T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });

  it('a physician may approve the same ReportLabResult a lab-technologist could not, and it commits', () => {
    const doOutcome = labEngine.executeSequence(orderedContext, reportProposal.instructions);
    const decision = labVerifier.verify(reportProposal);
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'dr-lin', displayName: 'Dr. Lin', roles: ['physician'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, labRiskTiers, EXAMPLE_labApprovalPolicy, reportProposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-08-02T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<LabContext, LabInstruction, LabEffect>();
    const outcome = act(shell, {
      proposal: reportProposal,
      doOutcome,
      decision,
      baselineContext: orderedContext,
      reexecute: (ctx) => labEngine.executeSequence(ctx, reportProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-02T01:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
  });
});
