import { describe, expect, it } from 'vitest';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { EXAMPLE_patientApprovalPolicy } from '../../../src/agentic/identity/patient.js';
import { resolveActorForInstructions } from '../../../src/agentic/identity/resolveActorForInstructions.js';
import { patientRiskTiers } from '../../../src/agentic/risk/patient.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

const identityProvider = createInMemoryIdentityProvider([
  { id: 'dr-chen', displayName: 'Dr. Chen', roles: ['physician'] },
  { id: 'nurse-wu', displayName: 'Nurse Wu', roles: ['charge-nurse'] },
  { id: 'nurse-lin', displayName: 'Nurse Lin', roles: ['reviewer'] },
]);

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

function actorFrom(actorId: string) {
  return { actorId, assertedAt: '2026-07-19T00:05:00.000Z' };
}

describe('resolveActorForInstructions', () => {
  it("resolves AdmitPatient's review-required tier for a charge-nurse directly issuing it", () => {
    const result = resolveActorForInstructions(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, [admit], actorFrom('nurse-wu'));

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') throw new Error('expected resolved');
    expect(result.approval).toEqual({
      approverId: 'nurse-wu',
      approverRole: 'charge-nurse',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });
  });

  it('does not resolve for a plain reviewer, even for the lower review-required tier', () => {
    const result = resolveActorForInstructions(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, [admit], actorFrom('nurse-lin'));

    expect(result.kind).toBe('unresolved');
  });

  it("does not resolve DischargePatient's approval-required tier for a charge-nurse alone", () => {
    const result = resolveActorForInstructions(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, [discharge], actorFrom('nurse-wu'));

    expect(result.kind).toBe('unresolved');
  });

  it("resolves DischargePatient's approval-required tier for a physician directly issuing it", () => {
    const result = resolveActorForInstructions(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, [discharge], actorFrom('dr-chen'));

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') throw new Error('expected resolved');
    expect(result.approval.approverRole).toBe('physician');
  });

  it('reports no identity found for an unknown actor, distinct from an insufficient role', () => {
    const result = resolveActorForInstructions(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, [admit], actorFrom('someone-unregistered'));

    expect(result).toEqual({ kind: 'unresolved', reason: "no identity found for approver 'someone-unregistered'" });
  });
});
