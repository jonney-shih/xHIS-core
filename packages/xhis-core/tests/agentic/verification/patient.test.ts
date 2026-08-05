import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { patientVerifier } from '../../../src/agentic/verification/patient.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

const admit: PatientInstruction = {
  kind: 'AdmitPatient',
  patientId: patientId('patient-1'),
  encounterId: encounterId('encounter-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<PatientInstruction>> = {}): PlanProposal<PatientInstruction> {
  return {
    instructions: [admit],
    rationale: 'admit per triage note',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('patientVerifier', () => {
  it('needs human approval for a routine AdmitPatient, via risk tier alone', () => {
    expect(patientVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = patientVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });
});
