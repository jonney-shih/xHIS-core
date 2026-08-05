import { describe, expect, it } from 'vitest';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/pharmacy.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { encounterId, isoTimestamp, prescriptionId } from '../../../src/instructions/pharmacy/ids.js';
import type { PharmacyInstruction } from '../../../src/instructions/pharmacy/types.js';
import type { VerifyDecision } from '../../../src/agentic/verification/verifier.js';

function needsApproval(reasons: readonly string[]): Extract<VerifyDecision, { kind: 'needs-human-approval' }> {
  return { kind: 'needs-human-approval', reasons };
}

describe('deriveApprovalConfirmationPanel (pharmacy)', () => {
  it('summarizes a single PrescribeMedication instruction and carries the risk reasons and provenance through unchanged', () => {
    const proposal: PlanProposal<PharmacyInstruction> = {
      instructions: [
        { kind: 'PrescribeMedication', prescriptionId: prescriptionId('rx-1'), encounterId: encounterId('encounter-1'), medicationCode: 'AMOX-500', prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z') },
      ],
      rationale: 'prescribed per attending order',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(["sequence contains an instruction at risk tier 'review-required'"]));

    expect(panel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        prescriptionIds: ['rx-1'],
        instructionSummary: ['PrescribeMedication — rx-1 / AMOX-500'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
    });
  });

  it('summarizes DispenseMedication distinctly from PrescribeMedication, and de-duplicates a repeated prescriptionId without merging distinct ones', () => {
    const proposal: PlanProposal<PharmacyInstruction> = {
      instructions: [
        { kind: 'PrescribeMedication', prescriptionId: prescriptionId('rx-1'), encounterId: encounterId('encounter-1'), medicationCode: 'AMOX-500', prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z') },
        { kind: 'DispenseMedication', prescriptionId: prescriptionId('rx-1'), dispensedAt: isoTimestamp('2026-07-31T01:00:00.000Z') },
        { kind: 'PrescribeMedication', prescriptionId: prescriptionId('rx-2'), encounterId: encounterId('encounter-2'), medicationCode: 'IBU-200', prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z') },
      ],
      rationale: 'end-of-shift batch',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(['proposal contains 3 instructions, exceeding the auto-reviewable limit of 2']));

    expect(panel.props.prescriptionIds).toEqual(['rx-1', 'rx-2']); // deduplicated, not tripled
    expect(panel.props.instructionSummary).toEqual([
      'PrescribeMedication — rx-1 / AMOX-500',
      'DispenseMedication — rx-1',
      'PrescribeMedication — rx-2 / IBU-200',
    ]);
  });

  it('never invents risk reasons — an empty reasons list stays empty, not a fabricated placeholder', () => {
    const proposal: PlanProposal<PharmacyInstruction> = {
      instructions: [{ kind: 'DispenseMedication', prescriptionId: prescriptionId('rx-1'), dispensedAt: isoTimestamp('2026-07-31T00:00:00.000Z') }],
      rationale: 'test',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval([]));

    expect(panel.props.riskReasons).toEqual([]);
  });
});
