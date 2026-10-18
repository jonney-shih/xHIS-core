import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { emergencyVerifier } from '../../../src/agentic/verification/emergency.js';
import { emergencyVisitId, encounterId, isoTimestamp, patientId } from '../../../src/instructions/emergency/ids.js';
import type { EmergencyInstruction } from '../../../src/instructions/emergency/types.js';

const registerVisit: EmergencyInstruction = {
  kind: 'RegisterEdVisit',
  visitId: emergencyVisitId('visit-1'),
  encounterId: encounterId('encounter-1'),
  patientId: patientId('patient-1'),
  chiefComplaint: 'Chest pain',
  registeredAt: isoTimestamp('2026-10-18T14:00:00.000Z'),
};

const triage: EmergencyInstruction = {
  kind: 'TriagePatient',
  visitId: emergencyVisitId('visit-1'),
  esiLevel: 2,
  triagedAt: isoTimestamp('2026-10-18T14:05:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<EmergencyInstruction>> = {}): PlanProposal<EmergencyInstruction> {
  return {
    instructions: [registerVisit],
    rationale: 'ED registration',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-10-18T13:59:00.000Z',
    ...overrides,
  };
}

describe('emergencyVerifier', () => {
  it('needs human approval for a review-required RegisterEdVisit, via risk tier alone', () => {
    expect(emergencyVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it("a sequence containing the approval-required TriagePatient still only needs human approval -- the risk-tier verifier itself doesn't distinguish the two non-auto tiers", () => {
    expect(emergencyVerifier.verify(proposal({ instructions: [registerVisit, triage] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = emergencyVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });
});
