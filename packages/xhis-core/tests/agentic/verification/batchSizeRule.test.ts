import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { createMaxBatchSizeVerifier } from '../../../src/agentic/verification/batchSizeRule.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

function proposalWith(count: number): PlanProposal<PatientInstruction> {
  const instructions: PatientInstruction[] = Array.from({ length: count }, (_, index) => ({
    kind: 'AdmitPatient',
    patientId: patientId(`patient-${index}`),
    encounterId: encounterId(`encounter-${index}`),
    admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
  }));

  return {
    instructions,
    rationale: 'batch size test',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-19T00:00:00.000Z',
  };
}

describe('createMaxBatchSizeVerifier', () => {
  const verifier = createMaxBatchSizeVerifier<PatientInstruction>(3);

  it('accepts a batch at the limit', () => {
    expect(verifier.verify(proposalWith(3))).toEqual({ kind: 'accept' });
  });

  it('requires human approval for a batch over the limit', () => {
    expect(verifier.verify(proposalWith(4))).toEqual({
      kind: 'needs-human-approval',
      reasons: ['proposal contains 4 instructions, exceeding the auto-reviewable limit of 3'],
    });
  });
});
