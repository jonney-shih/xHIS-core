import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { outpatientVerifier } from '../../../src/agentic/verification/outpatient.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/outpatient/ids.js';
import type { OutpatientInstruction } from '../../../src/instructions/outpatient/types.js';

const checkIn: OutpatientInstruction = {
  kind: 'CheckInPatient',
  encounterId: encounterId('encounter-1'),
  patientId: patientId('patient-1'),
  checkedInAt: isoTimestamp('2026-10-17T09:00:00.000Z'),
};

const completeEncounter: OutpatientInstruction = {
  kind: 'CompleteEncounter',
  encounterId: encounterId('encounter-1'),
  completedAt: isoTimestamp('2026-10-17T10:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<OutpatientInstruction>> = {}): PlanProposal<OutpatientInstruction> {
  return {
    instructions: [checkIn],
    rationale: 'routine outpatient visit',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-10-17T08:00:00.000Z',
    ...overrides,
  };
}

describe('outpatientVerifier', () => {
  it('needs human approval for a review-required CheckInPatient, via risk tier alone', () => {
    expect(outpatientVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it("a sequence containing the approval-required CompleteEncounter still only needs human approval -- the risk-tier verifier itself doesn't distinguish the two non-auto tiers", () => {
    expect(outpatientVerifier.verify(proposal({ instructions: [checkIn, completeEncounter] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = outpatientVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('needs human approval, for a second, independent reason, when the batch exceeds the max batch size', () => {
    const oversized = Array.from({ length: 21 }, () => checkIn);
    const result = outpatientVerifier.verify(proposal({ instructions: oversized }));

    expect(result).toEqual({
      kind: 'needs-human-approval',
      reasons: [
        'proposal contains 21 instructions, exceeding the auto-reviewable limit of 20',
        "sequence contains an instruction at risk tier 'review-required'",
      ],
    });
  });
});
