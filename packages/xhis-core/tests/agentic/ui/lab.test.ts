import { describe, expect, it } from 'vitest';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/lab.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { encounterId, isoTimestamp, labOrderId } from '../../../src/instructions/lab/ids.js';
import type { LabInstruction } from '../../../src/instructions/lab/types.js';
import type { VerifyDecision } from '../../../src/agentic/verification/verifier.js';

function needsApproval(reasons: readonly string[]): Extract<VerifyDecision, { kind: 'needs-human-approval' }> {
  return { kind: 'needs-human-approval', reasons };
}

describe('deriveApprovalConfirmationPanel (lab)', () => {
  it('summarizes a single OrderLabTest instruction and carries the risk reasons and provenance through unchanged', () => {
    const proposal: PlanProposal<LabInstruction> = {
      instructions: [{ kind: 'OrderLabTest', orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', orderedAt: isoTimestamp('2026-08-02T00:00:00.000Z') }],
      rationale: 'ordered per attending note',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-02T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(["sequence contains an instruction at risk tier 'review-required'"]));

    expect(panel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        orderIds: ['order-1'],
        instructionSummary: ['OrderLabTest — order-1 / CBC'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
    });
  });

  it('summarizes ReportLabResult and CancelLabOrder distinctly from OrderLabTest, and de-duplicates a repeated orderId without merging distinct ones', () => {
    const proposal: PlanProposal<LabInstruction> = {
      instructions: [
        { kind: 'OrderLabTest', orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', orderedAt: isoTimestamp('2026-08-02T00:00:00.000Z') },
        { kind: 'ReportLabResult', orderId: labOrderId('order-1'), result: 'WBC 7.2', resultedAt: isoTimestamp('2026-08-02T01:00:00.000Z') },
        { kind: 'CancelLabOrder', orderId: labOrderId('order-2'), cancelledAt: isoTimestamp('2026-08-02T00:00:00.000Z') },
      ],
      rationale: 'end-of-shift batch',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-02T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(['proposal contains 3 instructions, exceeding the auto-reviewable limit of 2']));

    expect(panel.props.orderIds).toEqual(['order-1', 'order-2']); // deduplicated, not tripled
    expect(panel.props.instructionSummary).toEqual([
      'OrderLabTest — order-1 / CBC',
      'ReportLabResult — order-1',
      'CancelLabOrder — order-2',
    ]);
  });

  it('never invents risk reasons — an empty reasons list stays empty, not a fabricated placeholder', () => {
    const proposal: PlanProposal<LabInstruction> = {
      instructions: [{ kind: 'CancelLabOrder', orderId: labOrderId('order-1'), cancelledAt: isoTimestamp('2026-08-02T00:00:00.000Z') }],
      rationale: 'test',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-02T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval([]));

    expect(panel.props.riskReasons).toEqual([]);
  });
});
