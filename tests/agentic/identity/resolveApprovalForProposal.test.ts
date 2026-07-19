import { describe, expect, it } from 'vitest';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { patientApprovalPolicy } from '../../../src/agentic/identity/patient.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { patientRiskTiers } from '../../../src/agentic/risk/patient.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

const identityProvider = createInMemoryIdentityProvider([
  { id: 'dr-chen', displayName: 'Dr. Chen', roles: ['physician'] },
  { id: 'nurse-wu', displayName: 'Nurse Wu', roles: ['charge-nurse'] },
  { id: 'nurse-lin', displayName: 'Nurse Lin', roles: ['reviewer'] },
]);

const admitProposal: PlanProposal<PatientInstruction> = {
  instructions: [
    {
      kind: 'AdmitPatient',
      patientId: patientId('patient-1'),
      encounterId: encounterId('encounter-1'),
      admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    },
  ],
  rationale: 'admit per triage note',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-19T00:00:00.000Z',
};

const dischargeProposal: PlanProposal<PatientInstruction> = {
  instructions: [{ kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-18T01:00:00.000Z') }],
  rationale: 'discharge per attending note',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-19T00:00:00.000Z',
};

function requestFrom(approverId: string): { approverId: string; approved: boolean; decidedAt: string } {
  return { approverId, approved: true, decidedAt: '2026-07-19T00:05:00.000Z' };
}

describe('resolveApprovalForProposal', () => {
  it("resolves AdmitPatient's review-required tier for a charge-nurse", () => {
    const result = resolveApprovalForProposal(
      identityProvider,
      patientRiskTiers,
      patientApprovalPolicy,
      admitProposal,
      requestFrom('nurse-wu'),
    );

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') throw new Error('expected resolved');
    expect(result.approval.approverRole).toBe('charge-nurse');
  });

  it("does not resolve AdmitPatient's review-required tier for a plain reviewer", () => {
    const result = resolveApprovalForProposal(
      identityProvider,
      patientRiskTiers,
      patientApprovalPolicy,
      admitProposal,
      requestFrom('nurse-lin'),
    );

    expect(result.kind).toBe('unresolved');
  });

  it("does not resolve DischargePatient's approval-required tier for a charge-nurse alone", () => {
    const result = resolveApprovalForProposal(
      identityProvider,
      patientRiskTiers,
      patientApprovalPolicy,
      dischargeProposal,
      requestFrom('nurse-wu'),
    );

    expect(result.kind).toBe('unresolved');
  });

  it("resolves DischargePatient's approval-required tier for a physician", () => {
    const result = resolveApprovalForProposal(
      identityProvider,
      patientRiskTiers,
      patientApprovalPolicy,
      dischargeProposal,
      requestFrom('dr-chen'),
    );

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') throw new Error('expected resolved');
    expect(result.approval.approverRole).toBe('physician');
  });
});
