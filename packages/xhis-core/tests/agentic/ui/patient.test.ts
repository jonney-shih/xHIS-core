import { describe, expect, it } from 'vitest';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/patient.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';
import type { VerifyDecision } from '../../../src/agentic/verification/verifier.js';

function needsApproval(reasons: readonly string[]): Extract<VerifyDecision, { kind: 'needs-human-approval' }> {
  return { kind: 'needs-human-approval', reasons };
}

describe('deriveApprovalConfirmationPanel', () => {
  it('summarizes a single AdmitPatient instruction and carries the risk reasons and provenance through unchanged', () => {
    const proposal: PlanProposal<PatientInstruction> = {
      instructions: [
        { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-31T00:00:00.000Z') },
      ],
      rationale: 'CDSS triage rule: recommending admission for 1 emergent signal(s) not yet admitted',
      modelVersion: 'cdss-triage-rule-engine-v1',
      promptVersion: 'triage-ruleset-v1',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(["sequence contains an instruction at risk tier 'review-required'"]));

    expect(panel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        encounterIds: ['encounter-1'],
        instructionSummary: ['AdmitPatient — patient-1 / encounter-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'cdss-triage-rule-engine-v1',
        promptVersion: 'triage-ruleset-v1',
      },
    });
  });

  it('summarizes DischargePatient distinctly from AdmitPatient, and de-duplicates repeated encounters without merging distinct ones', () => {
    const proposal: PlanProposal<PatientInstruction> = {
      instructions: [
        { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-31T00:00:00.000Z') },
        { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-31T01:00:00.000Z') },
        { kind: 'AdmitPatient', patientId: patientId('patient-2'), encounterId: encounterId('encounter-2'), admittedAt: isoTimestamp('2026-07-31T00:00:00.000Z') },
      ],
      rationale: 'end-of-day sweep',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(['proposal contains 3 instructions, exceeding the auto-reviewable limit of 2']));

    expect(panel.props.encounterIds).toEqual(['encounter-1', 'encounter-2']); // deduplicated, not tripled
    expect(panel.props.instructionSummary).toEqual([
      'AdmitPatient — patient-1 / encounter-1',
      'DischargePatient — encounter-1',
      'AdmitPatient — patient-2 / encounter-2',
    ]);
  });

  it('never invents risk reasons — an empty reasons list stays empty, not a fabricated placeholder', () => {
    const proposal: PlanProposal<PatientInstruction> = {
      instructions: [{ kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-31T00:00:00.000Z') }],
      rationale: 'test',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval([]));

    expect(panel.props.riskReasons).toEqual([]);
  });
});
