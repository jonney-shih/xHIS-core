import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { patientRiskTiers } from '../../../src/agentic/risk/patient.js';
import { createRiskTierVerifier } from '../../../src/agentic/verification/riskTierVerifier.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

const admit: PatientInstruction = {
  kind: 'AdmitPatient',
  patientId: patientId('patient-1'),
  encounterId: encounterId('encounter-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

const discharge: PatientInstruction = {
  kind: 'DischargePatient',
  encounterId: encounterId('encounter-1'),
  dischargedAt: isoTimestamp('2026-07-18T01:00:00.000Z'),
};

function proposalOf(instructions: readonly PatientInstruction[]): PlanProposal<PatientInstruction> {
  return {
    instructions,
    rationale: 'test proposal',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-19T00:00:00.000Z',
  };
}

describe('createRiskTierVerifier', () => {
  const verifier = createRiskTierVerifier(patientRiskTiers);

  it('accepts an empty sequence outright', () => {
    expect(verifier.verify(proposalOf([]))).toEqual({ kind: 'accept' });
  });

  it('requires human approval for a review-required instruction', () => {
    expect(verifier.verify(proposalOf([admit]))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('requires human approval for an approval-required instruction, even mixed with lower-tier ones', () => {
    expect(verifier.verify(proposalOf([admit, discharge]))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });
});
