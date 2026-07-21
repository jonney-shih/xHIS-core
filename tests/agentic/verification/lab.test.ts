import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { labVerifier } from '../../../src/agentic/verification/lab.js';
import { encounterId, isoTimestamp, labOrderId } from '../../../src/instructions/lab/ids.js';
import type { LabInstruction } from '../../../src/instructions/lab/types.js';

const orderTest: LabInstruction = {
  kind: 'OrderLabTest',
  orderId: labOrderId('order-1'),
  encounterId: encounterId('encounter-1'),
  testCode: 'CBC',
  orderedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
};

const reportResult: LabInstruction = {
  kind: 'ReportLabResult',
  orderId: labOrderId('order-1'),
  result: 'WBC 7.2',
  resultedAt: isoTimestamp('2026-07-22T01:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<LabInstruction>> = {}): PlanProposal<LabInstruction> {
  return {
    instructions: [orderTest],
    rationale: 'ordered per attending note',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('labVerifier', () => {
  it('needs human approval for OrderLabTest, via risk tier alone', () => {
    expect(labVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for ReportLabResult too, at its own (higher) tier', () => {
    expect(labVerifier.verify(proposal({ instructions: [reportResult] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = labVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than LAB_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(orderTest);
    const result = labVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});
