import { describe, expect, it } from 'vitest';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/imaging.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingInstruction } from '../../../src/instructions/imaging/types.js';
import type { VerifyDecision } from '../../../src/agentic/verification/verifier.js';

function needsApproval(reasons: readonly string[]): Extract<VerifyDecision, { kind: 'needs-human-approval' }> {
  return { kind: 'needs-human-approval', reasons };
}

describe('deriveApprovalConfirmationPanel (imaging)', () => {
  it('summarizes a single OrderStudy instruction and carries the risk reasons and provenance through unchanged', () => {
    const proposal: PlanProposal<ImagingInstruction> = {
      instructions: [{ kind: 'OrderStudy', studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') }],
      rationale: 'ordered per attending note',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(["sequence contains an instruction at risk tier 'review-required'"]));

    expect(panel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        studyIds: ['study-1'],
        instructionSummary: ['OrderStudy — study-1 / CT'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
    });
  });

  it('summarizes RecordStudyStored, ReportStudy, and CancelStudy distinctly from OrderStudy, and de-duplicates a repeated studyId without merging distinct ones', () => {
    const proposal: PlanProposal<ImagingInstruction> = {
      instructions: [
        { kind: 'OrderStudy', studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
        { kind: 'RecordStudyStored', studyId: studyId('study-1'), storageRef: 'pacs://study-1', performedAt: isoTimestamp('2026-08-01T00:30:00.000Z') },
        { kind: 'ReportStudy', studyId: studyId('study-1'), reportText: 'No acute findings.', reportedAt: isoTimestamp('2026-08-01T01:00:00.000Z') },
        { kind: 'CancelStudy', studyId: studyId('study-2'), cancelledAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      ],
      rationale: 'end-of-shift batch',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(['proposal contains 4 instructions, exceeding the auto-reviewable limit of 2']));

    expect(panel.props.studyIds).toEqual(['study-1', 'study-2']); // deduplicated, not quadrupled
    expect(panel.props.instructionSummary).toEqual([
      'OrderStudy — study-1 / CT',
      'RecordStudyStored — study-1',
      'ReportStudy — study-1',
      'CancelStudy — study-2',
    ]);
  });

  it('never invents risk reasons — an empty reasons list stays empty, not a fabricated placeholder', () => {
    const proposal: PlanProposal<ImagingInstruction> = {
      instructions: [{ kind: 'CancelStudy', studyId: studyId('study-1'), cancelledAt: isoTimestamp('2026-08-01T00:00:00.000Z') }],
      rationale: 'test',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval([]));

    expect(panel.props.riskReasons).toEqual([]);
  });
});
