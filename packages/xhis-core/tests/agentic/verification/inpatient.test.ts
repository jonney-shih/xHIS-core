import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { inpatientVerifier } from '../../../src/agentic/verification/inpatient.js';
import { encounterId, isoTimestamp, staffId, wardAssignmentId } from '../../../src/instructions/inpatient/ids.js';
import type { InpatientInstruction } from '../../../src/instructions/inpatient/types.js';

const assignWard: InpatientInstruction = {
  kind: 'AssignWard',
  assignmentId: wardAssignmentId('assignment-1'),
  encounterId: encounterId('encounter-1'),
  ward: '5B',
  attendingStaffId: staffId('dr-lin'),
  assignedAt: isoTimestamp('2026-10-18T09:00:00.000Z'),
};

const transferWard: InpatientInstruction = {
  kind: 'TransferWard',
  newAssignmentId: wardAssignmentId('assignment-2'),
  encounterId: encounterId('encounter-1'),
  ward: '6A',
  attendingStaffId: staffId('dr-wu'),
  transferredAt: isoTimestamp('2026-10-18T11:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<InpatientInstruction>> = {}): PlanProposal<InpatientInstruction> {
  return {
    instructions: [assignWard],
    rationale: 'initial ward assignment',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-10-18T08:00:00.000Z',
    ...overrides,
  };
}

describe('inpatientVerifier', () => {
  it('needs human approval for a review-required AssignWard, via risk tier alone', () => {
    expect(inpatientVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it("a sequence containing the approval-required TransferWard still only needs human approval -- the risk-tier verifier itself doesn't distinguish the two non-auto tiers", () => {
    expect(inpatientVerifier.verify(proposal({ instructions: [assignWard, transferWard] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = inpatientVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('needs human approval, for a second, independent reason, when the batch exceeds the max batch size', () => {
    const oversized = Array.from({ length: 21 }, () => assignWard);
    const result = inpatientVerifier.verify(proposal({ instructions: oversized }));

    expect(result).toEqual({
      kind: 'needs-human-approval',
      reasons: [
        'proposal contains 21 instructions, exceeding the auto-reviewable limit of 20',
        "sequence contains an instruction at risk tier 'review-required'",
      ],
    });
  });
});
