import { describe, expect, it } from 'vitest';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/bed.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { bedId, isoTimestamp } from '../../../src/instructions/bed/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { BedInstruction } from '../../../src/instructions/bed/types.js';
import type { VerifyDecision } from '../../../src/agentic/verification/verifier.js';

function needsApproval(reasons: readonly string[]): Extract<VerifyDecision, { kind: 'needs-human-approval' }> {
  return { kind: 'needs-human-approval', reasons };
}

describe('deriveApprovalConfirmationPanel (bed)', () => {
  it('summarizes a single AssignBed instruction and carries the risk reasons and provenance through unchanged', () => {
    const proposal: PlanProposal<BedInstruction> = {
      instructions: [{ kind: 'AssignBed', bedId: bedId('bed-1'), encounterId: encounterId('encounter-1'), assignedAt: isoTimestamp('2026-08-01T00:00:00.000Z') }],
      rationale: 'assigned per bed board',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(["sequence contains an instruction at risk tier 'review-required'"]));

    expect(panel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        bedIds: ['bed-1'],
        instructionSummary: ['AssignBed — bed-1 / encounter-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
    });
  });

  it('summarizes ReleaseBed distinctly from AssignBed, and de-duplicates a repeated bedId without merging distinct ones', () => {
    const proposal: PlanProposal<BedInstruction> = {
      instructions: [
        { kind: 'AssignBed', bedId: bedId('bed-1'), encounterId: encounterId('encounter-1'), assignedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
        { kind: 'ReleaseBed', bedId: bedId('bed-1'), releasedAt: isoTimestamp('2026-08-01T01:00:00.000Z') },
        { kind: 'AssignBed', bedId: bedId('bed-2'), encounterId: encounterId('encounter-2'), assignedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      ],
      rationale: 'end-of-shift turnover',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(['proposal contains 3 instructions, exceeding the auto-reviewable limit of 2']));

    expect(panel.props.bedIds).toEqual(['bed-1', 'bed-2']); // deduplicated, not tripled
    expect(panel.props.instructionSummary).toEqual([
      'AssignBed — bed-1 / encounter-1',
      'ReleaseBed — bed-1',
      'AssignBed — bed-2 / encounter-2',
    ]);
  });

  it('never invents risk reasons — an empty reasons list stays empty, not a fabricated placeholder', () => {
    const proposal: PlanProposal<BedInstruction> = {
      instructions: [{ kind: 'ReleaseBed', bedId: bedId('bed-1'), releasedAt: isoTimestamp('2026-08-01T00:00:00.000Z') }],
      rationale: 'test',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval([]));

    expect(panel.props.riskReasons).toEqual([]);
  });
});
